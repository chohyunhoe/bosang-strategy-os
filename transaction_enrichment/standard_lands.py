"""주변 표준지 조회(현장 상담 지도용) — 서버 전용. 키는 환경변수에만 있고 응답에 넣지 않는다.

원칙
- 조회 범위: 대상 필지(연속지적도 exact-one) 중심 반경 R m 상자와 겹치는 법정동(리·읍면동 경계 레이어)을
  모두 조회한다 — 같은 법정동만 보지 않는다. 실제 반경·법정동·누락·조회 시각을 함께 돌려준다.
- 표준지 속성: VWorld 국가중점데이터 getReferLandPriceAttr(ldCode·stdrYear). 명칭 필드가 비어 오면
  같은 연도 토지특성(getLandCharacteristics) 응답의 '코드↔명칭' 쌍으로만 채운다(코드표를 추정·하드코딩하지 않음).
  같은 코드에 다른 명칭이 오면 채우지 않는다.
- 위치: 표준지 PNU마다 연속지적도 exact-one 경계가 확인된 것만 좌표를 준다. 확인되지 않으면 좌표 없음(지도 미표시).
- 소유 구분 등 후보 판단에 쓰지 않는 필드는 돌려주지 않는다.
"""
from __future__ import annotations

import json
import math
import re
import ssl
import http.client
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Mapping

from .providers import (
    ProviderError,
    VWorldCadastralGeometryProvider,
    VWorldLandCharacteristicsProvider,
    redact_secrets,
)

STANDARD_ENDPOINT = "https://api.vworld.kr/ned/data/getReferLandPriceAttr"
DEFAULT_RADIUS_M = 1000
MIN_RADIUS_M, MAX_RADIUS_M = 300, 2000
MAX_LEGAL_DONGS = 10
MAX_PAGES = 5
MAX_NAME_LOOKUPS = 60
MAX_LOCATE = 150
LOCATE_WORKERS = 6

# 표준지 코드 필드 → (표준지 응답의 명칭 필드, 토지특성 코드 필드, 토지특성 명칭 필드)
CODE_FIELDS: dict[str, tuple[str, str, str]] = {
    "prposArea1": ("prposAreaNm1", "prposArea1", "prposArea1Nm"),
    "prposArea2": ("prposAreaNm2", "prposArea2", "prposArea2Nm"),
    "ladUseSittn": ("ladUseSittnNm", "ladUseSittn", "ladUseSittnNm"),
    "roadSideCode": ("roadSideCodeNm", "roadSideCode", "roadSideCodeNm"),
    "tpgrphFrmCode": ("tpgrphFrmCodeNm", "tpgrphFrmCode", "tpgrphFrmCodeNm"),
    "tpgrphHgCode": ("tpgrphHgCodeNm", "tpgrphHgCode", "tpgrphHgCodeNm"),
    "lndcgrCode": ("lndcgrCodeNm", "lndcgrCode", "lndcgrCodeNm"),
}
KEEP_FIELDS = ("pnu", "stdrYear", "pblntfPclnd", "lndpclAr", "ldCode", "mnnmSlno", "lastUpdtDt", "stdLandSn",
               *CODE_FIELDS.keys(), *(v[0] for v in CODE_FIELDS.values()))

_TRANSPORT_ERRORS = (TimeoutError, urllib.error.URLError, urllib.error.HTTPError, ssl.SSLError, ConnectionError, http.client.RemoteDisconnected)


