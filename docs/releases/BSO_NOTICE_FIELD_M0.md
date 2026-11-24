# BSO 현장 지번 상담 M0 — 고시 세목 색인 (Issue #34)

전국 공통 기능이며, 오송 제3생명과학 국가산단(국토교통부 고시 제2025-456호)을 첫 검증 사례로 쓴다.

## 무엇을 하나

- **고시 세목 색인**: 고시 PDF의 '수용·사용할 토지 세목' 표에서 일련번호·읍면·리·지번·지목·공부면적·편입면적·PDF 쪽만 뽑아 `bso-notice-index/1` JSON으로 만든다. 소유자·관계인 열은 좌표로 잘라내 읽지 않는다. 색인 스키마는 화이트리스트라 개인정보 키가 있으면 검증·빌드가 실패한다.
- **한 칸 검색**: `320-1`, `궁평리 320-1`, `궁평 320-1`, 전체 주소, `산 12-3`. 여러 리·여러 행이면 후보만 보여 주고 자동 선택하지 않는다. 색인에 없으면 '미편입'이라 하지 않고 '이 색인에서 찾지 못함'으로 안내한다.
- **상담카드 한 화면**: 확인 사실(고시 기재값·원본 쪽) / 산술값(편입률·공부−편입, `산술` 표지) / 미확인 / 상담자가 고른 쟁점 / 확보할 문서 / 후속조치 / 메모. 복사·저장(.txt)·인쇄는 버튼을 누를 때만. 새 상담은 지번·쟁점·메모·공적자료를 모두 지운다. 브라우저 영구저장 없음.
- **공적자료(선택)**: 루프백(127.0.0.1)에서 열고 로컬 브리지에 키가 있을 때만, 법정리가 하나로 확정된 필지에 한해 버튼으로 조회한다(PNU 해석 → VWorld 토지특성). 실패는 결과코드와 함께 '미조회'로 표시하고 값을 만들지 않는다. 이용조건 확인 전이라 공적자료 값은 카드 복사·저장에 넣지 않는다.

## 고시 색인 밖 전국 지번 (직접 조회)

색인에 없는 지번도 상담카드를 열 수 있다. 색인 없이 열어도 된다.
- 색인 대상 리의 미기재 지번(예: `궁평리 999`)은 색인 위치로 주소를 완성한다.
- 그 밖에는 **시·군·구 + 읍·면·동·리 + 지번**을 함께 적어야 한다(`역삼동 12-3`처럼 상위 행정구역이 없으면 조회 버튼 없음).
- 법정동은 브리지가 행정안전부 법정동코드로 다시 확인하고 후보가 여럿이면 조회하지 않는다.
- 카드는 '고시 색인 밖 · 편입 여부 미확인'으로 표시하고 미편입으로 판정하지 않는다.

실브리지 확인(2026-11-24): 색인 없이 `충청북도 청주시 흥덕구 오송읍 궁평리 320-1` → PNU 4311325027103200001 해석 성공, 토지특성은 VWorld `INCORRECT_KEY`.

## 오송3 색인 검산 (2026-11-24, 로컬)

| 항목 | 결과 |
|---|---|
| 대상 쪽 | PDF 15~219쪽 (전체 268쪽) |
| 행 수 | 2,933 (일련번호 1~2,933 연속, 누락 0) |
| 편입면적 합계 | 4,119,584.0㎡ — 사업계획 고시 면적과 일치 |
| 법정리 | 오송리 1,041 · 동평리 987 · 봉산리 401 · 서평리 240 · 정중리 200 · 궁평리 64 |
| 같은 리·지번 중복 행 | 0 |
| 리 이름 이어받음(반복 셀) | 28행 — 카드에 '원문 재확인' 표시. GPT 집계 34행과 차이가 있으나, 리는 일련번호상 6개 연속 구간(경계 5곳 모두 자기 셀에 리 이름 있음)이라 이어받은 리가 틀릴 수 없음 |
| 산번지 | 0 (`산` 토큰은 모두 '봉산리') |
| 공개 예시 궁평리 320-1 | 일련 3 · PDF 15쪽 · 전 · 3,204㎡ 전부 편입. `320-1`만 넣으면 궁평리·동평리 2건 후보 |

원본 PDF와 색인 JSON은 저장소에 없다(`local-data/`, `*.pdf`는 gitignore).

## VWorld `VWORLD_API_ERROR` 원인

같은 키·같은 등록 도메인으로 호출한 결과:

| VWorld API | 결과 |
|---|---|
| 검색 API (`req/search`, 주소→지번) | **OK** |
| 2D 데이터 API (`req/data`, 연속지적) | **INCORRECT_KEY** |
| 토지특성 (`ned/data/getLandCharacteristics`) | **INCORRECT_KEY** (도메인 4가지 변형 모두) |

