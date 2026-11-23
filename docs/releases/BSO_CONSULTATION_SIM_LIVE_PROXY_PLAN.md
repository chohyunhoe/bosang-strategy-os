# 상담 시뮬레이터 실데이터 연동 — 기존 API 재사용 · PC 없는 Fold8 연결

기준일: 2026-11-23 (KST) · 브랜치: `feat/consultation-sim-pr1`

상태: `LIVE_API_PROBE_COMPLETE (ThinkPad) / DUPLICATE_REVISION_RULE_DONE / FOLD8_HOST_ORIGIN_NOT_VERIFIED / WEB_DEPLOY_HOLD`

## 1. 기존 연동 확인 (저장소 코드 기준)

| 구성 | 현재 동작 | 상담 시뮬레이터 재사용 |
|---|---|---|
| `.env` | `VWORLD_API_KEY`, `VWORLD_DOMAIN`(또는 `VWORLD_API_DOMAIN`), `PUBLIC_DATA_API_KEY`(구 `PUBLIC_DATA_SERVICE_KEY`) | 그대로. 값은 Python 프로세스 안에서만 사용 |
| `scripts/public_data_bridge.js` | `/__public_data_bridge/*` 7개 작업, 요청마다 Python 실행, 인증 없음 | `status`·`resolve_pnu`·`vworld_land`만 사용 (`bridge-adapter.js`) |
| `scripts/public_data_bridge.py` | `resolve_pnu`: 행안부 법정동코드 exact/유일 suffix → PNU 후보. `vworld_land`: VWorld 토지특성 | 그대로 |
| VWorld 토지특성 provider | `ned/data/getLandCharacteristics`, PNU·연도 정확히 1행일 때만 채택, 키 마스킹 | 그대로 |
| `serve_product_v2.js` | `127.0.0.1`만 바인딩. 출력·지도·전송·RTMS·건축물대장 브리지까지 함께 노출 | **외부 터널로 그대로 노출 금지** |
| `vworld-api-map.js` (Release v1 지도) | 사용자가 세션에 키를 입력 → 브라우저 JSONP로 지적·검색·영상 호출 | 공개 웹에서는 재사용 불가(키가 브라우저로 감) |

### 코드에서 발견한 확인 필요 사항

- **F1 도메인 변수 불일치**: 토지특성 provider는 `VWORLD_DOMAIN`만 읽고, `probe_vworld_local.ps1`은 `VWORLD_API_DOMAIN`만 읽는다(`local_map_runtime.js`만 둘을 연결). `.env`에 `VWORLD_API_DOMAIN`만 있으면 토지특성 호출에 `domain`이 빠진다. 지금 정상이라면 영향 없음 — 프로브로 확인.
- **F2 면적 미매핑**: 토지특성 파서가 면적을 매핑하지 않아 상담 화면 면적은 실데이터 모드에서 `미조회`. 응답에 면적 필드가 있는지 프로브가 필드 이름 목록으로 확인한다. 있으면 Release v1의 `vworld_land`는 그대로 두고 상담 전용 작업으로 추가.
- **F3 지적 폴리곤**: 서버측 작업이 없다(브라우저 JSONP만). Fold8 실지도는 서버측 작업 신설이 필요하며 약관 확인 전 보류.
- **F4 노출 범위**: 기존 서버를 터널에 붙이면 7개 브리지 전부가 인터넷에 열린다. 상담 전용 최소 서버가 필요.

## 2. 실호출 검증

- 스크립트: `scripts/probe_consult_live.py` (기존 브리지 함수를 그대로 호출)
- 표본: 서울특별시청 부지(중구 태평로1가 31) — 공공청사, 사건 무관. 예상 PNU `1114010300100310000`을 실호출 결과와 교차확인
- 확인 항목: 키 설정 여부(값 미출력), 법정동코드→PNU, 올해·작년 토지특성 응답 필드 이름·매핑값·기준연도, 잘못된 PNU/없는 PNU/미래 연도 오류 코드
- 출력 정제: `.env` 비밀값·퍼센트 인코딩형·`key=` 패턴을 출력 직전 `[REDACTED]` 처리, 원문 저장 없음
- 상태: **미실행** — 2026-11-23 이 세션에서 ThinkPad가 브리지에 연결되지 않음

## 3. Fold8 연동 우선순위 (2026-11-23 사용자 지시 반영)

