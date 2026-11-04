# Parser Layer 2 LLM Extraction Design for KillerKit JSON

## 작업 목적

Parser Layer 1A는 `pdf-parse` 기반 텍스트 추출과 safe skeleton 생성을 담당하고, 정규식으로 무리하게 평가서 의미를 해석하지 않습니다. 이 문서는 Layer 1A 산출물을 보존하면서, PDF raw text를 KillerKit v0.2.5 JSON schema에 맞는 **검토 보조 후보 JSON**으로 구조화하는 별도 Layer 2 LLM-based extraction module의 입력/출력 계약을 정의합니다.

이번 범위는 설계 문서와 계약 작성에 한정합니다. 실제 OpenAI/Gemini/Claude 등 외부 모델 API 호출, API key 저장, 외부 서버 업로드, UI 변경은 구현하지 않습니다.

## 역할별 검토

- **GPT / 범위 통제**: Layer 2는 평가서 업로드 이후 “단순 텍스트 추출이 아니라 평가서의 법리, 평가 원리, 산식 구조를 이해하고 해석”하는 core workflow를 강화하되, 산정·법률판단·보상금 증액 판단을 수행하지 않는 검토 보조 단계로 제한합니다. stable16 HTML, reference HTML/JSON, OCR, VWorld/API, 거래사례·개별요인·그 밖의 요인 확장, 의견서 자동작성은 이번 PR 범위 밖입니다.
- **Gemini / UX·데이터 구조**: Layer 2 출력은 기존 KillerKit JSON key와 review UI 흐름을 깨지 않도록 `generated_case` skeleton 위에 후보값 메타를 붙이는 방식입니다. 모든 후보는 `source_refs`와 `review_status_code`를 포함하고, UI에서는 수동 검수 전 상태로 표시될 수 있어야 합니다.
- **Claude / 문구 안전**: 문서 전반에서 “검토 보조”, “후보”, “수동 검수”, “전문가 검토 필요” 표현을 우선 사용합니다. Layer 2는 감정평가 업무를 대체하거나 법률자문 결론을 제공하는 모듈이 아니며, `CONFIRMED`를 자동으로 사용하지 않습니다.
- **Perplexity / 외부 리서치**: 이번 문서는 로컬 reference와 parser 계약에 근거한 설계안이므로 외부 리서치가 필요하지 않습니다. 다만 상용화 전 외부 LLM API endpoint, 데이터 보관 정책, 폐쇄망/로컬 모델 옵션, 개인정보 처리 요건은 별도 최신 리서치가 필요합니다.

## 1. Layer 구분

| Layer | 책임 | 입력 | 출력 | 원칙 |
| --- | --- | --- | --- | --- |
| Layer 1A | PDF text extraction + safe skeleton + false positive 방지 | PDF 또는 TEXT_PDF, reference schema | `generated_case.layer1.*.json` | 텍스트 추출 상태와 KillerKit 렌더링 key/shape 보존, 불확실하면 빈 값·빈 배열·`MISSING` 유지 |
| Layer 1B | deterministic extractor | Layer 1A raw text, page/line blocks | deterministic 후보 patch | 확실한 라벨/표 구조만 후보화, 필수 토큰과 `source_refs`가 없으면 후보 생성 금지 |
| Layer 2 | LLM-based semantic extraction | raw text, page text, line blocks, Layer 1 skeleton, reference schema, extraction target list | `generated_case.layer2.candidate.json` | 의미 기반 구조화 후보 생성, `auto_confirmed:false`, `NEEDS_REVIEW`, `source_refs` 필수 |
| Layer 3 | KillerKit review UI | Layer 1/2 후보 JSON | 사용자가 검수하는 review workspace | 사람이 후보를 확인·수정·채택하는 단계, 자동 채택 금지 |

### 1.1 Layer 1A 유지 기준