→ 키 자체는 유효하지만 **데이터·국가중점데이터(토지특성) 서비스에 대해 허용되지 않은 키**다. 도메인 문제가 아니다. VWorld 오픈API 인증키 관리에서 해당 키의 활용 서비스(2D 데이터, 토지특성 등)를 추가하거나 그 서비스로 키를 새로 받아야 한다. 코드로는 고칠 수 없다.

대체 경로 확인: 공공데이터포털 NSDI 토지특성·개별공시지가·토지이용계획(`apis.data.go.kr/1611000/nsdi/...`)은 현재 공공데이터 키로 `returnReasonCode 12`(해당 서비스 없음·폐기) — 대체 공식 경로 없음. 토지특성·공시지가 실조회는 VWorld 키 서비스 범위 정리가 유일한 해결책이다.

코드 변경: provider가 결과코드를 버리지 않고 `VWORLD_API_ERROR` 메시지에 `resultCode=INCORRECT_KEY`처럼 정화해 싣는다(오류 코드 자체는 그대로라 Release v1 계약 불변). 현장 화면은 이 코드를 읽어 구체적 사유를 보여 준다.

## 로컬 실행 (ThinkPad)

```powershell
npm run notice:import -- --pdf "<고시 PDF 경로>" --profile osong3
npm run notice:field:build -- --index local-data/notice-index/osong3-molit-2025-456.json
npm run notice:field:serve
```

- 오프라인 백업: `dist/notice-field/molit-2025-456-field.html` 한 파일(색인 내장, 약 0.7MB). 파일로 열면 네트워크 호출 없음 — Fold8에 복사해 Chrome으로 연다.
- 공적자료까지: `npm run notice:field:serve` 후 `http://127.0.0.1:4180/molit-2025-456-field.html` (브리지는 저장소 루트 `.env` 사용).

## 새 사업 추가

1. `browser/consultation-sim/profiles/<id>.js` — 고시 서지·위치·대상 리·기대 행수/면적·지역 쟁점.
2. `profiles/index.js`에 등록.
3. `npm run notice:import -- --pdf <고시> --profile <id>` → 검산 통과 시 색인 생성.
프로필이 없어도 색인만으로 공통 쟁점·공통 경고로 동작한다.

## M0 / M1 구분

- **M0 (11/26 현장)**: 고시 색인 검색·상담카드·오프라인 단일 파일·결과코드 표시. 공적자료는 키 범위 문제로 현재 '미조회'.
- **M1**: VWorld 키 서비스 범위 정리 후 토지특성·공시지가 실조회 검증, 표준지 후보, 지도, 이용조건 확인 후 공적자료 출력 허용, 2026 현재 조서 대조.

## 남은 확인 (사람)

- 리 이름 이어받음 28행과 GPT 집계 34행의 집계 기준 차이 확인(리 배정 자체는 위 구간 검사로 영향 없음).
- Fold8 실기기 확인(이 PR은 884·412 뷰포트 자동 테스트까지).
- VWorld·고시 재제공 이용조건 확인 — 확인 전 공적자료 값은 출력하지 않는다.

## 지도(항공영상 + 지적경계) · 전용 최소 서버 · Fold8 (2026-11-24 추가)

### VWorld `INCORRECT_KEY` 최종 원인과 수정
- 원인: 서버 호출 인증은 **키에 등록한 서비스 URL을 HTTP `Referer`로 보낼 때** 통과한다. 기존 provider는 `domain` 쿼리만 보내 2D 데이터·국가중점(토지특성·공시지가)이 `INCORRECT_KEY`. 토지특성은 `domain` 파라미터가 있으면 Referer가 맞아도 거부.
- 수정: provider가 `VWORLD_DOMAIN`(없으면 `VWORLD_API_DOMAIN`)을 Referer로 보내고 `domain` 파라미터를 뺀다. 키·서비스 체크박스·`.env` 변경 불필요.
- 공공데이터포털 NSDI(`apis.data.go.kr/1611000/nsdi/...`)는 `returnReasonCode 12`로 대체 경로 아님(변동 없음).

### 지도
- 같은 PNU로: 연속지적도(`LP_PA_CBND_BUBUN`, `geometry=true`, EPSG:4326) **exact-one** 경계 + 주변 지적, VWorld 정적 영상(`/req/image`, `basemap=PHOTO`, 1024×768).
- 정합: 경위도 → 웹 메르카토르 픽셀(256·2^zoom), 영상 중심=화면 중심(`vworld-direct-adapter.js`·Release v1과 같은 방식). MultiPolygon 전 부분·구멍(evenodd).
- 줌 12~18. **VWorld 정적 영상은 줌 19에서 영상 대신 JSON 오류**(실측) → 상한 18.
- 대상 경계·주변 지적 토글, 확대/축소, 촬영일 미확인 표시, '지적선 ≠ 편입선' 경고.
- exact-one이 아니거나(복수·없음) 응답 PNU가 다르면 경계·영상을 그리지 않고 사유만. 상담카드는 그대로.
- 지도·영상·공적자료 값은 화면 열람 전용 — 카드 복사·저장·인쇄에서 제외.

