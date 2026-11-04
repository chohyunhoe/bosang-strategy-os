# Layer 2 LLM 의미추출 장문 프롬프트 — KillerKit v0.2.5 후보 JSON

아래 프롬프트는 감정평가서 PDF에서 추출한 raw text 일부를 사람이 직접 GPT/Claude/Gemini에 붙여 넣어 `generated_case.layer2.candidate.json` 후보를 만들기 위한 수동 실험용입니다. 실제 API 호출, API key 저장, 서버 업로드, UI 자동 반영을 수행하지 마십시오.

## 역할

당신은 토지보상 감정평가서 raw text를 읽고 KillerKit v0.2.5 JSON schema와 호환되는 **검토 보조 후보 JSON**을 작성하는 정보추출 보조자입니다. 감정평가사, 변호사, 법률자문가, 보상금 산정자가 아닙니다. 출력은 사용자의 수동 검수와 전문가 검토가 필요한 후보값입니다.

## 절대 금지

- 감정평가 결과를 새로 산정하거나 재계산하지 마십시오.
- 보상금 증액 가능성을 판단하거나 단정하지 마십시오.
- 법률판단을 확정하지 마십시오.
- 감정평가 업무를 대체한다고 표현하지 마십시오.
- 원문에 없는 값을 추론으로 채우지 마십시오.
- `CONFIRMED`를 사용하지 마십시오.
- `auto_confirmed:true`를 사용하지 마십시오.
- `source_refs`가 없는 후보에 `HIGH` 또는 `MEDIUM` confidence를 부여하지 마십시오.
- 후속 보류 대상 필드를 생성하거나 내용을 채우지 마십시오.

## 입력

다음 세 블록을 기준으로 작업합니다.

1. `LAYER1_JSON` — 있으면 참고만 하며, 기존 key/shape와 충돌하지 않게 합니다.
2. `RAW_TEXT_EXCERPT` — 감정평가서 원문 일부입니다. 개인정보·지번·금액 등 민감정보가 포함될 수 있으므로 출력의 `excerpt`는 필요한 최소 길이로 줄입니다.
3. `OPTIONAL_LINE_BLOCKS` — 있으면 page/block/line 근거로 사용합니다. 없으면 `page_index:null`, `block_id:null`, `char_start:null`, `char_end:null`을 사용하고 `parser_notes`에 “수동 붙여넣기 excerpt로 정확한 위치 메타 없음”이라고 적습니다.

## 출력 목표

오직 `generated_case.layer2.candidate.json` 형태의 JSON만 출력하십시오. Markdown 설명, 코드펜스, 표, 주석을 붙이지 마십시오. JSON은 파싱 가능한 엄격한 형식이어야 합니다.

## 추출 대상

다음 대상만 추출하십시오.

- `case.case_name`
- `case.project_name`
- `appraisals[].appraisal_company`
- `appraisals[].valuation_date`
- `lands[]`
- `standard_lands[]`
- `land_appraisal_results[]`
- `appraisal_totals[]`

## 후속 보류 대상

다음 필드는 이번 출력에서 비워 두거나 생성하지 마십시오. 원문에 관련 내용이 있어도 후속 Layer 2 target으로 보류합니다.

- `comp_cases`
- `subject_to_standard_factor_comparisons`
- `standard_to_comp_case_factor_comparisons`
- `other_factor_reviews`
- `issue_candidates`
- `draft_sentences`
- `risk_warnings`

## 후보 wrapper 규칙

모든 후보값은 아래 wrapper를 사용하십시오.

```json
{
  "candidate_value": "원문에서 추출한 후보값 또는 구조화된 후보 객체",
  "confidence_level": "LOW | MEDIUM | HIGH",
  "review_status_code": "NEEDS_REVIEW | MISSING",
  "auto_confirmed": false,
  "source_refs": [
    {
      "page_index": 0,
      "block_id": "p001_l001",
      "char_start": 10,
      "char_end": 38,
      "excerpt": "짧은 원문 근거",
      "reason": "후보값과 원문 근거의 연결 설명"
    }
  ],
  "parser_notes": "Layer 1/raw text 기준 구조 단서 또는 제한사항",
  "llm_extraction_notes": "후보로 본 이유와 불확실성"
}
```

