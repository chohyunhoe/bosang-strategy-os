from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Optional


class Provenance(str, Enum):
    SOURCE_TRANSACTION_FILE = "SOURCE_TRANSACTION_FILE"
    SOURCE_PUBLIC_DATA_API = "SOURCE_PUBLIC_DATA_API"
    SOURCE_VWORLD_API = "SOURCE_VWORLD_API"
    SOURCE_STANDARD_LAND_DATA = "SOURCE_STANDARD_LAND_DATA"
    DERIVED_RAW_GAP = "DERIVED_RAW_GAP"


class ReviewState(str, Enum):
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    NOT_IDENTIFIABLE = "NOT_IDENTIFIABLE"
    EXCLUDE = "EXCLUDE"


class CaseGrade(str, Enum):
    A_CANDIDATE = "A_CANDIDATE"
    B_REFERENCE = "B_REFERENCE"
    C_CONTEXT = "C_CONTEXT"
    EXCLUDE = "EXCLUDE"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class ReviewPriority(str, Enum):
    A_PLUS_REVIEW = "A_PLUS_REVIEW"
    STANDARD_REVIEW = "STANDARD_REVIEW"
    CONTEXT_ONLY = "CONTEXT_ONLY"


class EventPhase(str, Enum):
    PRE_ANNOUNCEMENT = "PRE_ANNOUNCEMENT"
    POST_ANNOUNCEMENT_PRE_DESIGNATION = "POST_ANNOUNCEMENT_PRE_DESIGNATION"
    POST_DESIGNATION = "POST_DESIGNATION"


@dataclass(frozen=True)
class TransactionCase:
    case_id: str
    address: str
    transaction_date: date
    land_category: str
    zoning: str
    area_m2: float
    unit_price_m2: float
    pnu: Optional[str] = None
    standard_candidate_ids: tuple[str, ...] = ()
    provenance: Provenance = Provenance.SOURCE_TRANSACTION_FILE


@dataclass(frozen=True)
class LandCharacteristics:
    pnu: str
    legal_dong: Optional[str] = None
    lot_number: Optional[str] = None
    land_category: Optional[str] = None
    zoning: Optional[str] = None
    zoning_secondary: Optional[str] = None
    land_use: Optional[str] = None
    road_access: Optional[str] = None
    shape: Optional[str] = None
    elevation: Optional[str] = None
    individual_official_price: Optional[float] = None
    price_year: Optional[int] = None
    last_updated_at: Optional[str] = None
    field_provenance: dict[str, Provenance] = field(default_factory=dict)
    provenance: Provenance = Provenance.SOURCE_PUBLIC_DATA_API


@dataclass(frozen=True)
class StandardLandCandidate:
    standard_id: str
    official_price_m2: float
    pnu: Optional[str] = None
    legal_dong: Optional[str] = None
    land_category: Optional[str] = None
    zoning: Optional[str] = None
    land_use: Optional[str] = None
    road_access: Optional[str] = None
    shape: Optional[str] = None
    elevation: Optional[str] = None
    distance_m: Optional[float] = None
    provenance: Provenance = Provenance.SOURCE_STANDARD_LAND_DATA


@dataclass
class FactorComparison:
    field: str
    transaction_value: Optional[str]
    standard_value: Optional[str]
    state: ReviewState


@dataclass
class IndividualFactorAssessment:
    factor: str
    state: ReviewState
    basis: str
    numeric_ratio: None = None


@dataclass
class TransactionEnrichmentResult:
    transaction: TransactionCase
    characteristics: Optional[LandCharacteristics]
    standard_candidates: list[StandardLandCandidate] = field(default_factory=list)
    selected_standard_id: Optional[str] = None
    raw_price_gap_ratio: Optional[float] = None
    factor_comparisons: list[FactorComparison] = field(default_factory=list)
    individual_factor_assessments: list[IndividualFactorAssessment] = field(default_factory=list)
    review_state: ReviewState = ReviewState.REVIEW_REQUIRED
    grade: CaseGrade = CaseGrade.C_CONTEXT
    review_priority: ReviewPriority = ReviewPriority.CONTEXT_ONLY
    event_phase: Optional[EventPhase] = None
    transaction_event_id: Optional[str] = None
    event_member_count: int = 1
    is_event_representative: bool = True
    provider_status: str = "NOT_ATTEMPTED"
    review_reasons: list[str] = field(default_factory=list)

    @property
    def appraisal_conclusion(self) -> None:
        """Deliberately unavailable: this module never returns an appraisal conclusion."""
        return None

    @property
    def adjusted_gap_candidate(self) -> None:
        """Unavailable until verified numeric individual-factor ratios exist."""
        return None
