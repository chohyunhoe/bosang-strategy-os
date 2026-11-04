# Parser Layer 1B — TEXT_PDF generated_case 검토 후보

이 디렉터리는 `reference/bosang_strategy_os_killerkit_v025.html` 검토 UI가 소비할 수 있는 `generated_case.json`의 계약과 Parser Layer 1 최소 구현을 관리합니다. Layer 1A 필드 계약과 false positive 차단 기준은 [`LAYER1_FIELD_CONTRACT.md`](LAYER1_FIELD_CONTRACT.md)를 우선 기준으로 합니다.

## 현재 범위

- 대상 입력: TEXT_PDF 1개 또는 실제 PDF 부재 시 익명화 text fixture 1개
- 실제 PDF 텍스트 추출: `pdf-parse@2.4.5` 의존성으로 로컬 TEXT_PDF 입력이 있을 때만 시도
- 실제 PDF 기반 actual 산출물: `parser/output/generated_case.layer1.actual.json`에 생성하되 Git 추적 제외
- 실제 PDF raw text 확인용 샘플: `parser/output/debug_actual_text_sample.txt`에 pdf-parse 원문 앞 10,000자만 저장하되 Git 추적 제외
- 명시적인 `편입토지 목록`·`토지조서` 표에서만 `lands[]` 후보 생성
- 토지가액 산출근거 행은 소재지·지목·면적이 편입토지 후보 하나와 정확히 일치할 때만 `land_appraisal_results[]`에 연결
- OCR, 이미지 PDF, 복수 PDF 동시 처리, VWorld/API 연동 없음
- 추출값은 모두 검토 후보이며 `auto_confirmed: false`를 유지
- 산출 데이터는 검토 보조용 구조화 데이터이며 감정평가 결과 산정 또는 법률판단 확정값이 아닙니다.

## Parser Layer 1 추출 영역

1. 기본정보
   - `case.project_name` / `case.case_name`
   - `case.base_date` / `appraisals[].valuation_date`
   - `appraisals[].appraisal_company`
   - `appraisals[].file_type = TEXT_PDF`
2. 비교표준지 목록
   - `standard_lands[]`
   - 기호, 소재지, 지목, 면적, 공시지가
3. 토지가액 산출근거
   - `land_appraisal_results[]`
   - 평가서 표에 기재된 단가·요인·금액 후보값만 구조화
   - `lands[]`는 명시적인 편입토지 목록/토지조서 섹션에서 필수 토큰이 확인되는 경우만 생성
4. 평가총액
   - `appraisal_totals[]`
   - 평가서에 기재된 총액 후보값만 구조화

공적자료/VWorld, 거래사례, 개별요인 상세 비교표, 그 밖의 요인 검토, 쟁점 후보, 주장문 초안, 표현 리스크 자동생성은 후속 단계로 보류하며, KillerKit가 소비하는 최상위 키는 빈 배열 또는 빈 객체로 유지합니다.

## 파일 구조

```text
parser/
  README.md
  generated_case.example.json
  fixtures/
    text_pdf_layer1_sample.txt
    pdf/
      .gitkeep
      README.md
      text_pdf_layer1_actual_gyeongil.pdf  # Git 제외, 로컬 수동 배치
  output/
    generated_case.layer1.example.json
    generated_case.layer1.actual.json  # Git 제외, 로컬 실제 PDF 검증 산출물
    debug_actual_text_sample.txt  # Git 제외, pdf-parse raw text 앞 10,000자
  src/
    appraisal_text_parser.js
    index.js
    line_table_segmenter.js
    pdf_text_extractor.js
    review_status.js
    schema_adapter.js
    source_refs.js
    text_normalizer.js
    extractors/
      appraisal_company_extractor.js
      case_info_extractor.js
      land_appraisal_results_extractor.js
      lands_extractor.js
      standard_lands_extractor.js
  tests/
    schema_compat.test.js
    text_pdf_parser_layer1.test.js
```


## 실제 PDF fixture 운영

실제 감정평가서 PDF는 Git 추적 대상이 아니라 로컬 테스트 입력물로 취급합니다. 로컬에서 실제 PDF 기반 Parser Layer 1 확인이 필요하면 다음 경로에 파일을 수동 배치합니다.

```text
parser/fixtures/pdf/text_pdf_layer1_actual_gyeongil.pdf
```

해당 PDF가 없으면 테스트는 실패하지 않고 SKIP 안내를 출력합니다. PDF가 있으면 `pdf-parse`로 텍스트를 추출해 `parser/output/generated_case.layer1.actual.json`을 생성하고, 실제 raw text 형태 확인을 위해 `parser/output/debug_actual_text_sample.txt`에 앞 10,000자만 저장합니다. 두 파일은 개인정보·지번·원문 일부가 포함될 수 있어 Git 추적 대상에서 제외하며, 추출값은 검토 보조용 후보이고 수동 검수와 전문가 검토 필요 상태를 유지합니다.

## source_refs 정책

Layer 1의 자동 추출 row에는 가능한 한 다음 형식의 `source_refs`를 붙입니다.

```json
{
  "appraisal_id": "APP_001",
  "file_name": "text_pdf_layer1_sample.txt",
  "page_no": 1,
  "line_start": 10,
  "line_end": 10,
  "source_label": "토지가액 산출근거",
  "raw_text_excerpt": "검수에 필요한 원문 일부"
}
```

- `page_no`는 1-indexed입니다.
- 원문 전문을 저장하지 않고 짧은 excerpt만 저장합니다.
- `source_refs`가 없는 후보는 `confidence_level: LOW`로 강제합니다.
- 개인정보가 포함될 수 있는 전체 원문은 디버그 로그에 출력하지 않습니다.

## confidence_level 기준

- `HIGH`: 표 행 패턴과 숫자 필드 검증이 모두 통과하고 `source_refs`가 있음
- `MEDIUM`: 표 행은 잡혔으나 일부 필드가 누락됨
- false positive 위험이 있는 extractor는 `MEDIUM`/`HIGH` 후보를 만들지 않고 비활성화하거나 `MISSING`으로 남깁니다.
- `LOW`: `source_refs`가 없거나 문맥이 불확실함

## review_status_code 기준

- `TEXT_PARSED`: 텍스트 추출 자체 성공 상태
- `NEEDS_REVIEW`: 자동 구조화 후보의 기본 검토 상태
- `MISSING`: 필수 후보 필드 누락
- `OCR_REQUIRED`: 텍스트 추출 실패로 OCR 필요 후보
- `PARSE_FAILED`: 입력 형식 또는 추출 실패
- `CONFIRMED`: 사용자 검수 전 자동 생성 결과에서는 사용 금지

## 실행

```bash
node parser/tests/text_pdf_parser_layer1.test.js
node parser/tests/text_pdf_parser_layer1b_subject_lands.test.js
node parser/tests/schema_compat.test.js
```

실제 PDF 입력을 검증하려면 의존성을 설치한 뒤 실행합니다.

```bash
npm install
node parser/tests/text_pdf_parser_layer1.test.js
```

정적 사이트 회귀 확인은 저장소 루트에서 실행합니다.

```bash
node tests/validate_static_site.js
git diff --check
```
