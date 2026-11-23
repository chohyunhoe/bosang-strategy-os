# BSO 지번형 보상상담 시뮬레이터 — PR-1

기준일: 2026-11-23 (KST) · 기준 SHA: `df310bc147d7f79f6a3a840a4047408fa4502d70` (main)

상태: `CHAT_IMPLEMENTATION_COMPLETE / LOCAL_GATE_PENDING`

범위: 지번 → 지도·공적자료 원페이지 MVP. **합성 데이터 기본**, 실데이터는 로컬 브리지 키가 있을 때만. 표준지 후보 비교(PR-2), 상담 멘트·BSO 사건 초안 전달(PR-3)은 미구현.

## 실행 (Windows 1개 명령)

```
RUN_CONSULT_SIM.cmd
```

`http://127.0.0.1:4176/`이 열린다. 기존 `RUN_BSO.cmd`(Release v1, 4174/4175)와 포트·빌드 출력이 분리되어 동시에 실행할 수 있다.

개발/검증:

```
npm run consult:test   # 결정론 코어 13건 (합성)
npm run consult:e2e    # PC 1440 · Fold 펼침 884 · Fold 커버 412 E2E
```

## 코드 위치와 이유

| 위치 | 역할 | 이유 |
|---|---|---|
| `browser/consultation-sim/` | 독립 화면(진입점·UI) | `browser/product-v2/`는 Release v1 빌드에 통째로 복사된다(`build_release_v1.js`). 같은 폴더에 넣으면 Release v1 산출물이 바뀌므로 분리했다. |
| `core/pnu.js` | 법정동+지번 → PNU 정규화, 후보 판정 | 네트워크 없는 순수 함수. 대장구분 규칙은 기존 `public_data/legal_dong.py:build_pnu`와 동일. |
| `core/consultation-session.js` | `ConsultationDraft`, 요청 바인딩, 필드 출처, 저장 정제 | 기존 `CaseStore`와 혼합 금지 요구. 상담 상태는 이 세션 객체에만 있다. |
| `adapters/synthetic-*.js` | 합성 법정동·필지·가격·도형 | 키 없이 전 플로우 실행. 시도코드 98/99(실제 미사용)와 합성 로컬 좌표만 사용. |
| `adapters/bridge-adapter.js` | 실데이터 경로 | 기존 `scripts/public_data_bridge.js`·`.py`의 `/resolve_pnu`, `/vworld_land`를 그대로 재사용. 키는 브리지(로컬 `.env`)에만 있고 브라우저로 오지 않는다. |
| `map-view.js` | 지도 SVG | exact-one 게이트 코드명은 `vworld-api-map.js`와 동일(`VWORLD_PNU_GEOMETRY_NOT_UNIQUE` 등)하게 맞췄다. |
| `scripts/build_consultation_sim.js` → `dist/consultation-sim/` | 별도 빌드 | Product v2·Release v1 빌드 목록을 수정하지 않는다. |
| 서버 | 기존 `scripts/serve_product_v2.js` 재사용 | 루트 경로 인자만 다르게 실행. 수정 없음. |

## 화면 계약 대응 (지시 B)

| 요구 | PR-1 구현 |
|---|---|
| 입력 상단: 행정구역·지번(산)·기준연도·조회·명시 저장 | 구현. 저장은 확인 체크 후에만, 세션 메모리 + 사용자 JSON 다운로드 |
| 지번만으로 전국 유일 확정 금지 | 컨텍스트·동명 없으면 `REGION_CONTEXT_REQUIRED`. 시군구까지만 지정 시 법정동 선택 요구 |
| 후보 2개 이상 자동선택 금지 | 후보 목록 UI. 선택 전 조회 안 함 |
| 0번지·비정형·PNU 19자리 오류·행정구역 변경 | 각각 코드로 차단. 폐지 법정동은 승계 법정동 자동 적용 안 함 |
| 지도: exact-one일 때만 폴리곤 | 복수·불일치·미발견은 점 + 사유. 촬영일 미상은 `미확인` |
| 토지정보: 필드별 원천·기준연도·조회시각·상태 | 구현. 공부/공시지가 산정용 특성/실제 현황 구분 표기 |
| 보상분석 | 표준지 후보는 `미조회 · 원천 검증 전(PR-2)`. 숫자 채움 없음. 확인 필요 신호·미확인 6항목·추가 확보자료 |
| 하단 버튼 | 1차 검토서 복사(사실/신호/미확인 구분)·인쇄·과업 제안(자동 계약·청구 없음 명시) |
| 상태 칩 7종 | 구현. 합성 모드에서 `공식조회 성공(합성)`으로 표기 |
| PC 3열 / Fold 탭 | 1180px 이상 3열, 미만 동일 콘텐츠 탭 |

## 규칙 엔진 (지시 D, PR-1 해당분)

- 결정론 신호만: 지목↔이용상황 표기 상이(→ 현장 확인), 전년 대비 특성 변경(→ 불일치), 필드 미확보, 지도 도형 미확정.
- 각 신호는 근거 필드 키를 가진다. 결론·금액·보정률·증액 예상은 산정하지 않는다.
- 기준연도 자료가 없으면 다른 연도 값으로 **자동 대체하지 않는다**.

## 출처·약관 검토표

