"""Isolated cadastral aerial tests with synthetic PNU and an offline tile source.

No real owner, parcel number, cadastral geometry, or imagery is committed.
"""
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest
import shapefile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import cadastral_aerial as aerial  # noqa: E402


BASE_PNU = "9999900000" + "1" + "0001" + "0001"
PNU_B = "9999900000" + "1" + "0001" + "0002"


def make_archive(tmp_path: Path, rows: list[tuple[str, str]], fname="test.zip") -> Path:
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    w = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON,
                         encoding="euc-kr")
    w.field("PNU", "C", size=19)
    w.field("JIBUN", "C", size=40)
    for i, (pnu, jibun) in enumerate(rows):
        x, y = 200000 + (i * 25), 350000 + (i * 20)
        w.poly([[(x, y), (x, y+10), (x+10, y+10), (x+10, y), (x, y)]])
        w.record(pnu, jibun)
    w.close()
    target = tmp_path / fname
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for ext, raw in {"shp": shp, "shx": shx, "dbf": dbf}.items():
            z.writestr("LDREG." + ext, raw.getvalue())
        z.writestr("LDREG.prj", "This PRJ is intentionally not used; EPSG code is explicit.")
    return target


def make_config(tmp_path: Path, archive: Path, parcels=None) -> Path:
    payload = {
        "case_id": "SYNTHETIC_TEST",
        "title": "합성 GIS 지도 검증",
        "archive": archive.name,
        "source_crs": "EPSG:5174",
        "dbf_encoding": "euc-kr",
        "expected_bounds_wgs84": [126.5, 36.2, 127.5, 37.1],
        "provider": "esri",
        "source_document_verified": False,
        "parcels": parcels or [
            {"pnu": BASE_PNU, "jibun": "1-1",
             "category": "대", "registered_area_m2": 100},
        ],
    }
    config = tmp_path / "config.json"
    config.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return config


def test_pnu_jibun_mapping_and_strict_19_digits():
    assert aerial.pnu_jibun(BASE_PNU) == "1-1"
    assert aerial.pnu_jibun("9999900000" + "2" + "0012" + "0000") == "산12"
    with pytest.raises(aerial.MapBlocked, match="PNU_INVALID"):
        aerial.pnu_jibun("12345")


def test_exact_one_and_epsg_transformation(tmp_path):
    path = make_archive(tmp_path, [(BASE_PNU, "1-1대")])
    config = json.loads(make_config(tmp_path, path).read_text(encoding="utf-8"))
    rows,meta = aerial.load_verified(path,config)
    assert meta["source_crs"] == "EPSG:5174"
    assert meta["features_checked"] == 1
    assert rows[0]["jibun"] == "1-1"
    assert rows[0]["geometry_area_m2"] == 100
    lon, lat = rows[0]["wgs84_centroid"]
    assert 126.5 < lon < 127.5 and 36.2 < lat < 37.1
    assert rows[0]["difference_pct"] == 0.0


@pytest.mark.parametrize("entries,error",[
    ([], "PNU_EXACT_ONE_FAILED"),
    ([(BASE_PNU,"1-1대"),(BASE_PNU,"1-1대")], "PNU_EXACT_ONE_FAILED"),
    ([(BASE_PNU,"1-11대")], "JIBUN_EXACT_MISMATCH"),
    ([(BASE_PNU,"1-1답")], "LAND_CATEGORY_MISMATCH"),
])
def test_fail_closed_bad_pnu_jibun_category(tmp_path,entries,error):
    src = make_archive(tmp_path,entries)
    config=make_config(tmp_path,src)
    with pytest.raises(aerial.MapBlocked, match=error):
        aerial.execute(config,tmp_path/"out")
    assert not (tmp_path/"out").exists()


