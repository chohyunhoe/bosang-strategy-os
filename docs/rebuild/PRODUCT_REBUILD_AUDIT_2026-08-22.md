# 보상전략 OS Product v2 — 전수조사·재편 기준선

기준일: 2026-08-22
기준 브랜치: `rebuild/product-v2-groundtruth`
기준 main: `dac75f353938ffeedbed3d88724cb27d0188ae51`
상태: **PRODUCTION REBUILD / MAIN 미변경**

## 0. 결론

현재 문제는 모바일 CSS 한 건이 아니라 런타임 구조의 누적 부채다. 기존 v1.0 LTR에서 검증한 엔진은 최대한 보존하되, 아래 요소는 Product v2의 주 런타임에서 제거한다.

- stable1~16 후행 wrapper/override 연쇄
- 단일 거대 `index.html`의 전역 mutable state 의존
- `renderAll` 전체 재렌더에 의한 스크롤/상태 불안정
- DOM을 다시 읽어 검수 데이터를 만드는 흐름
- `00_extraction_candidates`, `structured_review_candidates`, OCR 후보, legacy 검수카드가 서로 다른 검수 원장처럼 작동하는 구조
- 모바일 전용 click hijack / overlay patch / legacy 화면 재진입
- 실제 평가서의 정답 값·행 수를 단정하지 않는 회귀 테스트

Product v2는 **한 개 canonical case model + 한 개 review queue + 한 개 responsive renderer**를 원칙으로 한다. PC와 모바일은 기능 동등이며 CSS/레이아웃만 달라진다.

## 1. 저장소 전수조사 분류

### A. 보존 — 검증 엔진

#### Parser core
- `parser/src/appraisal_text_parser.js`
- `parser/src/appraisal_pages_parser.js`
- `parser/src/pdf_text_extractor.js`
- `parser/src/text_normalizer.js`
- `parser/src/line_table_segmenter.js`
- `parser/src/schema_adapter.js`
- `parser/src/source_refs.js`
- `parser/src/review_status.js`
- `parser/src/extraction_bundle.js`
- `parser/src/core_extraction_guard.js`

#### 평가서 구조 추출
- `parser/src/extractors/case_info_extractor.js`
- `parser/src/extractors/appraisal_company_extractor.js`
- `parser/src/extractors/standard_lands_extractor.js`
- `parser/src/extractors/lands_extractor.js`
- `parser/src/land_appraisal_results_link_bridge.js`
- `parser/src/extractors/land_price_calculation_extractor.js`
- `parser/src/extractors/individual_factor_details_extractor.js`
- `parser/src/extractors/subject_factor_comparison_extractor.js`
- `parser/src/appraisal_factor_candidates.js`
- `parser/src/appraisal_basis_factor_candidates.js`

#### OCR/scan
- `parser/src/auto_scan_ocr_bridge.js`
- `parser/src/auto_scan_ocr_failed_fallback.js`
- `parser/src/scan/**`
- `browser/pdfjs-loader.mjs`
- vendored PDF.js/Tesseract release assets

#### 외부 보강/데이터
- `public_data/**` — fail-closed Provider
- `transaction_enrichment/**` — 거래사례 보강 파이프라인
- `scripts/vworld_batch_lookup.js` — 고급 local batch fallback

#### 지도/GIS
- `browser/release-core.js`의 release map contract
- `bso/src/bso_graphics/**`
- `lk-gis-agent/**`

브라우저 Product v2에서는 브라우저에서 검증된 지도 컨텍스트만 직접 사용하고, QGIS 최종도면은 local capability로 유지한다.

#### 결과물
- `brief_output/**`
- `scripts/output_bridge.js`
- `RUN_BSO_OUTPUT_CENTER.cmd`

#### 안전/CI
- privacy guard
- Parser CI
- Public Data CI
- Brief Output CI
- Release Candidate CI

### B. 통합 — 기능은 유지하되 단일 계약으로 묶음

