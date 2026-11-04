# Parser Layer 1A KillerKit 필드 계약 재정의

## 작업 목적

Parser Layer 1A는 정규식 hotfix로 개별 필드를 맞추는 단계가 아니라, `reference/bosang_strategy_os_killerkit_v025.html`이 깨지지 않게 소비하는 JSON 계약을 먼저 만족시키는 단계입니다. 실제 추출값은 검토 보조 후보이며, 틀린 값을 `MEDIUM`/`HIGH` 신뢰도로 넣기보다 빈 값과 `MISSING` 상태를 유지합니다.

## 역할별 검토

- **GPT / 범위 통제**: 이번 전환은 KillerKit v0.2.5 렌더링 기준선을 복원하는 작업이며, OCR·VWorld·거래사례·개별요인·쟁점·의견서 자동작성 확장은 제외합니다.
- **Gemini / UX·데이터 구조**: UI가 `arr(data.<key>)`와 빈 배열 fallback으로 안전하게 렌더링되도록 최상위 키를 보존합니다. 화면이 비어도 “데이터 없음” 메시지가 떠야 하며, false positive가 표에 노출되면 안 됩니다.
- **Claude / 문구 안전**: 모든 자동 추출값은 “검토 보조”, “수동 검수”, “전문가 검토 필요” 맥락의 후보값입니다. 감정평가 대체, 법률판단 확정, 보상금 증액 단정 표현은 사용하지 않습니다.
- **Perplexity / 외부 리서치**: 이번 작업은 로컬 reference HTML/JSON 계약 조사이므로 외부 리서치가 필요하지 않습니다. VWorld endpoint나 법령 해석은 후속 단계에서 별도 리서치 필요로 남깁니다.

## 1. KillerKit v0.2.5가 실제 소비하는 핵심 JSON key

`reference/bosang_strategy_os_killerkit_v025.html` 기준 실제 소비 최상위 키는 다음과 같습니다.

| key | 주요 소비 화면/함수 | Layer 1A 계약 |
| --- | --- | --- |
| `meta` | `renderOverview`, 업로드 관리 | 객체 유지 |
| `case` | `renderOverview` | 객체 유지, 추출 실패 시 빈 값 + `MISSING` |
| `document_uploads` | `getUploadRows`, `renderUploadHub`, `renderSourceStatus` | 배열 유지 |
| `appraisals` | `renderOverview`, `renderSourceStatus`, 수치 비교 계열 | 최소 1개 상태 row 허용 |
| `appraisal_totals` | `renderSourceStatus` | 배열 유지 |
| `owners` | reference JSON 호환 | 배열 유지 |
| `lands` | `renderLands`, `renderSubjectFactors` | 배열 유지, 명시적 편입토지 목록/토지조서에서만 후보 생성 |
| `land_characteristics` | `renderOverview`, `renderLands`, `renderPublicData` | 배열 유지 |
| `public_land_characteristics` | `getPublicRowByAddress`, 공적 특성 병합 | 배열 유지 |
| `public_land_data_enrichment` | `renderOverview`, `renderPublicData` | 객체 유지 |
| `land_characteristic_crosscheck` | `renderPublicData` | 배열 유지 |
| `standard_lands` | `renderStdCases`, 개별요인 보조 카드 | 배열 유지, 확실한 후보만 입력 |
| `comp_cases` | `renderStdCases`, 사례 비교 계열 | 배열 유지, Layer 1A 추출 보류 |
| `land_appraisal_results` | `renderLandCompare`, `renderSubjectFactors` | 배열 유지, 평가서 표 후보만 입력 |
| `comparison_summary_by_land` | `renderOverview`, `renderLandCompare` | 배열 유지, 자동 계산 보류 |
| `subject_to_standard_factor_comparisons` | `renderSubjectFactors` | 배열 유지, Layer 1A 추출 보류 |
| `standard_to_comp_case_factor_comparisons` | `renderCaseFactors` | 배열 유지, Layer 1A 추출 보류 |
| `other_factor_reviews` | `renderOverview`, `renderOtherFactors` | 배열 유지, Layer 1A 추출 보류 |
| `obstacle_summary_by_appraisal` | `renderObstacles` | 배열 유지, Layer 1A 추출 보류 |
| `obstacle_appraisal_results_sample` | `renderObstacles` | 배열 유지, Layer 1A 추출 보류 |
| `ocr_review_items` | stable16 보존 키 | 배열 유지, Layer 1A 추출 보류 |
| `issue_candidates` | `renderOverview`, `renderIssues` | 배열 유지, 자동 생성 금지 |
| `draft_sentences` | `renderSentences` | 배열 유지, 자동 작성 금지 |
| `risk_warnings` | `renderOverview`, `renderRisks` | 배열 유지, 자동 생성 금지 |

