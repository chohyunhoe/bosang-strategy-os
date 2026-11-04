# 감정평가 요인 후보 계약 v0.1

## 작업 목적

이미 구조화된 `land_appraisal_results[]`에서 평가서 기재 요인과 금액을 **검토 보조 후보**로만 분리한다. 이 단계는 산식을 다시 계산하거나 빠진 계수를 채우지 않으며, 원문 확인과 전문가 검토 전에는 어떤 값도 확정하지 않는다.

## 역할별 검토

- **GPT / 범위 통제**: 평가요인 구조화와 출처 보존만 수행한다. OCR, LLM 해석, 외부 API, 쟁점 생성, 의견서 문안 생성은 범위 밖이다.
- **Gemini / 데이터 구조**: 각 후보는 평가서 행, 편입토지 연결 상태, 명시된 요인값, 원문 참조를 함께 보여 줄 수 있는 독립 계약을 사용한다. 기존 KillerKit 키는 수정하지 않는다.
- **Claude / 안전 문구**: 결과는 `NEEDS_REVIEW`, `auto_confirmed: false`인 후보이며 감정평가 대체나 보상액 판단으로 표현하지 않는다.
- **Perplexity / 외부 리서치**: 로컬 구조화 데이터의 결정적 변환만 다루므로 외부 리서치가 필요하지 않다.

## 입력

입력은 JSON 호환 객체이며 `land_appraisal_results`가 있으면 배열이어야 한다. 각 행은 다음 정보를 사용한다.

| 구분 | 입력 필드 | 규칙 |
| --- | --- | --- |
| 평가 식별 | `appraisal_id` | 필수 문자열 |
| 원본 행 식별 | `appraisal_result_id` | 토지 식별값이 없을 때 필요 |
| 비교표준지 식별 | `standard_land_symbol` | 필수 문자열; 후보에도 그대로 보존 |
| 편입토지 | `land_id` 또는 `parcel_address` + `land_category` + `area` | 연결 추론에는 사용하지 않고 중복·모호성 확인에만 사용 |
| 연결 상태 | `subject_link_status` | 없으면 `UNRESOLVED`; `LINKED`는 명시된 `land_id`가 있어야 함 |
| 요인·금액 | 아래 7개 후보 필드 | 기재값만 허용, 누락은 `null` |
| 출처 | `source_refs[]` | 비어 있으면 후보 생성 금지 |

## 출력 후보

`factor_chain`은 항상 아래 키를 모두 가진다. 모든 값은 비음수 10진 문자열 또는 `null`이다.

| 출력 필드 | 허용 입력 필드 |
| --- | --- |
| `official_price` | `official_price` |
| `time_correction` | `time_correction` |
| `regional_factor` | `regional_factor` |
| `individual_factor` | `individual_factor`, 기존 호환용 `individual_factor_total` |
| `other_factor` | `other_factor` |
| `unit_price` | `unit_price` |
| `amount` | `amount` |

두 개의 개별요인 입력 필드가 함께 존재하면 같은 10진 문자열일 때만 허용한다. `calculated_unit_price`는 계산 결과일 수 있으므로 `unit_price`의 대체값으로 사용하지 않는다.

각 후보는 다음 안전 속성을 가진다.

- `candidate_id`: 후보 내용과 출처로 만든 결정적 SHA-256 기반 ID
- `subject_link_status`: 기본 `UNRESOLVED`; `land_id`만 보고 자동으로 `LINKED` 처리하지 않음
- `standard_land_symbol`: 공시지가·요인 사슬이 참조하는 비교표준지 기호
- `source_refs`: 평가 ID, 페이지·줄 범위, 섹션, 140자 이하 excerpt로 제한한 원본 참조
- `provenance.input_sha256`: 전체 입력의 canonical JSON SHA-256
- `provenance.source_record_sha256`: 해당 원본 행의 canonical JSON SHA-256
- `review_status_code: NEEDS_REVIEW`
- `auto_confirmed: false`

## 숫자 안전 규칙

- 출력은 숫자형이 아니라 10진 문자열이다.
- 모듈은 곱셈, 나눗셈, 합산, 반올림을 하지 않는다.
- 새 입력 생산자는 정밀도 보존을 위해 처음부터 문자열을 사용해야 한다.
- 기존 JSON 호환을 위해 유한한 안전 정수와 지수표기 없는 JavaScript 숫자는 문자열로 옮길 수 있지만 계산하지 않는다.
- 쉼표, 지수표기, 음수, `NaN`, `Infinity`, 객체형 숫자는 허용하지 않는다.
- 누락된 `regional_factor` 등은 관행상 값으로 보충하지 않는다. 특히 `1.0`을 추정하지 않는다.

## fail-closed 규칙

다음 행은 `candidates[]`에 넣지 않고 해시와 `reason_codes`만 `rejections[]`에 남긴다.

- 출처 참조 누락 또는 잘못된 출처 참조
- 다른 평가 ID의 출처, 절대경로형 파일명 또는 허용되지 않은 출처 부가 필드
- 평가 ID나 원본 행/토지 식별정보 누락
- 비교표준지 기호 누락
- 동일 평가·동일 원본 행 또는 동일 편입토지 후보가 둘 이상 존재
- `subject_link_status: AMBIGUOUS`
- `LINKED`인데 명시된 `land_id`가 없음
- 허용되지 않는 10진값
- `individual_factor`와 `individual_factor_total` 충돌
- 7개 후보 필드가 모두 누락

## 실행 예시

```js
const { buildAppraisalFactorCandidates } = require('./src/appraisal_factor_candidates');

const bundle = buildAppraisalFactorCandidates(generatedCase);
```

이 모듈은 파일, OCR, 네트워크, 외부 모델을 호출하지 않으며 입력 객체를 수정하지 않는다.

Layer 1B처럼 소재지·지목·면적이 정확히 하나의 편입토지와 일치했음을 생산 단계에서
검증한 경우에만 입력 행이 `subject_link_status: LINKED`를 명시할 수 있다. 후보 생성기는
`land_id` 존재만으로 이 상태를 추정하지 않는다.