def _s(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _rows_of(payload: Any) -> tuple[list[dict[str, Any]], Mapping[str, Any] | None]:
    if not isinstance(payload, Mapping):
        raise ProviderError("VWORLD_SCHEMA_CHANGED", "response root is not an object")
    status = _s((payload.get("response") or {}).get("status") if isinstance(payload.get("response"), Mapping) else "").upper()
    if status == "NOT_FOUND":
        return [], None
    root = next((v for v in payload.values() if isinstance(v, Mapping) and ("field" in v or "fields" in v)), None)
    if root is None:
        raise ProviderError("VWORLD_API_ERROR" if status and status != "OK" else "VWORLD_SCHEMA_CHANGED", "standard land response root not found")
    code = _s(root.get("resultCode") or root.get("resultCd"))
    if code and code.upper() not in ("0", "00", "000", "SUCCESS"):
        raise ProviderError("VWORLD_API_ERROR", f"resultCode {code}")
    rows: list[dict[str, Any]] = []
    for key in ("field", "fields"):
        v = root.get(key)
        rows.extend([r for r in (v if isinstance(v, list) else [v]) if isinstance(r, Mapping)])
    return rows, root


def _centroid(geometry: Mapping[str, Any]) -> tuple[float, float]:
    pts = [pt for poly in geometry["coordinates"] for pt in (poly[0] if poly else [])]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371008.8
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


class StandardLandSearch:
    def __init__(self, *, geometry: VWorldCadastralGeometryProvider | None = None, land: VWorldLandCharacteristicsProvider | None = None):
        self.geometry = geometry or VWorldCadastralGeometryProvider()
        self.land = land or VWorldLandCharacteristicsProvider()

    @property
    def configured(self) -> bool:
        return bool(self.geometry.configured and self.land.configured)

    def _json(self, url: str, timeout: float = 15.0) -> Mapping[str, Any]:
        try:
            return self.land._transport(url, timeout)
        except ProviderError:
            raise
        except _TRANSPORT_ERRORS as exc:
            raise ProviderError("VWORLD_TRANSPORT_ERROR", redact_secrets(exc, (self.land._api_key or "",))) from None
        except (ValueError, TypeError, json.JSONDecodeError):
            raise ProviderError("VWORLD_RESPONSE_ERROR", "response could not be parsed") from None

    def legal_dongs(self, bbox: list[float], own_ld: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        box = f"BOX({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]})"
        ri = self.geometry._data({"data": "LT_C_ADRI_INFO", "geomFilter": box, "size": "100", "geometry": "false"})
        emd = self.geometry._data({"data": "LT_C_ADEMD_INFO", "geomFilter": box, "size": "100", "geometry": "false"})
        found: dict[str, str] = {}
        for f in ri:
            p = f.get("properties") or {}
            code = _s(p.get("li_cd"))
            if re.fullmatch(r"\d{10}", code):
                found[code] = _s(p.get("full_nm")) or _s(p.get("li_kor_nm"))
        for f in emd:
            p = f.get("properties") or {}
            code = _s(p.get("emd_cd"))
            # 리가 없는 동 지역만 읍면동 코드 + '00'으로 조회(리가 있는 읍면은 리 단위로 이미 포함)
            if re.fullmatch(r"\d{8}", code) and not any(k.startswith(code) for k in found):
                found[f"{code}00"] = _s(p.get("full_nm")) or _s(p.get("emd_kor_nm"))
        if own_ld not in found:
            found[own_ld] = ""
        ordered = [own_ld] + sorted(k for k in found if k != own_ld)
        items = [{"ld_code": k, "name": found[k]} for k in ordered]
        return items[:MAX_LEGAL_DONGS], items[MAX_LEGAL_DONGS:]

    def standard_rows(self, ld_code: str, year: int) -> dict[str, Any]:
        rows: list[dict[str, Any]] = []
        total = None
        for page in range(1, MAX_PAGES + 1):
            params = {"key": self.land._api_key or "", "ldCode": ld_code, "stdrYear": str(year), "format": "json", "numOfRows": "100", "pageNo": str(page)}
            page_rows, root = _rows_of(self._json(f"{STANDARD_ENDPOINT}?{urllib.parse.urlencode(params)}"))
            rows.extend(page_rows)
            try:
                total = int(_s((root or {}).get("totalCount")) or len(rows))
            except ValueError:
                total = None
            if root is None or total is None or len(rows) >= total or len(page_rows) < 100:
                break
        return {"rows": rows, "total_count": total if total is not None else len(rows), "truncated": total is not None and len(rows) < total}

    def learn_names(self, rows: list[dict[str, Any]], year: int) -> dict[str, Any]:
        learned: dict[str, dict[str, str]] = {k: {} for k in CODE_FIELDS}
        conflicts: dict[str, set[str]] = {k: set() for k in CODE_FIELDS}

        def learn(field: str, code: str, name: str) -> None:
            if not code or not name:
                return
            prev = learned[field].get(code)
            if prev is None:
                learned[field][code] = name
            elif prev != name:
                conflicts[field].add(code)

        for r in rows:  # 표준지 응답에 명칭이 이미 있으면 그대로 학습
            for field, (std_name, _c, _n) in CODE_FIELDS.items():
                learn(field, _s(r.get(field)), _s(r.get(std_name)))

        def missing(r: Mapping[str, Any]) -> bool:
            return any(_s(r.get(f)) and not _s(r.get(n)) and _s(r.get(f)) not in learned[f] for f, (n, _c, _nn) in CODE_FIELDS.items())

        lookups = 0
        for r in rows:
            if lookups >= MAX_NAME_LOOKUPS:
                break
            if not missing(r):
                continue
            pnu = _s(r.get("pnu"))
            if not re.fullmatch(r"\d{19}", pnu):
                continue
            lookups += 1
            try:
                lc_rows, _root = _rows_of(self._json(self.land._request_url(pnu, year)))
            except ProviderError:
                continue
            for lr in lc_rows:
                for field, (_n, lc_code, lc_name) in CODE_FIELDS.items():
                    learn(field, _s(lr.get(lc_code)), _s(lr.get(lc_name)))
        for field in CODE_FIELDS:
            for code in conflicts[field]:
                learned[field].pop(code, None)
        unresolved = sorted({f"{f}:{_s(r.get(f))}" for r in rows for f, (n, _c, _nn) in CODE_FIELDS.items()
                             if _s(r.get(f)) and not _s(r.get(n)) and _s(r.get(f)) not in learned[f]})
        return {"learned": learned, "conflicts": {k: sorted(v) for k, v in conflicts.items() if v}, "lookups": lookups, "unresolved": unresolved}

    def locate(self, pnu: str, center: tuple[float, float]) -> dict[str, Any]:
        try:
            t = self.geometry.target(pnu)
        except ProviderError as exc:
            return {"status": "FAILED", "code": exc.code}
        if t.get("status") != "EXACT_ONE" or t.get("pnu") != pnu or not t.get("geometry"):
            return {"status": t.get("status") or "MISMATCH"}
        c = _centroid(t["geometry"])
        return {"status": "EXACT_ONE", "centroid": [c[0], c[1]], "geometry": t["geometry"], "jibun": t.get("jibun"), "distance_m": round(_haversine(center, c), 1)}


def search_standard_lands(payload: Mapping[str, Any], *, searcher: StandardLandSearch | None = None) -> dict[str, Any]:
    pnu = _s(payload.get("pnu"))
    if not re.fullmatch(r"\d{19}", pnu):
        return {"ok": False, "error_code": "PNU_INVALID"}
    try:
        year = int(payload.get("year"))
    except (TypeError, ValueError):
        return {"ok": False, "error_code": "YEAR_INVALID"}
    if not 2000 <= year <= 2100:
        return {"ok": False, "error_code": "YEAR_INVALID"}
    try:
        radius = int(payload.get("radius_m") or DEFAULT_RADIUS_M)
    except (TypeError, ValueError):
        radius = DEFAULT_RADIUS_M
    radius = max(MIN_RADIUS_M, min(MAX_RADIUS_M, radius))
    review_zoning = _s(payload.get("review_zoning"))[:40]
    s = searcher or StandardLandSearch()
    if not s.configured:
        return {"ok": False, "error_code": "VWORLD_API_KEY_MISSING"}
    try:
        target = s.geometry.target(pnu)
    except ProviderError as exc:
        return {"ok": False, "error_code": exc.code, "error_message": str(exc)}
    if target.get("status") != "EXACT_ONE" or not target.get("geometry"):
        return {"ok": True, "status": "TARGET_NOT_EXACT", "target": {"pnu": pnu, "status": target.get("status")}, "rows": [], "locations": {}}
    center = _centroid(target["geometry"])
    dlat = radius / 111320.0
    dlon = radius / (111320.0 * math.cos(math.radians(center[1])))
    bbox = [round(center[0] - dlon, 7), round(center[1] - dlat, 7), round(center[0] + dlon, 7), round(center[1] + dlat, 7)]
    try:
        dongs, dongs_cut = s.legal_dongs(bbox, pnu[:10])
    except ProviderError as exc:
        return {"ok": False, "error_code": exc.code, "error_message": str(exc)}
    rows: list[dict[str, Any]] = []
    for d in dongs:
        try:
            res = s.standard_rows(d["ld_code"], year)
            d.update({"status": "OK", "count": len(res["rows"]), "total_count": res["total_count"], "truncated": res["truncated"]})
            rows.extend(res["rows"])
        except ProviderError as exc:
            d.update({"status": "FAILED", "code": exc.code, "count": 0})
    names = s.learn_names(rows, year)
    learned = names["learned"]
    dong_name = {d["ld_code"]: d.get("name") or "" for d in dongs}
    out_rows = []
    for r in rows:
        row = {k: _s(r.get(k)) for k in KEEP_FIELDS}
        filled = []
        for field, (name_field, _c, _n) in CODE_FIELDS.items():
            code = row.get(field)
            if code and not row.get(name_field) and code in learned[field]:
                row[name_field] = learned[field][code]
                filled.append(name_field)
        row["ldCodeNm"] = dong_name.get(row.get("ldCode") or "", "")
        row["name_filled_from_land_characteristics"] = filled
        out_rows.append(row)
    # 위치 확인 순서: 검토 용도지역과 같은 표준지 → 대상과 같은 법정동 → 나머지. 한도를 넘으면 위치 미조회로 남긴다.
    order = sorted({r["pnu"] for r in out_rows if re.fullmatch(r"\d{19}", r["pnu"])},
                   key=lambda p: (0 if any(r["pnu"] == p and review_zoning and r.get("prposAreaNm1") == review_zoning for r in out_rows) else 1,
                                  0 if p[:10] == pnu[:10] else 1, p))
    attempt, skipped = order[:MAX_LOCATE], order[MAX_LOCATE:]
    with ThreadPoolExecutor(max_workers=LOCATE_WORKERS) as pool:
        located = dict(zip(attempt, pool.map(lambda p: s.locate(p, center), attempt)))
    for p in skipped:
        located[p] = {"status": "NOT_ATTEMPTED"}
    return {
        "ok": True, "status": "OK", "review_required": True,
        "target": {"pnu": pnu, "centroid": [center[0], center[1]]},
        "search": {"year": year, "radius_m": radius, "bbox": bbox, "legal_dongs": dongs, "legal_dongs_not_queried": dongs_cut,
                   "review_zoning": review_zoning or None},
        "rows": out_rows, "locations": located,
        "name_resolution": {"lookups": names["lookups"], "unresolved": names["unresolved"], "conflicts": names["conflicts"],
                            "source": "같은 연도 VWorld 토지특성 응답의 코드↔명칭 쌍"},
        "limits": {"max_legal_dongs": MAX_LEGAL_DONGS, "max_locate": MAX_LOCATE, "not_located_by_limit": len(skipped)},
        "source": "VWorld 국가중점데이터 표준지공시지가(getReferLandPriceAttr) · 연속지적도(LP_PA_CBND_BUBUN) · 리/읍면동 경계(LT_C_ADRI_INFO/LT_C_ADEMD_INFO)",
    }