목표 구조: `Fold8 → BSO 웹 상담화면 → API → 분석 결과`. ThinkPad 경유는 필수가 아니다.

| 순위 | 방식 | 현재 판단 |
|---|---|---|
| 1 | 기존 승인 서버에 중계 기능 추가 | **재사용할 중계 서버 없음.** 기존 Cloudflare(`wrangler.toml`)·Netlify(`netlify.toml`)는 둘 다 정적 파일만 배포. 중계를 넣으려면 서버 코드를 새로 추가해야 함 |
| 2 | 브라우저에서 VWorld 직접 호출 | **구현 완료(배포 안 함), 실키 검증 대기.** 아래 4장 |
| 3 | ThinkPad 터널 | 후순위. PC 상시 구동 필요 |

## 4. 브라우저 직접 모드 (`adapters/vworld-direct-adapter.js`)

- 호출: Release v1 빠른지도와 같은 JSONP. `domain` = 페이지 출처(로컬은 `http://localhost`)
- 주소→PNU: VWorld 검색 API. **공공데이터포털 키는 도메인 제한이 없어 브라우저로 보내지 않음**
- 지적: `req/data` `LP_PA_CBND_BUBUN` exact-one 게이트, 주변 필지 BOX 조회
- 토지특성·공시지가·면적: `ned/data/getLandCharacteristics`를 JSONP로 시도. 막히면 `미조회`(추정값 없음)
- 키: 화면에서 입력 → 메모리에만 보관. 입력칸 즉시 비움, DOM·상태·저장 JSON·브라우저 저장소에 남지 않음(E2E로 검증)
- **연결 점검 버튼**: 공공청사 1필지로 검색·지적·토지특성(올해/작년) 호출 성공 여부와 응답 필드 이름만 표시
- 공개 시연판(합성)·Claude 아티팩트에는 포함하지 않음(빌드에서 스텁으로 제외)

### 저장소 기록으로 본 가능성

- 지적·검색 JSONP: Release v1에서 이미 사용 중 → 가능성 높음
- 토지특성: 과거 stable16은 브라우저 `fetch`로 호출하다가 CORS 차단 대비책을 두고 로컬 프록시로 옮김 → **브라우저 `fetch`는 막힐 가능성 높음, JSONP 지원 여부는 미확인**
- 응답에 면적 `lndpclAr` 존재(`vworld_success_flow.md` 실제 성공 응답 기록)

### 판정 규칙 (연결 점검 결과 → 구조 결정)

| 점검 결과 | 결정 |
|---|---|
| 검색·지적·토지특성 모두 성공 | **서버 없는 구조 확정.** 정적 호스팅 1곳 + VWorld 서비스 URL 등록만 필요 |
| 검색·지적 성공, 토지특성 실패 | 토지특성 1개 API만 중계 필요 → 서버리스 함수 1개(무료 등급) 또는 지도·PNU만 직접 + 토지특성은 PC 브리지 |
| 검색부터 실패 | 키의 서비스 URL 등록·권한 확인 |

## 5. Fold8 실데이터 연결에 필요한 것

1. **호스팅 도메인 = VWorld 키 서비스 URL.** Claude 아티팩트는 외부 스크립트를 막아(CSP) 직접 호출 불가 → 정적 호스팅 필요
   - 후보: GitHub Pages(`consultation-sim-demo-pages.yml` 준비됨, Settings→Pages 1회 설정) 또는 기존 Cloudflare 정적 사이트의 별도 경로(기존 배포 변경이므로 승인 필요)
2. VWorld 개발자센터에서 해당 도메인을 키의 서비스 URL로 등록(또는 시연용 키 별도 발급, 무료)
3. VWorld 약관 확인 기록(브라우저 직접 호출·화면 표시는 일반 사용 범위로 보이나 원문 미확인)
4. 게이트 통과 후 실데이터 빌드 배포(합성 시연판과 별도 주소)

## 6. 터널 방식 (후순위 참고)

Cloudflare Tunnel + Access는 무료지만 ThinkPad 상시 구동과 Cloudflare 도메인이 필요하다. 1·2순위가 막힐 때만 검토한다.

## 7. 2026-11-23 실호출 결과 반영 (PR #23 GPT 검증 댓글)

ThinkPad + 현재 등록 도메인 조합에서 VWorld 검색·지적(`LP_PA_CBND_BUBUN`)·토지특성 3종 모두 JSONP 실응답 성공. 면적 `lndpclAr` 존재. 토지특성은 같은 PNU·연도로 2026년 2행·2025년 3행, 행 간 차이는 `lastUpdtDt`뿐.