Layer 1A는 safe skeleton 생성기입니다. `lands[]` 등 false positive 위험이 큰 필드는 무리하게 채우지 않고, KillerKit가 소비하는 top-level key를 보존합니다. 평가서 원문에 명확히 기재된 `standard_lands[]`, `land_appraisal_results[]`, `appraisal_totals[]` 후보도 `source_refs`가 있는 경우에만 검토 보조값으로 유지합니다.

### 1.2 Layer 1B deterministic extractor 기준

Layer 1B는 정규식·테이블 파서·라벨 매칭으로 확실한 라벨 또는 표 헤더가 있는 경우만 후보를 만듭니다. 예를 들어 “감정평가업자”, “가격시점”, “비교표준지”, “토지가액 산출근거”처럼 명시 라벨과 인접 값이 모두 확인될 때만 사용합니다. 표 구조가 깨져 필드 간 경계가 모호하면 Layer 2 검토 대상으로 넘기고 `HIGH`/`MEDIUM` 후보를 만들지 않습니다.

### 1.3 Layer 2 semantic extraction 기준

Layer 2는 LLM을 이용해 raw text 내 의미 단서를 해석하고 KillerKit v0.2.5 JSON schema에 맞는 후보 JSON patch를 작성하는 설계 단계입니다. 단, LLM 출력은 최종값이 아니라 “검토 후보”이며, 사람이 source reference를 확인하기 전까지는 `NEEDS_REVIEW` 상태를 유지합니다.

### 1.4 Layer 3 review UI 기준

Layer 3는 KillerKit review UI입니다. Layer 2가 생성한 후보 JSON은 바로 제출용 자료가 아니라 UI에서 원문 근거와 함께 수동 검수되는 자료입니다. Layer 3에서 사용자가 검토·수정·채택하기 전에는 자동 승인 상태로 전환하지 않습니다.

## 2. Layer 2 입력 계약

Layer 2 module은 아래 입력을 받는 것으로 설계합니다. 실제 전송 방식은 이번 PR에서 구현하지 않습니다.

```json
{
  "raw_text": "PDF 전체 텍스트. 개인정보 원문 포함 가능성이 있어 기본 local-only 처리 대상입니다.",
  "page_texts": [
    {
      "page_index": 0,
      "text": "페이지 단위 텍스트",
      "char_start": 0,
      "char_end": 1200
    }
  ],
  "line_blocks": [
    {
      "block_id": "p001_l001",
      "page_index": 0,
      "line_index": 1,
      "text": "원문 라인",
      "char_start": 10,
      "char_end": 38
    }
  ],
  "generated_case_skeleton": {
    "description": "Layer 1A가 생성한 KillerKit 호환 skeleton JSON"
  },
  "reference_schema": {
    "description": "reference/sample_case_001_v021_full.json 및 KillerKit v0.2.5 소비 key 기준 schema"
  },
  "extraction_targets": [
    "case.case_name",
    "case.project_name",
    "appraisals[].appraisal_company",
    "appraisals[].valuation_date",
    "lands[]",
    "standard_lands[]",
    "land_appraisal_results[]",
    "appraisal_totals[]"
  ],
  "safety_policy": {
    "default_processing_mode": "local_only_or_user_approved",
    "allow_external_transmission": false,
    "require_masking_before_external_transmission": true,
    "require_user_notice_and_approval": true
  }
}
```

### 2.1 `raw_text`

- PDF 전체 텍스트입니다.
- 소유자, 지번, 금액, 사업명 등 민감정보가 포함될 수 있습니다.
- 기본 설계는 local-only 또는 user-approved extraction입니다.
- 외부 LLM API로 원문을 전송하는 동작은 이번 PR에서 구현하지 않습니다.

### 2.2 `page_texts`

- 페이지별 텍스트와 문자 범위를 보관합니다.
- `source_refs`가 page 기반으로 연결될 수 있도록 `page_index`, `char_start`, `char_end`를 포함합니다.

### 2.3 `line_blocks`

