# Layer 2 모델 출력 비교 체크리스트

이 표는 동일한 raw text excerpt와 동일한 프롬프트를 GPT / Claude / Gemini에 수동 입력한 뒤, `generated_case.layer2.candidate.json` 후보 품질을 비교하기 위한 기록지입니다. 실제 PDF 원문에는 지번, 금액, 소유자 등 민감정보가 포함될 수 있으므로 외부 모델 투입 전 사용자 승인, 최소 excerpt 원칙, 각 서비스의 로그/보관 정책 확인이 필요합니다.

## 점수 기준

| 점수 | 의미 | 판단 기준 |
| --- | --- | --- |
| 0 | 실패 | 값을 만들지 못했거나 schema/안전 규칙을 심각하게 위반 |
| 1 | 일부 성공 | 일부 후보는 맞지만 false positive, 누락, 근거 부족이 많음 |
| 2 | 실무 검수 가능 | 수동 검수 가능한 후보와 근거가 대체로 유지됨 |
| 3 | 매우 우수 | 후보값, 근거, MISSING 처리, schema 호환성이 안정적임 |

## 비교표

| 평가 항목 | GPT 점수(0-3) | Claude 점수(0-3) | Gemini 점수(0-3) | 관찰 메모 |
| --- | --- | --- | --- | --- |
| 사업명 추출 정확도 |  |  |  | `case.project_name`이 명시 라벨과 일치하는지 확인 |
| 평가법인명 추출 정확도 |  |  |  | `appraisals[].appraisal_company`가 원문 법인명과 일치하는지 확인 |
| 기준시점/가격시점 추출 정확도 |  |  |  | 작성일·조사기간·고시일과 혼동하지 않았는지 확인 |
| 비교표준지 추출 정확도 |  |  |  | `standard_lands[]`가 표준지 섹션 근거를 갖는지 확인 |
| 편입토지 추출 정확도 |  |  |  | 토지가액 산출근거 행을 편입토지 기본정보로 오인하지 않았는지 확인 |
| 토지가액 산출근거 추출 정확도 |  |  |  | `land_appraisal_results[]`가 원문 기재값만 사용했는지 확인 |
| source_refs 품질 |  |  |  | 짧은 excerpt, page/block/char 또는 위치 부재 notes가 적절한지 확인 |
| MISSING 처리 안전성 |  |  |  | 원문 근거 없는 항목을 null/MISSING/LOW로 둔 비율 확인 |
| false positive 발생 여부 |  |  |  | 그럴듯한 추론, 섹션 혼동, 평가법인-토지 연결 오류 확인 |
| 금지 표현 발생 여부 |  |  |  | 산정, 증액 가능성, 법률판단 확정, 평가 대체 표현 여부 확인 |
| JSON schema 호환성 |  |  |  | 엄격 JSON, wrapper 필드, KillerKit v0.2.5 key 호환성 확인 |
| 실무 검수 편의성 |  |  |  | 담당자가 원문 대조와 수동 검수를 빠르게 할 수 있는지 확인 |

## 모델별 종합 메모

### GPT

- 사용 프롬프트: `layer2_extraction_prompt_ko.md` / `layer2_extraction_prompt_short.md`
- raw text 범위:
- 장점:
- 오류/위험:
- 다음 조정:

### Claude

- 사용 프롬프트: `layer2_extraction_prompt_ko.md` / `layer2_extraction_prompt_short.md`
- raw text 범위:
- 장점:
- 오류/위험:
- 다음 조정:

### Gemini

- 사용 프롬프트: `layer2_extraction_prompt_ko.md` / `layer2_extraction_prompt_short.md`
- raw text 범위:
- 장점:
- 오류/위험:
- 다음 조정:

## 병합 전 판정 메모

- 가장 안정적인 모델:
- 가장 안정적인 프롬프트:
- API 구현 후보 여부: 예 / 아니오 / 추가 실험 필요
- 개인정보·보안 추가 확인 필요사항:
- Layer 2 구현 전 보강할 schema/테스트:
