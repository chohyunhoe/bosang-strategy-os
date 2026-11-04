"""공공데이터포털 공통 기반: 인증키, 전송, 공통 메타데이터, fail-safe 규약.

설계 원칙 (transaction_enrichment.providers 의 VWorld 패턴을 따름):

- 인증키는 런타임 환경변수에서만 읽는다. 로그·repr·예외 문자열에서 항상 마스킹.
- 전송 계층은 주입 가능(HttpTransport)해서 단위테스트는 실호출 없이 검증한다.
- 외부 API 실패는 기존 워크플로우를 중단시키지 않는다: 모든 dataset client 의
  ``fetch_safe`` 계열은 예외 대신 ``FetchResult(ok=False, ...)`` 를 반환하고
  ``review_required=True`` 상태로 남긴다.
- API 응답이라고 실시간으로 간주하지 않는다(freshness_grade 명시).
"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ENV_PUBLIC_DATA_API_KEY = "PUBLIC_DATA_API_KEY"
# transaction_enrichment.providers.PublicDataLandCharacteristicsProvider 가
# 사용하던 레거시 변수명. 새 코드는 PUBLIC_DATA_API_KEY 를 우선한다.
ENV_PUBLIC_DATA_API_KEY_LEGACY = "PUBLIC_DATA_SERVICE_KEY"

USER_AGENT = "bosang-strategy-os/public-data"

# HTTP 오류 본문에서 진단용으로 남길 최대 길이.
BODY_SNIPPET_LIMIT = 300


class ProviderError(RuntimeError):
    """코드 + 메시지 구조의 오류. 메시지에 인증키가 포함되면 안 된다."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def redact_secrets(value: object, secrets: tuple[str, ...] = ()) -> str:
    """오류/로그 문자열에서 인증키와 key/serviceKey 파라미터를 마스킹한다."""
    text = str(value)
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED]")
            quoted = urllib.parse.quote(secret, safe="")
            if quoted != secret:
                text = text.replace(quoted, "[REDACTED]")
    return re.sub(
        r"(?i)(key|api[_-]?key|service[_-]?key|serviceKey)=([^&\s]+)",
        lambda match: f"{match.group(1)}=[REDACTED]",
        text,
    )


def load_env_file(path: Path | None = None, *, override: bool = False) -> list[str]:
    """저장소 루트 ``.env`` 를 os.environ 으로 읽는다(값은 절대 출력하지 않음).

    반환값은 로드된 '변수명 목록'뿐이다. 파일이 없으면 빈 목록을 반환하고
    실패로 취급하지 않는다(기존 셸 환경변수 방식과 병행 사용 가능).
    """
    env_path = path or (Path(__file__).resolve().parents[1] / ".env")
    loaded: list[str] = []
    try:
        raw = env_path.read_text(encoding="utf-8-sig")
    except (FileNotFoundError, OSError):
        return loaded
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if not name:
            continue
        if override or name not in os.environ:
            os.environ[name] = value
            loaded.append(name)
    return loaded


class FreshnessGrade:
    """API 응답의 최신성 등급. API라고 해서 LIVE 로 간주하지 않는다."""

    LIVE = "LIVE"
    DAILY = "DAILY"
    PERIODIC = "PERIODIC"
    SNAPSHOT = "SNAPSHOT"
    UNKNOWN = "UNKNOWN"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def raw_hash(payload: Any) -> str:
    """원본 레코드의 결정적 해시(sha256, 정렬 JSON). 원문 저장 대신 대조용."""
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class SourceMeta:
    """외부 데이터 레코드 공통 provenance 메타데이터."""

    source_dataset: str
    source_provider: str
    retrieved_at: str = field(default_factory=utc_now_iso)
    source_updated_at: Optional[str] = None
    effective_date: Optional[str] = None
    pnu: Optional[str] = None
    project_id: Optional[str] = None
    raw_hash: Optional[str] = None
    freshness_grade: str = FreshnessGrade.UNKNOWN
    review_required: bool = True
    source_url: Optional[str] = None
    source_record_id: Optional[str] = None
    confidence: Optional[str] = None
    normalization_status: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_dataset": self.source_dataset,
            "source_provider": self.source_provider,
            "source_updated_at": self.source_updated_at,
            "retrieved_at": self.retrieved_at,
            "effective_date": self.effective_date,
            "pnu": self.pnu,
            "project_id": self.project_id,
            "raw_hash": self.raw_hash,
            "freshness_grade": self.freshness_grade,
            "review_required": self.review_required,
            "source_url": self.source_url,
            "source_record_id": self.source_record_id,
            "confidence": self.confidence,
            "normalization_status": self.normalization_status,
        }