- `parser/src/browser_api.js`
- structured review runtime/target dedupe/review execution 계열
- 앱 상태 merge 로직
- PC/모바일 navigation
- Output Center readiness

Product v2에서는 각 기능이 DOM을 서로 호출하지 않고 `CaseStore`와 명시적 command를 통해서만 통신한다.

### C. Product v2 주 런타임에서 폐기/격리 — 참고·회귀용으로만 보존

- `bosang_os_v04_alpha2_stable16.html`
- `bosang_strategy_os_killerkit_v025.html`
- `index.head-backup.html`
- `index_standalone.html`
- `reference/**`의 legacy UI 원본
- `strategy_os_v4_6_hearing_operation_integrated.html`
- `browser/mobile-review-p0.js`
- `browser/mobile-review-router.js`
- stable wrapper chain / 후행 CSS override
- legacy `review_progress_ui`의 화면·scroll 제어

삭제가 아니라 **V2 release entry에서 import하지 않는다.** 비교·회귀 참고자료로 저장소에는 남긴다.

### D. 별도 local capability

- Windows/QGIS 실행기
- PNU→SHP exact-one 검증
- QGIS 최종 도면
- 대량 VWorld batch
- 로컬 output bridge

웹 배포 실패가 local capability를 오동작 상태로 가장하지 않도록 `AVAILABLE / LOCAL_ONLY / BLOCKED`를 분리 표시한다.

## 2. 확인된 구조적 결함

### P0-1. 문서상 Freeze와 실제 런타임 불일치

v1.0 LTR 문서는 UI/Parser/Gate를 FROZEN으로 선언했으나 이후 production에는 다수의 모바일 후행 패치가 release entry에 추가됐다. 문서상 기준선과 실배포 기준선이 분리됐다.

### P0-2. 실제 평가서 테스트가 정답을 단정하지 않음

`parser/tests/text_pdf_parser_layer1.test.js`의 actual-PDF 검증은 파일이 없으면 SKIP하고, 파일이 있어도 배열 존재·source_ref·review-only 안전성 위주로 검사한다. 실제 필지 수, 표준지 수, 산출단가, 평가금액 정답을 gate로 잠그지 않는다.

따라서 `parser:test PASS`가 실제 평가서 추출 정확도를 보증하지 않는다.

### P0-3. 두 개의 extraction world

- Node: `pdf-parse`의 line text 중심
- Browser: PDF.js text item/좌표 + OCR

표의 빈 셀/열 위치가 중요한 감정평가서에서 두 경로의 구조화 결과가 달라질 수 있다. Product v2는 **PDF.js 좌표형 page model을 canonical browser input**으로 하고, Node text parser는 동일 canonical page model을 받는 test/local adapter로 맞춘다.

### P0-4. 검수 원장이 여러 개

후보/검수 상태가 복수 배열과 DOM 카드에 분산되어 화면별 건수 불일치가 발생할 수 있다. V2는 `review_queue[]`만 사용자 검수 원장으로 사용한다.

### P0-5. 렌더러가 상태를 소유함

legacy UI는 렌더 함수·DOM·전역 `data`가 서로 상태를 변경한다. 전체 재렌더/scrollIntoView/후행 wrapper 때문에 모바일과 PC가 다른 상태처럼 보일 수 있다.

V2는 renderer를 pure view에 가깝게 제한한다.

## 3. Product v2 canonical model

```text
CaseStore
 ├─ source_documents[]
 ├─ case_info
 ├─ appraisals[]
 ├─ lands[]
 ├─ standard_lands[]
 ├─ transaction_cases[]
 ├─ land_appraisal_results[]
 ├─ subject_standard_factors[]
 ├─ case_standard_factors[]
 ├─ other_factor_reviews[]
 ├─ obstacles[] / obstacle_summary[]
 ├─ public_enrichment[]
 ├─ map_context
 ├─ issue_candidates[]
 ├─ draft_sentences[]
 ├─ risk_warnings[]
 └─ review_queue[]
```

