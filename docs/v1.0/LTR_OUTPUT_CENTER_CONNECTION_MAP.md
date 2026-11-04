# 보상전략 OS v1.0 LTR — Parser P0 계측 결과 및 산출물 센터 연결표

기준일: 2026-08-20
전제: UI Feature Freeze 유지 · 신규 기능 개발 금지 · 산출물 센터는 "기존 기능 연결"만 허용

이 문서는 신규 기능 정의서가 아니다. (1) `P0-PARSER-SUBJECT-LAND-ROWS` 의 계측 결과와 판정,
(2) 이미 구현된 기능만으로 각 산출물 트랙이 어디까지 도달하는지를 기록한다.

---

## 1. P0-PARSER-SUBJECT-LAND-ROWS — 계측·수정·판정

### 1.1 투입한 계측 (규칙 변경 없음)

| 계측 지점 | 코드 위치 | 남기는 값 |
| --- | --- | --- |
| 편입토지 행 탈락 사유 | `parser/src/extractors/lands_extractor.js` `createSubjectLandExtractionStats` | `MISSING_TABLE_HEADER` / `MISSING_SEQUENCE_PREFIX` / `UNPARSED_ROW` / `DUPLICATE_ROW` 4종 + 구역 라인 분해 |
| 평가행 거부 사유 | `parser/src/extractors/land_appraisal_results_extractor.js` `createLandResultRejectStats` | `TOKEN_COUNT_LT_6` 외 8종 + 토큰수·지목 인덱스 min/max |
| 평가행↔편입토지 연결 손실 | 같은 파일 `createAppraisalRowExtractionStats` | 후보/연속줄/미파싱/중복/매칭/미식별/모호/미연결 |

원문 라인은 어떤 경로로도 저장하지 않는다. 사유 코드와 구조 수치만 남긴다.

계측 자체의 결함 1건도 함께 고쳤다. `starts_with_address` 가 지목 위치 검사를 **통과한** 행에서만
기록되어 `LAND_CATEGORY_POSITION_INVALID` 로 탈락한 행의 모양을 전혀 알 수 없었다. 계산 위치만
앞당겼고 추출 동작은 동일하다 (`npm run test:rc` 전량 PASS 로 확인).

### 1.2 수정한 규칙 (1개)

`parser/src/line_table_segmenter.js` `looksLikeColumnHeaderRow()`

토지조서 표 머리글이 `일련번호 소재지 지번 지목 면적 비교표준지 평가액` 처럼 **다른 구역의 어휘를
열 이름으로** 포함하면, 그 한 줄 때문에 조서 구역 전체가 비교표준지 구역으로 넘어가 편입토지가
통째로 사라졌다. 구역 표제는 어휘 토큰이 1개지만 표 머리글은 열 이름이 여러 개라는 구조적 차이로
구분한다 (열 이름 토큰 3종 이상이면 구역을 전환하지 않는다).

특정 평가서 10행을 억지로 읽게 하는 수정이 아니라, 표 머리글을 구역 표제로 오인하던 일반적 결함의
최소 수정이다. 브라우저측 후보 카운터 `selectiveOcrSubjectRowCandidateCount` 의 구역 종료 판정도
같은 의미로 정렬했다.

### 1.3 동일 Gate A 재실행 결과

기록: `pc-gate-results/2026-08-20T04-48-08-426Z/PC_GATE_RESULT.json` (`pc-gate/0.8`, 동일 입력 유형)

| 항목 | 2026-08-20T02-19 (P0 제기 시점) | 2026-08-20T04-48 (수정 후) |
| --- | --- | --- |
| `subject_land_row_candidates` | 10 | 4 |
| `subject_lands` | 4 | 4 |
| `appraisal_rows` | 3 | 3 |
| 편입토지 탈락 4종 합계 | 계측 없음 | **0** |
| `subject_land_data_row_candidates` / `parsed_rows` | 계측 없음 | 4 / 4 |
| `complete_subject_land_rows` | RUNTIME_FAIL | RUNTIME_FAIL |

### 1.4 판정

**편입토지 행 손실은 해소되었다.** 계측이 밝힌 사실은 두 가지다.

1. "후보 10 대비 인식 4" 는 **행 손실이 아니라 후보 카운터의 결함**이었다. 조서 구역이 닫히지 않아
   표준지·산출근거 표 행까지 편입토지 후보로 세고 있었다. 실제 조서 데이터 행은 4행이다.
2. 수정 후 편입토지 축의 탈락은 4종 사유 모두 **0건**이고
   `data_row_candidates(4) = parsed_rows(4) = subject_lands(4)` 로 일치한다.

