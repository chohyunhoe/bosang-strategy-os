# BSO 현장상담 V1.0 정식 출시 — 상담기록 로컬 DB 자동저장

상태: `CHAT_IMPLEMENTATION_COMPLETE / LOCAL_GATE_PENDING`
브랜치: `claude/bso-v1-official-release-wcw5jw` (기준 원격 `bc4ff7e` — ThinkPad 로컬 `b31b088` 지도 고정 패치는 아래 0단계로 반영)

검토 보조 도구다. 감정평가·법률자문을 대신하지 않으며, 상담기록은 상담자가 남기는 메모·쟁점 후보일 뿐 판단이 아니다.

## 1. 범위(추가된 것만)

| 항목 | 내용 |
|---|---|
| 자동저장 | 쟁점·메모·기타·용도지역 확인·묶음 담기·공통 메모·소유 확인·면적 기준일이 바뀌면 0.7초 모아 ThinkPad 로컬 SQLite에 저장 |
| 저장 항목 | 상담 ID · 상담일시 · PNU · 지번 · 사업(사업명·고시번호) · 상담쟁점 · 메모 · 후속조치 · 다필지 묶음(필지별 지번·PNU·쟁점·메모) + 재열기용 화면 상태 |
| 검색·재열기·수정 | 화면 `상담기록` → 상담ID·지번·PNU·사업·쟁점·메모 검색 → `열기` → 수정하면 같은 ID에 수정차수 +1 |
| 내보내기 | 전체/기록별 CSV(엑셀용 BOM)·JSON. 화면 상태 원본(payload)은 내보내지 않음 |
| 자동저장 실패 경고 | 배지 `⚠ 자동저장 실패` + 경고 줄 + 재시도(5→15→30→60초) + 창 닫기 전 경고 |
| 중복저장 방지 | 상담 ID를 화면이 만들고 같은 ID 재전송은 같은 기록 · 같은 내용은 수정차수를 올리지 않음 · 한 번에 하나만 전송 · 다른 기기에서 먼저 고친 기록은 덮어쓰지 않고 `충돌` 표시 |
| 재접속 복원 | 기기 쿠키(`bso_client`, 내용 없음)별 '열린 상담'을 DB에 기록 → 새로고침·브라우저 종료·서버 재시작 뒤 자동 복원. `새 상담`을 누르면 복원 대상에서 뺌 |
| 백업·복구 | 서버 시작·6시간마다(변경 시)·종료 시·`지금 백업` 버튼에 `VACUUM INTO` 백업(최근 30개). 시작 시 무결성 검사 실패면 손상본을 옆으로 옮기고 최신 정상 백업으로 자동 복구. 수동 복구는 CLI |
| 인증 만료 | 화면 요청은 `/pair`로 303 이동. 입력 중(저장 안 된 내용)이면 화면을 떠나지 않고 경고 줄에서 6자리 코드로 다시 연결 → 이어서 저장. `/pair`를 열 때 쓸 코드가 없으면 PC 파일에만 새 코드 생성(1분 1회) |

바꾸지 않은 것: 지도 크기·지도 고정·지도 크게·표준지 직접조회·서버 캐시·상담 UI·단계 이동·복사/내려받기/인쇄·인증 방식(토큰 쿠키 12시간·tailnet 로그인 허용목록·HTTPS 전용 교환·루프백 바인딩). UI는 검색칸 아래 저장 상태 한 줄과 `상담기록` 패널만 추가(현장 서버 V1.0에서만 표시, 정적·파일 열기에서는 숨김).

## 2. 개인정보·공개 저장소 보호

