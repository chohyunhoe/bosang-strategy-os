# Product v2.1 Capability Matrix

기준: 2026-08-22

- Production baseline: `release/v2.1.0` → `3985901e970d8547eeff9f18836b2b2bb7907dba`
- Current production hardening: `main` → `6b5d029e7445f7783cee71caef6fe02cb8698f2d`
- Patch candidate: `candidate/v2.1.1`
- Rollback: `rollback/pre-v2.1-20260822`
- Post-release hardening: `hardening/v2.1.0`, Issue #156
- Actual mobile Acceptance A smoke: **PASS**

상태 의미
- `RELEASED` — production v2.1에서 실제 사용 가능
- `RELEASED_LOCAL` — 같은 Product v2.1 UI에서 local bridge가 있을 때 동작
- `HARDENING` — production 기능은 존재하며 추가 실환경 교차검증 중
- `PRESERVED` — 기존 검증 엔진은 보존됐지만 v2.1 UI의 핵심 경로에는 아직 직접 연결하지 않음
- `DEPRECATED_RUNTIME` — 저장소 참고용으로만 남고 v2.1 release runtime에는 로드 금지

| Capability | v2.1 상태 | 현재 검증/경계 |
| --- | --- | --- |
| PDF 원본 등록 | RELEASED | 실제 iPhone + Acceptance A 등록 PASS |
| TEXT PDF 추출 | RELEASED | PDF.js positional PageModel → canonical parser |
| 스캔 PDF 자동 OCR | RELEASED / HARDENING | Tesseract kor+eng local fallback 구현, 실스캔 PDF 1건 완주가 #156 잔여 |
| 사건명/평가목적/기준시점 | RELEASED | 실제 문서에서 사업명·보상(협의)·2025.11.01 표시 |
| 평가법인명 | RELEASED review-only | 원문 우선, 없으면 파일명 괄호 후보를 NEEDS_REVIEW로만 사용 |
| 비교표준지 | RELEASED | Acceptance A = 8, page carry 포함 |
| 편입토지/토지조서 | RELEASED | Acceptance A = 5, 현황 전/도로 포함 |
| 필지별 평가결과 | RELEASED | 5필지 공시지가·시점수정·지역요인·개별요인·그 밖의 요인·산출/적용단가·금액 |
| 개별요인 누계 | RELEASED | 5필지 누계 유지 |
| 개별요인 세부 6칸 | RELEASED fail-closed | 명시 6칸만 DETAIL_AVAILABLE; 빈 셀 위치 모호 시 TOTAL_ONLY |
| 평가·거래사례 | RELEASED | Acceptance A = 4 |
| 그 밖의 요인 결정치 | RELEASED | Acceptance A = 8 |
| 지장물 세부내역 | RELEASED | Acceptance A = 36; PDF.js header-prefix/wrapped specification 보강 |
| 지장물 원문 합계 교차검증 | RELEASED | 29,350,000원 / 행 합계 MATCH 실제 smoke 후 hotfix |
| 평가총액 안전범위 | RELEASED | 일반 `합계`를 지장물 합계로 오인하지 않음 |
| 단일 CaseStore | RELEASED | PC/mobile 동일 state |
| 단일 reviewQueue | RELEASED | raw JSON 없는 canonical workbench |
| 전체검수 | RELEASED | 구조화값 + 원문근거 + 확인/원문·수정/보류/다음 |
| 원문 source_refs | RELEASED | record inspector 및 workbench에서 직접 확인 |
| 수동 수정 | RELEASED | 수정 시 기존 그룹확정 해제 → NEEDS_REVIEW 복귀 |
| 사건 초기화 | RELEASED | topbar/사건화면 |
| 복수 사건 세션 관리 | RELEASED | 메모리 전용; localStorage/sessionStorage/IndexedDB 미사용 |
| 복수 평가서/법인 | RELEASED / HARDENING | 구조 구현 및 E2E 계약 존재; 실제 2문서 동시등록 smoke 잔여 |
| 실행보드 6단계 | RELEASED | CaseStore-derived next action |
| PC/mobile 기능 동등 | RELEASED / HARDENING | 실제 모바일 6 route 확인; wide-table affordance hardening 중 |
| 모바일 넓은 표 | HARDENING | 첫 열 sticky + 수평스크롤 cue/관성스크롤 계약 추가, 브라우저 runner 교차검증 잔여 |
| VWorld 토지특성/공시지가 | RELEASED_LOCAL | exact PNU/year local bridge; Cloudflare에서는 LOCAL_ONLY |
| 법정동→PNU 후보 | RELEASED_LOCAL review-only | exact/unique suffix resolver + `후보 적용`; 자동확정 금지 |
| 공공데이터 보안경계 | RELEASED_LOCAL | API key는 browser bundle/response에 노출 금지 |
| 공적자료 JSON import | RELEASED | 검증자료 import 가능, 평가서 값 무음 덮어쓰기 금지 |
| 지도 미리보기 | RELEASED | LK_MAP_PREVIEW responsive SVG |
| VWorld 항공/지적 + QGIS | RELEASED_LOCAL / HARDENING | PNU exact 검증 → PNG/PDF 경로 구현; 실제 Windows/QGIS 1건 육안검수 잔여 |
| 쟁점 후보 | RELEASED review-only | 기계적 불일치/누락 후보만; `conclusion=null` |
| 지목·현황 차이 | RELEASED | 원문 검토후보로만 표시 |
| 개별요인 감액폭 | RELEASED | 임계치 기반 review candidate, 평가결론 자동생성 안 함 |
| 개별요인 세부열 모호성 | RELEASED v2.1.1 | DETAIL_AVAILABLE 연계 후 실제 모호한 3필지만 TOTAL_ONLY |
| 분석보고서 DOCX | RELEASED_LOCAL / HARDENING | Output bridge 연결, 실제 Windows runner PASS 잔여 |
| 수치표 XLSX/CSV | RELEASED_LOCAL / HARDENING | Output bridge 연결, 실제 Windows runner PASS 잔여 |
| 의견서 작성자료 | RELEASED_LOCAL / HARDENING | 새 주장 생성 금지; 실제 Windows runner PASS 잔여 |
| Output 검수상태 승계 | RELEASED | 사용자의 CONFIRMED만 snapshot에 승계; `auto_confirmed=true` 세탁 금지 |
| 개인정보 최소화 | RELEASED | Cloudflare bundle에 case data/key/local path/output 미포함 |
| legacy mobile patch | DEPRECATED_RUNTIME | v2.1 manifest에 `mobile-review-p0/router` 0건 |
| stable1~16 wrapper chain | DEPRECATED_RUNTIME | v2.1 runtime에서 미로드 |
| 건축물대장 교차검증 | PRESERVED | v2.2 후보 |
| RTMS/상가/FactoryOn/G2B | PRESERVED | v2.2 후보; v2.1 hardening 범위 밖 |

