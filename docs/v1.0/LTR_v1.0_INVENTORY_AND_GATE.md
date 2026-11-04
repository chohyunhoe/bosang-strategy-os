# 보상전략 OS v1.0 LTR — 기능 인벤토리 및 승격 게이트

기준 커밋: 로컬 작업본 `C:\Users\RMARKET\Documents\GitHub\bosang-strategy-os`
기준일: 2026-08-20
상태 잠금 (BSO v1.0 LTR RC)

상태 잠금 갱신: 2026-08-20 (LTR FEATURE FREEZE)

```
UI/UX Integration : DONE / FROZEN
Parser 축          : CLOSED / FROZEN   (P0-PARSER-SUBJECT-LAND-ROWS 종료)
Gate 축            : CLOSED / FROZEN   (과잉 1:1 계약 제거, READY_WITH_REVIEW 도입)
Output Center      : 6/7 트랙 CONNECTED · GIS 1건 BLOCKED(비차단)
Gate A 최종        : PASS_WITH_WARNINGS · hard blockers 0
신규 기능          : FREEZE (종료)
```

**FEATURE FREEZE APPROVED.** 이후 변경은 실제 실패가 재현된 항목의 수정에 한정한다.
신규 기능·리팩터링·디자인 개선·Parser 개선·의존성 상향은 이 문서 기준으로 범위 밖이다.

이 문서는 신규 기능 정의서가 아니다. 이미 구현·검증된 기능을 비개발자가 사용할 수 있는
하나의 UI로 통합한 결과와, v1.0 LTR 승격 가능 여부만 기록한다.

---

## 1. 상태 정의

| 코드 | 의미 |
| --- | --- |
| VERIFIED | 자동테스트 또는 실데이터 검증 기록이 문서에 남아 있음 |
| IMPLEMENTED | 코드가 동작하나 실데이터 검증 기록 없음 |
| PARTIAL | 일부 경로만 동작하거나 한계가 문서에 명시됨 |
| MOCK | 호출하지 않거나 고정값만 반환하는 stub |
| DEPRECATED | 중복 정의로 런타임에서 도달하지 않음 |
| BLOCKED | 외부 실기환경(QGIS/Windows/API키) 없이는 실행 불가 |

---

## 2. 기능 인벤토리 (v1.0 범위 = 브라우저 앱)