### 실호출 결과(PC, 공개 표본)
| 지번 | PNU | 토지특성·공시지가 | 경계 | 항공 |
|---|---|---|---|---|
| 충북 청주 흥덕 오송읍 궁평리 320-1 (고시 색인) | 4311325027103200001 | 2026 전·제1종일반주거·168,600원 | exact-one + 주변 100 | 수신(z18) |
| 서울 중구 태평로1가 31 (전국 직접) | 1114010300100310000 | 2026 대·일반상업·65,730,000원 | exact-one + 주변 99 | 수신(z18) |
| 세종 어진동 560 (전국 직접, 시·군·구 없는 특수) | 3611011000105600000 | 2026 대·중심상업·3,676,000원 | exact-one + 주변 73 | 수신(z17) |

### 전용 최소 서버 `scripts/field_server.js`
- 제공: 현장 상담 HTML 1개 + 허용 연산(`status`·`resolve_pnu`·`pnu_parcel`·`vworld_land`·`parcel_map`) + 영상 프록시(`/__field/aerial`). 그 밖(`rtms`·`building`·Product v2 등)은 404.
- 키는 이 PC 프로세스에만. 영상은 서버가 Referer와 함께 받아 PNG만 넘긴다(응답 형식·크기 6MB 검사). 응답에 키 없음(실측).
- 영상 좌표는 한국 범위·줌 12~18만. 요청 본문 8KB, IP별 분당 120(연산)/60(영상). `no-store`·`nosniff`·`no-referrer`·CSP(`connect-src 'self'`).
- 항상 127.0.0.1에만 바인딩(평문 HTTP LAN 모드 제거). 다른 기기는 Tailscale **Serve**(tailnet 전용 HTTPS)로만. Funnel 금지.
- `--require-token`: 앱 자체 접근 토큰(이중 인증). 토큰 교환(`/?t=`)은 Serve를 거친 HTTPS 요청에서만, 쿠키 `Secure; HttpOnly; SameSite=Strict`. 토큰 파일 `local-data/field-server/access-token.txt`(gitignore).
- `--allowed-login <tailnet 로그인>`: Serve가 붙이는 `Tailscale-User-Login`이 목록에 없으면 403(루프백 프록시 요청에서만 신뢰).

```powershell
npm run notice:field:build -- --index local-data/notice-index/osong3-molit-2025-456.json
node scripts/field_server.js --page dist/notice-field/molit-2025-456-field.html
```

### Fold8 연결 — 현재 상태와 선택지
| 경로 | 상태 | 필요한 결정 |
|---|---|---|
| PC 브라우저(127.0.0.1) | **동작**(위 실호출) | 없음 |
| Fold8 오프라인 단일 HTML | 동작(고시 카드만, 공적자료·지도 없음) | 없음 |
| Fold8 → Tailscale Serve(비공개 HTTPS, tailnet 접근 정책 허용 기기·사용자만) | PC·Fold8 설치·로그인 완료(사용자). 서버는 토큰+로그인 허용목록으로 실행 | tailnet에서 Serve·HTTPS 인증서 사용 허용(관리 콘솔, 사용자). 인증서 발급 시 머신 이름·tailnet 이름이 공개 CT 로그에 기록됨. **Funnel(인터넷 공개)은 쓰지 않음** |

Fold8 실기기에서 실제 지번 → 지도·토지정보·상담카드가 확인되기 전에는 현장 실사용 완료로 보지 않는다.

```powershell
node scripts/field_server.js --page dist/notice-field/molit-2025-456-field.html --require-token --allowed-login <tailnet 로그인>
& "C:\Program Files\Tailscale	ailscale.exe" serve --bg --https=443 http://127.0.0.1:4190
# 끄기
& "C:\Program Files\Tailscale	ailscale.exe" serve --https=443 off
```

### Fold8 연결 절차 (Tailscale Serve, 2026-11-24 연결 확인)
1. PC: 위 명령으로 서버 + `tailscale serve` 실행(Serve 상태 `tailnet only`, Funnel 없음).
2. Fold8(같은 tailnet 계정): Chrome에서 `https://<PC>.<tailnet>.ts.net/pair` → PC의 `local-data/field-server/pair-code.txt`에 있는 6자리 코드 입력(10분·1회용·실패 5회 폐기) → 쿠키(Secure·HttpOnly·SameSite=Strict, 12시간) 발급 후 상담 화면.
3. 다른 기기 추가·쿠키 만료 시 서버를 다시 시작하면 새 코드.
- 서버 시험(PC→Serve HTTPS): 토큰 없음 401 · 틀린 토큰 401 · 평문 HTTP 토큰 교환 403 · 정상 교환 303+Secure 쿠키 · 허용 안 된 연산 404 · tailnet IP:4190 직접 접속 불가.