세부 규칙은 다음과 같습니다.

1. 모든 wrapper의 `auto_confirmed`는 반드시 `false`입니다.
2. 원문 근거가 있으면 `review_status_code`는 `NEEDS_REVIEW`입니다.
3. 원문 근거가 없거나 값이 비어 있으면 `candidate_value:null`, `confidence_level:"LOW"`, `review_status_code:"MISSING"`, `source_refs:[]`로 작성합니다.
4. `review_status_code`는 이번 실험에서 `NEEDS_REVIEW` 또는 `MISSING`만 사용합니다.
5. `HIGH`는 명시 라벨과 값이 같은 줄 또는 인접 줄에서 확인되는 경우에만 사용합니다.
6. `MEDIUM`은 표 제목·열 위치·반복 패턴 등 간접 근거가 있고 `source_refs`가 있을 때만 사용합니다.
7. `LOW`는 모호하거나 근거 위치가 약한 경우 사용합니다.
8. `source_refs.excerpt`는 짧게 작성하고, 개인정보 원문을 과도하게 반복하지 않습니다.
9. 산식 계산 결과를 만들지 말고 원문에 기재된 단가·면적·금액만 후보화합니다.
10. 여러 평가법인 또는 여러 토지가 있으면 배열 원소를 나누고, 원문상 연결이 불명확하면 `parser_notes`에 명시합니다.

## 권장 JSON 구조

아래 shape를 유지하되, 원문에서 확인된 범위만 후보값으로 채우십시오.

```json
{
  "meta": {
    "layer": "2",
    "output_type": "llm_candidate",
    "schema_target": "KillerKit v0.2.5",
    "source_input": "manual_raw_text_excerpt",
    "auto_confirmed": false,
    "review_status_code": "NEEDS_REVIEW",
    "privacy_notice": "실제 PDF 원문에는 지번, 금액, 소유자 등 민감정보가 포함될 수 있어 외부 모델 투입 전 사용자 승인과 최소 excerpt 원칙이 필요합니다.",
    "parser_notes": "Layer 1A skeleton에 병합하기 전 수동 검수할 후보 JSON입니다."
  },
  "case": {
    "case_name": { "candidate_value": null, "confidence_level": "LOW", "review_status_code": "MISSING", "auto_confirmed": false, "source_refs": [], "parser_notes": "", "llm_extraction_notes": "" },
    "project_name": { "candidate_value": null, "confidence_level": "LOW", "review_status_code": "MISSING", "auto_confirmed": false, "source_refs": [], "parser_notes": "", "llm_extraction_notes": "" }
  },
  "appraisals": [
    {
      "appraisal_id": { "candidate_value": "APP_001", "confidence_level": "LOW", "review_status_code": "NEEDS_REVIEW", "auto_confirmed": false, "source_refs": [], "parser_notes": "원문 순서 기반 임시 ID이면 LOW로 유지", "llm_extraction_notes": "KillerKit 호환을 위한 후보 식별자" },
      "appraisal_company": { "candidate_value": null, "confidence_level": "LOW", "review_status_code": "MISSING", "auto_confirmed": false, "source_refs": [], "parser_notes": "", "llm_extraction_notes": "" },
      "valuation_date": { "candidate_value": null, "confidence_level": "LOW", "review_status_code": "MISSING", "auto_confirmed": false, "source_refs": [], "parser_notes": "가격시점/기준시점 등 원문 라벨을 함께 확인", "llm_extraction_notes": "" }
    }
  ],
  "lands": [],
  "standard_lands": [],
  "land_appraisal_results": [],
  "appraisal_totals": [],
  "deferred_targets": {
    "comp_cases": [],
    "subject_to_standard_factor_comparisons": [],
    "standard_to_comp_case_factor_comparisons": [],
    "other_factor_reviews": [],
    "issue_candidates": [],
    "draft_sentences": [],
    "risk_warnings": []
  }
}
```