| 기능 | 코드 위치 | 구현상태 | 검증상태 | 현재 접근방법 | UI 노출 | 워크플로우 위치 | LTR 필요조치 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 평가서 PDF 등록·교체 | `index.html registerUploadedPdfFiles` | IMPLEMENTED | VERIFIED(`release_ui_runtime`) | 브라우저 | 예 | 사건 워크스페이스 | 실행바에서 상시 접근 (완료) |
| PDF 텍스트 추출(PDF.js) | `index.html extractPdfTextPreview`, `browser/pdfjs-loader.mjs` | IMPLEMENTED | VERIFIED(`release_ui_runtime`, E2E) | 브라우저 | 예 | 사건 워크스페이스 | 없음 |
| 스캔 PDF 자동 OCR(Tesseract 로컬) | `parser/src/auto_scan_ocr_bridge.js` | IMPLEMENTED | VERIFIED(단위+`auto_scan_ocr_ui`), 실측 19쪽/116초 기록 | 자동(클릭 0회) | 예(진행률) | 사건 워크스페이스 | 없음 |
| 스캔 괘선표 → 평가행 구조화 | `parser/src/scan/scan_table_recovery.js` | PARTIAL | 문서상 BETA/`STRUCTURED_SCAN_OPEN` | 자동 | 예 | 사건 워크스페이스 | v1.1 backlog 유지, 표현 통제 |
| 필수정보 후보 추출·검수·구조화 | `index.html extractEssentialInfoCandidates` 외 | IMPLEMENTED | VERIFIED(E2E `review_execution`) | 브라우저 | 예 | 사건 워크스페이스 | 없음 |
| OCR 행단위 검수(확인/수정/보류) | `index.html renderOcrItemCard`(최종정의) | IMPLEMENTED | 부분 | 브라우저 | 예 | 사건 워크스페이스 | 없음 |
| **OCR 검수 완료값 JSON 반영** | `index.html applyConfirmedOcrToJson` | IMPLEMENTED | **UI 진입점 없음(수정 전)** | 없음 | **아니오 → 예** | 사건 워크스페이스 | **P0 — 버튼 복구 (완료)** |
| OCR 상태 필터 / 검산통과 일괄 검수 / 후보 초기화 | `setOcrFilter`,`confirmAutoPassedOcrItems`,`clearOcrReviewItems` | IMPLEMENTED | 부분 | 없음 | **아니오 → 예** | 사건 워크스페이스 | P1 — 복구 (완료) |
| PDF 원장 뷰어·근거 크롭 | `renderPdfViewerForOcr`,`loadPdfForOcr`,`autoMultiCropOcrItemV037` | PARTIAL | 크롭 버튼이 항상 alert만 발생 | 없음 | **아니오 → 예** | 사건 워크스페이스 | P1 — 뷰어 재노출 (완료) |
| 편입토지 목록·상세 | `renderLands` | IMPLEMENTED | VERIFIED(E2E) | 브라우저 | 예 | 자료·데이터 | 없음 |
| VWorld 공란 특성정보 일괄 보강 | `bulkEnrichBlankPublicLandCharacteristics` | IMPLEMENTED | 실데이터 응답구조 확인 기록 있음, 브라우저 E2E 기록 없음 | 브라우저(API Key 세션 입력) | 예 | 자료·데이터 | 실행바 `미조회→조회하기` 연결 (완료) |
| VWorld 단건 조회·주소검색·수동 fallback | `lookupPublicLandDataFromApi` 외 | IMPLEMENTED | 부분 | 브라우저 | 예 | 자료·데이터 | 없음 |
| VWorld 원문 URL 복사/붙여넣기 fallback | `openPublicLandRawRequestUrl` 외 | IMPLEMENTED | 부분 | 브라우저 + 외부 탭 | 예(고급) | 자료·데이터 | 고급 fallback 유지 |
| VWorld batch(최대 200필지) | `scripts/vworld_batch_lookup.js` | IMPLEMENTED | 실행 기록 없음 | **CLI** | import만 | 자료·데이터 | v1.0 고급 fallback 유지 |
| 표준지·거래사례 통합 | `renderStdCases` | IMPLEMENTED | 부분 | 브라우저 | 예 | 자료·데이터 | 없음 |
| 법인별 평가요소 비교표 | `renderLandCompare`, `browser/release-factor-matrix.mjs` | IMPLEMENTED | VERIFIED(E2E `factor_matrix`) | 브라우저 | 예 | 분석 | 없음 |
| 편입토지↔표준지 개별요인 비교 | `renderSubjectFactors` | IMPLEMENTED | 부분 | 브라우저 | 예 | 분석 | 없음 |
| 표준지↔사례 개별요인 비교 | `renderCaseFactors` | IMPLEMENTED | 부분 | 브라우저 | 예 | 분석 | 없음 |
| 그 밖의 요인 검토 | `renderOtherFactors` | IMPLEMENTED | 부분 | 브라우저 | 예 | 분석 | 없음 |
| 공적/평가서 스펙 나란히 비교표 | `renderSpecCompareTable` | DEPRECATED | 호출부 0건 | 없음 | 아니오 | 분석 | v1.1 후보(화면 안내문구와 불일치) |
| 지도 컨텍스트(대상↔표준지↔사례) | `renderSelectedLandMapContext`, `browser/release-core.js` | IMPLEMENTED | VERIFIED(E2E `map_context_gate`) | 브라우저 | 예 | 지도·현장 | 없음 |
| 지도 미리보기 import·SVG 저장 | `handleReleaseMapFile`,`downloadReleaseMapSvg` | IMPLEMENTED | 부분 | 브라우저 | 예 | 지도·현장 | 없음 |
| QGIS 최종 도면(PDF/PNG/QGZ) | `bso/src/bso_graphics/qgis_renderer.py` | BLOCKED | 실기 미완료 기록 | Windows CLI | 아니오 | 지도·현장 | v1.0 범위 외(로컬 게이트) |
| PNU→SHP 필지 exact-one 검증 | `bso/src/bso_graphics/parcel_verification.py` | BLOCKED | 실데이터 대조 기록 있음 | Windows CLI | 아니오 | 지도·현장 | v1.0 범위 외(로컬 게이트) |
| 검토 필요사항 큐 | `renderReviewQueue` | IMPLEMENTED | VERIFIED(E2E) | 브라우저 | 예 | 결과물 | 없음 |
| 쟁점 후보 / 보조문안 / 리스크 경고 | `renderIssues`,`renderSentences`,`renderRisks` | IMPLEMENTED | 부분 | 브라우저 | 예 | 결과물 | 없음 |
| 결과 레이아웃 정렬 | `renderWorkflowOutput` | IMPLEMENTED | VERIFIED(E2E) | 브라우저 | 예 | 결과물 | 없음 |
| 거래사례 enrichment 파이프라인 | `transaction_enrichment/**` | IMPLEMENTED | VERIFIED(단위 46건 + golden fixture) | CLI | 아니오 | 자료·데이터 | v1.0 범위 외 |
| 공공데이터 Provider(법정동/건축물대장/실거래/나라장터) | `public_data/**` | PARTIAL | 2026-08-19 실호출 확인 기록 | CLI | 아니오 | 자료·데이터 | v1.0 범위 외 |
| FactoryOn 생산정보 / 상가 법정동 조회 | `public_data/factoryon.py`,`stores.py` | MOCK | 공식 명세 미확보, fail-closed | CLI | 아니오 | — | 호출 금지 유지 |
| LK GIS Agent(FastAPI + QGIS Recipe) | `lk-gis-agent/**` | BLOCKED | 테스트 파일 부재, 일부 모듈 미추적 | 로컬 서비스 | 아니오 | 지도·현장 | v1.0 범위 외 |
| **산출물 센터(7트랙 상태·준비도)** | `index.html renderOutputCenter` | IMPLEMENTED | VERIFIED(E2E `output_center`) | 브라우저 | 예 | 결과물 | 없음 (FROZEN) |
| **로컬 출력 브리지(127.0.0.1)** | `scripts/output_bridge.js` | IMPLEMENTED | VERIFIED(계약 `output_bridge.test.js`) | 자동(브라우저→loopback) | 간접 | 결과물 | 없음 (FROZEN) |
| **사건 JSON → 문서 어댑터** | `brief_output/killerkit_adapter.py` | IMPLEMENTED | VERIFIED(단위 19건) | 자동 | 아니오 | 결과물 | 없음 (FROZEN) |
| PC Gate 런타임 게이트 | `scripts/run_pc_gate.js` | IMPLEMENTED | VERIFIED(계약 테스트 2종) | CLI/URL 파라미터 | 아니오 | — | 게이트 도구(사용자 기능 아님) |
| v0.3.x OCR 뷰어 중복 정의(6~9중) | `index.html` 다수 | DEPRECATED | — | 없음 | 아니오 | — | 기술부채, 별도 PR |

