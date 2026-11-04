from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from .models import (
    CaseGrade,
    EventPhase,
    FactorComparison,
    IndividualFactorAssessment,
    LandCharacteristics,
    ReviewPriority,
    ReviewState,
    StandardLandCandidate,
    TransactionCase,
    TransactionEnrichmentResult,
)
from .providers import LandCharacteristicsProvider, ProviderError


ANNOUNCEMENT_DATE = date(2023, 11, 15)
DESIGNATION_DATE = date(2025, 12, 31)
_CRITICAL_FIELDS = {"zoning", "land_category", "land_use"}


def classify_event_phase(transaction_date: date) -> EventPhase:
    if transaction_date < ANNOUNCEMENT_DATE:
        return EventPhase.PRE_ANNOUNCEMENT
    if transaction_date < DESIGNATION_DATE:
        return EventPhase.POST_ANNOUNCEMENT_PRE_DESIGNATION
    return EventPhase.POST_DESIGNATION


def raw_price_gap_ratio(transaction_unit_price_m2: float, official_price_m2: float) -> float:
    """Exploratory market/official-price gap. Never an other-factor rate."""
    if transaction_unit_price_m2 <= 0 or official_price_m2 <= 0:
        raise ValueError("prices must be positive")
    return transaction_unit_price_m2 / official_price_m2


def _cmp(field: str, tx: Optional[str], std: Optional[str]) -> FactorComparison:
    if tx in (None, "") or std in (None, ""):
        state = ReviewState.NOT_IDENTIFIABLE
    elif str(tx).strip() == str(std).strip():
        state = ReviewState.READY_FOR_REVIEW
    else:
        state = ReviewState.REVIEW_REQUIRED
    return FactorComparison(field, tx, std, state)


def _candidate_score(c: LandCharacteristics, s: StandardLandCandidate) -> int:
    pairs = [
        (c.zoning, s.zoning),
        (c.land_category, s.land_category),
        (c.land_use, s.land_use),
        (c.road_access, s.road_access),
        (c.shape, s.shape),
        (c.elevation, s.elevation),
    ]
    return sum(
        1
        for left, right in pairs
        if left not in (None, "") and right not in (None, "") and str(left).strip() == str(right).strip()
    )


def _individual_factor_assessments() -> list[IndividualFactorAssessment]:
    return [
        IndividualFactorAssessment("가로조건", ReviewState.NOT_IDENTIFIABLE, "도로접면만으로 가로조건 수치비교 불가"),
        IndividualFactorAssessment("접근조건", ReviewState.NOT_IDENTIFIABLE, "공공 토지특성 응답만으로 접근성 수치비교 불가"),
        IndividualFactorAssessment("환경조건", ReviewState.NOT_IDENTIFIABLE, "공공 토지특성 응답만으로 환경조건 수치비교 불가"),
        IndividualFactorAssessment("획지조건", ReviewState.NOT_IDENTIFIABLE, "형상·고저만으로 획지조건 수치비교 불가"),
        IndividualFactorAssessment("행정조건", ReviewState.NOT_IDENTIFIABLE, "용도지역 일치만으로 행정조건 수치비교 불가"),
        IndividualFactorAssessment("기타", ReviewState.NOT_IDENTIFIABLE, "확인 가능한 공적자료 없음"),
    ]


def enrich_transaction_case(
    transaction: TransactionCase,
    provider: LandCharacteristicsProvider,
    standard_candidates: Iterable[StandardLandCandidate],
) -> TransactionEnrichmentResult:
    result = TransactionEnrichmentResult(
        transaction=transaction,
        characteristics=None,
        event_phase=classify_event_phase(transaction.transaction_date),
        individual_factor_assessments=_individual_factor_assessments(),
    )
    if not transaction.pnu:
        result.review_reasons.append("PNU_MISSING")
        return result

    try:
        characteristics = provider.get_by_pnu(transaction.pnu, standard_year=transaction.transaction_date.year)
    except ProviderError as exc:
        result.provider_status = exc.code
        result.review_reasons.append(exc.code)
        return result
    except Exception:
        result.provider_status = "PROVIDER_ERROR"
        result.review_reasons.append("PROVIDER_ERROR")
        return result

    if characteristics is None:
        result.provider_status = "LAND_CHARACTERISTICS_NOT_FOUND"
        result.review_reasons.append("LAND_CHARACTERISTICS_NOT_FOUND")
        return result
    if characteristics.pnu != transaction.pnu:
        result.provider_status = "PNU_MISMATCH"
        result.review_reasons.append("PNU_MISMATCH")
        return result

    result.provider_status = "SUCCESS"
    result.characteristics = characteristics
    candidates = list(standard_candidates)
    result.standard_candidates = candidates
    if not candidates:
        result.review_reasons.append("STANDARD_CANDIDATE_NOT_FOUND")
        return result

    scored = sorted(
        ((_candidate_score(characteristics, candidate), candidate) for candidate in candidates),
        key=lambda item: item[0],
        reverse=True,
    )
    best_score = scored[0][0]
    best = [candidate for score, candidate in scored if score == best_score]
    if best_score <= 0 or len(best) != 1:
        result.grade = CaseGrade.REVIEW_REQUIRED
        result.review_priority = ReviewPriority.STANDARD_REVIEW
        result.review_reasons.append("STANDARD_CANDIDATE_AMBIGUOUS")
        return result

    selected = best[0]
    result.selected_standard_id = selected.standard_id
    result.factor_comparisons = [
        _cmp("zoning", characteristics.zoning, selected.zoning),
        _cmp("land_category", characteristics.land_category, selected.land_category),
        _cmp("land_use", characteristics.land_use, selected.land_use),
        _cmp("road_access", characteristics.road_access, selected.road_access),
        _cmp("shape", characteristics.shape, selected.shape),
        _cmp("elevation", characteristics.elevation, selected.elevation),
    ]
    result.raw_price_gap_ratio = raw_price_gap_ratio(transaction.unit_price_m2, selected.official_price_m2)

    unresolved = [comparison for comparison in result.factor_comparisons if comparison.state != ReviewState.READY_FOR_REVIEW]
    critical_unresolved = [comparison for comparison in unresolved if comparison.field in _CRITICAL_FIELDS]
    if critical_unresolved:
        result.review_state = ReviewState.REVIEW_REQUIRED
        result.grade = CaseGrade.REVIEW_REQUIRED
        result.review_priority = ReviewPriority.STANDARD_REVIEW
        result.review_reasons.append("CRITICAL_CHARACTERISTIC_REVIEW_REQUIRED")
    elif unresolved:
        result.review_state = ReviewState.REVIEW_REQUIRED
        result.grade = CaseGrade.B_REFERENCE
        result.review_priority = ReviewPriority.STANDARD_REVIEW
        result.review_reasons.append("FACTOR_ADJUSTMENT_REQUIRED")
    else:
        result.review_state = ReviewState.READY_FOR_REVIEW
        result.grade = CaseGrade.A_CANDIDATE
        result.review_priority = (
            ReviewPriority.A_PLUS_REVIEW
            if result.event_phase == EventPhase.PRE_ANNOUNCEMENT
            else ReviewPriority.STANDARD_REVIEW
        )
        result.review_reasons.append("HUMAN_APPRAISAL_REVIEW_REQUIRED")

    result.review_reasons.append("INDIVIDUAL_FACTORS_NOT_IDENTIFIABLE")
    return result
