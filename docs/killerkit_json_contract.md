# KillerKit v025 JSON Contract — Parser Layer 0

## 1. 목적과 기준 파일

Parser Layer 0의 목표는 PDF를 직접 해석하는 것이 아니라, `reference/bosang_strategy_os_killerkit_v025.html` 검토 UI가 소비할 수 있는 `generated_case.json`의 최소 구조를 고정하는 것이다.

- Stable UI 기준: `reference/bosang_strategy_os_killerkit_v025.html`
- Schema 기준: `reference/sample_case_001_v021_full.json`
- 이번 단계 범위: 계약서, 스켈레톤, schema compatibility test
- 제외 범위: PDF 파싱, OCR, PDF.js, 정규식 파서, UI 리디자인

생성 JSON은 검토 보조용 구조화 데이터이며 감정평가 결과 산정, 법률판단, 보상금 증액 가능성 판단을 확정하지 않는다. 누락·불명확 값은 `NEEDS_REVIEW`, `MISSING`, `OCR_REQUIRED`, `PARSE_FAILED` 등의 상태로 남기고 수동 검수 및 전문가 검토 필요 상태를 보존한다.

## 2. KillerKit HTML이 소비하는 주요 JSON 키

`bosang_strategy_os_killerkit_v025.html`은 다음 계열의 데이터를 중심으로 화면을 구성한다.

| UI 소비 영역 | 주요 키 | 용도 |
| --- | --- | --- |
| 사건·파일 상태 | `meta`, `case`, `appraisals`, `appraisal_totals` | 사건명, 평가 목적, 평가법인별 원본 파일·추출 상태·총액 표시 |
| 소유자·편입토지 | `owners`, `lands`, `land_characteristics` | 소유자, 편입토지 기본정보, 평가서/공적자료 특성정보 검토 |
| 평가 결과 비교 | `land_appraisal_results`, `comparison_summary_by_land` | 법인별 표준지, 개별요인, 그 밖의 요인, 단가, 금액 차이 비교 |
| 비교표준지·거래사례 | `standard_lands`, `comp_cases` | 평가법인별 비교표준지와 거래사례 정보 표시 |
| 요인 비교 | `subject_to_standard_factor_comparisons`, `standard_to_comp_case_factor_comparisons`, `other_factor_reviews` | 편입토지↔비교표준지, 비교표준지↔거래사례, 그 밖의 요인 산식 구조 검토 |
| 쟁점·문안·리스크 | `issue_candidates`, `draft_sentences`, `risk_warnings` | 쟁점 후보, 의견서 주장문 초안, 제출 전 표현 리스크 표시 |

> 참고: 기존 stable 계열에는 `public_land_characteristics`, `public_land_data_enrichment`, `land_characteristic_crosscheck`, `ocr_review_items` 등 확장 키도 존재할 수 있다. Parser Layer 0의 최소 필수 키에는 포함하지 않지만, 입력에 존재하는 경우 삭제하지 않고 보존하는 것을 원칙으로 한다.

## 3. `sample_case_001_v021_full.json` 최상위 키와 row-level 주요 필드

