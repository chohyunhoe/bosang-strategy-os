# Parser extraction bundle / status bridge contract

## 작업 목적

이 계약은 로컬 Parser Layer 1 결과를 모바일 검토 화면이 사용하는 추출 상태로 연결합니다. 평가서 원문을 다시 해석하거나 후보를 추가하는 기능이 아니라, 이미 생성된 `generated_case`를 검증한 뒤 한 가지 안정된 번들로 전달하는 경계입니다.

상태 매핑은 다음 세 가지로만 고정합니다.

| Parser `meta.parse_status` | Bundle `status` |
| --- | --- |
| `TEXT_PARSED` | `TEXT_EXTRACTED` |
| `OCR_REQUIRED` | `OCR_REQUIRED` |
| `PARSE_FAILED` | `EXTRACTION_FAILED` |

그 밖의 상태는 추측해서 변환하지 않고 `PARSER_STATUS_UNSUPPORTED`로 중단합니다.

## 역할별 검토

- **GPT / 범위 통제**: 업로드와 필수정보 갈무리 사이의 상태·데이터 경계만 연결합니다. OCR, LLM, VWorld, 지도, 쟁점 또는 의견서 생성은 포함하지 않습니다.
- **Gemini / 데이터 구조**: `status`는 기존 모바일 큐의 상태명과 일치하며, `generated_case`는 KillerKit 최상위 키를 그대로 보존합니다. 화면 코드는 파서 내부 상태를 다시 해석할 필요가 없습니다.
- **Claude / 안전 표현**: 자동 결과는 검토 보조 후보이고 수동 검수와 전문가 검토가 필요하다는 경고를 유지합니다. 실패 메시지는 원문·파일명·로컬 경로를 복제하지 않습니다.
- **Perplexity / 외부 리서치**: 로컬 계약 연결 작업이라 외부 법령·API 조사가 필요하지 않습니다.

## 번들 형식

```json
{
  "schema_version": "0.1",
  "bundle_type": "APPRAISAL_TEXT_EXTRACTION",
  "input": {
    "document_id": "sha256:<64 lowercase hex>",
    "content_sha256": "<64 lowercase hex>",
    "byte_size": 1234,
    "media_type": "application/pdf"
  },
  "status": "TEXT_EXTRACTED",
  "generated_case": {},
  "error": null,
  "warnings": [
    {
      "code": "MANUAL_REVIEW_REQUIRED",
      "message": "자동 추출값은 검토 보조 후보이며 수동 검수와 전문가 검토가 필요합니다."
    }
  ],
  "provenance": {
    "bridge_name": "parser_layer1_extraction_bundle",
    "bridge_version": "0.1.0",
    "parser_stage": "parser_layer_1_text_pdf",
    "parser_status": "TEXT_PARSED",
    "generated_case_sha256": "<64 lowercase hex>",
    "deterministic": true
  }
}
```

`input`에는 원본 파일명, 절대경로, 업로드 시각을 넣지 않습니다. 같은 입력 바이트와 같은 `generated_case`에는 같은 번들과 같은 직렬화 결과가 생성됩니다. `generated_case_sha256`는 객체 키를 정렬한 canonical JSON을 기준으로 계산합니다.

## 실패 차단 기준

- 필수 KillerKit 최상위 키가 하나라도 누락되면 번들을 만들지 않습니다.
- `parser_stage` 또는 parser status가 허용 목록 밖이면 번들을 만들지 않습니다.
- 자동 결과에 `auto_confirmed: true` 또는 `review_status_code: CONFIRMED`가 있으면 번들을 만들지 않습니다.
- 입력 SHA-256, 식별자, 바이트수, 미디어 유형 또는 provenance가 서로 맞지 않으면 직렬화를 차단합니다.
- 함수, `undefined`, `NaN`, `Infinity`, 순환 참조, 사용자 정의 객체처럼 정상 JSON이 아닌 값은 차단합니다.
- 로컬 편의 함수는 추출 전후 입력 해시와 크기를 다시 확인하고, 실행 중 파일이 바뀌면 결과를 버립니다.

## 상태별 오류와 경고

- `TEXT_EXTRACTED`: 오류 없음, 수동 검수 경고 유지
- `OCR_REQUIRED`: 오류로 간주하지 않으며, 수동 검수 경고와 “이 브리지는 OCR을 실행하지 않음” 경고 유지
- `EXTRACTION_FAILED`: 고정된 `PARSER_PARSE_FAILED` 오류를 제공하되 parser exception, 원문, 파일명 또는 로컬 경로를 오류 메시지에 복제하지 않음

## 실행

```bash
node parser/tests/extraction_bundle.test.js
node tests/validate_static_site.js
git diff --check
```

이 테스트는 상태 3종, 결정성, 방어적 복제, 해시·provenance 변조, 자동 확정 차단, 로컬 경로 비노출을 검증합니다.