## 2. `sample_case_001_v021_full.json` 기준 필수 필드

KillerKit 화면 구성을 위한 최소 필드는 “값 추출 필수”가 아니라 “UI 계약상 key/shape 필수”입니다.

| Level | 필드군 | 최소 필드 |
| --- | --- | --- |
| A. 렌더링 필수 | 최상위 계약 | 위 25개 top-level key |
| A. 렌더링 필수 | `appraisals[]` | `appraisal_id`, `appraisal_company`, `file_name`, `file_type`, `parse_status`, `review_status_code` |
| A. 렌더링 필수 | `case` | `review_status_code`, 선택적 `case_name`, `project_name`, `price_date` |
| A. 렌더링 필수 | 배열형 화면 | 값이 없으면 빈 배열 유지 |
| B. 있으면 좋은 필드 | `standard_lands[]` | `standard_land_id`, `appraisal_id`, `standard_land_symbol`, `parcel_address`, `land_category`, `area`, `official_price` |
| B. 있으면 좋은 필드 | `land_appraisal_results[]` | `appraisal_id`, `land_id`, `parcel_address`, `land_category`, `area`, `standard_land_symbol`, `individual_factor_total`, `other_factor`, `unit_price`, `amount`; 소재지·지목·면적의 유일 연결 필수 |
| B. 있으면 좋은 필드 | `appraisal_totals[]` | `appraisal_id`, `appraisal_company`, `total_amount` 또는 후속 호환용 합계 필드 |
| C. 아직 뽑지 말 필드 | 확장 검토자료 | VWorld/공적 특성, 거래사례, 개별요인 상세, 그 밖의 요인, 쟁점 후보, 의견서 문안, 리스크 자동생성 |

## 3. 현재 actual JSON과 sample JSON 차이

`parser/output/generated_case.layer1.actual.json`은 개인정보·지번·원문 일부가 포함될 수 있어 Git 추적 제외 대상이며, 현재 작업 환경에는 존재하지 않았습니다. 따라서 아래 비교는 현재 추적 가능한 `parser/output/generated_case.layer1.example.json`과 `reference/sample_case_001_v021_full.json` 기준의 계약 차이입니다. 실제 PDF actual 비교는 로컬 파일이 있을 때만 테스트가 생성합니다.

| 구분 | sample 기준 | 현재 Layer 1A 기준 | 조치 |
| --- | --- | --- | --- |
| 공적자료 key | `public_land_data_enrichment`, `land_characteristic_crosscheck` 포함 | 일부 skeleton에서 누락 가능 | schema adapter 최상위 계약으로 보강 |
| KillerKit upload key | `document_uploads`는 HTML에서 소비 | parser skeleton에 없을 수 있음 | 빈 배열로 보강 |
| public lookup key | `public_land_characteristics`는 HTML helper에서 소비 | parser skeleton에 없을 수 있음 | 빈 배열로 보강 |
| 지장물 key | reference HTML에서 소비 | parser skeleton에 없을 수 있음 | 빈 배열로 보강 |
| `lands[]` | sample은 사람이 검수한 편입토지 row 포함 | 토지가액 산출근거를 재사용하면 false positive 위험 | 명시적인 편입토지 목록/토지조서에서만 후보 생성 |
| `standard_lands[]` | sample은 법인별 표준지 정보 | Layer 1A는 raw text 표 후보 | source_refs 있는 후보만 유지, 없으면 LOW/MISSING |
| `land_appraisal_results[]` | sample은 법인별 수치 비교 가능 | Layer 1A는 표 후보 일부 | 산식 재계산 없이 기재값 후보만 유지 |
| 거래사례/요인/쟁점/문안 | sample은 완성형 검토자료 | Layer 1A 범위 밖 | 빈 배열 유지 |