| 최상위 키 | 타입 | row-level 주요 필드 |
| --- | --- | --- |
| `meta` | object | `schema_version`, `project_name`, `prototype_type`, `created_for`, `case_scope`, `notes` |
| `case` | object | `case_id`, `case_name`, `project_name`, `project_owner`, `appraisal_purpose`, `price_date`, `field_investigation_period`, `project_approval_notice_date`, `review_status_code` |
| `owners` | array | `owner_id`, `owner_name`, `display_name`, `owner_role`, `privacy_handling_note` |
| `appraisals` | array | `appraisal_id`, `appraisal_company`, `file_name`, `file_type`, `extraction_method`, `parse_status`, `review_status_code`, `source_note` |
| `lands` | array | `land_id`, `owner_id`, `serial_no`, `parcel_address`, `legal_dong`, `lot_number`, `location`, `land_category`, `area`, `appraisal_use_status`, `use_note`, `public_characteristics_status`, `review_status_code` |
| `land_characteristics` | array | `land_id`, `parcel_address`, `land_category_appraisal`, `use_status_appraisal`, `zoning_appraisal`, `road_frontage_public`, `terrain_height_public`, `terrain_shape_public`, `land_use_status_public`, `official_land_price_public`, `pnu`, `public_data_source`, `review_status_code`, `review_note` |
| `land_appraisal_results` | array | `appraisal_id`, `appraisal_company`, `land_id`, `parcel_address`, `standard_land_symbol`, `individual_factor_total`, `other_factor`, `unit_price`, `amount`, `extraction_status` |
| `appraisal_totals` | array | `appraisal_id`, `appraisal_company`, `land_total_amount`, `obstacle_total_amount`, `grand_total_amount`, `review_status_code` |
| `standard_lands` | array | `standard_land_id`, `appraisal_id`, `appraisal_company`, `standard_land_symbol`, `parcel_address`, `legal_dong`, `lot_number`, `land_category`, `use_status`, `zoning`, `area`, `official_price`, `road_condition`, `shape_terrain`, `selected_for_land_ids`, `source_note` |
| `comp_cases` | array | `comp_case_id`, `appraisal_id`, `appraisal_company`, `case_symbol`, `parcel_address`, `legal_dong`, `lot_number`, `land_category`, `zoning`, `case_date`, `case_unit_price`, `case_type`, `used_for_standard_land_ids` |
| `subject_to_standard_factor_comparisons` | array | `comparison_id`, `comparison_type`, `appraisal_id`, `appraisal_company`, `land_id`, `subject_parcel_address`, `standard_land_id`, `standard_parcel_address`, `street_condition`, `access_condition`, `environment_or_natural_condition`, `parcel_condition`, `administrative_condition`, `other_condition`, `total_factor`, `factor_reason` |
| `standard_to_comp_case_factor_comparisons` | array | `comparison_id`, `comparison_type`, `appraisal_id`, `appraisal_company`, `standard_land_id`, `standard_parcel_address`, `comp_case_id`, `comp_case_parcel_address`, `street_condition`, `access_condition`, `environment_or_natural_condition`, `parcel_condition`, `administrative_condition`, `other_condition`, `total_factor`, `factor_reason` |
| `other_factor_reviews` | array | `appraisal_id`, `appraisal_company`, `standard_land_id`, `standard_land_symbol`, `comparison_case_symbol`, `comp_case_id`, `case_unit_price`, `case_time_correction`, `case_individual_factor`, `case_based_standard_price`, `standard_based_price`, `calculated_gap_ratio`, `decided_other_factor` |
| `comparison_summary_by_land` | array | `land_id`, `parcel_address`, `min_company`, `min_unit_price`, `max_company`, `max_unit_price`, `unit_price_gap`, `amount_gap`, `primary_review_axis` |
| `issue_candidates` | array | `issue_id`, `issue_type_code`, `detail_type_code`, `related_land_ids`, `confirmed_fact`, `interpretation_note`, `required_evidence`, `issue_grade`, `reflection_status`, `risk_control_note` |
| `draft_sentences` | array | `draft_sentence_id`, `issue_id`, `template_id`, `draft_sentence_raw`, `draft_sentence_safe`, `filter_result_code`, `draft_reflection_status` |
| `risk_warnings` | array | `risk_id`, `risk_type`, `risk_level`, `related_issue_id`, `message`, `required_action` |

## 4. Parser가 생성해야 할 `generated_case.json` 최소 필수 구조

Parser는 실제 추출 결과가 부분 객체이더라도 아래 최상위 키를 항상 포함한 JSON으로 정규화해야 한다.

```json
{
  "meta": {
    "generated_for": "killerkit_v025_review_ui",
    "parser_stage": "skeleton_only",
    "schema_reference": "reference/sample_case_001_v021_full.json",
    "notice": "본 JSON은 검토 보조용 구조화 데이터이며 감정평가 결과 산정 또는 법률판단 확정값이 아닙니다."
  },
  "case": {
    "review_status_code": "NEEDS_REVIEW"
  },
  "owners": [],
  "appraisals": [],
  "lands": [],
  "land_characteristics": [],
  "land_appraisal_results": [],
  "appraisal_totals": [],
  "standard_lands": [],
  "comp_cases": [],
  "subject_to_standard_factor_comparisons": [],
  "standard_to_comp_case_factor_comparisons": [],
  "other_factor_reviews": [],
  "comparison_summary_by_land": [],
  "issue_candidates": [],
  "draft_sentences": [],
  "risk_warnings": []
}
```

### 필수 최상위 키

1. `meta`
2. `case`
3. `owners`
4. `appraisals`
5. `lands`
6. `land_characteristics`
7. `land_appraisal_results`
8. `appraisal_totals`
9. `standard_lands`
10. `comp_cases`
11. `subject_to_standard_factor_comparisons`
12. `standard_to_comp_case_factor_comparisons`
13. `other_factor_reviews`
14. `comparison_summary_by_land`
15. `issue_candidates`
16. `draft_sentences`
17. `risk_warnings`

## 5. 상태값 계약

Parser Layer 0은 다음 상태값만 상수로 제공한다.

| 상태값 | 의미 |
| --- | --- |
| `TEXT_PARSED` | 텍스트 추출 결과가 구조화 후보로 반영됨 |
| `NEEDS_REVIEW` | 수동 검수 필요 |
| `MISSING` | 원문 또는 추출 결과에서 확인되지 않음 |
| `OCR_REQUIRED` | 이미지 기반 PDF 등으로 OCR 필요 |
| `CONFIRMED` | 검토자가 확인한 값 |
| `PARSE_FAILED` | 추출 또는 정규화 실패 |

## 6. 호환성 원칙

- `ensureRequiredTopLevelKeys()`는 누락된 필수 최상위 키를 보정한다.
- 배열형 필수 키가 배열이 아니면 빈 배열로 보정한다.
- `meta`, `case`가 객체가 아니면 최소 객체로 보정한다.
- 입력에 존재하는 추가 키는 삭제하지 않는다.
- Parser Layer 0은 PDF 내용 파싱, OCR, 법령/API 최신성 판단을 수행하지 않는다.