- 원문 라인·블록 단위 근거 참조를 위한 배열입니다.
- LLM은 후보값마다 가능하면 `block_id`를 포함해야 합니다.
- table parser가 후속으로 붙을 경우 row/column 범위를 추가할 수 있습니다.

### 2.4 `generated_case_skeleton`

- Layer 1A가 생성한 safe skeleton입니다.
- Layer 2는 skeleton의 기존 top-level key를 삭제하거나 의미를 바꾸지 않고 후보 patch를 생성합니다.
- `public_land_characteristics`, `public_land_data_enrichment`, `land_characteristics`, `land_characteristic_crosscheck`, `comparison_summary_by_land`, `land_appraisal_results`, `subject_to_standard_factor_comparisons`, `standard_to_comp_case_factor_comparisons`, `other_factor_reviews`, `ocr_review_items`, `issue_candidates`, `draft_sentences`, `risk_warnings`는 삭제하지 않습니다.

### 2.5 `reference_schema`

- `reference/bosang_strategy_os_killerkit_v025.html`이 소비하는 JSON key와 `reference/sample_case_001_v021_full.json`의 shape를 기준으로 합니다.
- Layer 2는 schema에 없는 임의 top-level key를 만들지 않습니다.
- 새 메타 정보가 필요한 경우 후보 field wrapper 내부에만 둡니다.

### 2.6 `extraction_targets`

- 이번 설계의 1차 대상 목록입니다.
- Layer 2 prompt에는 대상 밖 필드는 생성하지 말라는 제약을 넣습니다.
- 거래사례, 개별요인 상세, 그 밖의 요인 검토는 후속 target으로 분리합니다.

## 3. Layer 2 출력 계약

Layer 2의 산출물 파일명은 다음으로 설계합니다.

```text
generated_case.layer2.candidate.json
```

출력은 KillerKit skeleton 전체를 대체하는 파일이 아니라, Layer 1A skeleton에 병합하기 전 검토할 수 있는 후보 JSON입니다. 모든 후보 필드는 아래 메타 wrapper를 포함해야 합니다.

```json
{
  "candidate_value": "원문에서 추출한 후보값 또는 구조화된 후보 객체",
  "confidence_level": "LOW | MEDIUM | HIGH",
  "review_status_code": "NEEDS_REVIEW | MISSING | OCR_REQUIRED | PARSE_AMBIGUOUS",
  "auto_confirmed": false,
  "source_refs": [
    {
      "page_index": 0,
      "block_id": "p001_l001",
      "char_start": 10,
      "char_end": 38,
      "excerpt": "짧은 원문 근거. 개인정보 최소 노출 원칙 적용",
      "reason": "후보값과 연결되는 원문 근거 설명"
    }
  ],
  "parser_notes": "Layer 1A/1B 기준에서 확인된 구조적 단서 또는 제한사항",
  "llm_extraction_notes": "LLM이 의미상 후보로 본 이유와 불확실성"
}
```

### 3.1 필수 출력 규칙

1. 모든 후보는 `auto_confirmed:false`를 유지합니다.
2. 자동 생성 후보의 기본 `review_status_code`는 `NEEDS_REVIEW`입니다.
3. 값이 없거나 근거가 부족하면 `MISSING` 또는 `PARSE_AMBIGUOUS`를 사용합니다.
4. 이미지/스캔본 등 텍스트 추출 자체가 부족하면 `OCR_REQUIRED`를 사용합니다.
5. `HIGH` 또는 `MEDIUM` 후보는 반드시 1개 이상의 `source_refs`를 가져야 합니다.
6. `source_refs`가 없는 후보는 `confidence_level:"LOW"`와 `review_status_code:"PARSE_AMBIGUOUS"` 이하로 제한합니다.
7. Layer 2는 `CONFIRMED`를 자동으로 사용하지 않습니다.
8. 산식 재계산이나 보상액 산정값 생성은 금지하고, 평가서에 기재된 값만 후보화합니다.