| 원천 | 이번 PR에서 한 일 | 확인 상태 |
|---|---|---|
| 국토교통부 토지특성정보 (data.go.kr 15123549) | 합성 어댑터로 응답 형태만 모사 | 공식 문서·필드 **미검증** (이 세션에서 페이지 열람 권한 승인 대기, 실호출 없음) |
| 국토교통부 개별공시지가정보 (15124014) | 합성 모사. 실데이터 경로는 기존 브리지의 VWorld 토지특성 내 공시지가 필드 사용 | **미검증** |
| 국토교통부 표준지공시지가정보 (15123971) | 사용 안 함 (PR-2) | 반경 조회 가능 여부 **미검증**, 가정하지 않음 |
| VWorld 토지특성 `ned/data/getLandCharacteristics` | 기존 브리지 재사용, 응답 매핑만 추가 | 키 없음 → 실호출 0건 |
| VWorld 지도·항공사진·지적·지오코더 | 실연결 **보류**(`MAP_LIVE_PENDING_TERMS_REVIEW`) | 2026-10 약관 개정 여부 **원문 미열람**. 공공데이터포털 등록 정보상 VWorld 지도 API는 무료로 표시됨. 국외 전송 제한 이슈가 커뮤니티에 보고된 바 있어 원본·캐시 저장 및 해외 전송 기능은 만들지 않음 |

저장 정책: 저장 JSON에는 지도 도형 좌표·이웃 필지·원본 응답·API 키가 들어가지 않는다(`geometry_persisted:false`). 브라우저 영구저장(localStorage/sessionStorage) 사용 없음.

## 검증 결과 (이 세션, Linux 샌드박스)

| 항목 | 결과 |
|---|---|
| 코어 결정론 테스트 (`consult:test`) | 17/17 PASS (리뷰 반영·배포 보안 포함) |
| E2E 17시나리오 × 3뷰포트 (`consult:e2e`, 시연판 포함) | 50 PASS / 1 skip(가로·세로 전환은 PC 해당 없음) |
| `product:v2:test` | PASS (변경 전·후 동일) |
| `test:static`, `validate_static_site.js`, `git diff --check` | PASS |
| `parser:test`, `privacy_purge_guard` | PASS |
| `release:v1:test` | PASS |
| `release:v1:e2e` | 88 PASS / 1 FAIL / 9 skip — **변경 전 baseline도 같은 1건 실패** (`vworld_api_quick_map.spec.js:7`, PNG 다운로드 파일명이 샌드박스 Chromium 1243에서 `download`로 나옴). Playwright 1.54 고정 브라우저를 받을 수 없어 사전설치 Chromium으로 실행한 환경 차이로 판단, CI에서 재확인 필요 |
| Release v1 빌드 산출물 | 변경 전·후 `dist/release-v1` 40개 파일 SHA-256 동일 |
| WebKit 모바일 | 샌드박스에 WebKit 없음 → 미실행 |

## 남은 게이트

1. **LOCAL**: Windows PC에서 `RUN_CONSULT_SIM.cmd` 실행·육안 확인, 실제 Galaxy Fold 기기 확인
2. **LOCAL**: 키가 있는 PC에서 로컬 브리지 실호출 1회(비식별 PNU)로 응답 필드·기준연도 확인
3. **RESEARCH**: VWorld·공공데이터포털 현행 약관 원문 재열람 및 기록(저장·재제공·영리·국외 이전)
4. **CI**: GitHub Actions에서 `release:v1:e2e` PNG 파일명 테스트 통과 여부 확인
5. **PR-2**: 표준지 후보 원천(WFS 공간조회 또는 지역별 파일) 검증 후 연결
6. **PR-3**: 3구역 상담 멘트, 사용자 검수 플래그, 명시적 BSO 사건 초안 전달

신규 비용: 0원 (새 API 계약·유료 호출·n8n 없음).

## 공개 시연판 (2026-11-23 추가)

- 주소: https://claude.ai/artifact/P6C1TZpbUH4Z9oFDyzyb2X (Claude 아티팩트, HTTPS, 무료)
- 공개 범위: 현재 **소유자 본인만** 열람(claude.ai 로그인 필요). 다른 사람에게 보이려면 소유자가 아티팩트 페이지에서 공유를 켜야 한다.
- 빌드: `node scripts/build_consultation_sim_demo.js --host=claude-artifact` → `dist/consultation-sim-demo/index.html` 단일 파일
  - 합성 전용(`synthetic_only:true`). 실데이터 브리지 어댑터는 번들에서 제외하고 호출 시 예외를 던지는 스텁으로 대체
  - 빌드 시 브리지 경로·fetch/XHR·외부 URL·키 값·실제 사건명·브라우저 영구저장·비합성 PNU를 검사해 있으면 실패
- 아티팩트 뷰어 제약 대응: 인쇄(`window.print`) 차단 → 인쇄 버튼 숨기고 "복사 후 붙여넣기" 안내. 파일 다운로드 차단 → `downloads` 기능(사용자 확인창)으로 저장, 불가 시 JSON 텍스트 제공
- 실데이터 브리지(`serve_product_v2.js`)는 `127.0.0.1`에만 바인딩되어 공개 인터넷에서 접근할 수 없음(테스트로 고정)
- 선택: `.github/workflows/consultation-sim-demo-pages.yml`(수동 실행 전용). Settings → Pages → Source를 "GitHub Actions"로 켜고 main에서 실행하면 로그인 없이 열리는 공개 주소가 생긴다. 이 세션은 Pages 설정 API 권한이 없어 켜지 않았다.

### 검증 구분

| 구분 | 상태 |
|---|---|
| 데스크톱 Chromium의 모바일 에뮬레이션 (412·884, 세로/가로, 터치 탭, 입력, 탭 이동, 복사·저장, 후보 선택, API 오류) | PASS |
| 게시본 = 검증 빌드 동일성 (SHA-256 `dc963494e181`) | 확인 |
| claude.ai 아티팩트 뷰어 안에서의 실제 렌더링 | **미실행** (이 세션에서 뷰어 검사 도구 사용 불가) |
| Fold8 실기기 (삼성 인터넷·Chrome·Claude 앱) | **미실행** (실기기 접근 없음) |