- DB: `<StateDir>\consult-records.sqlite`(+`-wal`·`-shm`·`.lock`), 백업 `<StateDir>\backups\`. 기본 StateDir은 `local-data\field-server`(이미 gitignore).
- `.gitignore`에 `*.sqlite*`·`*.db`·`상담기록_*.csv/json` 추가. 회귀 테스트가 gitignore 대상인지 검사한다.
- 브라우저 저장소(localStorage·IndexedDB) 사용 안 함(기존 빌드 안전검사 유지). 외부 전송·클라우드 저장 없음. 서버 로그에는 건수·파일명만.
- 메모 안내 문구: "실명·전화번호는 적지 마세요 · 이 PC 로컬 DB에 자동저장".

## 3. ThinkPad 반영 절차(PowerShell)

```powershell
# 0) 작업 위치: std-direct-review-gpt worktree. 기준을 b31b088(지도 고정 복원)으로 두고 V1.0 변경을 얹는다.
cd <std-direct-review-gpt worktree>
git status                                  # 미커밋 작업 없음 확인
git fetch origin claude/bso-v1-official-release-wcw5jw
git log -1 --oneline b31b088                # 로컬 커밋 존재 확인
git switch -c v1.0-release-local b31b088
git cherry-pick <이 브랜치의 V1.0 커밋 hash>   # 충돌 시: field.js·field.html·field.css는 양쪽 변경을 모두 살린다(아래 참고)
#   b31b088이 없고 원격 bc4ff7e 기준이면: git switch -c v1.0-release-local origin/claude/bso-v1-official-release-wcw5jw
#   후 git apply --3way local-data\handoff\b31b088-map-pin.patch 로 지도 고정 패치를 먼저 반영하고 커밋한다.

# 1) 확인: Node 22.13 이상(권장 24 LTS)
node -p "process.versions.node"

# 2) 결정론 회귀 + V1.0 E2E(합성 데이터)
npm run consult:test
npx playwright test -c playwright.consultation-sim.config.js tests/consultation-sim-browser/field_v1_records.spec.js

# 3) 10005 시험본(운영 4190·443은 그대로). 시험 DB는 운영과 분리.
node scripts\build_notice_field.js --index local-data\notice-index\<색인>.json --out dist\notice-field\field-v1.html
#    4197에서 돌던 시험 서버 창만 Ctrl+C
powershell -ExecutionPolicy Bypass -File scripts\start_field_server.ps1 -Page dist\notice-field\field-v1.html -Port 4197 -ServePort 10005 -StateDir local-data\field-server-trial -EnvFile <기존 .env>
node scripts\verify_standard_traits_live.js --check-deployed https://<PC>.<tailnet>.ts.net:10005
#    BSO_FIELD_STATE_DIR=local-data\field-server-trial 로 실행해야 토큰을 찾는다. server_rev=field-server/v1.0-std-direct-records-1, ui_rev=v1.0-std-direct-records-1
```

충돌 해소 기준: 지도 고정(b31b088) 쪽 지도·CSS 변경은 그대로 두고, V1.0은 ① `field.html` 검색칸 아래 `data-f-save-line`·`data-f-save-alert`·`data-f-records` 블록과 메모 안내 `data-f-memo-hint`, ② `field.js`의 `recTouch()` 호출(입력 이벤트·`render()` 끝)과 `init()` 앞 'V1.0 상담기록' 블록, ③ `field.css` 끝의 V1.0 블록만 더한다.

## 4. 실기 확인(10005, 사용자) — 기기·상태별 1회씩 따로 판정

| # | 기기 | 확인 | 통과 기준 |
|---|---|---|---|
| 1 | PC 1440 | 지번 → 쟁점 1개 + 메모 → 배지 `저장됨 HH:MM` · 상담ID 표시 | DB 건수 1 (`node scripts\consult_db.js status`, BSO_FIELD_STATE_DIR=시험) |
| 2 | PC | F5 새로고침 | 같은 상담ID·메모·쟁점 복원 |
| 3 | PC | 브라우저 완전 종료 후 다시 열기 | 같은 상담 복원 |
| 4 | PC | 시험 서버 창 Ctrl+C → 다시 시작 → 새로고침 | 같은 상담 복원 · 서버 로그 `start backup` |
| 5 | Fold8 접힘(커버) | 1~4 반복 | 같음 · 가로 넘침 없음 |
| 6 | Fold8 펼침 | 1~4 반복 + 입력 중 접기/펼치기 | 입력 유지 · 저장 |
| 7 | 공통 | 2필지 묶음 + 공통 메모 → `새 상담` → `상담기록`에서 지번 검색 → 열기 → 메모 수정 | 묶음·메모 복원 · 수정차수 +1 · 전체 건수 그대로 |
| 8 | 공통 | `전체 내보내기(CSV)` 엑셀로 열기 | 한글 정상 · 12열 |
| 9 | 공통 | 서버 창 종료 상태에서 메모 입력 | `⚠ 자동저장 실패` 경고 → 서버 재시작 후 `지금 다시 저장` 또는 자동 재시도로 `저장됨` |
| 10 | Fold8 | 쿠키 만료(12시간) 또는 사이트 데이터 삭제 후 접속 | `/pair`로 이동 → 코드 입력 → 이어서 열린 상담 복원 |
| 11 | 공통 | 지도 고정·지도 크게·표준지 직접조회·상담 버튼 | 기존과 동일 |

## 5. GPT 검수 통과 뒤 운영 전환(포트 없는 주소) — 기존 운영본 복구 경로 보존

원칙: 기존 운영 프로세스(4190)와 그 worktree·StateDir은 지우지도 멈추지도 않은 채 둔다. V1.0은 다른 포트에서 띄우고 Serve 매핑만 바꾼다.

```powershell
# 1) 기존 운영 매핑 기록(복구용)
& "C:\Program Files\Tailscale\tailscale.exe" serve status > local-data\serve-before-v1.txt