### 3.2 출력 예시

```json
{
  "meta": {
    "layer": "2",
    "output_type": "llm_candidate",
    "schema_target": "KillerKit v0.2.5",
    "auto_confirmed": false,
    "review_status_code": "NEEDS_REVIEW",
    "parser_notes": "Layer 1A skeleton 위에 병합 전 검토할 후보 patch입니다."
  },
  "case": {
    "case_name": {
      "candidate_value": "공익사업 보상평가 비교 검토",
      "confidence_level": "MEDIUM",
      "review_status_code": "NEEDS_REVIEW",
      "auto_confirmed": false,
      "source_refs": [
        {
          "page_index": 0,
          "block_id": "p001_l003",
          "char_start": 84,
          "char_end": 109,
          "excerpt": "감정평가서 표지의 사건명 인접 문구",
          "reason": "표지 제목과 평가 목적 문장이 사건명 후보와 일치"
        }
      ],
      "parser_notes": "Layer 1A에서 case_name이 비어 있거나 MISSING인 경우 보강 후보입니다.",
      "llm_extraction_notes": "문서 제목과 본문 평가 목적 표현이 유사하지만 사용자가 사건명으로 채택할지 검토 필요합니다."
    },
    "project_name": {
      "candidate_value": "도시계획시설 사업",
      "confidence_level": "MEDIUM",
      "review_status_code": "NEEDS_REVIEW",
      "auto_confirmed": false,
      "source_refs": [
        {
          "page_index": 1,
          "block_id": "p002_l014",
          "char_start": 520,
          "char_end": 541,
          "excerpt": "사업명 라벨 인접 문구",
          "reason": "사업명 라벨 바로 뒤에 위치"
        }
      ],
      "parser_notes": "명시 라벨이 있어 deterministic extractor 후보와 교차 확인 가능합니다.",
      "llm_extraction_notes": "사업명 후보이나 전체 고시명과 축약명이 혼재할 수 있어 수동 검수 필요합니다."
    }
  },
  "appraisals": [
    {
      "appraisal_id": "appraisal_001",
      "appraisal_company": {
        "candidate_value": "○○감정평가법인",
        "confidence_level": "HIGH",
        "review_status_code": "NEEDS_REVIEW",
        "auto_confirmed": false,
        "source_refs": [
          {
            "page_index": 0,
            "block_id": "p001_l020",
            "char_start": 740,
            "char_end": 756,
            "excerpt": "감정평가법인명 라인",
            "reason": "평가서 표지 하단의 법인명으로 보이는 텍스트"
          }
        ],
        "parser_notes": "법인명 라벨 또는 표지 위치 근거가 필요합니다.",
        "llm_extraction_notes": "법인명 후보입니다. 지점명·담당자명과 혼동 가능성은 검토해야 합니다."
      },
      "valuation_date": {
        "candidate_value": "2025-11-01",
        "confidence_level": "MEDIUM",
        "review_status_code": "NEEDS_REVIEW",
        "auto_confirmed": false,
        "source_refs": [
          {
            "page_index": 2,
            "block_id": "p003_l008",
            "char_start": 1010,
            "char_end": 1020,
            "excerpt": "가격시점 인접 날짜",
            "reason": "가격시점 라벨 옆 날짜"
          }
        ],
        "parser_notes": "KillerKit sample에는 case.price_date와 appraisal valuation date가 함께 쓰일 수 있으므로 매핑 검토 필요합니다.",
        "llm_extraction_notes": "가격시점 후보입니다. 작성일·조사일과 혼동되지 않았는지 검토해야 합니다."
      }
    }
  ],
  "lands": [],
  "standard_lands": [],
  "land_appraisal_results": [],
  "appraisal_totals": []
}
```

## 4. Layer 2 추출 대상

### 4.1 1차 추출 대상

