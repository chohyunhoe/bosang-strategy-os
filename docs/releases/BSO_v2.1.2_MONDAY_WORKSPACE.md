# BSO Product v2.1.2 — Monday Unified Workspace

기준일: 2026-08-27

## 월요일 진입점

Windows 저장소 루트의 `RUN_BSO.cmd`를 더블클릭한다.

- 앱 URL: `http://localhost:4174/`
- 서버 bind: `127.0.0.1` only
- 첫 실행에만 Node package / `.venv` / 보고서 Python dependency를 준비한다.
- QGIS 또는 로컬 지적원본이 없어도 BSO 자체는 반드시 실행된다.
- `.env` 또는 일부 API key가 없어도 앱 자체는 실행되고 해당 capability만 사용할 수 없다고 표시한다.
- 구 `RUN_BSO_OUTPUT_CENTER.cmd`는 통합 런처로 전달한다.

## 업무 기능 계약

| 업무 | 월요일 경로 | 필요 조건 | 자동확정 |
| --- | --- | --- | --- |
| 평가서 PDF 등록·해석 | 사건 | 없음 | 금지 |
| TEXT PDF | 사건 | PDF.js browser runtime | 금지 |
| 스캔 PDF OCR | 사건 | browser Tesseract kor+eng | 금지 |
| 전체검수·원문수정 | 전체검수 | 없음 | 사용자 확인만 |
| 복수 평가법인 | 사건/평가검토 | 없음 | 법인별 행 분리 |
| VWorld 항공사진 | 지도·현장 | VWorld session key | 금지 |
| VWorld 위치도 | 지도·현장 | VWorld session key | 금지 |
| API 지적/필지 좌표 | 지도·현장 | PNU 또는 주소 + VWorld session key | 금지 |
| QGIS 정밀도면 | 지도·현장 | 선택: QGIS + 로컬 지적원본 + VWorld | 금지 |
| PNU 후보 | 토지 | PUBLIC_DATA_API_KEY local bridge | 후보 적용 필요 |
| VWorld 토지특성/공시지가 | 토지 | local bridge + VWorld key | 금지 |
| 현장선별 P1/P4/P5 | 지도·현장 | PUBLIC_DATA_API_KEY local bridge | 금지 |
| FactoryOn 필지 보강 | 지도·현장 | 회사명 + PUBLIC_DATA_API_KEY | 금지 |
| 신규사업 EARLY_SIGNAL | 지도·현장 | PUBLIC_DATA_API_KEY | 금지 |
| RTMS 거래사례 후보 | 지도·현장 | PUBLIC_DATA_API_KEY | 금지 |
| 건축물대장 | 지도·현장 | PNU + PUBLIC_DATA_API_KEY | 금지 |
| 분석보고서 DOCX | 쟁점·결과물 | local Output bridge | 사용자 검수상태만 승계 |
| 수치표 XLSX/CSV | 쟁점·결과물 | local Output bridge | 사용자 검수상태만 승계 |
| 의견서 작성자료 DOCX | 쟁점·결과물 | local Output bridge | 새 주장 자동생성 금지 |
| 다중 사건 | 홈 | 세션 메모리 | 브라우저 종료 시 소멸 |

## VWorld 지도 원칙

기본 지도는 로컬 지적파일에 의존하지 않는다.

1. PNU가 있으면 VWorld Data API의 필지 geometry exact-one을 우선한다.
2. PNU가 없거나 geometry를 얻지 못하면 평가서 소재지의 VWorld 주소좌표 API를 사용한다.
3. Static Map API의 `PHOTO` 항공사진을 배경으로 사용한다.
4. 전체 위치도와 편입토지–비교표준지, 비교표준지–평가·거래사례 관계도를 서로 다른 축척으로 만든다.
5. 대상토지는 노랑, 비교표준지는 빨강, 평가·거래사례는 밝은 파랑으로 표시하고 역할명·지번 라벨, 북쪽표시, 범례를 함께 제공한다.
6. 작은 필지나 본도에서 형상 판독이 어려운 필지는 항공사진 인셋으로 보조한다.
7. 관계가 명시되지 않았거나 PNU exact 검증이 실패한 필지를 임의로 조합하지 않는다.
8. QGIS는 제출용 정밀 폴리곤·축척·레이아웃이 필요할 때만 사용하는 선택 capability다.