@dataclass
class FetchResult:
    """fail-safe 조회 결과. ok=False 여도 예외를 밖으로 던지지 않는다."""

    ok: bool
    records: list[Any] = field(default_factory=list)
    meta: Optional[SourceMeta] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    status: str = "REVIEW_REQUIRED"  # SUCCESS_REVIEW_REQUIRED / PARTIAL / REVIEW_REQUIRED

    @classmethod
    def failure(cls, code: str, message: str, meta: Optional[SourceMeta] = None) -> "FetchResult":
        return cls(
            ok=False,
            records=[],
            meta=meta,
            error_code=code,
            error_message=message,
            status="PARTIAL",
        )


# 전송 계층: URL, timeout -> 응답 본문 텍스트. JSON/XML 파싱은 dataset client 책임.
HttpTransport = Callable[[str, float], str]


def default_text_transport(url: str, timeout: float) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def normalize_service_key(raw: str | None) -> tuple[str | None, str]:
    """공공데이터포털 인증키 정규화 (이중 인코딩 방지).

    포털 마이페이지는 Encoding 키(퍼센트 인코딩)와 Decoding 키(원문)를 함께
    제공한다. Decoding 키는 base64 계열이라 ``%`` 를 포함하지 않으므로,
    ``%`` 가 보이면 Encoding 키가 붙여넣어진 것으로 보고 1회 unquote 한다.
    (그대로 두면 build_url 이 다시 인코딩해 %2B -> %252B 로 키가 깨진다.)

    반환: (정규화된 키, 형태) — 형태는 MISSING / DECODED /
    PERCENT_ENCODED_NORMALIZED. 키 값 자체는 어디에도 기록하지 않는다.
    """
    if not raw:
        return (None, "MISSING")
    if "%" in raw:
        decoded = urllib.parse.unquote(raw)
        if decoded != raw:
            return (decoded, "PERCENT_ENCODED_NORMALIZED")
    return (raw, "DECODED")


def classify_http_error(exc: urllib.error.HTTPError) -> tuple[str, str]:
    """HTTP 오류 응답 '본문'까지 읽어 data.go.kr 사유코드로 분류한다.

    data.go.kr 는 401/403 응답 본문에 <returnReasonCode> 를 담아 보내므로,
    본문을 읽지 않으면 '활용승인 대기'와 '키 오류'를 구분할 수 없다.
    """
    status = getattr(exc, "code", None)
    body = ""
    try:
        raw = exc.read()
        body = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
    except Exception:  # noqa: BLE001 - 본문을 못 읽어도 분류는 계속한다
        body = ""
    stripped = body.lstrip()
    if stripped.startswith("<"):
        code, message = parse_service_error_xml(stripped)
        if code != "PUBLIC_DATA_RESPONSE_ERROR":
            return (code, f"HTTP {status}: {message}")
    # 본문 앞부분을 진단 단서로 남긴다. 오류 본문은 파라미터·경로 안내만 담고
    # 개인정보를 담지 않으므로 길이를 제한해 그대로 노출한다(키는 상위에서 마스킹).
    snippet = " ".join(stripped.split())[:BODY_SNIPPET_LIMIT]
    detail = f" body={snippet}" if snippet else ""
    if status in (401, 403):
        return (
            "SERVICE_ACCESS_DENIED",
            f"HTTP {status}: 접근 거부 — 해당 서비스 활용신청 승인 여부와 인증키 형식(Decoding 키)을 확인하세요{detail}",
        )
    if status == 404:
        return ("NO_OPENAPI_SERVICE", f"HTTP {status}: endpoint 경로를 확인하세요{detail}")
    if status == 429:
        return ("RATE_LIMIT_EXCEEDED", f"HTTP {status}: 요청 한도 초과{detail}")
    if status == 400:
        return (
            "PUBLIC_DATA_BAD_REQUEST",
            f"HTTP {status}: 필수 파라미터 누락·형식 오류 또는 미등록 경로{detail}",
        )
    return ("PUBLIC_DATA_HTTP_ERROR", f"HTTP {status}{detail}")


TRANSPORT_EXCEPTIONS = (
    TimeoutError,
    urllib.error.URLError,
    urllib.error.HTTPError,
    ssl.SSLError,
    ConnectionError,
    http.client.RemoteDisconnected,
)