# 2) V1.0 운영 데이터 위치: worktree 밖 고정 경로(worktree 정리와 무관). 기존 접속 토큰을 이어 쓰면 Fold8 재페어링 불필요.
$V1State = "$env:USERPROFILE\BSO-local\field-server-v1"
New-Item -ItemType Directory -Force $V1State | Out-Null
Copy-Item <기존 운영 StateDir>\access-token.txt $V1State\   # 선택: 생략하면 Fold8에서 한 번 다시 페어링

# 3) V1.0 서버를 새 포트 4200에 시작(Serve 매핑은 아직 안 바꿈 → -ServePort 10006 같은 미사용 포트로 임시 노출하거나, 직접 node 실행)
$env:BSO_FIELD_STATE_DIR = $V1State
node scripts\field_server.js --page dist\notice-field\field-v1.html --port 4200 --require-token --allowed-login <tailnet 로그인> --env <기존 .env>

# 4) 전환: 포트 없는 주소(443)를 V1.0으로
& "C:\Program Files\Tailscale\tailscale.exe" serve --bg --https=443 http://127.0.0.1:4200
node scripts\verify_standard_traits_live.js --check-deployed https://<PC>.<tailnet>.ts.net   # BSO_FIELD_STATE_DIR=$V1State

# 5) 되돌리기(1분): 기존 운영 4190이 그대로 살아 있으므로 매핑만 되돌린다.
& "C:\Program Files\Tailscale\tailscale.exe" serve --bg --https=443 http://127.0.0.1:4190
```

- 안정화 기간(권장 1주) 동안 4190 창은 닫지 않는다. 이후 닫더라도 그 worktree·StateDir은 보존(재시작 명령은 기존 runbook 그대로).
- 시험 DB(`local-data\field-server-trial`)는 운영 DB로 옮기지 않는다(합성·시험 기록).
- Funnel·포트포워딩·방화벽 변경 없음.

## 6. DB 관리(CLI · 값은 출력하지 않음)

```powershell
$env:BSO_FIELD_STATE_DIR = "$env:USERPROFILE\BSO-local\field-server-v1"
node scripts\consult_db.js status                     # 건수·무결성·최근 백업
node scripts\consult_db.js backup                     # 지금 백업(서버 실행 중에도 가능)
node scripts\consult_db.js verify --file <백업파일>
# 복구: 서버 창을 먼저 닫는다(실행 중이면 DB_IN_USE_STOP_SERVER_FIRST로 거부). 현재 DB는 *.pre-restore-<시각>으로 보존.
node scripts\consult_db.js restore --from latest
node scripts\consult_db.js export --format csv --out $env:BSO_FIELD_STATE_DIR\상담기록_전체.csv
```

## 7. 남은 위험

- ThinkPad Node가 22.13 미만이면 자동저장이 꺼진다(화면에 `자동저장 꺼짐 · 서버 V1.0 아님/서버 확인 실패` 경고, 시작 스크립트도 경고). `node:sqlite`는 Node 24에서도 '실험' 표기 — 동작·파일 형식은 표준 SQLite.
- 같은 상담을 PC·Fold8에서 동시에 고치면 나중 기기에 `충돌` 경고가 뜨고 상담자가 덮어쓰기/다시 열기를 고른다(자동 병합 없음).
- 기록을 연 뒤 색인을 다른 사업으로 바꾸면 그 기록은 읽기 전용으로 열린다(덮어쓰기 방지).
- 공적자료·지도·표준지 조회 결과는 저장하지 않는다(다시 열면 필요할 때 다시 조회 · 서버 캐시 재사용).