## 4. false positive로 비활성화해야 할 extractor

| extractor | 상태 | 이유 |
| --- | --- | --- |
| `lands[]` 자동 생성 | 제한적 활성화 | 토지가액 산출근거 재사용은 금지하고 명시적인 편입토지 목록/토지조서 섹션에서만 후보 생성 |
| 공적자료/VWorld extractor | 미구현 유지 | 조회값을 확정 사실처럼 표시할 위험이 있어 Layer 1A 범위 밖 |
| 거래사례/개별요인/그 밖의 요인 extractor | 미구현 유지 | raw text 매핑 전략과 검수 UI 계약 확정 전 오염 가능성 높음 |
| 쟁점/문안/리스크 자동생성 | 미구현 유지 | 의견서 자동작성 및 확정적 판단으로 오해될 수 있어 금지 |

## 5. Parser Layer 1A에서 유지할 최소 범위

1. TEXT_PDF 텍스트 추출 상태 row 생성
2. `case` 기본정보 후보: 실패 시 빈 값 + `MISSING`
3. `appraisals[]` 최소 상태 row: 실패 시 빈 법인명 + `MISSING`
4. `standard_lands[]` 후보: source_refs가 있는 경우만, 자동 확정 금지
5. `land_appraisal_results[]` 후보: 평가서 표에 기재된 값만, 재계산 금지
6. `appraisal_totals[]` 후보: 평가서에 기재된 총액 후보만, 재계산 금지
7. KillerKit가 소비하는 모든 최상위 key를 빈 배열/객체로 보존

## 6. 다음 구현 계획

1. 실제 PDF raw text를 섹션 단위로 분류하는 mapping fixture를 익명화해서 추가합니다.
2. `standard_lands[]`와 `land_appraisal_results[]` 각각에 대해 “필수 토큰이 모두 있는 경우만 후보 생성” 규칙을 테스트로 고정합니다.
3. `lands[]`는 토지가액 산출근거가 아니라 편입토지 목록/토지조서 원문 섹션에서만 생성하며, 소재지·지목·면적이 유일하게 일치할 때만 `land_appraisal_results[]`를 연결합니다.
4. actual JSON 비교는 Git에 포함하지 않고, 테스트 실행 시 로컬 output으로만 생성합니다.

## 7. 외부모델 투입 필요 여부

현재 계약 복원에는 외부모델이 필요하지 않습니다. 다만 실제 PDF raw text에서 표 구조가 줄바꿈·컬럼 깨짐으로 반복 실패하면, 익명화된 raw text 조각을 기준으로 외부모델에 “섹션 분류/컬럼 매핑 전략” 검토를 요청할 수 있습니다.

## 8. 병합 가능 여부

병합 가능 기준은 다음과 같습니다.

- stable16/reference HTML과 sample reference JSON을 수정하지 않을 것
- actual PDF/output/debug sample을 Git에 포함하지 않을 것
- `node tests/validate_static_site.js`, `node parser/tests/schema_compat.test.js`, `node parser/tests/text_pdf_parser_layer1.test.js`, `node parser/tests/text_pdf_parser_layer1b_subject_lands.test.js`, `git diff --check`가 통과할 것
- false positive 후보를 `MEDIUM`/`HIGH`로 넣지 않고 빈 값 + `MISSING` 또는 빈 배열로 유지할 것
