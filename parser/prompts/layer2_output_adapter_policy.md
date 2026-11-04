# Layer 2 Output Adapter Policy

## 목적

이 문서는 GPT / Claude / Gemini가 생성한 Layer 2 후보 JSON을 KillerKit v0.2.5 flat schema로 옮기기 전에 적용할 offline adapter 정책입니다. 실제 LLM API 호출, API key 저장, 외부 서버 전송, OCR, VWorld/API 연동, 의견서 자동작성은 포함하지 않습니다.

Layer 2 후보는 감정평가서 원문을 검토자료로 구조화하기 위한 **검토 보조** 데이터입니다. 모든 후보는 수동 검수와 전문가 검토 필요 상태를 유지하며, 감정평가 업무를 대신하거나 법률 검토 결론으로 사용하지 않습니다.

## 모델별 기본 역할

- **GPT**: 기본 추출 후보입니다. lands, standard_lands, land_appraisal_results처럼 실무 검수에 필요한 후보를 넓게 잡는 데 사용합니다.
- **Claude**: Safety Baseline입니다. MISSING-first, 근거 부족 후보 보류, 과신 방지 규칙을 GPT 결과에 덧씌웁니다.
- **Gemini**: Supplemental UX/Data Structuring 후보입니다. 구조화 아이디어는 참고하되 설명문/마크다운 혼입과 schema 호환성 문제를 adapter에서 차단합니다.

## Adapter 필수 원칙

1. `source_refs` 위치 메타가 없으면 `HIGH` confidence를 `MEDIUM` 또는 `LOW`로 강등합니다.
2. `page_no`, `line_start`, `line_end`가 모두 존재하지 않는 후보는 KillerKit flat schema에 자동 반영하지 않습니다.
3. `candidate_value` wrapper는 KillerKit flat schema로 변환하기 전까지 수동검수 상태로 유지합니다.
4. KillerKit v0.2.5 표준 root key가 아닌 값은 원문 root에 두지 않고 `preserved_notes` 또는 `deferred_targets` 내부로 이동합니다.
5. `comp_cases`, `subject_to_standard_factor_comparisons`, `standard_to_comp_case_factor_comparisons`, `other_factor_reviews`, `issue_candidates`, `draft_sentences`는 Layer 2 1차에서는 자동 반영하지 않습니다.
6. GPT 결과는 추출 후보로 사용할 수 있으나, Claude식 MISSING-first 정책을 적용합니다.

## 변환 전 검수 규칙

- `auto_confirmed`는 항상 `false`로 유지합니다.
- `review_status_code`는 자동으로 `CONFIRMED`를 사용하지 않습니다.
- 원문 근거가 없는 항목은 `MISSING`, `LOW`, 빈 배열 또는 null 후보로 보류합니다.
- `source_refs`는 짧은 excerpt와 위치 메타를 포함해야 하며, 위치가 null인 근거는 원문 대조용 근거로만 보존합니다.
- 설명문, 마크다운, 모델별 reasoning 문단이 JSON value에 섞인 경우 `preserved_notes`로 격리하고 flat field에는 넣지 않습니다.
- 금지 표현 또는 단정적 표현이 포함된 후보는 `risk_warnings` 후보로만 보류하고 제출문으로 자동 전환하지 않습니다.

## 후보별 처리 기준

| 후보 유형 | 자동 반영 | 처리 원칙 |
| --- | --- | --- |
| `lands` | 제한적 가능 | 지번·면적·지목·source_refs 위치가 모두 있을 때만 수동검수 후보로 유지 |
| `standard_lands` | 제한적 가능 | 비교표준지 섹션 근거와 위치 메타가 있을 때만 수동검수 후보로 유지 |
| `land_appraisal_results` | 제한적 가능 | 평가법인, 편입토지, 단가/금액의 연결 근거가 있을 때만 수동검수 후보로 유지 |
| `comp_cases` | 불가 | Layer 2 1차 자동 반영 제외, deferred 대상으로 보존 |
| factor comparisons | 불가 | 개별요인표 구조 검증 전까지 deferred 대상으로 보존 |
| `issue_candidates` | 불가 | 쟁점 후보 자동작성으로 오해되지 않도록 1차 반영 제외 |
| `draft_sentences` | 불가 | 의견서 자동작성 금지 범위이므로 1차 반영 제외 |

## GPT 후보에 적용할 Claude식 safety adapter

1. GPT JSON을 엄격 JSON으로 parse합니다.
2. KillerKit 필수 top-level key 누락을 skeleton 기본값으로 채우되, 새로 채운 값은 `MISSING` 또는 빈 값으로 둡니다.
3. 비표준 root key를 탐지해 `preserved_notes` 또는 `deferred_targets` 후보로 이동합니다.
4. `CONFIRMED`와 `auto_confirmed:true`를 모두 `NEEDS_REVIEW`, `auto_confirmed:false` 검토 상태로 되돌립니다.
5. `source_refs`가 없거나 위치 메타가 null인 `HIGH`/`MEDIUM` 후보는 confidence를 낮추고 수동 검수 메모를 추가합니다.
6. 핵심 1차 대상인 `lands`, `standard_lands`, `land_appraisal_results` 외의 확장 후보는 자동 반영하지 않고 deferred 대상으로 보존합니다.
7. 금지 표현을 탐지하면 제출 전 표현 리스크 후보로만 남기고 주장문 초안으로 전환하지 않습니다.

## 외부 리서치 필요 여부

이 adapter는 로컬 JSON 품질 평가와 schema 정합성 검토만 수행하므로 현재 단계에서는 외부 리서치가 필요하지 않습니다. 다만 상용 API를 붙이는 별도 단계에서는 최신 LLM API endpoint, 데이터 보관 정책, 폐쇄망 옵션, 개인정보 처리 요건을 별도 확인해야 합니다.