## Release 판정

### 완료
1. Product v2.1 production entry 전환
2. 실제 모바일 Acceptance A 등록·READY·6개 route·검수·주요 구조화값 smoke PASS
3. Acceptance A ground truth: 표준지 8 / 토지 5 / 평가결과 5 / 사례 4 / 그 밖의 요인 8 / 지장물 36
4. 토지 합계 7,643,346,000원
5. 지장물 원문 및 행 합계 29,350,000원 MATCH
6. rollback/release/candidate branch 확보

### Post-release hardening 잔여 — Issue #156
1. GitHub Actions 사용량 복구 후 `npm run release:v2.1:gate` 1회 교차검증
2. 실제 Windows local Output Center DOCX/XLSX/CSV/opinion package 생성
3. 실제 QGIS/VWorld subject-vs-standard PNG/PDF 1건 육안검수
4. 스캔 PDF 실문서 OCR → CaseStore → reviewQueue 완주
5. 실제 평가서 2개 동시등록 후 법인별 데이터 병합/분리 확인
6. 모바일 wide-table E2E runner 확인

## 고정 안전경계

- PNU 자동확정 금지
- `auto_confirmed=true`를 false로 세탁 금지
- 공적자료가 평가서 원문값을 무음 덮어쓰기 금지
- 개별요인 빈 셀 위치 추정 금지
- issue candidate의 법률/평가 결론 자동생성 금지
- Cloudflare에서 local bridge 기능을 AVAILABLE처럼 표시 금지
