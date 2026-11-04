# BSO Product v2.1 Production Smoke Checklist

기준: 2026-08-22

## 기준점

- Production URL: `bosang-strategy-os-mobile.chohyunhoe.workers.dev`
- Release baseline: `release/v2.1.0` / `3985901e970d8547eeff9f18836b2b2bb7907dba`
- Current v2.1.1 hardening on main: `6b5d029e7445f7783cee71caef6fe02cb8698f2d`
- Patch candidate: `candidate/v2.1.1`
- Rollback: `rollback/pre-v2.1-20260822`
- Hardening branch: `hardening/v2.1.0`
- Ground truth PDF는 git에 저장하지 않는다.

## 기준 명령

- 전체 release 교차검증: `npm run release:v2.1:gate`
- post-release 집중 검증: `npm run product:v2:hardening`
- local capability 상태/보안 self-check: `npm run local:v2.1:status`
- 실제 평가서 local browser gate: `BSO_ACCEPTANCE_PDF=... BSO_ACCEPTANCE_EXPECT=... npm run product:v2:acceptance`

## A. 빈 사건

- [x] 첫 화면이 비어 있지 않다.
- [x] `보상전략 OS v2.1`이 보인다.
- [x] 평가서 PDF 선택 경로가 보인다.
- [x] 모바일 하단 6개 route가 보인다: 사건 / 토지 / 평가검토 / 지장물 / 지도 / 결과물.
- [x] PC와 모바일이 다른 데이터 모델을 사용하지 않는다.

## B. Acceptance A — 실제 TEXT PDF

실제 모바일 smoke PASS 기준:

- [x] 상태 `READY`.
- [x] 편입토지 5필지.
- [x] 비교표준지 8개.
- [x] 평가·거래사례 4개.
- [x] 필지별 평가결과 5행.
- [x] 개별요인 누계 5행.
- [x] 그 밖의 요인 결정치 8개.
- [x] 지장물 36행.
- [x] 토지 평가금액 합계 7,643,346,000원.
- [x] 지장물 원문 합계 29,350,000원.
- [x] 지장물 행 합계 29,350,000원.
- [x] 지장물 `MATCH`.
- [x] 현황분리 `전` / `도로` 보존.
- [x] 사업/평가목적/기준시점이 원문 기반으로 보인다.

## C. 검수

- [x] raw developer JSON 카드가 기본 검수에 나타나지 않는다.
- [x] `전체 검수`가 canonical `reviewQueue`를 사용한다.
- [x] 구조화값과 원문근거가 같은 카드에 보인다.
- [x] `원문·수정 / 확인 / 보류 / 다음`이 있다.
- [x] 수정 시 기존 그룹확정이 해제되어 다시 `NEEDS_REVIEW`가 된다.
- [x] `auto_confirmed=true`를 수동확인으로 위장하지 않는다.
- [x] 명시 세부계수가 있는 필지는 `DETAIL_AVAILABLE`.
- [x] 빈 셀 위치가 모호한 필지만 `TOTAL_ONLY`.

## D. 모바일 UI

- [x] 상단 액션이 2x2 안정 레이아웃으로 표시된다.
- [x] 하단 6개 route가 기능축소 없이 동일 CaseStore를 사용한다.
- [x] wide table 첫 열 sticky + 수평스크롤 cue/관성스크롤 구현.
- [x] `mobile_table_affordance.spec.js` 계약 작성.
- [ ] WebKit 390 runner에서 신규 wide-table 계약 교차검증.
- [ ] 실제 iPhone에서 넓은 평가결과 표의 가로 스크롤 체감을 한 번 더 확인.

## E. 스캔 PDF/OCR

- [x] Tesseract kor+eng local fallback runtime 구현.
- [x] `ocr_runtime.spec.js` browser runtime contract 작성: PageModel/source_type/NEEDS_REVIEW/auto_confirmed=false.
- [ ] 실제 스캔 PDF 1건을 OCR → parser → CaseStore → reviewQueue까지 완주.

## F. 복수 평가서

- [x] 업로드 처리 시 `APP_001`, `APP_002`처럼 document count 기반 고유 appraisal id 부여.
- [x] `multi_appraisal_merge.spec.js`: 동일 편입토지 1필지 유지 + 법인별 appraisal/standard/result 분리 계약.
- [ ] 실제 감정평가서 2개를 동시에 등록해 모바일/PC에서 육안 확인.

## G. Public Data / PNU

- [x] Cloudflare에서는 `LOCAL_ONLY`로 표시.
- [x] PNU 후보는 자동확정하지 않는다.
- [x] PNU 19자리 후보는 명시적 `후보 적용` 후에만 CaseStore에 들어간다.
- [x] 공적자료가 평가서 값을 무음 덮어쓰지 않는다.
- [x] Public Data unit에서 실제 sentinel key가 stdout에 노출되지 않는 계약 존재.
- [ ] 실제 local bridge에서 `npm run local:v2.1:status` 실행 후 secret/path/temp workspace 노출 0건 확인.

## H. 지도

- [x] 웹에서 LK_MAP_PREVIEW 렌더.
- [x] local QGIS/VWorld bridge 구현.
- [x] subject/standard PNU fail-closed 입력계약.
- [x] `sanitizeMessage()`를 unit gate에 노출하고 workspace/archive/VWorld sentinel redaction 계약 추가.
- [ ] 실제 Windows QGIS + 지적 archive + VWorld로 PNG/PDF 1건 생성 후 육안검수.

## I. Output Center

- [x] Cloudflare에서는 `LOCAL_ONLY`.
- [x] 분석보고서 / 수치표 / 의견서 작성자료 bridge 연결.
- [x] 검수 CONFIRMED만 output snapshot에 승계.
- [x] `auto_confirmed=true` 세탁 금지.
- [x] 원본 파일명은 output bridge 전에 마스킹.
- [ ] 실제 Windows local server에서 DOCX/XLSX/CSV/opinion package 생성.

## J. CI 사후 교차검증

GitHub Actions 사용량 소진으로 release 당일 runner가 step을 시작하지 못했다.

- [ ] Actions 사용량 복구 후 `npm run release:v2.1:gate` 1회.
- [ ] `npm run product:v2:hardening` 신규 계약 PASS.
- [ ] Parser / privacy / Public Data / Brief Output / Product v2 workflow 실제 step PASS.

## 즉시 rollback 조건

다음 중 하나라도 production에서 재현되면 기능확장보다 rollback/repair가 우선이다.

1. 첫 화면 또는 전체검수 빈 화면.
2. raw JSON/legacy mobile runtime 노출.
3. 실제 문서의 5필지/8표준지/4사례/36지장물 기준 붕괴.
4. 평가서값을 공적자료가 무음 덮어쓰기.
5. PNU 또는 평가판단 자동확정.
6. `auto_confirmed=true`를 output snapshot에서 false로 세탁.
7. API key/local path/temp workspace가 browser response에 노출.
