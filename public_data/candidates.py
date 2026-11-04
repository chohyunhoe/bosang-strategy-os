"""P0-C. 현장후보 파이프라인.

사업지구 경계 → 상가정보/FactoryOn 수집 → 주소 정규화 → PNU/좌표 확보 →
사업지구 공간 JOIN → 후보 생성 → review_required → 현장후보표/QGIS.

주유소에 한정하지 않는다. 공장·창고·근린생활시설·상업시설·복합영업시설 등
현장검토 가치가 있는 후보를 폭넓게 담는다. 후보는 전부 review_required=True
이며 현장확인·전문가 검토 전에는 확정하지 않는다.
"""

from __future__ import annotations

import csv
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

from .core import SourceMeta, utc_now_iso
from .factoryon import FactoryParcelRecord, FactoryRecord
from .stores import StoreRecord


def normalize_address(value: str | None) -> str:
    """지번주소 표시 문자열 정규화(괄호·중복 공백 제거). 확정값 아님."""
    if not value:
        return ""
    cleaned = re.sub(r"\([^)]*\)", " ", value)
    cleaned = re.sub(r"[(),]", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def point_in_polygon(lon: float, lat: float, ring: Sequence[tuple[float, float]]) -> bool:
    """단순 폴리곤 ray-casting. ring 은 (lon, lat) 목록(EPSG:4326)."""
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


@dataclass
class FieldCandidate:
    """현장방문 후보 1건. 모든 값은 검토 보조 후보값이다."""

    candidate_id: str
    kind: str  # STORE / FACTORY / FACTORY_PARCEL
    name: Optional[str]
    business_category: Optional[str]  # 업종(대>중>소 또는 업종명)
    ksic: Optional[str]
    road_address: Optional[str]
    jibun_address: Optional[str]
    lon: Optional[float]
    lat: Optional[float]
    pnu_candidate: Optional[str]
    in_boundary: Optional[bool]  # None = 좌표/경계 부족으로 판정 불가
    review_required: bool = True
    status: str = "REVIEW_REQUIRED"
    review_notes: list[str] = field(default_factory=list)
    source: dict[str, Any] = field(default_factory=dict)  # SourceMeta.to_dict()


def _category(store: StoreRecord) -> Optional[str]:
    parts = [store.category_large_nm, store.category_medium_nm, store.category_small_nm]
    joined = " > ".join(p for p in parts if p)
    return joined or None


def build_field_candidates(
    *,
    stores: Iterable[StoreRecord] = (),
    factories: Iterable[FactoryRecord] = (),
    factory_parcels: Iterable[FactoryParcelRecord] = (),
    boundary_ring: Sequence[tuple[float, float]] | None = None,
    stores_meta: SourceMeta | None = None,
    factories_meta: SourceMeta | None = None,
    parcels_meta: SourceMeta | None = None,
    project_id: str | None = None,
) -> list[FieldCandidate]:
    """수집 레코드 → 현장후보 목록. 자동 확정 없음(전건 review_required)."""
    candidates: list[FieldCandidate] = []
    counter = 0

    def next_id(prefix: str) -> str:
        nonlocal counter
        counter += 1
        return f"{prefix}-{counter:05d}"

    def boundary_state(lon: Optional[float], lat: Optional[float]) -> Optional[bool]:
        if boundary_ring is None or lon is None or lat is None:
            return None
        return point_in_polygon(lon, lat, boundary_ring)

    for store in stores:
        in_boundary = boundary_state(store.lon, store.lat)
        notes = []
        if in_boundary is None:
            notes.append("경계판정불가: 좌표 또는 경계 미확보")
        if not store.pnu_candidate:
            notes.append("PNU 후보 없음: 주소 기반 수동 확인 필요")
        candidates.append(
            FieldCandidate(
                candidate_id=next_id("STORE"),
                kind="STORE",
                name=store.name,
                business_category=_category(store),
                ksic=(f"{store.ksic_cd} {store.ksic_nm}".strip() if (store.ksic_cd or store.ksic_nm) else None),
                road_address=store.road_address,
                jibun_address=normalize_address(store.jibun_address) or store.jibun_address,
                lon=store.lon,
                lat=store.lat,
                pnu_candidate=store.pnu_candidate,
                in_boundary=in_boundary,
                review_notes=notes,
                source=(stores_meta.to_dict() if stores_meta else {}),
            )
        )

    for factory in factories:
        candidates.append(
            FieldCandidate(
                candidate_id=next_id("FACTORY"),
                kind="FACTORY",
                name=factory.factory_name or factory.company_name,
                business_category=factory.industry_nm,
                ksic=factory.industry_cd,
                road_address=factory.road_address,
                jibun_address=normalize_address(factory.jibun_address) or factory.jibun_address,
                lon=None,
                lat=None,
                pnu_candidate=None,
                in_boundary=None,
                review_notes=["좌표 미제공: 필지정보와 JOIN 후 QGIS 확인 필요"],
                source=(factories_meta.to_dict() if factories_meta else {}),
            )
        )

    for parcel in factory_parcels:
        notes = []
        if not parcel.pnu_candidate:
            notes.append("PNU 변환 불가: 법정동코드/지번 수동 확인 필요")
        candidates.append(
            FieldCandidate(
                candidate_id=next_id("FCTPARCEL"),
                kind="FACTORY_PARCEL",
                name=parcel.company_name,
                business_category=None,
                ksic=None,
                road_address=None,
                jibun_address=normalize_address(parcel.jibun_address) or parcel.jibun_address,
                lon=None,
                lat=None,
                pnu_candidate=parcel.pnu_candidate,
                in_boundary=None,
                review_notes=notes or ["공장-필지 연결 검수 필요"],
                source=(parcels_meta.to_dict() if parcels_meta else {}),
            )
        )

    if project_id:
        for candidate in candidates:
            candidate.source = dict(candidate.source)
            candidate.source["project_id"] = project_id
    return candidates


CANDIDATE_CSV_COLUMNS = [
    "candidate_id",
    "kind",
    "name",
    "business_category",
    "ksic",
    "road_address",
    "jibun_address",
    "lon",
    "lat",
    "pnu_candidate",
    "in_boundary",
    "status",
    "review_required",
    "review_notes",
    "source_dataset",
    "retrieved_at",
]


def write_candidate_outputs(output_dir: Path, candidates: list[FieldCandidate]) -> tuple[Path, Path]:
    """현장후보표 JSON + QGIS 친화 CSV(lon/lat 컬럼) 출력.

    실주소·PNU가 포함되므로 output_dir 는 gitignore 대상(**/local_only/) 아래를
    권장한다. run_field_candidates CLI 는 항상 local_only/ 아래에 쓴다.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "field_candidates.json"
    csv_path = output_dir / "field_candidates_qgis.csv"

    payload = {
        "schema_version": "public-data/field-candidates/0.1",
        "generated_at": utc_now_iso(),
        "safety_boundary": (
            "현장후보는 검토 보조 자료이며 수임 판단·보상 판단이 아닙니다. "
            "전 건 review_required=True, 현장확인 및 전문가 검토가 필요합니다."
        ),
        "total": len(candidates),
        "candidates": [asdict(candidate) for candidate in candidates],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=CANDIDATE_CSV_COLUMNS, lineterminator="\n")
        writer.writeheader()
        for candidate in candidates:
            writer.writerow(
                {
                    "candidate_id": candidate.candidate_id,
                    "kind": candidate.kind,
                    "name": candidate.name,
                    "business_category": candidate.business_category,
                    "ksic": candidate.ksic,
                    "road_address": candidate.road_address,
                    "jibun_address": candidate.jibun_address,
                    "lon": candidate.lon,
                    "lat": candidate.lat,
                    "pnu_candidate": candidate.pnu_candidate,
                    "in_boundary": candidate.in_boundary,
                    "status": candidate.status,
                    "review_required": candidate.review_required,
                    "review_notes": "|".join(candidate.review_notes),
                    "source_dataset": candidate.source.get("source_dataset"),
                    "retrieved_at": candidate.source.get("retrieved_at"),
                }
            )
    return json_path, csv_path
