# -*- coding: utf-8 -*-
"""BSO isolated cadastral aerial runner: local SHP ZIP -> verified GeoJSON/maps.

No network is used until all requested PNU/JIBUN/land-category/CRS checks pass.
Never commit case configs, SHP archives, output maps, or API credentials.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import re
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import shapefile
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform as geo_transform

SCHEMA = "bso_cadastral_aerial_v1"
DISCLAIMER = "연속지적도는 참고도면. 법적 면적은 공부, 법적 경계는 지적측량 확인 필요."
PROVIDER_CREDIT = {
    "esri": "Esri World Imagery | Esri, Vantor, Earthstar Geographics and GIS User Community",
    "vworld": "VWorld Satellite (국토교통부 공간정보 오픈플랫폼)",
}
COLORS = [(242, 91, 60), (22, 170, 229), (248, 187, 53), (113, 206, 129)]
CATEGORY_CODES = {"대": {"대", "대지"}, "대지": {"대", "대지"},
                  "창": {"창", "창고용지"}, "창고용지": {"창", "창고용지"},
                  "답": {"답"}}


class MapBlocked(ValueError):
    """No map may be released for an unverified parcel or input."""


def filehash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return h.hexdigest()


def pnu_jibun(pnu: str) -> str:
    if not re.fullmatch(r"\d{19}", pnu) or pnu[10] not in ("1", "2"):
        raise MapBlocked("PNU_INVALID")
    main, sub = int(pnu[11:15]), int(pnu[15:19])
    if not main:
        raise MapBlocked("PNU_MAIN_ZERO")
    return ("산" if pnu[10] == "2" else "") + str(main) + (f"-{sub}" if sub else "")


def split_jibun(value: object) -> tuple[str, str]:
    text = re.sub(r"\s+", "", str(value or ""))
    m = re.fullmatch(r"(산?\d+(?:-\d+)?)([가-힣]*)", text)
    if not m:
        raise MapBlocked("JIBUN_UNREADABLE")
    return m.group(1), m.group(2)


def ensure_config(config: dict) -> list[dict]:
    if config.get("source_crs") != "EPSG:5174":
        raise MapBlocked("SOURCE_CRS_MUST_BE_EPSG_5174")
    if not re.fullmatch(r"[A-Za-z0-9_-]{2,64}", str(config.get("case_id", ""))):
        raise MapBlocked("CASE_ID_MUST_BE_NON_IDENTIFYING_ASCII")
    bounds = config.get("expected_bounds_wgs84")
    if not isinstance(bounds, list) or len(bounds) != 4 or not (
        -180 <= float(bounds[0]) < float(bounds[2]) <= 180
        and -90 <= float(bounds[1]) < float(bounds[3]) <= 90
    ):
        raise MapBlocked("EXPECTED_WGS84_BOUNDS_REQUIRED")
    parcels = config.get("parcels")
    if not isinstance(parcels, list) or not parcels or len(parcels) > 25:
        raise MapBlocked("PARCEL_COUNT_INVALID")
    seen = set()
    for p in parcels:
        pnu = str(p.get("pnu", ""))
        if pnu in seen:
            raise MapBlocked("DUPLICATE_REQUESTED_PNU")
        seen.add(pnu)
        expected = pnu_jibun(pnu)
        jibun = split_jibun(p.get("jibun"))[0]
        if expected != jibun:
            raise MapBlocked("PNU_JIBUN_SELF_MISMATCH")
        category = str(p.get("category", ""))
        if category not in ("대", "창고용지", "답") and not category:
            raise MapBlocked("CATEGORY_REQUIRED")
        if float(p.get("registered_area_m2", 0)) <= 0:
            raise MapBlocked("REGISTERED_AREA_INVALID")
    if config.get("provider", "esri") not in PROVIDER_CREDIT:
        raise MapBlocked("UNKNOWN_IMAGERY_PROVIDER")
    return parcels


def load_verified(zip_path: Path, config: dict) -> tuple[list[dict], dict]:
    """Read attributes before geometries. Reject zero/multiple/mismatched PNU."""
    parcels = ensure_config(config)
    if not zip_path.is_file() or zip_path.suffix.lower() != ".zip":
        raise MapBlocked("CADASTRAL_ZIP_NOT_FOUND")
    with zipfile.ZipFile(zip_path) as archive:
        if archive.testzip() is not None:
            raise MapBlocked("CADASTRAL_ZIP_CRC_FAILURE")
        members = archive.namelist()
        shps = [s for s in members if s.lower().endswith(".shp")]
        if len(shps) != 1:
            raise MapBlocked("EXPECTED_EXACTLY_ONE_SHP")
        stem = shps[0][:-4]
        def member(ext: str) -> bytes:
            matches = [s for s in members if s.lower() == (stem + ext).lower()]
            if len(matches) != 1:
                raise MapBlocked("MISSING_OR_DUPLICATE_" + ext[1:].upper())
            return archive.read(matches[0])
        reader = shapefile.Reader(
            shp=io.BytesIO(member(".shp")),
            shx=io.BytesIO(member(".shx")),
            dbf=io.BytesIO(member(".dbf")),
            encoding=config.get("dbf_encoding", "euc-kr"),
        )
        fields = [f[0] for f in reader.fields[1:]]
        fieldmap = {s.upper(): s for s in fields}
        if not {"PNU", "JIBUN"} <= set(fieldmap):
            raise MapBlocked("PNU_JIBUN_FIELDS_REQUIRED")
        index = {p["pnu"]: [] for p in parcels}
        for i, row in enumerate(reader.iterRecords()):
            d = dict(zip(fields, row))
            key = str(d[fieldmap["PNU"]]).strip()
            if key in index:
                index[key].append((i, d))
        if any(len(v) != 1 for v in index.values()):
            raise MapBlocked("PNU_EXACT_ONE_FAILED:" + ",".join(
                f"{k}={len(v)}" for k, v in index.items() if len(v) != 1
            ))
        to_wgs = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True)
        bbox = [float(x) for x in config["expected_bounds_wgs84"]]
        result = []
        for p in parcels:
            pos, attrs = index[p["pnu"]][0]
            raw_jibun = str(attrs[fieldmap["JIBUN"]])
            jibun, category = split_jibun(raw_jibun)
            if jibun != pnu_jibun(p["pnu"]):
                raise MapBlocked("JIBUN_EXACT_MISMATCH:" + p["pnu"])
            accepted = CATEGORY_CODES.get(p["category"], {p["category"]})
            if category not in accepted:
                raise MapBlocked("LAND_CATEGORY_MISMATCH:" + p["pnu"])
            geometry = shape(reader.shape(pos).__geo_interface__)
            if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in (
                "Polygon", "MultiPolygon"
            ) or geometry.area <= 0:
                raise MapBlocked("CADASTRAL_GEOMETRY_INVALID:" + p["pnu"])
            wgs = geo_transform(to_wgs.transform, geometry)
            xmin, ymin, xmax, ymax = wgs.bounds
            if not (bbox[0] <= xmin <= xmax <= bbox[2] and
                    bbox[1] <= ymin <= ymax <= bbox[3]):
                raise MapBlocked("COORDINATE_OUTSIDE_EXPECTED_BOUNDS:" + p["pnu"])
            result.append({
                "pnu": p["pnu"], "jibun": jibun, "category": p["category"],
                "raw_jibun": raw_jibun,
                "registered_area_m2": float(p["registered_area_m2"]),
                "incorporated_area_m2": p.get("incorporated_area_m2"),
                "geometry_area_m2": round(geometry.area, 3),
                "difference_pct": round(
                    (geometry.area / float(p["registered_area_m2"]) - 1) * 100, 2
                ),
                "wgs84_centroid": [round(wgs.centroid.x, 8), round(wgs.centroid.y, 8)],
                "original_epsg5174_centroid": [
                    round(geometry.centroid.x, 3), round(geometry.centroid.y, 3)
                ],
                "wgs84_geometry": wgs,
                "epsg5174_geometry": geometry,
            })
        return result, {"source_zip_sha256": filehash(zip_path),
                        "source_shp_name": shps[0], "source_crs": "EPSG:5174",
                        "dbf_encoding": config.get("dbf_encoding", "euc-kr"),
                        "features_checked": len(reader)}


def point_px(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    n = (2 ** zoom) * 256
    return (lon + 180) / 360 * n, (
        1 - math.asinh(math.tan(math.radians(lat))) / math.pi
    ) / 2 * n


def choose_view(items: list[dict], width: int, height: int, zoom_cap: int) -> tuple[int, float, float]:
    points = []
    for item in items:
        geom = item["wgs84_geometry"]
        xmin, ymin, xmax, ymax = geom.bounds
        points.extend([(xmin, ymin), (xmax, ymax)])
    for z in range(min(19, zoom_cap), 5, -1):
        vals = [point_px(lon, lat, z) for lon, lat in points]
        dx = max(x for x, y in vals) - min(x for x, y in vals)
        dy = max(y for x, y in vals) - min(y for x, y in vals)
        if dx < width * 0.74 and dy < height * 0.65:
            return z, (max(x for x, y in vals) + min(x for x, y in vals))/2, (
                max(y for x, y in vals) + min(y for x, y in vals))/2
    raise MapBlocked("MAP_EXTENT_TOO_LARGE")


def tile_url(provider: str, z: int, x: int, y: int) -> str:
    if provider == "esri":
        return ("https://server.arcgisonline.com/ArcGIS/rest/services/"
                f"World_Imagery/MapServer/tile/{z}/{y}/{x}")
    key = os.environ.get("VWORLD_API_KEY", "").strip()
    if not key:
        raise MapBlocked("VWORLD_API_KEY_NOT_CONFIGURED")
    return f"https://api.vworld.kr/req/wmts/1.0.0/{key}/Satellite/{z}/{y}/{x}.jpeg"


def fetch_tile(provider: str, z: int, x: int, y: int) -> Image.Image:
    url = tile_url(provider, z, x, y)
    headers = {"User-Agent": "Mozilla/5.0 BSO-Cadastral-Aerial/1.0",
               "Accept": "image/jpeg,image/png,*/*"}
    if provider == "vworld":
        headers["Referer"] = os.environ.get("VWORLD_DOMAIN", "http://localhost")
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            payload = response.read(2_000_000)
            content_type = str(response.headers.get("Content-Type", ""))
        if "image" not in content_type.lower() or len(payload) < 200:
            raise MapBlocked("INVALID_IMAGERY_TILE")
        img = Image.open(io.BytesIO(payload))
        img.load()
        return img.convert("RGB")
    except Exception as exc:
        # URL may contain a key. Do not leak exception/URL into logs or artifacts.
        raise MapBlocked(f"IMAGERY_TILE_FETCH_FAILED:{type(exc).__name__}") from None


def font(size: int, explicit: str | None = None) -> ImageFont.FreeTypeFont:
    paths = [explicit] if explicit else []
    paths += [
        "C:/Windows/Fonts/malgun.ttf",
        "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for path in paths:
        if path and Path(path).is_file():
            return ImageFont.truetype(path, size)
    raise MapBlocked("KOREAN_FONT_NOT_FOUND: use --font")


def geometry_rings(g):
    polygons = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    for poly in polygons:
        yield poly.exterior, list(poly.interiors)


def render_panel(items: list[dict], width: int, height: int, provider: str,
                 zoom_cap: int, cache: dict, font_path: str | None) -> Image.Image:
    z, cx, cy = choose_view(items, width, height, zoom_cap)
    x0, y0 = cx - width/2, cy - height/2
    xstart, ystart = int(math.floor(x0/256)), int(math.floor(y0/256))
    xend, yend = int(math.ceil((x0+width)/256)), int(math.ceil((y0+height)/256))
    if (xend-xstart)*(yend-ystart) > 150:
        raise MapBlocked("IMAGERY_TILE_LIMIT_EXCEEDED")
    base = Image.new("RGB", (width, height))
    for tx in range(xstart, xend):
        for ty in range(ystart, yend):
            key = (provider, z, tx, ty)
            if key not in cache:
                cache[key] = fetch_tile(provider, z, tx, ty)
            base.paste(cache[key], (int(round(tx*256-x0)), int(round(ty*256-y0))))
    overlay = Image.new("RGBA", base.size, (0,0,0,0))
    draw = ImageDraw.Draw(overlay)
    for i, item in enumerate(items):
        color = COLORS[i % len(COLORS)]
        for outer, holes in geometry_rings(item["wgs84_geometry"]):
            pts = [(round(point_px(a,b,z)[0]-x0),round(point_px(a,b,z)[1]-y0))
                   for a,b in outer.coords]
            draw.polygon(pts, fill=(*color, 75))
            for hole in holes:
                hpts = [(round(point_px(a,b,z)[0]-x0),round(point_px(a,b,z)[1]-y0))
                        for a,b in hole.coords]
                draw.polygon(hpts, fill=(0,0,0,0))
            draw.line(pts, fill=(255,255,255,255), width=7, joint="curve")
            draw.line(pts, fill=(*color,255), width=4, joint="curve")
        centroid = item["wgs84_geometry"].representative_point()
        px,py = point_px(centroid.x,centroid.y,z)
        draw.text((round(px-x0+10),round(py-y0-16)),
                  f'{item["jibun"]} / {item["registered_area_m2"]:g}m²',
                  font=font(27,font_path), fill="white", stroke_width=3, stroke_fill="#233047")
    out = Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")
    return out


def split_clusters(items: list[dict], threshold_m: float = 180) -> list[list[dict]]:
    """Separate far-apart parcels. No inferred cadastral connectivity."""
    pending = list(items)
    clusters = []
    while pending:
        cluster = [pending.pop(0)]
        changed = True
        while changed:
            changed = False
            for other in list(pending):
                if any(other["epsg5174_geometry"].distance(
                    chosen["epsg5174_geometry"]) <= threshold_m for chosen in cluster):
                    cluster.append(other)
                    pending.remove(other)
                    changed = True
        clusters.append(cluster)
    return clusters


def format_map(image: Image.Image, heading: str, subtitle: str,
               font_path: str | None, provider: str,
               capture_date: object, accuracy_m: object) -> Image.Image:
    out = Image.new("RGB", (image.width,image.height+152), "white")
    out.paste(image,(0,114))
    d = ImageDraw.Draw(out)
    d.rectangle((0,0,image.width,113),fill="#233047")
    d.text((28,18),heading,font=font(32,font_path),fill="white")
    d.text((28,68),subtitle,font=font(22,font_path),fill="#e6eef3")
    d.rectangle((0,image.height+114,image.width,image.height+151),fill="#233047")
    accuracy = f"{accuracy_m}m" if accuracy_m is not None else "미확인"
    source = PROVIDER_CREDIT[provider]
    d.text((20,image.height+124),
           f"영상: {source} / 촬영일: {capture_date or '미확인'} / 위치정확도: {accuracy}",
           font=font(17,font_path),fill="white")
    return out


def save_png_jpg(image: Image.Image, stem: Path) -> list[Path]:
    png,jpg=stem.with_suffix(".png"),stem.with_suffix(".jpg")
    image.save(png,format="PNG")
    image.save(jpg,format="JPEG",quality=92,subsampling=0)
    return [png,jpg]


def create_outputs(items: list[dict], input_meta: dict, config: dict, outdir: Path,
                   font_path: str | None = None) -> dict:
    provider = config.get("provider", "esri")
    cache = {}
    title = str(config.get("title") or config["case_id"])
    overview = format_map(
        render_panel(items,1616,900,provider,17,cache,font_path),
        title+" — 전체 항공위치도", "PNU 정확 일치 확인 / 소유·면적 원본검증 별도",
        font_path, provider, config.get("imagery_capture_date"),
        config.get("imagery_accuracy_m"))
    clusters=split_clusters(items)
    if len(clusters)>4:
        raise MapBlocked("TOO_MANY_DISTANT_PARCEL_CLUSTERS")
    panels=[render_panel(g,1600,1350,provider,19,cache,font_path) for g in clusters]
    wide=Image.new("RGB",(1600*len(panels),1350),"white")
    for i, panel in enumerate(panels):
        wide.paste(panel,(1600*i,0))
    detail=format_map(wide,title+" — 필지 경계 확대도",
                      f"분리 표시 구역 {len(clusters)}개 / 확대배율 구역별 자동조정",
                      font_path, provider, config.get("imagery_capture_date"),
                      config.get("imagery_accuracy_m"))
    root=outdir/config["case_id"]
    p_ov=save_png_jpg(overview,root.with_name(root.name+"_overview"))
    p_detail=save_png_jpg(detail,root.with_name(root.name+"_detail"))
    # One-page A4 raster PDF, all text remains visible in the JPG preview.
    page=Image.new("RGB",(2480,3508),"white")
    d=ImageDraw.Draw(page)
    d.text((100,90),title+" — 토지현황도",font=font(63,font_path),fill="#263347")
    y=205
    for it in items:
        line=(f'{it["jibun"]}   {it["category"]}   공부 {it["registered_area_m2"]:g}㎡'
              f'   도형 {it["geometry_area_m2"]:,.1f}㎡ ({it["difference_pct"]:+.1f}%)')
        d.text((110,y),line,font=font(36,font_path),fill="#263347")
        y+=70
    def paste_scaled(image,y,height):
        copy=image.copy()
        copy.thumbnail((2260,height),Image.Resampling.LANCZOS)
        page.paste(copy,((2480-copy.width)//2,y))
        return y+copy.height
    y=paste_scaled(overview,max(525,y+70),920)+50
    y=paste_scaled(detail,y,1400)+80
    info=(
        f'영상: {PROVIDER_CREDIT[provider]}',
        f'영상촬영일: {config.get("imagery_capture_date") or "미확인"}  |  원본 SHP: {input_meta["source_shp_name"]}',
        f'영상 제공자 위치정확도: {str(config.get("imagery_accuracy_m")) + "m" if config.get("imagery_accuracy_m") is not None else "미확인"}',
        f'좌표계: 원본 EPSG:5174 → WGS84 / 영상 WebMercator',
        DISCLAIMER,
        f'토지조서 원본대조: {"확인" if config.get("source_document_verified") else "미완료"}',
        "내부 검토 초안 / 대외 제출 전 담당변호사 검토·승인 필요",
    )
    for line in info:
        if y>3370:raise MapBlocked("PDF_PAGE_LAYOUT_OVERFLOW")
        d.text((95,y),line,font=font(27,font_path),fill="#263347")
        y+=48
    pdf=root.with_name(root.name+"_one_page.pdf")
    preview=root.with_name(root.name+"_one_page.jpg")
    page.save(pdf,"PDF",resolution=200.0)
    page.save(preview,"JPEG",quality=88)
    feature_coll={"type":"FeatureCollection","features":[{
        "type":"Feature","properties":{k:it[k] for k in (
          "pnu","jibun","category","registered_area_m2","geometry_area_m2","difference_pct")},
        "geometry":mapping(it["wgs84_geometry"])
    } for it in items]}
    geo=root.with_name(root.name+"_verified_wgs84.geojson")
    geo.write_text(json.dumps(feature_coll,ensure_ascii=False),encoding="utf-8")
    paths=[*p_ov,*p_detail,pdf,preview,geo]
    return {"files":[{"name":p.name,"sha256":filehash(p),"bytes":p.stat().st_size}
                     for p in paths], "clusters":len(clusters),
            "image_provider":provider,"tiles_downloaded":len(cache)}


def execute(config_path: Path, output: Path, font_path: str | None = None) -> dict:
    config=json.loads(config_path.read_text(encoding="utf-8"))
    ensure_config(config)
    archive=Path(config["archive"])
    if not archive.is_absolute():archive=(config_path.parent/archive).resolve()
    items,meta=load_verified(archive,config)
    # Only after exact-one/JIBUN/category/CRS/geometry checks are imagery tiles requested.
    if output.exists() and any(p.name.startswith(config["case_id"]+"_") for p in output.iterdir()):
        raise MapBlocked("PREVIOUS_OUTPUT_EXISTS_USE_NEW_DIRECTORY")
    output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="bso-aerial-") as tmp:
        tmpdir=Path(tmp)
        produced=create_outputs(items,meta,config,tmpdir,font_path)
        report={
            "schema_version":SCHEMA,"geometry_status":"PASS",
            "delivery_status":"DRAFT_REVIEW_REQUIRED",
            "source_document_verified":config.get("source_document_verified") is True,
            "imagery_source":PROVIDER_CREDIT[config.get("provider","esri")],
            "imagery_capture_date":config.get("imagery_capture_date"),
            "imagery_accuracy_m":config.get("imagery_accuracy_m"),
            "source":meta,
            "parcels":[{
                k:v for k,v in it.items() if k not in ("wgs84_geometry","epsg5174_geometry")
            } for it in items],
            "outputs":produced,
            "disclaimer":DISCLAIMER,
        }
        path=tmpdir/(config["case_id"]+"_verification.json")
        path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        for file in tmpdir.iterdir():
            os.replace(file,output/file.name)
    return report


def main() -> int:
    parser=argparse.ArgumentParser(description="BSO local cadastral ZIP aerial-map SOP v1")
    parser.add_argument("--config",type=Path,required=True)
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--font",default=None)
    args=parser.parse_args()
    try:
        report=execute(args.config,args.out,args.font)
    except (MapBlocked,OSError,ValueError,KeyError,zipfile.BadZipFile) as exc:
        # Avoid external exception text, which may contain an API credential or raw URL.
        reason=str(exc) if isinstance(exc,MapBlocked) else type(exc).__name__
        print(json.dumps({"status":"BLOCKED","reason":reason},ensure_ascii=False))
        return 2
    print(json.dumps({"status":"DRAFT_REVIEW_REQUIRED","geometry_status":"PASS",
                      "files":[o["name"] for o in report["outputs"]["files"]]},
                     ensure_ascii=False))
    return 0


if __name__=="__main__":
    raise SystemExit(main())