---

## 3. v1.0 LTR 통합 UI

### 3.1 사건처리 흐름 6단계 내비게이션

```
1 홈·실행보드      overview
2 사건 워크스페이스  uploadHub · sourceStatus · ocrReview · documentWorkspace
3 자료·데이터       lands · publicData · stdCases
4 분석             landCompare · subjectFactors · caseFactors · otherFactors · obstacles · workflowBase · workflowValue
5 지도·현장         workflowLogic
6 결과물           reviewQueue · issues · sentences · risks · workflowOutput   (+ 개발자 옵션 json)
```

`data-section` 값, 렌더 함수, 데이터 키는 하나도 변경하지 않았다. 그룹과 라벨만 재편했다.

### 3.2 상태 기반 다음 Action

`#lkExecutionBar` 가 모든 화면 상단에 6단계 진행상태와 다음 Action 1개를 표시한다.
상태 판정은 기존 검증 로직(`extractionProgressSummary`, `nextActionForWorkflow`,
`blankDraftLandCount`, `hasAppraisalCompanyMatrix`, `hasDraftIssueCandidates`,
`releaseLoadMapFromData`)을 그대로 사용하며 신규 분석 엔진을 추가하지 않았다.

| 현재 상태 | 다음 Action | 이동 화면 |
| --- | --- | --- |
| 미등록 | 평가서 등록 | 사건 워크스페이스 |
| 추출·검수 진행 | 기존 `nextActionForWorkflow` 결과 | 사건 워크스페이스 |
| 미조회 | 공적자료 조회하기 | 자료·데이터 |
| 조회완료 | 분석 반영 | 분석 |
| 분석완료 | 지도·현장 확인 | 지도·현장 |
| 지도 확인완료 | 쟁점 검토 | 결과물 |
| 검토완료 | 결과물 생성 | 결과물 |