| 대상 | 목적 | 필수 검토 포인트 |
| --- | --- | --- |
| `case.case_name` | 검토자료 제목 후보 | 문서 제목, 평가 목적, 사건명/사업명 혼동 여부 |
| `case.project_name` | 사업명 후보 | 고시명, 평가 목적, 표지 사업명 라벨 근거 여부 |
| `appraisals[].appraisal_company` | 평가법인 후보 | 법인명·지점명·담당자명 구분, 여러 법인 병합 여부 |
| `appraisals[].valuation_date` | 가격시점/평가 기준일 후보 | 작성일, 조사일, 가격시점 혼동 방지 |
| `lands[]` | 편입토지 후보 | 토지가액 산출근거 행을 편입토지 기본정보로 오인하지 않도록 원문 섹션 확인 |
| `standard_lands[]` | 비교표준지 후보 | 표준지 기호, 소재지, 지목, 면적, 공시지가 근거 확인 |
| `land_appraisal_results[]` | 법인별 토지 평가결과 후보 | 법인·토지·단가·개별요인·그 밖의 요인·금액 매핑 근거 확인 |
| `appraisal_totals[]` | 평가법인별 합계 후보 | 평가서 기재 총액만 후보화, 재계산 금지 |

### 4.2 후속 추출 대상

아래 항목은 Layer 2 prompt 및 schema adapter가 충분히 검증된 뒤 별도 PR에서 다룹니다.

- `comp_cases[]`
- `subject_to_standard_factor_comparisons[]`
- `standard_to_comp_case_factor_comparisons[]`
- `other_factor_reviews[]`
- 거래사례↔비교표준지 개별요인표
- 편입토지↔비교표준지 개별요인표
- 그 밖의 요인 검토 정보

## 5. 금지 대상

Layer 2는 아래 행위를 하지 않습니다.

1. 보상금 증액 가능성 판단
2. 법률판단 결론 제공
3. 감정평가 결과 산정 또는 산식 재계산
4. 감정평가 업무 대체 표현 생성
5. `CONFIRMED` 자동 사용
6. `source_refs` 없는 `HIGH`/`MEDIUM` 후보 생성
7. 원문 개인정보 무단 외부 전송
8. VWorld/API 조회값을 평가서 원문 사실처럼 표시
9. `issue_candidates`, `draft_sentences`, `risk_warnings` 자동 생성
10. 기존 KillerKit top-level key 삭제 또는 의미 변경

## 6. LLM 프롬프트 초안

아래 프롬프트는 설계 초안입니다. 이번 PR에서 실제 LLM 호출 코드에 사용하지 않습니다.

### 6.1 System prompt 초안

```text
You are an extraction assistant for Bosang Strategy OS. Your task is to transform appraisal report raw text into review-only candidate JSON compatible with the KillerKit v0.2.5 schema.

Rules:
- Produce only review candidates, not final facts.
- Never provide legal conclusions, compensation increase predictions, appraisal recalculations, or professional appraisal substitutes.
- Do not use CONFIRMED for any automatically extracted field.
- Every extracted field must include: candidate_value, confidence_level, review_status_code, auto_confirmed:false, source_refs, parser_notes, llm_extraction_notes.
- Use review_status_code NEEDS_REVIEW for supported candidates, MISSING when no candidate exists, OCR_REQUIRED when text is insufficient due to scan/image issues, and PARSE_AMBIGUOUS when mapping is unclear.
- HIGH or MEDIUM confidence is forbidden without at least one source_refs entry.
- source_refs must point to page_index and preferably block_id/char range. Keep excerpts short and only as much as needed for human review.
- Preserve the existing generated_case skeleton keys. Do not create new top-level keys outside the target schema.
- Extract only the requested target fields. Leave future targets empty.
- If a value requires calculation, do not calculate it. Only extract values explicitly written in the report.
- If owner names, parcel addresses, amounts, or project names appear, treat them as sensitive and minimize excerpts.

Return JSON only.
```

### 6.2 User prompt template 초안