class PublicDataProvider:
    """공공데이터포털 인증키/전송을 관리하는 공통 허브.

    dataset client 들은 이 provider 를 주입받아 사용한다. VWorldProvider
    (transaction_enrichment.providers.VWorldLandCharacteristicsProvider) 를
    대체하지 않으며, 공간정보 계열은 계속 VWorld 가 담당한다.
    """

    ENV_NAME = ENV_PUBLIC_DATA_API_KEY

    def __init__(
        self,
        *,
        service_key: str | None = None,
        timeout: float = 10.0,
        transport: HttpTransport | None = None,
    ):
        raw_key = (
            service_key
            or os.getenv(ENV_PUBLIC_DATA_API_KEY)
            or os.getenv(ENV_PUBLIC_DATA_API_KEY_LEGACY)
        )
        self._service_key, self._key_form = normalize_service_key(raw_key)
        self._timeout = timeout
        self._transport = transport or default_text_transport

    def __repr__(self) -> str:  # 키는 어떤 경우에도 노출하지 않는다.
        return f"PublicDataProvider(service_key='[REDACTED]', timeout={self._timeout!r})"

    @property
    def configured(self) -> bool:
        return bool(self._service_key)

    @property
    def key_form(self) -> str:
        """MISSING / DECODED / PERCENT_ENCODED_NORMALIZED (키 값은 노출하지 않음)."""
        return self._key_form

    @property
    def timeout(self) -> float:
        return self._timeout

    def require_key(self) -> str:
        if not self._service_key:
            raise ProviderError(
                "PUBLIC_DATA_KEY_MISSING",
                f"{ENV_PUBLIC_DATA_API_KEY} is not configured (set it in .env or the runtime environment)",
            )
        return self._service_key

    def build_url(self, endpoint: str, params: Mapping[str, Any]) -> str:
        """serviceKey 를 포함한 요청 URL 생성. Decoding 키를 넣으면 여기서 인코딩된다."""
        query = {"serviceKey": self.require_key()}
        for key, value in params.items():
            if value is None:
                continue
            query[key] = str(value)
        return f"{endpoint}?{urllib.parse.urlencode(query)}"

    def get_text(self, endpoint: str, params: Mapping[str, Any]) -> str:
        """전송 오류를 ProviderError 로 변환(키 마스킹). 파싱은 호출측 책임."""
        url = self.build_url(endpoint, params)
        try:
            return self._transport(url, self._timeout)
        except ProviderError:
            raise
        except urllib.error.HTTPError as exc:
            # HTTPError 는 URLError 의 서브클래스이므로 반드시 먼저 잡는다.
            code, message = classify_http_error(exc)
            raise ProviderError(code, self.redact(message)) from None
        except TRANSPORT_EXCEPTIONS as exc:
            safe = redact_secrets(exc, (self._service_key or "",))
            raise ProviderError("PUBLIC_DATA_TRANSPORT_ERROR", f"public-data request failed safely: {safe}") from None
        except Exception as exc:  # noqa: BLE001 - fail closed, never leak the key
            safe = redact_secrets(exc, (self._service_key or "",))
            raise ProviderError("PUBLIC_DATA_INTERNAL_ERROR", f"unexpected public-data error: {safe}") from None

    def get_json(self, endpoint: str, params: Mapping[str, Any]) -> Any:
        text = self.get_text(endpoint, params)
        stripped = text.lstrip()
        if stripped.startswith("<"):
            # 인증 실패 등에서 data.go.kr 가 XML(OpenAPI_ServiceResponse)을 반환하는 경우
            code, message = parse_service_error_xml(stripped)
            raise ProviderError(code, message)
        try:
            return json.loads(text)
        except (ValueError, TypeError) as exc:
            safe = redact_secrets(exc, (self._service_key or "",))
            raise ProviderError("PUBLIC_DATA_RESPONSE_ERROR", f"response is not valid JSON: {safe}") from None

    def redact(self, value: object) -> str:
        return redact_secrets(value, (self._service_key or "",))


# 공공데이터포털 공통 오류 XML: <OpenAPI_ServiceResponse><cmmMsgHeader>...
_SERVICE_ERROR_CODES = {
    "01": "APPLICATION_ERROR",
    "04": "HTTP_ERROR",
    "12": "NO_OPENAPI_SERVICE",
    "20": "SERVICE_ACCESS_DENIED",  # 활용승인 대기 포함
    "22": "RATE_LIMIT_EXCEEDED",
    "30": "SERVICE_KEY_UNREGISTERED",
    "31": "SERVICE_KEY_EXPIRED",
    "32": "UNREGISTERED_DOMAIN_OR_IP",
}