**그러나 hard blocker 는 0 이 아니다.** `PARTIAL_SUBJECT_LAND_ROWS` 는 게이트가
`후보 = 편입토지 = 평가행` 을 함께 요구하기 때문에 계속 뜨며, 지금 어긋나는 것은
`appraisal_rows(3) ≠ subject_lands(4)` 한 다리뿐이다. 이는 편입토지 행 손실이 아니라
**평가행 연결 결함**이며, 계측 수치도 그 지점을 가리킨다.

```
appraisal_row_candidates 9 / parsed 3 / unparsed 6 / matched 3 / unlinked_lands 1
거부 사유: LAND_CATEGORY_POSITION_INVALID 4 · TOKEN_COUNT_LT_6 1 · NUMERIC_TOKENS_AFTER_CATEGORY_LT_3 1
unmatched_row_identity 0 · ambiguous_row_identity 0 · unindexable_lands 0
```

매칭된 3행은 모두 깨끗하게 연결됐고, 남은 1필지는 **평가행 자체가 파싱되지 않았다.**
유력 가설 2개이며 원문 대조 없이는 어느 쪽인지 판정할 수 없다.

- (A) 산출근거 표에 그 필지 행이 실제로 있는데 지목 컬럼 위치 규칙에서 탈락한다 → Parser 결함
- (B) 현황분리행이어서 원문 산출근거가 실제로 3행뿐이다 → **게이트의 1:1 규칙이 결함**이고 Parser 는 정상

1.1 의 계측 위치 수정으로 다음 Gate A 실행에서 `appraisal_row_reject_starts_with_address_count`
값이 (A)/(B) 를 가른다.

### 1.5 후속 축 분리

`P0-PARSER-SUBJECT-LAND-ROWS` 는 자기 범위에서 종료한다. 남은 1건은 별도 축으로 분리한다.

```
P0-PARSER-APPRAISAL-ROW-LINK   편입토지 4필지 중 1필지에 산출근거 평가행이 붙지 않음
                                (또는 게이트 1:1 규칙이 현황분리행을 반영하지 못함)
```

UI Feature Freeze 유지. 이 축의 코드 수정은 원문 대조로 (A)/(B) 를 확정한 뒤에만 착수한다.

---

## 2. 산출물 센터 연결표

### 2.0 전 트랙 공통 사실

브라우저 앱 전체에서 **파일로 저장되는 산출물은 지도 SVG 1개뿐이다**
(`index.html:6712 downloadReleaseMapSvg`). 케이스 JSON 도 파일 저장이 아니라 클립보드 복사만 있다
(`index.html:8929 copyJson`). 나머지 문서형 산출물은 전부 Python CLI (`brief_output/`, `bso/`) 에 있고,
그 CLI 는 브라우저의 케이스 JSON 스키마를 소비하지 않는다.

| 스키마 | 최상위 키 | 사용처 |
| --- | --- | --- |
| killerkit 케이스 JSON | `meta, case, owners, appraisals, lands, land_appraisal_results, standard_lands, comp_cases, issue_candidates, draft_sentences, risk_warnings …` (22종) | 브라우저 앱 전체 |
| `BriefOutput` 번들 | `run_meta, project_meta, source_bundle, subject_bundle, valuation_bundle, analysis_bundle, graphics_bundle, page_payloads, docx_assembly, qa_bundle, review_queue` (12종) | `brief_output/` DOCX 조립 |
| `bso_parser` canonical | 별도 (`bso/src/bso_parser/canonical_schema.py`) | `bso/` 그래픽·GIS·시용배치 |

**이 세 스키마 사이의 어댑터가 하나도 없다는 것이 산출물 센터의 단일 최대 병목이다.**

### 2.1 요약 매트릭스

| 트랙 | 현재 파일 산출 | UI 단독 가능 | CLI 의존 | 최대 병목 |
| --- | --- | --- | --- | --- |
| 보상전략 분석보고서 | 불가 | 아니오 | 예 | 케이스 JSON → `BriefOutput` 어댑터 부재 |
| 재결/이의 의견서 자료 | **가능 (DOCX 10구성)** | 예 | 아니오 | 없음 (Output Center P4 연결 완료) |
| 지도·그래픽 | **가능 (SVG)** | 예 (SVG) | QGIS 축만 예 | QGIS 축 실기 BLOCKED |
| 현장검토자료 | **가능 (브라우저 인쇄·PDF)** | 예 | 아니오 | 없음 (Output Center P2 연결 완료) |
| 수치 비교표 | **가능 (XLSX·CSV)** | 예 | 아니오 | 없음 (Output Center P1 연결 완료) |
| GIS 패키지 | 불가 | 아니오 | 예 (전부) | v1.0 범위 외 · `lk-gis-agent` BLOCKED |
| 쟁점·검토 메모 | **가능 (TXT·Markdown)** | 예 | 아니오 | 없음 (Output Center P3 연결 완료). 메모 입력 state 는 v1.1 유지 |

