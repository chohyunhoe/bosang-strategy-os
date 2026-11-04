"""Transaction-case enrichment and other-factor precheck.

This package is review-assist only. It must not auto-determine compensation,
appraisal conclusions, or an 'other factor' adjustment rate.
"""

from .models import (
    CaseGrade,
    EventPhase,
    LandCharacteristics,
    Provenance,
    ReviewPriority,
    ReviewState,
    StandardLandCandidate,
    TransactionCase,
    TransactionEnrichmentResult,
)
from .precheck import classify_event_phase, enrich_transaction_case, raw_price_gap_ratio
from .providers import VWorldLandCharacteristicsProvider, parse_vworld_land_characteristics

__all__ = [
    "CaseGrade",
    "EventPhase",
    "LandCharacteristics",
    "Provenance",
    "ReviewPriority",
    "ReviewState",
    "StandardLandCandidate",
    "TransactionCase",
    "TransactionEnrichmentResult",
    "VWorldLandCharacteristicsProvider",
    "classify_event_phase",
    "enrich_transaction_case",
    "parse_vworld_land_characteristics",
    "raw_price_gap_ratio",
]
