# Parser Layer 2 Prompt-Only Extraction Experiment Kit

이 디렉터리는 실제 LLM API 구현 전에 감정평가서 raw text 일부를 수동으로 GPT / Claude / Gemini에 넣어 KillerKit v0.2.5 후보 JSON 추출 가능성을 비교하기 위한 실험 키트입니다. 여기의 파일은 prompt-only 문서이며 OpenAI/Gemini/Claude API 호출, API key 저장, 서버 업로드, UI 변경, 의견서 자동작성을 포함하지 않습니다.

## 파일 구성

| 파일 | 용도 |
| --- | --- |
| `layer2_extraction_prompt_ko.md` | raw text excerpt에서 `generated_case.layer2.candidate.json` 후보를 만들기 위한 한국어 장문 프롬프트 |
| `layer2_extraction_prompt_short.md` | 모바일 복사와 짧은 excerpt 실험에 맞춘 1,500자 이하 단축 프롬프트 |
| `layer2_extraction_prompt_gpt_v2.md` | Layer 2 모델 비교 후 GPT를 Recommended Base Model 후보로 고정하고 Claude식 MISSING-first 정책을 강제하는 v2 프롬프트 |
| `layer2_gpt_v2_adapter_rules.md` | GPT v2 결과를 KillerKit v0.2.5 flat schema로 옮기기 전 적용할 adapter normalization 규칙 |
| `layer2_model_comparison_checklist.md` | GPT / Claude / Gemini 출력 품질을 0~3점으로 비교하는 평가표 |
| `layer2_output_adapter_policy.md` | 모델별 후보 JSON을 flat schema로 옮기기 전 적용할 공통 adapter 정책 |

## 기준 문서와 입력 후보

수동 실험 전 아래 파일을 함께 확인합니다.

- `parser/LAYER2_LLM_EXTRACTION_DESIGN.md`
- `parser/LAYER1_FIELD_CONTRACT.md`
- `reference/sample_case_001_v021_full.json`
- `parser/output/debug_actual_text_sample.txt`
- `parser/output/generated_case.layer1.actual.json`

`parser/output/*actual*` 파일은 실제 PDF 원문에서 생성될 수 있고 민감정보를 포함할 수 있으므로 Git에 추가하지 않습니다.

## 수동 실험 절차

1. `npm run parser:actual`을 실행해 실제 PDF 기반 Layer 1 산출물과 debug text sample을 생성합니다.
2. `parser/output/debug_actual_text_sample.txt`를 열고 지번, 금액, 소유자 등 개인정보가 과도한 부분은 제외하거나 실험에 필요한 최소 범위만 선택합니다.
3. `layer2_extraction_prompt_ko.md` 또는 `layer2_extraction_prompt_short.md`를 복사합니다.
4. 선택한 raw text excerpt를 프롬프트의 붙여넣기 영역에 넣고 GPT / Claude / Gemini에 각각 동일하게 입력합니다.
5. 각 모델의 결과 JSON을 파싱 가능한지 확인하고 `layer2_model_comparison_checklist.md`에 점수와 관찰 메모를 기록합니다.
6. 가장 안정적인 모델과 프롬프트를 다음 Layer 2 구현 후보로 선정합니다.

## GPT v2 Recommended Base Model 정책

Layer 2 모델 비교 결과 GPT는 `lands`, `standard_lands`, `land_appraisal_results` 추출률이 가장 높아 기본 추출 모델 후보로 둡니다. 다만 모든 모델에서 prompt 보정이 필요했고, GPT도 required top-level key 누락과 위치 메타 없는 높은 confidence 문제가 확인되었으므로 `layer2_extraction_prompt_gpt_v2.md`와 `layer2_gpt_v2_adapter_rules.md`를 함께 적용합니다.

GPT v2 프롬프트와 adapter는 다음 정책을 고정합니다.

- KillerKit v0.2.5 required top-level key 24개를 항상 출력합니다.
- `deferred_targets` 같은 비표준 root key를 금지하고, 보류 항목은 기존 schema key를 빈 배열로 유지합니다.
- Claude식 MISSING-first 정책을 적용해 근거가 없으면 `LOW`/`MISSING`으로 둡니다.
- `source_refs` 위치 메타인 `page_no`, `line_start`, `line_end`가 없으면 `HIGH` confidence를 금지합니다.
- 위치 메타가 없고 excerpt만 있으면 confidence는 최대 `MEDIUM`이며, 자동 반영 금지 상태로 표시합니다.
- `candidate_value` wrapper는 수동 검수 전 구조로 유지하고, KillerKit flat schema 변환은 별도 adapter 단계에서만 수행합니다.

## KillerKit v0.2.5 required top-level keys