### 2.2 보상전략 분석보고서

| 항목 | 내용 |
| --- | --- |
| 필요한 기존 데이터 | `appraisals`, `lands`, `land_appraisal_results`, `appraisal_totals`, `standard_lands`, `subject_to_standard_factor_comparisons`, `other_factor_reviews`, `issue_candidates`, `draft_sentences` |
| 현재 이미 구현된 기능 | `brief_output/generator.py build_output` (5페이지 브리프의 표·문안·쟁점·슬롯·QA·검토큐 조립), `brief_output/docx_binder.py` + `templates/bso_brief_template_v0.1.docx`, `build_golden_case.py` / `build_golden_case_docx.py`, 브라우저측 `renderWorkflowBase`(평가서 분석)·`renderWorkflowOutput`(결과 정렬) |
| 현재 UI 접근경로 | **없음.** 브라우저는 `6.결과물 > 결과 정렬` 화면 렌더까지가 최대치 |
| 누락 adapter/state | ① 케이스 JSON → `BriefOutput` 어댑터 부재 (현재는 수작업 번들 `golden_case_shinmh_input.json` 만 소비) ② 케이스 JSON 파일 저장 진입점 부재 (클립보드 복사만) ③ 보고서 생성 상태를 담을 state 없음 |
| CLI 의존 여부 | **예** — `python -m brief_output.build_golden_case`, `build_golden_case_docx` |
| 생성 가능 조건 | 개별요인 세부값 또는 종합값 존재 (둘 다 없으면 해당 평가행 `FAIL`) · 누락이 있으면 `complete` 불가이고 `partial` 반환 · 증액률·적정 보상액·감정평가 적정성의 최종판단은 생성하지 않음 |
| LTR 최소 연결조치 | (a) `copyJson` 옆에 "케이스 JSON 파일 저장" 진입점 1개 (b) 케이스 JSON → `BriefOutput` 어댑터 1본 (c) 결과물 화면에 "분석보고서 = 로컬 CLI 필요" 상태 표기. **신규 분석 로직·문안 생성 금지** |

### 2.3 재결/이의 의견서 자료

| 항목 | 내용 |
| --- | --- |
| 필요한 기존 데이터 | `issue_candidates`, `draft_sentences`, `risk_warnings`, 검토큐 항목, `land_appraisal_results`, `other_factor_reviews`, 각 항목의 `source_refs` |
| 현재 이미 구현된 기능 | `renderIssues`·`renderSentences`·`renderRisks`·`renderReviewQueue` (검토큐는 E2E VERIFIED), `bso/src/bso_parser/review_queue_builder.py`, `reverse_factor_audit.py`, `formula_verifier.py`, `trial_report.build_markdown` |
| 현재 UI 접근경로 | `6.결과물 > 7.검토 필요사항 / 쟁점 상세 / 문안 상세 / 리스크 상세` |
| 누락 adapter/state | ① 화면→문서 내보내기 없음 ② 쟁점 + 문안 + 근거(`source_ref`) 를 하나의 의견서 초안으로 묶는 조립기 없음 ③ `trial_report.build_markdown` 은 `bso_parser` canonical 전용이라 브라우저 데이터를 받지 못함 |
| CLI 의존 여부 | 부분 — 열람은 브라우저 단독, 문서화는 CLI 또는 수기 복사 |
| 생성 가능 조건 | 쟁점 후보 ≥1 · 보조문안 ≥1 · 각 항목이 `source_ref` 보유 · `review_status_code = NEEDS_REVIEW`, `auto_confirmed = false` 유지 |
| LTR 최소 연결조치 | 결과물 화면에 "선택한 쟁점·문안·근거 내보내기 (텍스트/클립보드)" 1개. **기존 render 데이터만 재사용하고 새 문안을 생성하지 않는다** |

### 2.4 지도·그래픽

