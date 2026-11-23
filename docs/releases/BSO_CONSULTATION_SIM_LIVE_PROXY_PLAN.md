# 상담 시뮬레이터 실데이터 연동 검토 — 기존 API 재사용 · Fold8 보안 프록시

기준일: 2026-11-23 (KST) · 브랜치: `feat/consultation-sim-pr1`

상태: `CODE_REVIEW_DONE / LIVE_CALL_PENDING (ThinkPad 미연결) / WEB_DEPLOY_HOLD (약관·보안 검증 전)`

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

## 3. Fold8 연동 방식 비교 (추가 비용 0원 조건)

| 방식 | 키 위치 | 조건 | 위험 |
|---|---|---|---|
| **A. Cloudflare Tunnel + Access → ThinkPad 상담 전용 서버** (권장) | ThinkPad `.env` 그대로 | Cloudflare 계정에 **도메인(zone)이 이미 있어야** 함. ThinkPad 켜짐·`cloudflared` 설치 | PC 꺼지면 불가. 회사망 정책 확인 |
| B. Cloudflare Worker 프록시(workers.dev) + Access | Worker 비밀값으로 **Cloudflare로 이전** | 도메인 불필요. 기존 `bosang-strategy-os-mobile`과 별도 Worker | 호출 출발지가 Cloudflare(국외 IP 가능) → VWorld·공공데이터포털 차단·약관 위반 가능성, 키 위치 변경 |
| C. 같은 Wi-Fi LAN 직접 | ThinkPad | 같은 네트워크 | HTTPS 없음, 인증 약함 — 비권장 |

A·B 모두 기존 Cloudflare 정적 배포(`wrangler.toml`)는 건드리지 않는다.

## 4. 구현 경로 (방식 A, 약관·보안 게이트 통과 후)

1. `scripts/serve_consult_live.js` 신설: `127.0.0.1` 바인딩, `dist/consultation-sim` + `status`·`resolve_pnu`·`consult_land` 3개 작업만, Cloudflare Access JWT 검증 실패 시 거부, 분당 호출 제한, 응답 필드 화이트리스트, 요청 로그에 PNU·주소 미기록
2. `public_data_bridge.py`에 `consult_land` 추가: 기존 provider 재사용 + 면적 매핑(F2) + 도메인 변수 대체(F1). 기존 `vworld_land` 불변
3. 프런트: 같은 출처로 서빙되므로 `bridge-adapter.js` 경로 변경 최소. 실데이터 모드 표시 유지, 지도는 계속 보류
4. `cloudflared` 터널 + Access 정책(본인 이메일 1개) — 사용자 Cloudflare 계정에서 1회 설정
5. 게이트: VWorld 약관(서버 중계·재제공·국외) 기록 → 비식별 1필지 Fold8 실호출 → 키·PNU 로그 미노출 점검

## 5. 남은 결정

- Cloudflare 계정에 연결된 도메인 유무(A 가능 여부)
- VWorld·공공데이터포털 약관 원문 확인 결과
