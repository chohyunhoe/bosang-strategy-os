from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass, replace
from datetime import date
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Mapping

from .models import (
    CaseGrade,
    LandCharacteristics,
    Provenance,
    ReviewPriority,
    StandardLandCandidate,
    TransactionCase,
    TransactionEnrichmentResult,
)
from .pnu import PnuResolutionError, VWorldAddressPnuResolver
from .precheck import enrich_transaction_case
from .providers import OfflineFixtureProvider, VWorldLandCharacteristicsProvider


@dataclass(frozen=True)
class TransactionEvent:
    event_id: str
    member_case_ids: tuple[str, ...]
    representative_case_id: str


def _enum_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _enum_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_enum_value(item) for item in value]
    return value


def _legal_dong_key(address: str) -> str:
    tokens = re.sub(r"[(),]", " ", address).split()
    dong_tokens = [token for token in tokens if re.search(r"(동|리|가)$", token)]
    return " ".join(tokens[:2] + dong_tokens[-1:]) if tokens else ""


def transaction_event_key(case: TransactionCase) -> tuple[str, str, str, str, str]:
    return (
        _legal_dong_key(case.address),
        case.transaction_date.isoformat(),
        case.zoning.strip(),
        case.land_category.strip(),
        f"{case.unit_price_m2:.6f}",
    )


def group_transaction_events(cases: Iterable[TransactionCase]) -> dict[str, TransactionEvent]:
    groups: dict[tuple[str, str, str, str, str], list[TransactionCase]] = {}
    for case in cases:
        groups.setdefault(transaction_event_key(case), []).append(case)
    result: dict[str, TransactionEvent] = {}
    for key, members in groups.items():
        digest = hashlib.sha256("|".join(key).encode("utf-8")).hexdigest()[:12]
        ordered = sorted(members, key=lambda item: item.case_id)
        event = TransactionEvent(
            event_id=f"TXEVENT-{digest}",
            member_case_ids=tuple(item.case_id for item in ordered),
            representative_case_id=ordered[0].case_id,
        )
        for member in ordered:
            result[member.case_id] = event
    return result


def _masked_address(address: str) -> str:
    return re.sub(r"(?:산\s*)?\d+(?:-\d+)?\s*$", "***-*", address).strip()


def _candidate_subset(case: TransactionCase, candidates: list[StandardLandCandidate]) -> list[StandardLandCandidate]:
    if not case.standard_candidate_ids:
        return candidates
    allowed = set(case.standard_candidate_ids)
    return [candidate for candidate in candidates if candidate.standard_id in allowed]


def run_enrichment(
    cases: list[TransactionCase],
    provider: Any,
    standard_candidates: list[StandardLandCandidate],
    *,
    pnu_resolver: Any | None = None,
) -> tuple[list[TransactionEnrichmentResult], dict[str, Any]]:
    events = group_transaction_events(cases)
    results: list[TransactionEnrichmentResult] = []
    for case in cases:
        effective_case = case
        resolution_error: str | None = None
        if not case.pnu and pnu_resolver is not None:
            try:
                resolution = pnu_resolver.resolve(case.address)
                effective_case = replace(case, pnu=resolution.pnu)
            except PnuResolutionError as exc:
                resolution_error = exc.code
        result = enrich_transaction_case(
            effective_case, provider, _candidate_subset(effective_case, standard_candidates)
        )
        if resolution_error:
            result.provider_status = resolution_error
            result.review_reasons = [reason for reason in result.review_reasons if reason != "PNU_MISSING"]
            result.review_reasons.append(resolution_error)
        event = events[case.case_id]
        result.transaction_event_id = event.event_id
        result.event_member_count = len(event.member_case_ids)
        result.is_event_representative = case.case_id == event.representative_case_id
        if not result.is_event_representative:
            result.review_reasons.append("POSSIBLE_SAME_TRANSACTION_EVENT")
        results.append(result)

    results.sort(
        key=lambda item: (
            item.review_priority != ReviewPriority.A_PLUS_REVIEW,
            item.transaction.transaction_date,
            item.transaction.case_id,
        )
    )
    return results, summarize_results(results, provider)


