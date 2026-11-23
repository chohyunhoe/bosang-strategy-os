r"""상담 시뮬레이터 실데이터 경로 1회 검증 프로브 (수동 실행 전용, 자동 테스트 아님).

    python scripts/probe_consult_live.py                 # 저장소 안에서 실행
    python probe_consult_live.py C:\path\to\bosang-strategy-os   # 파일만 따로 받아 실행할 때(브랜치 전환 불필요)

기존 로컬 브리지(scripts/public_data_bridge.py)와 같은 코드 경로를 그대로 호출해
공공데이터포털(법정동코드)·VWorld(토지특성) 실호출 가능 여부를 확인한다.

원칙
- 인증키 값은 어떤 줄에도 출력하지 않는다. 출력 직전에 .env의 비밀값을 [REDACTED]로 치환하고 key= 패턴도 지운다.
- 응답 원문을 파일로 저장하지 않는다. VWorld 응답은 '필드 이름 목록'과 매핑 결과만 출력한다.
- 표본은 사건과 무관한 공공청사 부지 1필지(서울특별시청, 중구 태평로1가 31)다.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date
from pathlib import Path

_arg = next((a for a in sys.argv[1:] if not a.startswith("-")), "")
REPO_ROOT = Path(_arg).resolve() if _arg else Path(__file__).resolve().parents[1]
if not (REPO_ROOT / "scripts" / "public_data_bridge.py").is_file():
    print(json.dumps({"step": "fatal", "error_type": "REPO_ROOT_NOT_FOUND"}))
    sys.exit(2)
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from public_data import load_env_file  # noqa: E402
import public_data_bridge as bridge  # noqa: E402  (기존 브리지 함수 그대로 사용)
from transaction_enrichment import providers as tp  # noqa: E402

SAMPLE_ADDRESS = "서울특별시 중구 태평로1가 31"   # 공공청사 부지, 사건과 무관
SAMPLE_PNU = "1114010300100310000"                 # 위 주소의 예상 PNU (실호출로 교차확인)
NONEXISTENT_PNU = "1114010300199990000"            # 본번 9999 — 존재하지 않을 가능성이 높은 PNU
SECRET_ENV = ("VWORLD_API_KEY", "PUBLIC_DATA_API_KEY", "PUBLIC_DATA_SERVICE_KEY")
DOMAIN_ENV = ("VWORLD_DOMAIN", "VWORLD_API_DOMAIN")


def redact(text: str) -> str:
    for name in SECRET_ENV:
        value = os.environ.get(name) or ""
        if len(value) >= 6:
            text = text.replace(value, "[REDACTED]")
            # 퍼센트 인코딩된 키 형태도 가린다
            from urllib.parse import quote, unquote
            for variant in {quote(value, safe=""), unquote(value)}:
                if len(variant) >= 6:
                    text = text.replace(variant, "[REDACTED]")
    return re.sub(r"(?i)((?:service)?key|api[_-]?key)=([^&\s\"']+)", r"\1=[REDACTED]", text)


def emit(step: str, **data) -> None:
    print(redact(json.dumps({"step": step, **data}, ensure_ascii=False, default=str)), flush=True)


def main() -> int:
    loaded = load_env_file()
    emit(
        "env",
        env_file_loaded=bool(loaded),
        configured={name: bool(os.environ.get(name)) for name in SECRET_ENV + DOMAIN_ENV},
        note="값은 출력하지 않음. VWorld 토지특성 provider는 VWORLD_DOMAIN만 읽음(VWORLD_API_DOMAIN은 읽지 않음).",
    )
    emit("bridge_status", **{k: v for k, v in bridge.status().items() if k != "capabilities"})

    # 1) 공공데이터포털 법정동코드 → PNU 후보
    resolved = bridge.resolve_pnu({"parcel_address": SAMPLE_ADDRESS})
    candidate = resolved.get("candidate") or {}
    emit("resolve_pnu", ok=resolved.get("ok"), error_code=resolved.get("error_code"),
         pnu=candidate.get("pnu"), legal_dong_name=candidate.get("legal_dong_name"),
         matches_expected=candidate.get("pnu") == SAMPLE_PNU)

    # 2) VWorld 토지특성: 응답 필드 이름 목록(원문 저장 없음) + 기존 매핑 결과
    seen_fields: dict[int, list[str]] = {}
    original_transport = tp.default_json_transport

    def recording_transport(url: str, timeout: float):
        payload = original_transport(url, timeout)
        root = payload.get("landCharacteristicss") or payload.get("landCharacteristics") or {}
        rows = root.get("field") if isinstance(root, dict) else None
        rows = rows if isinstance(rows, list) else ([rows] if isinstance(rows, dict) else [])
        year = re.search(r"stdrYear=(\d{4})", url)
        seen_fields[int(year.group(1)) if year else 0] = sorted({k for row in rows for k in row.keys()})
        return payload

    pnu = candidate.get("pnu") or SAMPLE_PNU
    this_year = date.today().year
    for year in (this_year, this_year - 1):
        provider = tp.VWorldLandCharacteristicsProvider(transport=recording_transport)
        try:
            record = provider.get_by_pnu(pnu, standard_year=year)
            emit("vworld_land", year=year, ok=True, status="OK" if record else "NO_DATA",
                 response_field_names=seen_fields.get(year), record=bridge.plain(record) if record else None,
                 area_field_present=any(n in (seen_fields.get(year) or []) for n in ("lndpclAr", "ladArea", "area")))
        except tp.ProviderError as exc:
            emit("vworld_land", year=year, ok=False, error_code=exc.code, message=str(exc)[:200],
                 response_field_names=seen_fields.get(year))

    # 3) 오류 처리: 기존 브리지 함수 경유
    for label, payload in (
        ("invalid_pnu", {"pnu": "123", "standard_year": this_year - 1}),
        ("nonexistent_pnu", {"pnu": NONEXISTENT_PNU, "standard_year": this_year - 1}),
        ("future_year", {"pnu": pnu, "standard_year": 2099}),
    ):
        result = bridge.vworld_land(payload)
        emit("error_handling", case=label, ok=result.get("ok"), status=result.get("status"),
             error_code=result.get("error_code"), has_record=bool(result.get("record")))
    emit("done", secrets_printed=False, raw_saved=False)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # 어떤 예외든 키가 섞이지 않게 정제해서만 출력
        emit("fatal", error_type=type(exc).__name__, message=str(exc)[:300])
        sys.exit(1)
