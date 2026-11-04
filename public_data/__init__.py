"""공공데이터포털(data.go.kr) 공통 Provider 기반.

이 패키지는 보상전략 OS와 신규사업 모니터링이 공공데이터를 재사용하기 위한
최소 공통 기반입니다. 검토 보조 전용이며 다음을 절대 수행하지 않습니다.

- 감정평가 결론, 보상액, 증액 가능성 판단
- 거래사례 자동 확정 (모든 거래 후보는 review_required=True)
- 나라장터 신호만으로 수임가능 사업 확정 (EARLY_SIGNAL + 사람 검수)

인증키는 환경변수 ``PUBLIC_DATA_API_KEY`` (레거시 fallback:
``PUBLIC_DATA_SERVICE_KEY``) 로만 읽으며, 코드·로그·fixture 에 남기지 않습니다.
"""

from .core import (
    ENV_PUBLIC_DATA_API_KEY,
    FetchResult,
    FreshnessGrade,
    ProviderError,
    PublicDataProvider,
    SourceMeta,
    load_env_file,
    redact_secrets,
)
from .legal_dong import LegalDongCodeClient, LegalDongRecord, build_pnu
from .building import (
    BuildingLedgerClient,
    BuildingLedgerOp,
    CrosscheckFlag,
    CrosscheckState,
    crosscheck_building,
    pnu_to_ledger_params,
)
from .stores import StoreInfoClient, StoreRecord
from .factoryon import FactoryOnClient, FactoryParcelRecord, FactoryRecord
from .rtms import RtmsTradeClient, RtmsTradeType, TradeCandidate
from .g2b import (
    EarlySignal,
    G2BClient,
    G2BStage,
    NEW_BUSINESS_KEYWORDS,
    classify_keywords,
)
from .candidates import FieldCandidate, build_field_candidates, point_in_polygon, write_candidate_outputs

__all__ = [
    "ENV_PUBLIC_DATA_API_KEY",
    "FetchResult",
    "FreshnessGrade",
    "ProviderError",
    "PublicDataProvider",
    "SourceMeta",
    "load_env_file",
    "redact_secrets",
    "LegalDongCodeClient",
    "LegalDongRecord",
    "build_pnu",
    "BuildingLedgerClient",
    "BuildingLedgerOp",
    "CrosscheckFlag",
    "CrosscheckState",
    "crosscheck_building",
    "pnu_to_ledger_params",
    "StoreInfoClient",
    "StoreRecord",
    "FactoryOnClient",
    "FactoryRecord",
    "FactoryParcelRecord",
    "RtmsTradeClient",
    "RtmsTradeType",
    "TradeCandidate",
    "G2BClient",
    "G2BStage",
    "EarlySignal",
    "NEW_BUSINESS_KEYWORDS",
    "classify_keywords",
    "FieldCandidate",
    "build_field_candidates",
    "point_in_polygon",
    "write_candidate_outputs",
]