def summarize_results(
    results: list[TransactionEnrichmentResult], provider: Any
) -> dict[str, Any]:
    """Aggregate a results list into the same summary shape run_enrichment returns.

    Exposed separately so callers that re-run a subset of cases (e.g. a retry
    pass over transport-failed cases) can splice updated results back into the
    original list and recompute one final summary, instead of duplicating this
    aggregation logic.
    """
    reason_counts: dict[str, int] = {}
    for result in results:
        for reason in set(result.review_reasons):
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
    provider_mode = "vworld" if isinstance(provider, VWorldLandCharacteristicsProvider) else "offline_fixture"
    lookup_success = sum(item.provider_status == "SUCCESS" for item in results)
    lookup_failure = sum(item.provider_status not in {"SUCCESS", "NOT_ATTEMPTED"} for item in results)
    return {
        "provider_mode": provider_mode,
        "total_cases": len(results),
        "transaction_events": len({item.transaction_event_id for item in results}),
        "a_plus_review_candidates": sum(
            item.review_priority == ReviewPriority.A_PLUS_REVIEW for item in results
        ),
        "lookup_success": lookup_success,
        "lookup_failure": lookup_failure,
        "api_lookup_success": lookup_success if provider_mode == "vworld" else 0,
        "api_lookup_failure": lookup_failure if provider_mode == "vworld" else 0,
        "fixture_lookup_success": lookup_success if provider_mode == "offline_fixture" else 0,
        "fixture_lookup_failure": lookup_failure if provider_mode == "offline_fixture" else 0,
        "pnu_mismatch": reason_counts.get("PNU_MISMATCH", 0),
        "pnu_multiple_candidates": reason_counts.get("PNU_MULTIPLE_EXACT_MATCHES", 0),
        "standard_multiple_candidates": reason_counts.get("STANDARD_CANDIDATE_AMBIGUOUS", 0),
        "remaining_not_identifiable_fields": sum(
            assessment.state.value == "NOT_IDENTIFIABLE"
            for item in results
            for assessment in item.individual_factor_assessments
        ),
        "review_reason_counts": reason_counts,
        "safety_boundary": (
            "A_PLUS_REVIEW and A_CANDIDATE are human-review priorities only; "
            "raw_price_gap_ratio is not an other-factor adjustment rate."
        ),
    }


def result_to_dict(result: TransactionEnrichmentResult, *, mask_address: bool = True) -> dict[str, Any]:
    transaction = asdict(result.transaction)
    if mask_address:
        transaction["address"] = _masked_address(result.transaction.address)
    payload = {
        "transaction_case": transaction,
        "transaction_event_id": result.transaction_event_id,
        "event_member_count": result.event_member_count,
        "is_event_representative": result.is_event_representative,
        "event_phase": result.event_phase,
        "land_characteristics": asdict(result.characteristics) if result.characteristics else None,
        "comparison_standard_candidates": [asdict(item) for item in result.standard_candidates],
        "comparison_standard_id": result.selected_standard_id,
        "factor_comparisons": [asdict(item) for item in result.factor_comparisons],
        "individual_factor_assessments": [asdict(item) for item in result.individual_factor_assessments],
        "raw_price_gap_ratio": result.raw_price_gap_ratio,
        "raw_price_gap_provenance": Provenance.DERIVED_RAW_GAP if result.raw_price_gap_ratio is not None else None,
        "review_state": result.review_state,
        "review_reasons": result.review_reasons,
        "grade": result.grade,
        "review_priority": result.review_priority,
        "provider_status": result.provider_status,
        "appraisal_conclusion": None,
        "adjusted_gap_candidate": None,
    }
    return _enum_value(payload)