홈(실행보드) 화면에서는 기존 "다음 작업" 카드가 이미 있으므로 실행바는 CTA를 중복 노출하지 않는다
(한 화면 1 CTA 규칙 유지).

### 3.3 오류 복구

- 자동 OCR 실패 시 실행바 상태가 `BLOCKED` 로 바뀌고 "OCR 수동 검수로 복구" 버튼이 나타난다.
- "원본 추가·교체", "사건 초기화" 는 모든 화면에서 접근 가능하다.
- 실행보드 계산 실패 시 실행바는 예외를 삼키지 않고 오류문구와 복구 진입점을 표시한다.

---

## 4. LTR Gate 판정

| Gate | 내용 | 판정 | 근거 |
| --- | --- | --- | --- |
| G1 | 검증기능 UI 접근 | **PASS(브라우저 범위)** | OCR 검수 완료값 JSON 반영·필터·일괄검수·후보 초기화·PDF 원장 뷰어 진입점 복구. E2E `execution_board.spec.js` 로 고정. QGIS/공공데이터 CLI 축은 v1.0 범위 외로 명시 |
| G2 | 실제 유형 2건 E2E | **PARTIAL** | 합성 데이터 E2E 27건 PASS. 실제 TEXT_PDF 1건은 아래 §4.1 기록대로 PC Gate A 실행 완료 → `PARTIAL_SUBJECT_LAND_ROWS` 1건으로 FAIL. IMAGE_PDF 1건 미실시 |
| G3 | 주요업무 No-CLI | **PASS(단서 있음)** | 등록→추출→OCR→후보검수→구조화→공란보강→비교→지도→쟁점→결과물이 브라우저 단독으로 완결. VWorld batch(200필지)·QGIS 도면은 고급/로컬 경로로 분리 표기 |
| G4 | 회귀테스트·오류복구 | **PASS** | `npm run test:rc` 전량 PASS, Playwright 24건 PASS(1440/768/390), privacy guard PASS, 신규 회귀계약 추가 |
| G5 | P0/P1 종료 후 Feature Freeze | **PASS(UI 축)** | UI 축 P0 2건·P1 4건 종료. UI 축 Feature Freeze 선언. Parser 축 P0 1건은 별도 축으로 분리 |

### 4.1 PC Gate A 실측 기록 (2026-08-20)

기록 파일: `pc-gate-results/2026-08-20T02-19-44-058Z/PC_GATE_RESULT.json` (gate_version `pc-gate/0.8`)
입력: 사용자 PC 로컬 선택, `TEXT_OR_PARTIAL_TEXT_LAYER_PDF`, 8쪽, 익명화 사용자 확인

| 계수 | 값 |
| --- | --- |
| upload / parser_runs / appraisals | 1 / 1 / 1 |
| named_appraisal_companies | 1 |
| subject_land_row_candidates | 10 |
| subject_lands | 4 |
| appraisal_rows | 3 |
| standard_lands / linked_standard_rows | 5 / 3 |
| parser_dropped_rows / parser_unmatched_appraisal_rows | 0 / 0 |
| selective OCR 후보/시도/미복구 | 0 / 0 / 0 (텍스트 레이어 완전) |
| core_extracted / core_review_required | 14 / 9 |

