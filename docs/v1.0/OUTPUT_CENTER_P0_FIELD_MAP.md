# Output Center P0 — killerkit 사건 JSON → BriefOutput 필드 매핑표

기준일: 2026-08-20
어댑터: [`brief_output/killerkit_adapter.py`](../../brief_output/killerkit_adapter.py) (`killerkit_case → bso_brief_output_v0.1` v1)
CLI: [`brief_output/build_case_brief.py`](../../brief_output/build_case_brief.py)
계약 테스트: [`brief_output/test_killerkit_adapter.py`](../../brief_output/test_killerkit_adapter.py) 18건

```bash
python -m brief_output.build_case_brief <case.json> --out-dir output/brief
```

브라우저 `JSON/API/OCR` 화면의 사건 데이터를 그대로 넣으면 기존 산출 계층
(`generator.build_output` → `docx_binder.bind_docx`)이 5페이지 분석보고서(JSON + DOCX)를 만든다.
**새 분석기능·새 Provider·새 지도엔진을 추가하지 않았고, 기존 스키마를 고치지 않았다.**
`generator.py`·`models.py`·`docx_binder.py` 는 한 줄도 수정하지 않았다.

---

## 1. 매핑표

### 1.1 사건·문서

| target (BriefOutput) | source (killerkit case JSON) | 규칙 |
| --- | --- | --- |
| `run_meta.run_id` | `case.case_id` | `bso-adapter-<case_id>` 로 결정론적 생성 |
| `run_meta.status` | — | `build_output` + `apply_adapter_qa` 가 결정. 어댑터는 `partial` 로 시작 |
| `project_meta.project_name` | `case.project_name` → `case.case_name` | 둘 다 비면 **fail-closed 중단** |
| `project_meta.report_date` | `case.price_date` → `case.base_date` | `2025-11-01`·`2024.01.01` 모두 파싱. 실패 시 `null` |
| `project_meta.ownership_share` | `land_appraisal_results[].ownership_share_text` | 사건 전체에서 표기가 **유일할 때만** 승계 |
| `project_meta.client_name_masked` | — | **항상 `null`.** 소유자 실명을 문서 산출 계층으로 넘기지 않는다 |
| `document_meta[].document_id` | `appraisals[].appraisal_id` | 없으면 그 문서를 건너뛰고 차단 기록 |
| `document_meta[].file_name_masked` | `appraisals[].appraisal_id` + `appraisal_company` | **원본 파일명을 넘기지 않는다** (`홍길동(감정평가서).pdf` 처럼 실명이 들어 있음) |
| `document_meta[].appraisal_company` | `appraisals[].appraisal_company` | 그대로 |
| `document_meta[].page_count` | `document_uploads[].page_count` → `appraisals[].page_count` | 1 미만이면 `null` |
| `document_meta[].extraction_method` | `appraisals[].extraction_method` → `parse_status` | 그대로 |

### 1.2 대상토지·비교표준지

| target | source | 규칙 |
| --- | --- | --- |
| `subject_parcels[].parcel_id` | `lands[].land_id` | 없으면 그 필지 차단 |
| `subject_parcels[].lot_number` | `lands[].parcel_address` → `lot_number` | 없으면 그 필지 차단 |
| `subject_parcels[].area_sqm` | `lands[].area` | `> 0` 아니면 `null` (0 으로 채우지 않음) |
| `subject_parcels[].land_category` | `lands[].land_category` | 그대로 |
| `subject_parcels[].current_use` | `lands[].appraisal_use_status` → `use_note` | 현황분리행 꼬리표 승계 |
| `subject_parcels[].ownership_share` | `land_appraisal_results[].ownership_share_text` | 필지별로 유일할 때만 |
| `subject_parcels[].source_refs` | `lands[].source_refs` | §2 |
| `reference_parcels[].reference_id` | `standard_lands[].standard_land_id` | 없으면 차단 |
| `reference_parcels[].lot_number` | `standard_lands[].parcel_address` | 없으면 차단 |
| `reference_parcels[].official_price_per_sqm` | `standard_lands[].official_price` | `>= 0` 아니면 `null` |

### 1.3 평가행 (`valuation_bundle`)

| target | source | 규칙 |
| --- | --- | --- |
| `valuator_id` | `appraisal_id` + `land_id` | `APP_002__LAND_001` |
| `appraisal_company` | `land_appraisal_results[].appraisal_company` → `appraisals[].appraisal_company` | 없으면 **행 차단** (`MISSING_APPRAISAL_COMPANY`) |
| `subject_parcel_id` | `land_appraisal_results[].land_id` | `lands` 에 없는 id 면 **행 차단** (`UNLINKED_SUBJECT_PARCEL`) |
| `reference_parcel_id` | `standard_land_symbol` × `(appraisal_id, symbol)` 조회 | 해석 실패 시 `null` + `SYMBOL_NOT_RESOLVED` 기록 |
| `official_price_per_sqm` | `official_price` | `>= 0` |
| `time_adjustment` | `time_correction` | `> 0` |
| `regional_factor` | — | killerkit 에 지역요인 필드가 없다. **항상 `null`** (역산하지 않음) |
| `other_factor` | `other_factor` | `> 0` |
| `calculated_unit_price` | `calculated_unit_price` | `>= 0` |
| `decided_unit_price` | `unit_price` | `>= 0` |
| `appraised_amount` | `amount` | `>= 0` |
| `source_refs` | `land_appraisal_results[].source_refs` | §2 |