def write_outputs(
    output_dir: Path,
    results: list[TransactionEnrichmentResult],
    summary: Mapping[str, Any],
    *,
    mask_address: bool = True,
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "transaction_case_enrichment.json"
    csv_path = output_dir / "transaction_case_enrichment_review.csv"
    payload = {
        "schema_version": "transaction-enrichment/0.2",
        "summary": _enum_value(dict(summary)),
        "cases": [result_to_dict(result, mask_address=mask_address) for result in results],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    columns = [
        "case_id",
        "transaction_date",
        "area_m2",
        "unit_price_m2",
        "pnu",
        "land_characteristics",
        "comparison_standard_candidates",
        "comparison_standard_id",
        "factor_comparisons",
        "raw_price_gap_ratio",
        "review_reasons",
        "grade",
        "review_priority",
        "provenance",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for result in results:
            row = result_to_dict(result, mask_address=mask_address)
            transaction = row["transaction_case"]
            writer.writerow(
                {
                    "case_id": transaction["case_id"],
                    "transaction_date": transaction["transaction_date"],
                    "area_m2": transaction["area_m2"],
                    "unit_price_m2": transaction["unit_price_m2"],
                    "pnu": transaction["pnu"],
                    "land_characteristics": json.dumps(row["land_characteristics"], ensure_ascii=False),
                    "comparison_standard_candidates": json.dumps(row["comparison_standard_candidates"], ensure_ascii=False),
                    "comparison_standard_id": row["comparison_standard_id"],
                    "factor_comparisons": json.dumps(row["factor_comparisons"], ensure_ascii=False),
                    "raw_price_gap_ratio": row["raw_price_gap_ratio"],
                    "review_reasons": "|".join(row["review_reasons"]),
                    "grade": row["grade"],
                    "review_priority": row["review_priority"],
                    "provenance": transaction["provenance"],
                }
            )
    return json_path, csv_path


def load_bundle(path: Path) -> tuple[list[TransactionCase], dict[str, LandCharacteristics], list[StandardLandCandidate]]:
    bundle = json.loads(path.read_text(encoding="utf-8"))
    cases = [
        TransactionCase(
            case_id=item["case_id"],
            address=item["address"],
            transaction_date=date.fromisoformat(item["transaction_date"]),
            land_category=item["land_category"],
            zoning=item["zoning"],
            area_m2=float(item["area_m2"]),
            unit_price_m2=float(item["unit_price_m2"]),
            pnu=item.get("pnu"),
            standard_candidate_ids=tuple(item.get("standard_candidate_ids", [])),
        )
        for item in bundle["transactions"]
    ]
    characteristics: dict[str, LandCharacteristics] = {}
    for key, value in bundle.get("land_characteristics", {}).items():
        fields = dict(value)
        raw_provenance = fields.pop("field_provenance", {})
        if "provenance" in fields:
            fields["provenance"] = Provenance(fields["provenance"])
        fields["field_provenance"] = {
            field_name: Provenance(provenance)
            for field_name, provenance in raw_provenance.items()
        }
        characteristics[key] = LandCharacteristics(**fields)
    standards = [StandardLandCandidate(**item) for item in bundle["standard_candidates"]]
    return cases, characteristics, standards


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Transaction-case enrichment review output")
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--provider", choices=("offline", "vworld"), default="offline")
    parser.add_argument("--include-addresses", action="store_true", help="Local-only; never commit detailed addresses")
    args = parser.parse_args(argv)

    cases, characteristics, standards = load_bundle(args.bundle)
    provider = OfflineFixtureProvider(characteristics) if args.provider == "offline" else VWorldLandCharacteristicsProvider()
    resolver = None if args.provider == "offline" else VWorldAddressPnuResolver()
    if args.provider == "vworld":
        bundle_raw = json.loads(args.bundle.read_text(encoding="utf-8"))
        if bundle_raw.get("standards_source") == "SYNTHETIC_DEFAULT":
            print("ERROR: bundle contains synthetic DEFAULT_STANDARDS. Supply verified --standards to xlsx_converter.", file=sys.stderr)
            return 1
    results, summary = run_enrichment(cases, provider, standards, pnu_resolver=resolver)
    output_dir = args.output_dir / "local_only" if args.provider == "vworld" else args.output_dir
    write_outputs(output_dir, results, summary, mask_address=not args.include_addresses)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