```text
Given the following inputs, create generated_case.layer2.candidate.json as a review-only candidate patch.

Inputs:
1. raw_text:
{{raw_text}}

2. page_texts:
{{page_texts}}

3. line_blocks:
{{line_blocks}}

4. generated_case_skeleton:
{{generated_case_skeleton}}

5. reference_schema:
{{reference_schema}}

6. extraction_targets:
{{extraction_targets}}

Output requirements:
- Return JSON only.
- Include candidates only for the extraction_targets.
- Use candidate field wrappers with candidate_value, confidence_level, review_status_code, auto_confirmed:false, source_refs, parser_notes, llm_extraction_notes.
- If no supported candidate exists, return candidate_value:null, confidence_level:"LOW", review_status_code:"MISSING", auto_confirmed:false, source_refs:[], and explain in notes.
- Do not infer unsupported values from context.
- Do not mark anything as CONFIRMED.
```

## 7. 개인정보/보안 주의

실제 감정평가서 원문에는 다음 민감정보가 포함될 수 있습니다.

- 소유자 성명 또는 이해관계자 정보
- 지번, 주소, 편입면적 등 토지 식별정보
- 보상액, 단가, 평가총액 등 금액 정보
- 사업명, 시행자, 문서번호 등 사건 식별정보
- 담당자명, 연락처, 직인 주변 텍스트

보안 설계 원칙은 다음과 같습니다.

1. 기본 처리 모드는 local-only 또는 user-approved extraction입니다.
2. 외부 LLM API 전송은 사용자 승인, 마스킹, 보관정책, 전송범위 고지 후에만 가능합니다.
3. 상용화 전 폐쇄망/로컬 모델 또는 사내 승인형 gateway를 검토해야 합니다.
4. 원문 전체를 기본 업로드하는 설계는 피하고, 필요한 page/line 범위만 최소 전송하는 방식을 우선 검토합니다.
5. `source_refs.excerpt`는 사람이 검토할 수 있는 최소 길이로 제한하고, 불필요한 개인정보 반복 노출을 피합니다.
6. 로그에는 raw text 전체, 원문 PDF, API request/response 전문을 저장하지 않는 것을 기본값으로 둡니다.
7. 외부 모델 provider의 데이터 보관·학습 사용·삭제 정책은 최신 약관 리서치 후 운영정책에 반영해야 합니다.

## 8. 구현 보류 항목

이번 PR에서 구현하지 않는 항목은 다음과 같습니다.

- 실제 OpenAI/Gemini/Claude API 호출
- API key 저장 또는 환경변수 연결
- 서버 업로드 구현
- UI 변경
- OCR 구현
- VWorld/API 연동
- 거래사례 확장
- 개별요인 확장
- 그 밖의 요인 확장
- 의견서 자동작성
- 실제 `generated_case.layer2.candidate.json` 생성 코드

## 9. 외부모델 투입 필요 여부

문서 설계 자체에는 외부모델 투입이 필요하지 않습니다. 다만 실제 Layer 2 구현 전에는 아래 항목에 대해 별도 검토가 필요합니다.

- 로컬 LLM 또는 폐쇄망 모델로 충분한 표 구조화 성능을 낼 수 있는지
- 외부 API 사용 시 개인정보 마스킹 후에도 추출 정확도가 유지되는지
- provider별 데이터 보관·학습 사용·삭제 정책이 상용 운영 기준을 만족하는지
- page/line 단위 최소 전송 방식으로 `source_refs` 품질을 유지할 수 있는지

## 10. 병합 가능 기준

이 문서는 설계 계약만 추가하므로 아래 조건을 만족하면 병합 가능합니다.

- `index.html`, stable16 HTML, reference HTML/JSON을 수정하지 않을 것
- OCR, VWorld/API, 실제 LLM 호출 코드를 추가하지 않을 것
- 기존 데이터 key와 렌더 함수를 삭제하지 않을 것
- `node tests/validate_static_site.js` 통과
- `git diff --check` 통과
