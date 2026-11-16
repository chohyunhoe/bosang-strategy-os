# -*- coding: utf-8 -*-
"""VWorld 데이터 API 연속지적도(LP_PA_CBND_BUBUN) 단일 필지 조회.

설정은 저장소 루트 `.env`의 VWORLD_API_KEY / VWORLD_DOMAIN 에서 읽는다
(파일에 값이 없을 때만 프로세스 환경변수를 사용).

보안 규칙
- 키는 URL 쿼리에 실리므로 URL, 헤더, 응답 전체, 예외 메시지를 로그나 화면에 남기지 않는다.
- 로그에는 HTTP 상태 코드와 안전한 오류 코드(대문자/숫자/밑줄)만 남긴다.
- 네트워크 예외는 예외 클래스 이름만 남기고 원 예외는 체인에서 끊는다(`from None`).

사용 예
    python bso/tools/vworld_parcel_lookup.py --pnu <19자리 PNU>
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


def _build_url(pnu: str, config: VWorldConfig) -> str:
    params = {
        "service": "data",
        "request": "GetFeature",
        "data": CADASTRAL_LAYER,
        "key": config.api_key,
        "format": "json",
        "geometry": "false",
        "attribute": "true",
        "size": "1",
        "attrFilter": f"pnu:=:{pnu}",
    }
    if config.domain:
        params["domain"] = config.domain
    return f"{VWORLD_DATA_API}?{urllib.parse.urlencode(params)}"


def fetch_parcel(pnu: str, config: VWorldConfig | None = None, timeout: float = 20.0) -> dict[str, Any]:
    """PNU 1건의 연속지적도 속성을 조회한다.

    반환값에는 키·URL·응답 원문이 들어가지 않는다. 실패 시 VWorldCadastralError.
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
        _build_url(pnu, config),
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
    if status == "OK":
        collection = (response_obj.get("result") or {}).get("featureCollection") or {}
        for feature in collection.get("features") or []:
            if isinstance(feature, dict) and isinstance(feature.get("properties"), dict):
                features.append(_redact(dict(feature["properties"]), secret))
    matched = [item for item in features if str(item.get("pnu")) == pnu]
    LOGGER.info("vworld cadastral http=%s status=%s features=%s", http, status, len(features))
    return {
        "pnu": pnu,
        "http": http,
        "status": status,
        "feature_count": len(features),
        "pnu_match": bool(matched),
        "properties": matched[0] if matched else None,
    }


def _summary(result: dict[str, Any]) -> dict[str, Any]:
    props = result.get("properties") or {}
    return {
        "pnu": result["pnu"],
        "http": result["http"],
        "status": result["status"],
        "feature_count": result["feature_count"],
        "pnu_match": result["pnu_match"],
        "addr": props.get("addr"),
        "jibun": props.get("jibun"),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="VWorld 연속지적도 단일 필지 조회 (키 비노출)")
    parser.add_argument("--pnu", required=True, help="19자리 PNU")
    parser.add_argument("--env", type=Path, default=None, help="기본값: 저장소 루트 .env")
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    config = load_vworld_config(args.env)
    try:
        result = fetch_parcel(args.pnu, config, timeout=args.timeout)
    except VWorldCadastralError as exc:
        print(json.dumps({"ok": False, "code": exc.code, "http": exc.http, "detail": exc.detail},
                         ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, **_summary(result)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