경계·안전 점검

- `all_review_status_needs_review` RUNTIME_PASS
- `all_auto_confirmed_false` RUNTIME_PASS
- `unexpected_auto_confirmed` RUNTIME_PASS
- `nan_or_undefined` RUNTIME_PASS
- `unintended_external_request` 설계상 자동 외부요청 없음
- `repository_pii_ingress` 설계상 저장소 쓰기 없음
- `complete_subject_land_rows` **RUNTIME_FAIL**

최종 하드 블로커 2건

```
BROWSER_STATUS_NOT_READY      ← 아래 항목의 결과
PARTIAL_SUBJECT_LAND_ROWS     ← 실제 원인
```

판정: **FAIL**

해석: 파서·안전 경계·자동확정 금지·수치 무결성은 모두 통과했다. 유일한 실패는
**편입토지 행 후보 10건 중 4필지만 인식되고 평가행이 3행만 생성된 추출 완전성 결함**이다.
이는 UI 통합 축이 아니라 Parser 축 결함이므로 v1.0 LTR UI 범위에서 수정하지 않고
후속 P0(`P0-PARSER-SUBJECT-LAND-ROWS`)로 분리한다.

**v1.0 LTR 승격 가능 여부: UI 축 승격 가능 / 제품 태깅은 Parser P0 종료 후.**

- **UI 통합 축: DONE.** 사건처리 흐름 6단계 IA, 상태 기반 다음 Action, 검증기능 UI 접근,
  오류복구 경로, 회귀계약이 모두 완료·검증되었다. 이 축은 **Feature Freeze** 한다.
  이후 UI 변경은 실제 실패가 재현된 항목에 한정한다.
- **Parser 축: BLOCKED.** `P0-PARSER-SUBJECT-LAND-ROWS` 1건이 Gate A 유일 블로커로 남는다.
  이 결함이 해소되면 `BSO v1.0 LTR` 태깅이 가능하다.
- **QGIS Gate B**: v1.0 지원범위에서 "로컬 전용 산출물"로 분리하고 비차단 사유를 기록한다.

---

## 4.2 Output Center 7트랙 최종 상태 (P0~P4)

| # | 트랙 | 상태 | 산출 형식 | 경로 | 실행 방식 |
| --- | --- | --- | --- | --- | --- |
| 1 | 보상전략 분석보고서 | **CONNECTED** | DOCX 5페이지 | `POST /__output_bridge/analysis_report` | 버튼 1회 |
| 2 | 재결·이의 의견서 작성자료 | **CONNECTED** | DOCX 10구성 | `POST /__output_bridge/opinion_package` | 버튼 1회 |
| 3 | 수치 비교표 | **CONNECTED** | XLSX 4시트 · CSV | `POST /__output_bridge/numeric_table` | 버튼 1회 |
| 4 | 지도·그래픽 | **CONNECTED** | SVG | 브라우저 `downloadReleaseMapSvg` | 버튼 1회 |
| 5 | 현장검토 자료 | **CONNECTED** | A4 인쇄 · PDF | 브라우저 print CSS | 버튼 1회 |
| 6 | 쟁점·검토 메모 | **CONNECTED** | TXT · Markdown | 브라우저 | 버튼 1회 |
| 7 | GIS 패키지 | **BLOCKED / NON-BLOCKING** | — | 연결하지 않음 | v1.0 범위 외 |

전 트랙 **No-CLI**. 사용자는 `RUN_BSO_OUTPUT_CENTER.cmd` 더블클릭 외에 터미널 명령을 입력하지 않는다.

