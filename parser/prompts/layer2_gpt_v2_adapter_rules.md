# Layer 2 GPT v2 Adapter Normalization Rules

## 목적

이 문서는 GPT v2 Layer 2 후보 JSON을 KillerKit v0.2.5 flat schema로 옮기기 전에 적용할 adapter normalization 정책입니다. 실제 LLM API 호출, API key 저장, 외부 서버 전송, OCR, VWorld/API 연동, UI 변경, 의견서 자동작성은 포함하지 않습니다.

GPT는 Layer 2 모델 비교에서 추출률이 가장 높았으므로 기본 추출 후보로 사용합니다. 다만 GPT 결과에는 required top-level key 누락, 비표준 root key, 위치 메타 없는 높은 confidence가 섞일 수 있으므로 Claude식 MISSING-first 안전정책을 adapter에서 강제합니다.

## 모델 선택 정책

1. GPT 결과는 Layer 2 기본 후보로 사용합니다.
2. Claude식 안전정책은 GPT 결과에 반드시 덧씌웁니다.
3. Gemini 결과는 보조 참고 후보로만 보며, schema/source_refs 품질이 낮은 경우 자동 반영하지 않습니다.
4. 모든 모델 결과는 검토 보조 후보이며 수동 검수와 전문가 검토 필요 상태를 유지합니다.

## required top-level key 정규화

adapter 입력 root는 KillerKit v0.2.5 required top-level key 24개만 허용합니다.

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

누락된 required key는 skeleton 기본값으로 채웁니다. 값이 없는 배열 key는 `[]`로 두고, 객체 내부 후보값은 MISSING wrapper로 둡니다.

## 비표준 root key 차단

1. `deferred_targets`, `preserved_notes`, `reasoning`, `analysis`, `warnings`, `model_notes` 같은 비표준 root key는 허용하지 않습니다.
2. GPT가 비표준 root key를 만들면 flat schema 변환 전에 차단하고 adapter error 또는 수동검수 메모로 남깁니다.
3. 보류 항목은 별도 root key로 옮기지 않습니다.
4. 보류해야 하는 표준 대상은 기존 schema key를 빈 배열로 유지합니다.
5. `comp_cases`, factor comparisons, `other_factor_reviews`, `issue_candidates`, `draft_sentences`, `risk_warnings`는 Layer 2 1차에서 값 후보가 있어도 자동 반영하지 않습니다.

## candidate_value wrapper 유지

1. GPT v2 결과의 `candidate_value` wrapper는 검수 전 구조로 유지합니다.
2. wrapper 제거와 KillerKit flat schema 변환은 별도 adapter 단계에서만 수행합니다.
3. wrapper 내부의 `auto_confirmed`는 항상 `false`로 강제합니다.
4. `review_status_code`는 `NEEDS_REVIEW` 또는 `MISSING`만 허용합니다.
5. `CONFIRMED`가 있으면 `NEEDS_REVIEW`로 되돌리고 수동검수 메모를 남깁니다.

## source_refs와 confidence 강등 규칙

1. `source_refs` 위치 메타는 `page_no`, `line_start`, `line_end`가 모두 숫자인 경우에만 충족된 것으로 봅니다.
2. 위치 메타가 없으면 `confidence_level:"HIGH"`를 `MEDIUM`으로 강등합니다.
3. 위치 메타가 없고 `excerpt`도 약하거나 후보 연결이 불명확하면 `LOW`로 강등합니다.
4. `source_refs` 자체가 없거나 빈 배열이면 `confidence_level:"LOW"`, `review_status_code:"MISSING"`으로 둡니다.
5. `source_refs`가 완전히 없으면 flat schema 자동 반영 후보에서 제외합니다.
6. `page_no`, `line_start`, `line_end` 중 하나라도 없으면 `NO_AUTO_APPLY_LOCATION_METADATA_MISSING` 메모를 추가합니다.
7. `excerpt`만 있는 후보는 원문 대조용 단서로 보존할 수 있지만 자동 반영 대상은 아닙니다.

## Layer 2 1차 자동 반영 허용 후보

아래 후보만 제한적으로 flat schema 변환 검토 대상이 될 수 있습니다.

- `case.project_name`
- `appraisals[].valuation_date`
- `lands[]`
- `standard_lands[]`
- `land_appraisal_results[]`

단, 모든 후보는 다음 조건을 동시에 만족해야 합니다.

1. `candidate_value`가 비어 있지 않습니다.
2. `review_status_code:"NEEDS_REVIEW"`입니다.
3. `auto_confirmed:false`입니다.
4. `source_refs`가 있습니다.
5. `page_no`, `line_start`, `line_end` 위치 메타가 모두 있습니다.
6. 원문 라벨과 후보값의 연결이 명확합니다.
7. 원문 수치 재계산이나 모델 추론으로 만든 값이 아닙니다.

조건을 하나라도 만족하지 않으면 수동 검수 후보로만 유지하고 flat schema 자동 반영을 보류합니다.

## 자동 반영 금지 대상

아래 항목은 Layer 2 1차 adapter에서 자동 반영하지 않습니다.

- `comp_cases`
- `subject_to_standard_factor_comparisons`
- `standard_to_comp_case_factor_comparisons`
- `other_factor_reviews`
- `issue_candidates`
- `draft_sentences`
- `risk_warnings`

이 항목들은 원문에 단서가 있어도 빈 배열을 유지합니다. 후속 전용 prompt와 검수 정책이 마련되기 전까지 쟁점 후보, 주장문 초안, 표현 리스크로 자동 전환하지 않습니다.

## normalization 순서

1. GPT 응답이 strict JSON object인지 parse합니다.
2. root key가 required 24개뿐인지 검사합니다.
3. 누락된 required key를 skeleton 기본값으로 채웁니다.
4. 비표준 root key를 차단하고 수동검수 메모를 남깁니다.
5. 모든 wrapper의 `auto_confirmed`를 `false`로 강제합니다.
6. `CONFIRMED`를 `NEEDS_REVIEW` 또는 `MISSING`으로 되돌립니다.
7. `source_refs` 유무와 위치 메타를 검사해 confidence를 강등합니다.
8. 자동 반영 허용 후보와 금지 대상을 분리합니다.
9. 허용 후보라도 위치 메타와 `NEEDS_REVIEW` 조건이 없으면 flat schema 변환을 보류합니다.
10. 최종 결과는 검토 보조 후보로만 저장하거나 수동 검수 queue에 둡니다.

## 안전 표현 원칙

- 모든 결과는 검토 보조 후보입니다.
- 모든 자동 반영 후보는 수동 검수와 전문가 검토 필요 상태를 유지합니다.
- 보상금 증액 가능성, 법률판단, 감정평가 결과 산정, 위법 단정 표현은 adapter 결과에 포함하지 않습니다.
- 의견서 주장문 자동작성으로 오해될 수 있는 값은 `draft_sentences`에 자동 생성하지 않습니다.

## 외부모델 투입 필요 여부

이 문서는 offline adapter normalization 정책입니다. 최신 API endpoint, API key 보관, 외부 서버 전송, 개인정보 처리 정책은 이 단계에서 구현하지 않으며, 상용 API 연결 단계에서 별도 리서치와 사용자 승인이 필요합니다.