`subject_link_status` 가 `LINKED` 가 아니면 그 행은 차단한다.

### 1.4 개별요인 (`individual_factors`)

우선순위 1 — `subject_to_standard_factor_comparisons` 에서 `(appraisal_id, land_id)` 조합이 **정확히 1건**일 때:

| target | source |
| --- | --- |
| `street_condition` | `street_condition` |
| `access_condition` | `access_condition` |
| `environment_condition` | `environment_or_natural_condition` |
| `parcel_condition` | `parcel_condition` |
| `administrative_condition` | `administrative_condition` |
| `other_condition` | `other_condition` |
| `overall_individual_factor` | `total_factor` |

우선순위 2 — 위에서 비어 있는 조건 칸만, parser 세부계수 `land_appraisal_results[].individual_factor_details[]`
의 `category` 로 채운다. 접근조건/환경조건/획지조건/행정적조건/기타조건 → 같은 이름 필드.
**한 조건에 항목이 2개 이상이면 채우지 않는다** (소계를 곱해 만들지 않음).

우선순위 3 — 누계만: `land_appraisal_results[].individual_factor_total` → `overall_individual_factor`.

`review_status` 는 §3 매핑을 따른다.

### 1.5 그 밖

| target | source | 규칙 |
| --- | --- | --- |
| `analysis_bundle.special_phrases[]` | `subject_to_standard_factor_comparisons[].factor_reason` + `total_factor` | 평가서에 **이미 기재된** 사유 문언만 옮긴다. 새 문장을 쓰지 않는다 |
| `analysis_bundle.browser_issue_candidates` | `issue_candidates` | 원본 보존 (`build_output` 이 자기 후보로 덮어쓰는 키와 분리) |
| `analysis_bundle.browser_draft_sentences` | `draft_sentences` | 원본 보존 |
| `analysis_bundle.browser_risk_warnings` | `risk_warnings` | 원본 보존 |
| `analysis_bundle.adapter_report` | — | 결손·차단·근거·검토상태 집계 |
| `source_bundle.counts` | 각 배열 길이 | 원본 대비 몇 건이 들어왔는지 대조용 |

---

## 2. provenance 유지

parser `source_ref` → BriefOutput `SourceRef` 로 1:1 승계한다.

| target | source |
| --- | --- |
| `document_id` | `appraisal_id` |
| `page` | `page_no` (1 미만이면 `null`) |
| `locator` | `source_label` + `L<line_start>[-<line_end>]` |
| `excerpt` | `raw_text_excerpt` |

근거가 없는 레코드는 **근거를 만들어내지 않고** `records_without_source_ref` 로 센다.
`QA-ADAPTER-PROVENANCE` 가 이를 문서 계층에 올린다.

- 근거 0건 → `FAIL` + `review-missing-provenance` 검토큐 등록 + `run_meta.status = partial`
- 일부 누락 → `REVIEW_REQUIRED`
- 전부 보유 → `PASS`

---

## 3. NEEDS_REVIEW 상태 보존

| killerkit `review_status_code` | BriefOutput `ReviewStatus` |
| --- | --- |
| `NEEDS_REVIEW`, `REVIEW_REQUIRED`, `PENDING` | `REVIEW_REQUIRED` |
| `CONFIRMED` | `PASS` |
| `MISSING`, `CONFLICT`, `FAILED` | `FAIL` |
| 그 밖의 값·미지정 | `REVIEW_REQUIRED` (모르는 상태는 아래로 내린다) |

`SubjectParcel`·`ReferenceParcel` 에는 검토상태 필드가 없다(스키마 개편 금지). 상태가 조용히 사라지지
않도록 어댑터가 원천 레코드의 상태를 집계하고 `QA-ADAPTER-REVIEW-STATE` 로 올린다.
`CONFIRMED` 가 아닌 레코드가 하나라도 있으면 `REVIEW_REQUIRED`.

`auto_confirmed: true` 레코드가 하나라도 있으면 **어댑터가 중단한다**(`AdapterSafetyError`).
v1.0 자동확정 금지 경계를 문서 산출로 우회할 수 없다.

---

## 4. fail-closed 규칙