| 항목 | 내용 |
| --- | --- |
| 필요한 기존 데이터 | `lands` (소재지/PNU), `standard_lands`, `comp_cases`, 또는 사용자가 import 한 GeoJSON·PNG·JPEG. QGIS 축은 별도 manifest + 지적 geometry |
| 현재 이미 구현된 기능 | `renderSelectedLandMapContext` + `browser/release-core.js` (E2E `map_context_gate` VERIFIED), `handleReleaseMapFile`, **`downloadReleaseMapSvg` (앱 유일의 파일 다운로드)**, `bso/src/bso_graphics/` 의 `qgis_renderer.py`·`vworld_wmts_renderer.py`·`flow_graphic.py`(PyMuPDF 폴백)·`layout_exporter.py`·`parcel_verification.py` |
| 현재 UI 접근경로 | `5.지도·현장 > 6.지도` — 지도 파일 선택 / 초기화 / **SVG 저장** |
| 누락 adapter/state | ① SVG 외 PNG·PDF 출력 없음 ② 브라우저 지도 state ↔ QGIS manifest 어댑터 없음 ③ QGIS 축은 실기 미완료 (BLOCKED) |
| CLI 의존 여부 | 브라우저 SVG = **아니오** / QGIS 도면 = **예** (`bso/RUN_GRAPHICS_GATE.cmd`, Windows + QGIS 실기) |
| 생성 가능 조건 | SVG: 지도 미리보기 state 존재 · QGIS: manifest + PNU exact-one 검증 통과 (`verification_gate_passed`) + QGIS 실기환경 |
| LTR 최소 연결조치 | "SVG 저장" 은 이미 노출되어 있으므로 **산출물 센터 목록에 등록만** 한다. QGIS 축은 "로컬 전용 산출물" 로 분리 표기하고 v1.0 에서 연결하지 않는다 |

### 2.5 현장검토자료

| 항목 | 내용 |
| --- | --- |
| 필요한 기존 데이터 | `lands`, `land_characteristics`, `public_land_data_enrichment`, `land_characteristic_crosscheck`, 지도 컨텍스트, 검토큐 |
| 현재 이미 구현된 기능 | `renderLands`, `renderPublicData`, `bulkEnrichBlankPublicLandCharacteristics` (VWorld 공란 일괄 보강), `lookupPublicLandDataFromApi`, `renderSelectedLandMapContext`, `renderReviewQueue` |
| 현재 UI 접근경로 | `3.자료·데이터 > 2.대상토지` · `공적자료 상세·보강`, `5.지도·현장`, `6.결과물 > 검토 필요사항` — **4개 화면에 분산** |
| 누락 adapter/state | ① 필지 1건 = 1장으로 묶는 합본 뷰 없음 ② 인쇄용 레이아웃 (print CSS) 없음 ③ 지도 이미지 + 속성표 합성 없음 |
| CLI 의존 여부 | **아니오** |
| 생성 가능 조건 | 편입토지 ≥1필지 · 공적자료 조회 완료 (공란은 "미확인" 으로 표기 가능) · 지도 컨텍스트 로드 |
| LTR 최소 연결조치 | 산출물 센터에서 위 4개 화면으로 가는 **링크 묶음** 제공 (1순위). 합본 인쇄 뷰는 기존 4개 render 결과 재사용에 한정하며, 새 데이터·새 계산을 추가하면 Feature Freeze 위반 |

### 2.6 수치 비교표

| 항목 | 내용 |
| --- | --- |
| 필요한 기존 데이터 | `land_appraisal_results`, `appraisal_totals`, `comparison_summary_by_land`, `other_factor_reviews`, `subject_to_standard_factor_comparisons` |
| 현재 이미 구현된 기능 | `renderLandCompare` + `browser/release-factor-matrix.mjs` (E2E `factor_matrix` VERIFIED), `renderWorkflowValue` (수치표 생성), `renderSubjectFactors`·`renderCaseFactors`·`renderOtherFactors`, `bso/src/bso_parser/batch_comparison.py`, `formula_verifier.py`, `trial_report.build_markdown` |
| 현재 UI 접근경로 | `4.분석 > 3.법인별 평가 비교` · `수치표 생성` |
| 누락 adapter/state | ① 표 단위 복사·CSV·TSV 내보내기 없음 (전체 JSON 클립보드 복사만) ② `batch_comparison.py` 는 canonical 스키마 전용 |
| CLI 의존 여부 | 열람 = **아니오** / 문서화 = 예 |
| 생성 가능 조건 | 평가법인 ≥2 (법인별 비교표) 또는 ≥1 (단일 수치표) · 평가행 존재 · **현재 Gate A 상태에서는 편입토지 4필지 중 1필지에 평가행이 없어 비교표가 필지 단위로 불완전** (§1.4) |
| LTR 최소 연결조치 | 비교표 화면에 "표 복사 (TSV)" 1개. **새 계산·새 파생값 금지.** 필지 결측은 `P0-PARSER-APPRAISAL-ROW-LINK` 종료 후 자동 해소 |

### 2.7 GIS 패키지

