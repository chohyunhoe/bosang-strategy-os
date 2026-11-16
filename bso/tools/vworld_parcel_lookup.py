# -*- coding: utf-8 -*-
"""VWorld 데이터 API 연속지적도(LP_PA_CBND_BUBUN) 단일 필지 조회.

설정은 저장소 루트 `.env`의 VWORLD_API_KEY / VWORLD_DOMAIN 에서 읽는다
(파일에 값이 없을 때만 프로세스 환경변수를 사용).

보안 규칙
- 키는 URL 쿼리에 실리므로 URL, 헤더, 응답 전체, 예외 메시지를 로그나 화면에 남기지 않는다.
- 로그에는 HTTP 상태 코드와 안전한 오류 코드(대문자/숫자/밑줄)만 남긴다.
- 네트워크 예외는 예외 클래스 이름만 남기고 원 예외는 체인에서 끊는다(`from None`).

도형(geometry)
- `include_geometry=True` / `--geometry` 일 때만 필지 경계를 함께 받는다(기본은 속성만).
- 좌표계는 EPSG:4326(경도, 위도)로 요청한다. 응답 좌표가 한반도 범위가 아니면
  `lonlat_plausible=False` 로 표시한다. 이 값은 실호출 확인 전까지 확정으로 쓰지 않는다.
- `--geojson-out` 은 지도·QGIS 중첩용 GeoJSON Feature 를 파일로 저장한다.
- 연속지적도는 참고도면이다. 법적 경계는 지적측량, 법적 면적은 공부로 확인한다.

사용 예
    python bso/tools/vworld_parcel_lookup.py --pnu <19자리 PNU>
    python bso/tools/vworld_parcel_lookup.py --pnu <19자리 PNU> --geometry --geojson-out parcel.geojson
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger("bso.cadastral_aerial")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV_PATH = REPO_ROOT / ".env"

VWORLD_DATA_API = "https://api.vworld.kr/req/data"
CADASTRAL_LAYER = "LP_PA_CBND_BUBUN"
USER_AGENT = "BSO-Cadastral-Aerial/0.1"

_PNU_PATTERN = re.compile(r"^\d{19}$")
_SAFE_CODE_PATTERN = re.compile(r"^[A-Z0-9_]{1,64}$")
_PLACEHOLDER_VALUES = {
    "",
    "your_vworld_api_key_here",
    "YOUR_LOCAL_KEY",
    "your_registered_domain_here",
}


class VWorldCadastralError(RuntimeError):
    """키 원문 없이 안전한 코드만 담는 오류."""

    def __init__(self, code: str, http: int | None = None, detail: str = "") -> None:
        self.code = code
        self.http = http
        self.detail = detail
        parts = [f"VWorld cadastral request failed: code={code}"]
        if http is not None:
            parts.append(f"http={http}")
        if detail:
            parts.append(f"detail={detail}")
        super().__init__(" ".join(parts))


@dataclass(frozen=True)
class VWorldConfig:
    api_key: str = field(repr=False)
    domain: str = ""
    source: str = ""

    def __repr__(self) -> str:  # 키 원문이 repr/로그로 새지 않도록 고정
        return (
            f"VWorldConfig(api_key=<{'set' if self.api_key else 'missing'}>, "
            f"domain=<{'set' if self.domain else 'missing'}>, source={self.source!r})"
        )


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name.startswith("export "):
            name = name[len("export "):].strip()
        values[name] = value.strip().strip('"').strip("'")
    return values


def _usable(value: str | None) -> str:
    value = (value or "").strip()
    return "" if value in _PLACEHOLDER_VALUES else value


def load_vworld_config(env_path: Path | None = None) -> VWorldConfig:
    """루트 `.env`에서 VWorld 설정을 읽는다. 값이 비었거나 예시값이면 환경변수로 대체한다."""
    path = Path(env_path) if env_path is not None else DEFAULT_ENV_PATH
    file_values = _parse_env_file(path)
    key = _usable(file_values.get("VWORLD_API_KEY"))
    domain = _usable(file_values.get("VWORLD_DOMAIN"))
    source = ".env" if key else ""
    if not key:
        key = _usable(os.environ.get("VWORLD_API_KEY"))
        source = "environment" if key else ""
    if not domain:
        domain = _usable(os.environ.get("VWORLD_DOMAIN"))
    return VWorldConfig(api_key=key, domain=domain, source=source)


def _redact(value: Any, secret: str) -> Any:
    if not secret:
        return value
    if isinstance(value, str):
        return value.replace(secret, "[REDACTED]")
    if isinstance(value, list):
        return [_redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {key: _redact(item, secret) for key, item in value.items()}
    return value


def _safe_code(value: Any) -> str:
    code = str(value or "").strip()
    return code if _SAFE_CODE_PATTERN.match(code) else "UNRECOGNIZED_ERROR_CODE"


GEOMETRY_CRS = "EPSG:4326"
_GEOMETRY_TYPES = {"Polygon", "MultiPolygon"}
# 한반도 및 부속도서 대략 범위(경도, 위도). 좌표계 취급 오류 탐지용 자가검증이며 행정 판단 기준이 아니다.
_LON_RANGE = (124.0, 132.0)
_LAT_RANGE = (33.0, 39.0)


def _iter_points(coords: Any):
    if isinstance(coords, (list, tuple)):
        if len(coords) >= 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in coords[:2]):
            yield coords[0], coords[1]
        else:
            for item in coords:
                yield from _iter_points(item)


def summarize_geometry(geometry: Any) -> dict[str, Any] | None:
    """geometry 의 구조를 검증하고 좌표 없이 요약(종류, 정점 수, bbox, 좌표범위 적합 여부)만 돌려준다."""
    if not isinstance(geometry, dict) or geometry.get("type") not in _GEOMETRY_TYPES:
        return None
    points = list(_iter_points(geometry.get("coordinates")))
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    plausible = (
        _LON_RANGE[0] <= min(xs) and max(xs) <= _LON_RANGE[1]
        and _LAT_RANGE[0] <= min(ys) and max(ys) <= _LAT_RANGE[1]
    )
    return {
        "geometry_type": geometry["type"],
        "vertex_count": len(points),
        "bbox": [min(xs), min(ys), max(xs), max(ys)],
        "lonlat_plausible": plausible,
    }


def _build_url(pnu: str, config: VWorldConfig, include_geometry: bool = False) -> str:
    params = {
        "service": "data",
        "request": "GetFeature",
        "data": CADASTRAL_LAYER,
        "key": config.api_key,
        "format": "json",
        "geometry": "true" if include_geometry else "false",
        "attribute": "true",
        "size": "1",
        "attrFilter": f"pnu:=:{pnu}",
    }
    if include_geometry:
        params["crs"] = GEOMETRY_CRS
    if config.domain:
        params["domain"] = config.domain
    return f"{VWORLD_DATA_API}?{urllib.parse.urlencode(params)}"


def fetch_parcel(
    pnu: str,
    config: VWorldConfig | None = None,
    timeout: float = 20.0,
    include_geometry: bool = False,
) -> dict[str, Any]:
    """PNU 1건의 연속지적도 속성(옵션: 경계 도형)을 조회한다.

    반환값에는 키·URL·응답 원문이 들어가지 않는다. 실패 시 VWorldCadastralError.
    include_geometry=True 이면 결과에 `geometry`(GeoJSON geometry 또는 None)와
    `geometry_summary`(종류·정점 수·bbox·좌표범위 적합 여부)가 추가된다.
    """
    pnu = str(pnu).strip()
    if not _PNU_PATTERN.match(pnu):
        raise VWorldCadastralError("INVALID_PNU")
    config = config or load_vworld_config()
    if not config.api_key:
        LOGGER.warning("vworld cadastral http=None code=KEY_MISSING")
        raise VWorldCadastralError("KEY_MISSING")

    secret = config.api_key
    request = urllib.request.Request(
        _build_url(pnu, config, include_geometry),
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            http = int(response.status)
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        http = int(exc.code)
        LOGGER.warning("vworld cadastral http=%s code=HTTP_ERROR", http)
        raise VWorldCadastralError("HTTP_ERROR", http=http) from None
    except (urllib.error.URLError, socket.timeout, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        kind = type(reason).__name__ if isinstance(reason, BaseException) else type(exc).__name__
        LOGGER.warning("vworld cadastral http=None code=NETWORK_ERROR kind=%s", kind)
        raise VWorldCadastralError("NETWORK_ERROR", detail=kind) from None

    try:
        payload = json.loads(body)
    except ValueError:
        LOGGER.warning("vworld cadastral http=%s code=NON_JSON_RESPONSE", http)
        raise VWorldCadastralError("NON_JSON_RESPONSE", http=http) from None

    response_obj = payload.get("response") if isinstance(payload, dict) else None
    if not isinstance(response_obj, dict):
        LOGGER.warning("vworld cadastral http=%s code=UNEXPECTED_RESPONSE", http)
        raise VWorldCadastralError("UNEXPECTED_RESPONSE", http=http)

    status = _safe_code(response_obj.get("status"))
    if status == "ERROR":
        error = response_obj.get("error") if isinstance(response_obj.get("error"), dict) else {}
        code = _safe_code(error.get("code"))
        LOGGER.warning("vworld cadastral http=%s status=ERROR code=%s", http, code)
        raise VWorldCadastralError(code, http=http)
    if status not in ("OK", "NOT_FOUND"):
        LOGGER.warning("vworld cadastral http=%s code=UNEXPECTED_STATUS", http)
        raise VWorldCadastralError("UNEXPECTED_STATUS", http=http)

    features: list[dict[str, Any]] = []
    geometries: list[Any] = []
    if status == "OK":
        collection = (response_obj.get("result") or {}).get("featureCollection") or {}
        for feature in collection.get("features") or []:
            if isinstance(feature, dict) and isinstance(feature.get("properties"), dict):
                features.append(_redact(dict(feature["properties"]), secret))
                geometries.append(feature.get("geometry"))
    matched_index = next((i for i, item in enumerate(features) if str(item.get("pnu")) == pnu), None)
    LOGGER.info("vworld cadastral http=%s status=%s features=%s", http, status, len(features))
    result: dict[str, Any] = {
        "pnu": pnu,
        "http": http,
        "status": status,
        "feature_count": len(features),
        "pnu_match": matched_index is not None,
        "properties": features[matched_index] if matched_index is not None else None,
    }
    if include_geometry:
        geometry = geometries[matched_index] if matched_index is not None else None
        summary = summarize_geometry(geometry)
        result["geometry"] = geometry if summary else None
        result["geometry_summary"] = summary
        result["geometry_crs"] = GEOMETRY_CRS
        LOGGER.info(
            "vworld cadastral geometry=%s plausible=%s",
            summary["geometry_type"] if summary else "NONE",
            summary["lonlat_plausible"] if summary else None,
        )
    return result


def to_geojson(result: dict[str, Any]) -> dict[str, Any]:
    """fetch_parcel(include_geometry=True) 결과를 GeoJSON Feature 로 변환한다(키·URL 없음)."""
    if "geometry" not in result:
        raise VWorldCadastralError("GEOMETRY_NOT_REQUESTED")
    if not result.get("geometry"):
        raise VWorldCadastralError("GEOMETRY_MISSING", http=result.get("http"))
    summary = result.get("geometry_summary") or {}
    if not summary.get("lonlat_plausible"):
        raise VWorldCadastralError("GEOMETRY_CRS_UNVERIFIED", http=result.get("http"))
    return {
        "type": "Feature",
        "geometry": result["geometry"],
        "properties": dict(result.get("properties") or {}),
    }


def _summary(result: dict[str, Any]) -> dict[str, Any]:
    props = result.get("properties") or {}
    summary = {
        "pnu": result["pnu"],
        "http": result["http"],
        "status": result["status"],
        "feature_count": result["feature_count"],
        "pnu_match": result["pnu_match"],
        "addr": props.get("addr"),
        "jibun": props.get("jibun"),
    }
    if "geometry_summary" in result:  # 좌표 원문은 화면에 찍지 않고 요약만 보인다
        summary["geometry_crs"] = result.get("geometry_crs")
        summary["geometry"] = result["geometry_summary"]
    return summary


def write_geojson(result: dict[str, Any], path: Path) -> None:
    """GeoJSON Feature 를 새 파일로 저장한다. 이미 있는 파일은 덮어쓰지 않는다."""
    feature = to_geojson(result)
    target = Path(path)
    try:
        with target.open("x", encoding="utf-8") as handle:
            json.dump(feature, handle, ensure_ascii=False)
    except FileExistsError:
        raise VWorldCadastralError("OUTPUT_EXISTS") from None
    except OSError:
        raise VWorldCadastralError("OUTPUT_WRITE_FAILED") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="VWorld 연속지적도 단일 필지 조회 (키 비노출)")
    parser.add_argument("--pnu", required=True, help="19자리 PNU")
    parser.add_argument("--env", type=Path, default=None, help="기본값: 저장소 루트 .env")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--geometry", action="store_true", help="필지 경계 도형도 함께 조회")
    parser.add_argument("--geojson-out", type=Path, default=None,
                        help="경계를 GeoJSON Feature 로 저장(--geometry 포함, 기존 파일 덮어쓰지 않음)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    config = load_vworld_config(args.env)
    want_geometry = bool(args.geometry or args.geojson_out)
    try:
        result = fetch_parcel(args.pnu, config, timeout=args.timeout, include_geometry=want_geometry)
        if args.geojson_out:
            write_geojson(result, args.geojson_out)
    except VWorldCadastralError as exc:
        print(json.dumps({"ok": False, "code": exc.code, "http": exc.http, "detail": exc.detail},
                         ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, **_summary(result)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