| 상황 | 처리 | 사유 코드 |
| --- | --- | --- |
| `auto_confirmed: true` | 전체 중단 | `AdapterSafetyError` |
| 편입토지 0건 / 평가행 0건 | 전체 중단 | `AdapterError` |
| 사업명·사건명 둘 다 공란 | 전체 중단 | `AdapterError` |
| 살아남은 평가행 0건 | 전체 중단 (차단 사유 동봉) | `AdapterError` |
| 평가법인명 없음 | 그 행만 제외 | `MISSING_APPRAISAL_COMPANY` |
| `land_id` 가 `lands` 에 없음 | 그 행만 제외 | `UNLINKED_SUBJECT_PARCEL` |
| `subject_link_status != LINKED` | 그 행만 제외 | `SUBJECT_LINK_NOT_LINKED:<값>` |
| 숫자 아님 / `""` / `"-"` | 필드만 `null` | `field_gaps` |
| 목표 스키마 범위 위반 (`other_factor = 0` 등) | 필드만 `null` (**클램프하지 않음**) | `:OUT_OF_CONTRACT_RANGE` |
| 개별요인 비교행이 (평가서, 필지)당 2건 이상 | 6조건 전부 비움 | `AMBIGUOUS_COMPARISON_ROWS` |
| 한 조건에 parser 세부계수 2건 이상 | 그 조건만 비움 | `AMBIGUOUS_PARSER_DETAILS` |
| 평가행이 없는 편입토지 | 보고서에서 제외 + P0 검토큐 | `QA-ADAPTER-SUBJECT-COVERAGE = FAIL` |

마지막 항목이 현재 Gate A 의 **편입토지 4 : 평가행 3** 상황에 해당한다. 어댑터는 빠진 필지를
숨기지 않고 `unlinked_subject_parcels` 로 이름을 남기며, 보고서 상태를 `partial` 로 고정한다.

---

## 5. 기존 browser data 훼손 금지

- `adapt_case(case)` 는 입력 dict 을 **읽기만** 한다 (`test_does_not_mutate_input` 로 고정).
- 브라우저 코드(`index.html`)·parser·기존 `brief_output` 모듈을 수정하지 않았다.
- 브라우저가 만든 `issue_candidates`·`draft_sentences`·`risk_warnings` 는 `browser_*` 키로 원본 보존한다
  (`build_output` 이 자체 쟁점 후보를 넣는 `analysis_bundle["issue_candidates"]` 와 충돌하지 않는다).
- 산출물은 `output/brief/` 에만 쓰며 `.gitignore` 로 저장소 유입을 차단했다.

---

## 6. 실제 생성 기록

| 입력 | 결과 |
| --- | --- |
| `sample_case_001_v021_full.json` (3법인 × 5필지 = 평가행 15) | `partial` · 차단 0건 · 미연결 0필지 · **근거 0건 → `QA-ADAPTER-PROVENANCE = FAIL`** (v0.2.1 샘플에 `source_ref` 없음) |
| parser Layer1 출력 (`text_pdf_layer1b_subject_lands`) | `complete` · 평가행 2 · **근거 7건 승계** |

첫 번째 입력에서 5페이지 DOCX(문단 21, 표 4)가 생성되며, 표에는 평가법인별 결정단가·평가액·
개별요인·그 밖의 요인이 채워지고 원천에 값이 없는 칸은 `확인 필요` 로 남는다.

---

## 7. 다음 순서 (이 어댑터를 재사용)

1. **분석보고서 DOCX** — 완료 (Output Center P0). `POST /__output_bridge/analysis_report`
2. **수치 비교표 XLSX·CSV** — 완료 (Output Center P1). 같은 어댑터·QA 계층을 지나온 결과를
   대상토지 / 법인별 평가 비교 / 개별요인 / 검토사항 4개 시트로 옮긴다. CSV 는 법인별 평가 비교표.
   `POST /__output_bridge/numeric_table` · `brief_output/numeric_table.py`
3. **현장검토 자료** — 완료 (Output Center P2). 브라우저 단독·서버 PDF 엔진 없음.
   필지별 6구성(대상토지/공적자료/평가자료/지도/현장 확인사항/검토상태)을 A4 print CSS 로 합본하고,
   기존 `releaseLoadMapFromData`·`buildSvgMarkup`·`landMapFeatureIndex`·`reviewQueueItems` 를 그대로 재사용한다.
   평가행이 없는 필지도 삭제하지 않고 `확인 필요`, 공적자료가 없으면 `미조회`, 좌표가 없으면 `지도 데이터 필요`.
4. **쟁점·검토 메모** — 완료 (Output Center P3). 브라우저 단독 TXT·Markdown 내보내기.
   `reviewQueueItems()`·`issue_candidates`·`draft_sentences`·`risk_warnings`·`source_refs` 를 7개 구성으로 옮기며,
   새 쟁점·문안을 만들지 않고 기존 문구를 그대로 복사한다. 메모 입력 state 는 추가하지 않았다(v1.1 후보).

5. **재결·이의 의견서 작성자료** — 완료 (Output Center P4). 같은 어댑터·QA 계층 + 수치표 시트 +
   브라우저가 래스터화한 기존 지도 이미지를 10개 구성 DOCX 로 조립한다. 쟁점·문안은 사건 데이터의
   문구를 그대로 옮기며, `최종 의견서`·`법률의견`·`증액 가능성` 표현은 조립 후 자체 검사로 차단한다.
   `POST /__output_bridge/opinion_package` · `brief_output/opinion_package.py`

P0~P4 로 6개 트랙이 No-CLI 로 연결 완료. 남은 것은 GIS 패키지(v1.0 범위 외, BLOCKED 유지)뿐이다.

2~4 도 새 분석을 추가하지 않고 기존 산출물의 표현 형식만 바꾼다.