def test_second_parcel_can_use_warehouse_land_category_suffix(tmp_path):
    path=make_archive(tmp_path,[(PNU_B,"1-2창")])
    config=json.loads(make_config(tmp_path,path).read_text(encoding="utf-8"))
    config["parcels"]=[{"pnu":PNU_B,"jibun":"1-2",
                        "category":"창고용지","registered_area_m2":100}]
    parsed,_=aerial.load_verified(path,config)
    assert parsed[0]["category"] == "창고용지"


def test_bound_rejection_blocks_output(tmp_path):
    archive=make_archive(tmp_path,[(BASE_PNU,"1-1대")])
    config_path=make_config(tmp_path,archive)
    payload=json.loads(config_path.read_text(encoding="utf-8"))
    payload["expected_bounds_wgs84"]=[125.0,34.0,126.0,35.0]
    config_path.write_text(json.dumps(payload,ensure_ascii=False),encoding="utf-8")
    with pytest.raises(aerial.MapBlocked,match="COORDINATE_OUTSIDE_EXPECTED_BOUNDS"):
        aerial.execute(config_path,tmp_path/"out")
    assert not (tmp_path/"out").exists()


def test_complete_outputs_with_mock_imagery(tmp_path,monkeypatch):
    archive=make_archive(tmp_path,[(BASE_PNU,"1-1대"),(PNU_B,"1-2창")])
    parcels=[
      {"pnu":BASE_PNU,"jibun":"1-1","category":"대","registered_area_m2":100},
      {"pnu":PNU_B,"jibun":"1-2","category":"창고용지","registered_area_m2":100},
    ]
    config=make_config(tmp_path,archive,parcels)
    requested=[]
    def fake_tile(provider,z,x,y):
        requested.append((provider,z,x,y))
        return Image.new("RGB",(256,256),(130,165,160))
    monkeypatch.setattr(aerial,"fetch_tile",fake_tile)
    output=tmp_path/"out"
    report=aerial.execute(config,output)
    assert report["geometry_status"] == "PASS"
    assert report["delivery_status"] == "DRAFT_REVIEW_REQUIRED"
    assert report["source_document_verified"] is False
    assert len(requested)>0
    names={p.name for p in output.iterdir()}
    assert len(names)==8, names
    assert any(name.endswith("_one_page.pdf") for name in names)
    assert any(name.endswith("_verified_wgs84.geojson") for name in names)
    for entry in report["outputs"]["files"]:
        assert (output/entry["name"]).stat().st_size == entry["bytes"]
        assert aerial.filehash(output/entry["name"]) == entry["sha256"]
    with Image.open(next(output.glob("*_detail.png"))) as im:
        im.verify()
    with Image.open(next(output.glob("*_one_page.jpg"))) as im:
        assert im.size == (2480,3508)
    geojson=json.loads(next(output.glob("*_verified_wgs84.geojson")).read_text(encoding="utf-8"))
    assert len(geojson["features"])==2
    assert all(f["geometry"]["type"] in ("Polygon","MultiPolygon") for f in geojson["features"])
    assert "법적 경계" in report["disclaimer"]


def test_source_crs_must_be_explicit_and_provider_does_not_default_to_vworld(tmp_path):
    archive=make_archive(tmp_path,[(BASE_PNU,"1-1대")])
    config=json.loads(make_config(tmp_path,archive).read_text(encoding="utf-8"))
    config["source_crs"]="PRJ_AUTO"
    with pytest.raises(aerial.MapBlocked,match="SOURCE_CRS_MUST_BE_EPSG_5174"):
        aerial.ensure_config(config)
    config["source_crs"]="EPSG:5174"
    assert aerial.ensure_config(config)
    assert "server.arcgisonline.com" in aerial.tile_url("esri",17,100,100)


def test_no_embedded_real_pnu_or_credentials():
    text=(ROOT/"tools"/"cadastral_aerial.py").read_text(encoding="utf-8")
    assert "4311325029" not in text
    assert "YOUR_REAL_KEY" not in text
    assert "os.environ.get" in text