GPT v2 출력 root는 아래 24개 key를 모두 포함해야 합니다.

1. `meta`
2. `case`
3. `document_uploads`
4. `appraisals`
5. `appraisal_totals`
6. `owners`
7. `lands`
8. `land_characteristics`
9. `public_land_characteristics`
10. `public_land_data_enrichment`
11. `land_characteristic_crosscheck`
12. `standard_lands`
13. `comp_cases`
14. `land_appraisal_results`
15. `comparison_summary_by_land`
16. `subject_to_standard_factor_comparisons`
17. `standard_to_comp_case_factor_comparisons`
18. `other_factor_reviews`
19. `obstacle_summary_by_appraisal`
20. `obstacle_appraisal_results_sample`
21. `ocr_review_items`
22. `issue_candidates`
23. `draft_sentences`
24. `risk_warnings`

## GPT v2 adapter 요약

Layer 2 1차 자동 반영 허용 후보는 `case.project_name`, `appraisals[].valuation_date`, `lands[]`, `standard_lands[]`, `land_appraisal_results[]`로 제한합니다. 이 후보들도 `source_refs`, `page_no`, `line_start`, `line_end`, `review_status_code:"NEEDS_REVIEW"`, `auto_confirmed:false` 조건을 모두 만족해야 합니다.

`comp_cases`, factor comparisons, `other_factor_reviews`, `issue_candidates`, `draft_sentences`, `risk_warnings`는 자동 반영 금지 대상이며 1차 출력에서는 빈 배열을 유지합니다.

## 개인정보/보안 주의사항

- 실제 PDF 원문에는 지번, 금액, 소유자, 이해관계자, 문서 파일명 등 민감정보가 포함될 수 있습니다.
- 외부 모델에 원문 또는 excerpt를 넣기 전 사용자 승인이 필요합니다.
- 원문 전체보다 목적 달성에 필요한 최소 excerpt만 사용합니다.
- 외부 전송 로그, 학습 사용 여부, 보관 기간, 삭제 방법, 기업용 데이터 보호 정책을 확인하기 전 자동 API 구현을 금지합니다.
- 모델 출력의 `source_refs.excerpt`에도 개인정보 원문이 과도하게 반복되지 않도록 필요한 최소 길이만 남깁니다.
- 외부 모델 결과는 검토 보조 후보일 뿐이며, 수동 검수와 전문가 검토 필요 상태를 유지합니다.

## 추출 범위

이번 prompt-only 실험의 추출 대상은 다음으로 제한합니다.

- `case.case_name`
- `case.project_name`
- `appraisals[].appraisal_company`
- `appraisals[].valuation_date`
- `lands[]`
- `standard_lands[]`
- `land_appraisal_results[]`
- `appraisal_totals[]`

다음 항목은 후속 실험 대상으로 보류합니다.

- `comp_cases`
- `subject_to_standard_factor_comparisons`
- `standard_to_comp_case_factor_comparisons`
- `other_factor_reviews`
- `issue_candidates`
- `draft_sentences`
- `risk_warnings`

## 안전 출력 원칙

- 모든 값은 후보값입니다.
- 모든 후보 wrapper는 `auto_confirmed:false`를 유지합니다.
- `review_status_code`는 `NEEDS_REVIEW` 또는 `MISSING`만 사용합니다.
- `CONFIRMED`는 자동으로 사용하지 않습니다.
- `HIGH` 또는 `MEDIUM` confidence 후보에는 반드시 `source_refs`가 있어야 합니다.
- 원문 근거가 없으면 `MISSING`으로 둡니다.
- 감정평가 결과 산정, 보상금 증액 가능성 판단, 법률판단 확정, 감정평가 업무 대체 표현은 금지합니다.

## 실제 API 구현 여부

이번 키트는 실제 API 구현이 아닙니다. OpenAI/Gemini/Claude API 호출, API key 저장, 서버 업로드, UI 리디자인, Parser extractor 변경, OCR 구현, VWorld/API 연동, 의견서 자동작성은 포함하지 않습니다.

## 외부모델 투입 필요 여부

Layer 2 구현 전에는 외부모델 투입이 선택적 수동 실험으로 필요합니다. 다만 실제 원문 또는 민감 excerpt를 외부 모델에 넣을지는 사용자 승인과 보안 정책 확인 후 결정해야 합니다.

## 병합 가능 기준

- `index.html`, stable16 HTML, reference HTML/JSON, Parser extractor 코드, OCR 구현, VWorld/API 연동을 수정하지 않았을 것
- 실제 PDF 원문 또는 actual output을 Git에 추가하지 않았을 것
- `node tests/validate_static_site.js`가 통과할 것
- `git diff --check`가 통과할 것