def parse_service_error_xml(text: str) -> tuple[str, str]:
    import xml.etree.ElementTree as ET

    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return ("PUBLIC_DATA_RESPONSE_ERROR", "non-JSON response could not be parsed")
    reason = root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg") or "service error"
    raw_code = (root.findtext(".//returnReasonCode") or "").strip()
    code = _SERVICE_ERROR_CODES.get(raw_code, "PUBLIC_DATA_SERVICE_ERROR")
    return (code, f"{reason} (returnReasonCode={raw_code or 'unknown'})")


def parse_standard_xml_body(text: str, *, dataset: str) -> tuple[list[dict[str, Any]], int]:
    """data.go.kr 표준 XML envelope 파싱.

    일부 서비스(소상공인 상가정보 sdsc2 등)는 JSON 파라미터를 지원하지 않고
    XML 만 반환한다. JSON 경로와 동일한 (records, total) 계약을 지킨다.
    """
    import xml.etree.ElementTree as ET

    stripped = (text or "").lstrip()
    if not stripped.startswith("<"):
        raise ProviderError(f"{dataset}_RESPONSE_ERROR", "expected an XML response body")
    try:
        root = ET.fromstring(stripped)
    except ET.ParseError:
        raise ProviderError(f"{dataset}_RESPONSE_ERROR", "XML response could not be parsed") from None

    if root.tag.endswith("OpenAPI_ServiceResponse"):
        code, message = parse_service_error_xml(stripped)
        raise ProviderError(code, message)

    result_code = (
        root.findtext("./header/resultCode")
        or root.findtext(".//header/resultCode")
        or root.findtext("./resultCode")
        or ""
    ).strip()
    if result_code in NODATA_RESULT_CODES:
        return [], 0
    if result_code not in SUCCESS_RESULT_CODES:
        message = (
            root.findtext("./header/resultMsg")
            or root.findtext(".//header/resultMsg")
            or "non-success result code"
        ).strip()
        raise ProviderError(f"{dataset}_API_ERROR", f"{message} (resultCode={result_code})")

    records = [
        {child.tag: (child.text or "").strip() for child in item}
        for item in root.findall(".//items/item")
    ]
    total_raw = (root.findtext(".//totalCount") or "").strip()
    try:
        total = int(total_raw) if total_raw else len(records)
    except ValueError:
        total = len(records)
    return records, total


def find_first(source: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source.get(key)
        if value not in (None, ""):
            return value
    return None


def as_record_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


# data.go.kr 표준 응답코드. 기관마다 표기가 달라 넓게 허용한다.
SUCCESS_RESULT_CODES = frozenset(
    {"", "0", "00", "000", "INFO-0", "INFO-00", "NORMAL SERVICE", "NORMAL_SERVICE", "SUCCESS"}
)
# '조회 결과 없음'은 실패가 아니라 빈 결과다(상가정보 03, 행안부 INFO-200 등).
NODATA_RESULT_CODES = frozenset({"03", "3", "INFO-200", "INFO-0200"})


def parse_standard_body(payload: Mapping[str, Any], *, dataset: str) -> tuple[list[dict[str, Any]], int]:
    """data.go.kr 표준 envelope 파싱.

    지원 형태:
    - {"response": {"header": {...}, "body": {"items": {"item": [...]}, "totalCount": n}}}
    - {"header": {...}, "body": {"items": [...], "totalCount": n}}  (sdsc2 등)
    """
    envelope: Mapping[str, Any] = payload
    if isinstance(payload.get("response"), Mapping):
        envelope = payload["response"]

    header = envelope.get("header")
    if isinstance(header, Mapping):
        result_code = str(find_first(header, "resultCode", "resultCd") or "").strip()
        if result_code in NODATA_RESULT_CODES:
            # '조회 결과 없음'은 오류가 아니다 — 빈 결과로 정상 반환하고
            # 상위에서 REVIEW_REQUIRED 로 남긴다(기존 수동 workflow 유지).
            return [], 0
        if result_code not in SUCCESS_RESULT_CODES:
            message = str(find_first(header, "resultMsg", "resultMessage") or "non-success result code")
            raise ProviderError(f"{dataset}_API_ERROR", f"{message} (resultCode={result_code})")

    body = envelope.get("body")
    if not isinstance(body, Mapping):
        raise ProviderError(f"{dataset}_SCHEMA_CHANGED", "response body was not found")

    items = body.get("items")
    if isinstance(items, Mapping):
        items = items.get("item")
    records = as_record_list(items)

    total_raw = find_first(body, "totalCount", "totalcount")
    try:
        total = int(str(total_raw)) if total_raw is not None else len(records)
    except (TypeError, ValueError):
        total = len(records)
    return records, total