모든 문서 산출은 하나의 어댑터·QA 계층(`killerkit_adapter` → `build_output` → `apply_adapter_qa`)을 지난다.
따라서 fail-closed(누락값 0채움 금지), provenance 승계, `NEEDS_REVIEW` 보존, 자동확정 금지 경계가
트랙마다 재구현되지 않으며, `APPRAISAL_ROW_COVERAGE_GAP` 은 6개 트랙 산출물 전부에 유지된다.

GIS 패키지는 **비차단**이다. 브라우저에서 실행할 경로가 없고 v1.0 지원범위 밖이므로
산출물 센터에 `BLOCKED` 로만 표시하고 실행 진입점을 노출하지 않는다.

---

## 4.3 Gate A 최종 기록 (2026-08-20)

기록 파일: `pc-gate-results/2026-08-20T10-02-09-593Z/PC_GATE_RESULT.json` (`pc-gate/0.8`)

```
final_decision  : PASS_WITH_WARNINGS
runtime status  : READY_WITH_REVIEW
hard_block_reasons : []            (0건)
review_warnings : APPRAISAL_ROW_COVERAGE_GAP  (1건)
```

| 계수 | 값 |
| --- | --- |
| 편입토지 / 평가행 / 조서 행 후보 | 4 / 3 / 4 |
| 조서 행 계측 (후보 / 파싱 / 탈락) | 4 / 4 / **0** |
| 평가행 (구조화 / 연결) | 3 / 3 |
| `appraisal_row_reject_starts_with_address_count` | **0** |
| 미연결 편입토지 | 1 (`APPRAISAL_ROW_COVERAGE_GAP`) |
| 비교표준지 / 표준지 연결 | 5 / 3 |

경계 판정

- `complete_subject_land_rows` **RUNTIME_PASS**
- `appraisal_row_coverage` **RUNTIME_NEEDS_REVIEW**
- `hard_blockers_clear` **RUNTIME_PASS**
- `all_review_status_needs_review` / `all_auto_confirmed_false` **RUNTIME_PASS**
- 육안 확인 6개 항목 전부 `USER_REVIEWED_PASS_WITH_WARNINGS`

`starts_with_address_count = 0` 은 §1.4 의 가설 (B) 를 실측으로 확정한다. 즉 산출근거 원문이
실제로 3행이며 파서는 읽은 행을 하나도 흘리지 않았다. **Parser 는 수정하지 않았고, 결함은
편입토지 수와 평가행 수를 함께 요구하던 게이트의 과잉 1:1 계약이었다.**

### 4.4 최종 Gate 판정

| Gate | 내용 | 판정 |
| --- | --- | --- |
| G1 | 검증기능 UI 접근 | **PASS** (산출물 센터 7트랙 상태 노출 포함) |
| G2 | 실제 유형 E2E | **PASS_WITH_WARNINGS** — 실제 TEXT_PDF 1건 Gate A 통과, 검토항목 1건 |
| G3 | 주요업무 No-CLI | **PASS** — 산출물 6트랙까지 브라우저 단독·버튼 1회 |
| G4 | 회귀테스트·오류복구 | **PASS** — §6 참조 |
| G5 | Feature Freeze | **PASS** — UI·Parser·Gate·Output Center 전 축 FREEZE |

IMAGE_PDF Gate 는 v1.0 범위에서 `Beta` 로 분리하며 승격 차단요건이 아니다.

---

## 5. v1.0에서 하지 않은 것

- 신규 Provider, 신규 분석 알고리즘, 보상금 예측, 증액확률, 모바일앱, SaaS 확장
- 스캔 괘선표 완전 자동 구조화(v1.1 `SCAN_TABLE_STRUCTURE_RECOVERY`)
- v0.3.x OCR 뷰어 중복 정의 정리 및 CSS override 통합(기술부채, 별도 PR)
- `renderSpecCompareTable` 재연결(v1.1 후보)
- 문서 간 상태 표기 불일치 정리(별도 문서 PR)
- GIS 패키지 UI 연결 (BLOCKED 유지)
- 검토 메모 입력·보관 state (v1.1 후보)
- 공공데이터 Provider 확장 (별도 작업 축, 이 릴리즈에 포함하지 않음)