| 항목 | 내용 |
| --- | --- |
| 필요한 기존 데이터 | `lands` 의 동·지번 (둘 다 필수) 또는 PNU, `standard_lands`, `comp_cases`, 지구경계 |
| 현재 이미 구현된 기능 | `bso/src/bso_parser/gis_export_builder.py` (비교군 CSV, `dong`/`lot` 결측을 blocking 으로 표기), `scripts/vworld_batch_lookup.js` (최대 200필지), `lk-gis-agent/` (FastAPI + `gpkg/builder.py` + `vworld_wfs`·`datago_attributes` 어댑터), `bso/src/bso_graphics/parcel_verification.py` |
| 현재 UI 접근경로 | **없음.** 브라우저에는 VWorld 단건 조회·공란 보강만 있고 GIS 패키지 진입점은 없다 |
| 누락 adapter/state | ① 브라우저 → GIS 입력 CSV 내보내기 없음 ② PNU 컬럼이 브라우저 state 에 없음 ③ `lk-gis-agent` 는 테스트 파일 부재·일부 모듈 미추적으로 BLOCKED |
| CLI 의존 여부 | **예 (전 경로)** |
| 생성 가능 조건 | 동·지번이 **둘 다** 확정된 필지만 대상 (그 외는 `gis_export_builder` 가 blocking 으로 표기) · PNU→SHP exact-one 검증 통과 |
| LTR 최소 연결조치 | **연결 구현 금지.** v1.0 산출물 센터에는 `BLOCKED / 로컬 전용` 으로 등록만 하고 실행 진입점을 노출하지 않는다 |

### 2.8 쟁점·검토 메모

| 항목 | 내용 |
| --- | --- |
| 필요한 기존 데이터 | `issue_candidates`, `risk_warnings`, 검토큐 항목, `ui_recommendations`, 각 항목의 `source_refs` |
| 현재 이미 구현된 기능 | `renderReviewQueue` (E2E VERIFIED), `renderIssues`, `renderRisks`, `bso/src/bso_parser/review_queue_builder.py` (불확실 추출값·산식 실패·GIS 주소 누락을 사람 검토 큐로 수집), `trial_readiness.py` |
| 현재 UI 접근경로 | `6.결과물 > 7.검토 필요사항 / 쟁점 상세 / 리스크 상세` |
| 누락 adapter/state | ① 사용자 메모를 담을 입력·보관 state 없음 ② 항목별 코멘트 저장 없음 ③ 메모 내보내기 없음 |
| CLI 의존 여부 | **아니오** |
| 생성 가능 조건 | 검토큐 항목 ≥1 |
| LTR 최소 연결조치 | 검토큐·쟁점·리스크의 **텍스트 내보내기** 1개까지만. 메모 입력 필드 추가는 신규 state 이므로 v1.0 금지 → **v1.1 후보** |

---

## 3. v1.0 산출물 센터에서 하지 않는 것

- 새 산출물 포맷, 새 템플릿, 새 문안 생성 로직, 새 계산
- `lk-gis-agent`·QGIS 축의 UI 연결
- 메모 입력·보관 등 신규 state 도입
- `P0-PARSER-APPRAISAL-ROW-LINK` 원인 미확정 상태에서의 Parser 규칙 추가 수정


---

## 4. Output Center 연결 종료 (P0~P4)

| 트랙 | 산출 | 경로 |
| --- | --- | --- |
| 1. 보상전략 분석보고서 | DOCX 5페이지 | `POST /__output_bridge/analysis_report` |
| 2. 재결·이의 의견서 자료 | DOCX 10구성 | `POST /__output_bridge/opinion_package` |
| 3. 수치 비교표 | XLSX 4시트 · CSV | `POST /__output_bridge/numeric_table` |
| 4. 지도·그래픽 | SVG | 브라우저 (기존) |
| 5. 현장검토 자료 | A4 인쇄 · PDF | 브라우저 print CSS |
| 6. 쟁점·검토 메모 | TXT · Markdown | 브라우저 |
| 7. GIS 패키지 | **BLOCKED** | 연결하지 않음 (v1.0 범위 외) |

모든 문서 산출은 하나의 어댑터·QA 계층(`killerkit_adapter` → `build_output` → `apply_adapter_qa`)을 지나므로
fail-closed·provenance·`NEEDS_REVIEW`·자동확정 금지 경계가 트랙마다 다시 구현되지 않는다.
`APPRAISAL_ROW_COVERAGE_GAP` 은 6개 트랙 산출물 전부에 유지된다.

**Output Center LTR Feature Freeze 후보.** 이후 변경은 실제 실패가 재현된 항목에 한정한다.