VWorld key는 브라우저 메모리에만 존재하며 CaseStore/localStorage/sessionStorage/indexedDB에 저장하지 않는다.

## 현장선별 원칙

2026-08 시흥정왕 LIVE API 실증 기준을 사용한다.

- P1 주유소·연료: `FIELD_ACTIVE`
- P4 화훼·원예: 동일 PNU 복수 영업레코드이면 `FIELD_ACTIVE`, 단독이면 `REVIEW`
- P5 일반 영업시설: `REVIEW`
- FactoryOn은 지역 전체검색이 아니라 확보된 회사명 기준 필지 보강에 사용한다.
- 모든 후보는 `review_required=true`, `auto_confirmed=false`.
- `FIELD_ACTIVE`는 현장방문 우선순위이며 편입·영업보상·수임대상 확정이 아니다.

## 신규사업 모니터링 원칙

G2B 4단계를 `EARLY_SIGNAL`로 모은다.

- ORDER_PLAN
- PRE_SPEC
- BID_NOTICE
- CONTRACT

검증된/미검증 endpoint 또는 활용신청 상태는 원래 adapter metadata를 따른다. 일부 단계 실패가 전체 앱 실패로 전파되지 않으며 `PARTIAL`로 보고한다. EARLY_SIGNAL은 사업 확정이나 수임가능 판정이 아니다.

## 월요일 최소 Smoke

1. `RUN_BSO.cmd` 더블클릭 → 브라우저 자동 오픈.
2. 실제 평가서 1건 등록 → READY → 전체검수 진입.
3. 지도·현장 → VWorld session key 입력 → 지적파일 없이 항공사진·위치도 생성.
4. 현장선별 → 시군구/행정동 또는 경계 JSON 기준 후보 조회 → P1/P4/P5/REVIEW 확인 → CSV 저장.
5. 신규사업 → 최근 30일 EARLY_SIGNAL 조회.
6. RTMS → 지역코드/월 입력 → 거래사례 후보 확인.
7. 건축물대장 → 검수된 PNU 입력 → TITLE/BASIS/JIJIGU 확인.
8. 쟁점·결과물 → 분석보고서 DOCX 및 수치표 XLSX/CSV 생성.
9. 필요 시 QGIS 정밀도면은 별도 capability로 확인.

## Release gate

월요일 실랩탑에서 위 Smoke를 통과하기 전까지 이 브랜치를 Cloudflare production/main으로 자동 승격하지 않는다.

후보 브랜치: `release/v2.1.2-monday`
기준 production: `main` v2.1.1

GitHub Actions quota가 복구되면 `npm run release:v2.1:gate`와 `npm run product:v2:hardening`을 사후 교차검증한다.

## 2026-08-27 실노트북 게이트

- 상태: `LOCAL_SMOKE_PASS / CASE_DATA_REVIEW_PENDING`
- 평가서 3건, 편입토지 5건, 평가결과 5건을 한 세션에서 처리했다.
- 검수 10건 완료, 비교표준지 위치 검수 1건은 완료로 오인하지 않고 보류 상태로 남았다.
- VWorld `PHOTO` 지도는 exact 폴리곤 12건, 점 대체 0건으로 생성됐다.
- 생성 도면은 전체 위치도 1장, 편입토지–비교표준지 2장, 비교표준지–평가·거래사례 6장이다.
- 항공사진 인셋은 18건 모두 로딩됐고 재시도·실패는 없었다.
- 주소가 모호하거나 지번 형태가 아닌 4건은 임의 PNU 선택 없이 검토 대상으로 남겼다.
- 세션 키는 현재 탭 메모리에만 사용했고 수행 로그에는 키·주소·PNU·원문을 기록하지 않았다.
- 실노트북 게이트 통과 후 사용자 승인을 받아 Wrangler 직접 경로로 Cloudflare production에 배포했다.
- Production URL: `https://bosang-strategy-os-mobile.chohyunhoe.workers.dev`
- 배포 Version ID: `acbd004f-6e27-4e22-8821-e4be7015d2d3`
- GitHub Actions는 결제 또는 spending limit로 작업 실행 전에 차단됐으며, 로컬 게이트와 직접 배포 검증 결과를 릴리즈 근거로 사용했다.