### 중복 행 규칙 (`collapseNedRevisions`, Python `collapse_identical_revisions`)

| 경우 | 처리 |
|---|---|
| 같은 PNU·연도 1행 | 그대로 |
| 복수 행, `lastUpdtDt` 외 모든 필드 값 동일 | 날짜로 검증되는 최신 `lastUpdtDt` 행을 대표로 기록(값이 같으므로 결과 동일). 행 수·갱신일 목록·근거 저장 |
| 복수 행, 다른 필드가 하나라도 다름(한 행에만 있는 값 포함) | **자동 선택 안 함** `VWORLD_REVISION_CONFLICT`. 해당 응답의 모든 필드 값 비움·불일치 표시·전문가 검토 신호. 충돌 필드 이름만 기록(값 미기록) |
| 다른 연도 행 섞임 | 요청 연도만 사용, 제외 행 수 기록 |
| `response.status = NOT_FOUND`(미존재 필지·미래연도) | `자료 없음`으로 구분(오류와 분리) |

- 로컬 Python provider는 **옵트인**(`dedupe_revisions: true`를 상담 화면만 보냄). Release v1 요청은 기존 계약(복수 행 보류) 그대로 — `test_transaction_enrichment.py`와 `test_vworld_revisions.py`가 둘 다 고정
- 미존재·미래연도의 실제 응답 형태가 `NOT_FOUND`인지는 다음 실호출에서 응답 키·상태값만 확인 필요(현재 provider 결과 `VWORLD_SCHEMA_CHANGED`)

## 8. 키 노출 검토 (브라우저 직접 방식)

- JSONP 요청 주소에 `key`가 들어가므로 **해당 기기의 개발자도구·네트워크 기록·브라우저 확장 프로그램에서 보일 수 있다.** 화면에 고지 문구 추가(`data-vw-key-exposure`)
- VWorld는 브라우저 외 사용 시 `domain` 파라미터로 등록 도메인을 맞추게 하고, 다르면 `INCORRECT_KEY`를 반환한다. 이 값은 요청자가 넣는 값이라 **도메인 등록만으로 키 도용을 막지 못한다**
- 따라서: 본인 기기·본인 키로만 사용, 키를 번들·저장소·공용 화면에 넣지 않음, 다른 사용자에게 공용 키 배포 금지. 외부 사용자 대상 서비스가 되면 서버 측 비밀관리(무료 서버리스 중계 등)로 전환 판단
- 일부 API는 일일 호출 한도가 있고 초과 시 별도 신청 필요 → 공용 배포 시 한도 소진 위험

## 9. Fold8 HTTPS 출처 검증 경로

- 빌드: `node scripts/build_consultation_sim_demo.js --host=static --variant=vworld-direct-test` → `dist/consultation-sim-live-test/index.html` (키 없음, 외부 주소는 `https://api.vworld.kr`만 허용, 로컬 브리지 제외, "대외 공개용 아님" 배너)
- 배포: `consultation-sim-demo-pages.yml`(수동 실행, `variant` 선택). 실행 전 필요:
  1. 저장소 Settings → Pages → Source "GitHub Actions" (이 세션은 Pages API 권한 없음)
  2. VWorld 개발자센터에서 키의 서비스 URL에 `https://chohyunhoe.github.io` 등록(또는 테스트용 키 별도 발급)
  3. 약관 원문 확인 기록
- 검증: Fold8 삼성 인터넷/Chrome에서 `…/?mode=vworld` → 키 입력 → 연결 점검 4줄
- localhost·ThinkPad 등록 도메인 성공을 새 도메인 성공으로 간주하지 않는다

## 10. 약관 검토 상태

| 항목 | 상태 |
|---|---|
| 브라우저(HTTPS) 사용 시 `domain` 파라미터·등록 도메인 일치 요구 | VWorld 개발자 문서로 확인 |
| 도메인 불일치 시 `INCORRECT_KEY` | VWorld WMS/WFS 문서 오류코드로 확인 |
| 일부 API 일일 호출 한도·초과 신청 | 2차 자료로 확인, 원문 미확인 |
| 이용약관 원문(재제공·영리·저장·국외 이전)과 2026년 개정 | **미확인** — 이 작업 환경에서 vworld.kr 본문 접근 불가 |