모든 자동 추출 레코드는 `source_refs`, `confidence`, `review_status`, `auto_confirmed:false`를 유지한다.

## 4. UI Information Architecture

상위 기능은 PC/모바일 동일하다.

1. **사건** — 원본등록, 문서상태, 처리상태
2. **토지** — 편입토지, 표준지, 사례, 공적자료
3. **평가검토** — 필지별 단가, 개별요인, 그 밖의 요인, 법인 비교
4. **지장물** — 물건조서, 법인별 비교, 합계
5. **지도·현장** — 대상/표준지/사례 위치와 현황
6. **쟁점·결과물** — 검토큐, 쟁점후보, 문안, 리스크, 산출물

홈은 별도 기능 메뉴가 아니라 `현재 사건 + 다음 작업 + 검수 필요 건수 + readiness`만 표시한다.

### 모바일 원칙

- 별도 모바일 데이터 모델 없음
- DOM scraping 없음
- click hijack 없음
- 하단 nav는 같은 route/state를 사용
- 표는 모바일에서 card/grid로 CSS 변환하되 데이터·command 동일
- 모든 핵심 기능은 PC/모바일 양쪽에서 접근 가능

## 5. Acceptance Document A — 실사용 Gate

실제 원문은 git에 넣지 않는다. 현재 사용자 제공 평가서는 local-only Acceptance Document A로 사용한다.

### 최소 Gate 0

- TEXT_PDF 12페이지 입력을 정상 처리
- 비교표준지 8건 구조화
- 편입토지/토지조서 5건 구조화
- 필지별 평가결과 5건 연결
- 토지가격 산출행 5건 연결
- 개별요인 누계 5건 확보
- 명시적으로 복원 가능한 세부 요인만 구조화하고 빈 셀은 추정 금지
- 인근 거래/평가사례 4건 후보화
- 그 밖의 요인 표준지별 결정치 8건 후보화
- 지장물 세부내역과 지장물 합계 존재 여부 구조화
- source page/line provenance 유지
- 자동 추출값은 전부 review-only

### Gate 1 — 검수 UX

- 업로드 후 사용자가 개발자 JSON을 보지 않아도 진행 가능
- 자동 추출 성공값은 표/카드로 바로 보임
- 실패/모호값만 `review_queue`에 들어감
- 검수 건수는 모든 화면에서 동일
- 확인/수정/보류 후 동일 항목이 중복 재등장하지 않음
- PC/모바일 동일 상태

### Gate 2 — 기능 동등성

토지/평가검토/지장물/지도/쟁점/결과물의 모든 user capability를 PC/모바일에서 동일하게 접근한다.

### Gate 3 — 산출물

현재 CaseStore에서 Output Center가 DOCX/XLSX/CSV/현장검토/쟁점메모/지도 산출 readiness를 계산한다. local-only capability는 정직하게 구분한다.

## 6. Merge 금지 조건

다음이 하나라도 남으면 Product v2를 main에 병합하지 않는다.

- Acceptance Document A의 5필지 또는 5개 산출행을 못 읽음
- 홈/route가 빈 화면 가능
- 검수 원장 건수 불일치
- 모바일 기능 손실
- DOM scraping 또는 legacy click interception이 V2 주 플로우에 남음
- 실제 PDF acceptance test가 SKIP만 되고 대체 gate가 없음
- privacy guard 실패

## 7. 구현 순서

1. local real-PDF acceptance runner
2. canonical page/case/review contracts
3. Parser coverage 보완 — 사례/그 밖의 요인/지장물
4. Product v2 shell + CaseStore + router
5. single review queue
6. existing VWorld/map/output adapters 연결
7. responsive E2E
8. real-document local acceptance PASS
9. release entry 전환
10. main merge + Cloudflare deploy