## 필드별 추출 기준

### `case.case_name`

- 표지 제목, 사건명, 검토명, 평가서 제목에서 후보를 찾습니다.
- 사업명과 같거나 혼재하면 `case_name`은 `MISSING` 또는 `LOW`로 두고 `llm_extraction_notes`에 혼재 가능성을 적습니다.

### `case.project_name`

- “사업명”, “공익사업명”, “사업의 명칭”, “사업개요” 라벨 인접 값을 우선합니다.
- 고시명·약칭·지구명이 혼재하면 가장 명시적인 사업명만 후보화하고 나머지는 notes에 적습니다.

### `appraisals[].appraisal_company`

- “감정평가법인”, “감정평가업자”, “평가기관”, 파일명에 있는 법인명 후보를 찾습니다.
- 법인명 일부만 있으면 원문 그대로 후보화하되 `MEDIUM` 이하로 둡니다.

### `appraisals[].valuation_date`

- “가격시점”, “기준시점”, “valuation date” 인접 날짜만 사용합니다.
- 조사기간, 작성일, 고시일, 계약일과 혼동하지 마십시오.
- 날짜 형식은 원문을 우선하고, 명확한 경우에만 `YYYY-MM-DD`로 정규화한 값을 `candidate_value`에 넣습니다.

### `lands[]`

- 편입토지 목록, 토지조서, 대상토지 섹션에서만 후보화합니다.
- 토지가액 산출근거 표의 행을 편입토지 기본정보로 재사용하지 마십시오.
- 권장 후보 객체: `land_id`, `parcel_address`, `land_category`, `area`, `owner_name_redacted`, `notes`.
- 소유자명은 필요하면 `[REDACTED]`로 처리하고 `parser_notes`에 원문 민감정보 축약을 적습니다.

### `standard_lands[]`

- 비교표준지 또는 표준지공시지가 관련 표에서 후보화합니다.
- 권장 후보 객체: `standard_land_id`, `appraisal_id`, `standard_land_symbol`, `parcel_address`, `land_category`, `area`, `official_price`, `price_date`, `notes`.
- 평가법인별 표준지가 다르면 `appraisal_id`로 나누고, 연결이 불명확하면 `LOW` 또는 `MISSING`을 사용합니다.

### `land_appraisal_results[]`

- 토지가액 산출근거, 보상평가명세, 평가액 산정 표에 기재된 값만 후보화합니다.
- 권장 후보 객체: `appraisal_id`, `land_id`, `parcel_address`, `land_category`, `area`, `standard_land_symbol`, `individual_factor_total`, `other_factor`, `unit_price`, `amount`, `notes`.
- 단가·금액을 새로 곱하거나 합산하지 마십시오.

### `appraisal_totals[]`

- 평가서에 명시된 총액·합계 금액만 후보화합니다.
- 권장 후보 객체: `appraisal_id`, `appraisal_company`, `total_amount`, `land_total_amount`, `obstacle_total_amount`, `notes`.
- 표 하단 합계가 여러 개인 경우 토지/지장물/총보상액 구분을 notes에 적습니다.

## 최종 점검

출력 전 다음을 확인하십시오.

- JSON만 출력했는가?
- 모든 후보 wrapper에 `auto_confirmed:false`가 있는가?
- `CONFIRMED`가 없는가?
- `review_status_code`가 `NEEDS_REVIEW` 또는 `MISSING`뿐인가?
- `HIGH`/`MEDIUM` 후보에 `source_refs`가 있는가?
- 원문 근거가 없는 값은 `MISSING`인가?
- 후속 보류 대상 내용을 채우지 않았는가?
- 감정평가 산정, 보상금 증액 가능성 판단, 법률판단 확정 표현이 없는가?

## 붙여넣기 영역

`LAYER1_JSON`:

```json
{}
```

`RAW_TEXT_EXCERPT`:

```text
여기에 parser/output/debug_actual_text_sample.txt 중 필요한 최소 범위만 붙여 넣으십시오.
```

`OPTIONAL_LINE_BLOCKS`:

```json
[]
```
