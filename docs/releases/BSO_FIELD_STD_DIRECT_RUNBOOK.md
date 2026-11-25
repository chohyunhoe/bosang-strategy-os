# 표준지 직접조회·지도 크기 개선 — 시험 서버(4197 / Tailscale 10005) 반영 절차

대상 브랜치: `claude/bso-standard-land-direct-query-exgzzi` (기준 `feat/field-standard-traits-gpt-20261126` @ b8736e3)
운영 서버·다른 시험 서버는 건드리지 않는다. 운영본 병합은 별도 승인.

## 왜 서버도 바꿔야 하나
- 화면(`field.html`)은 후보 ①②③과 지도에서 고른 표준지를 새 경로 `/__public_data_bridge/standard_traits`로 직접조회한다.
- 이 경로·캐시·계측은 `scripts/field_server.js`(+ `scripts/standard_traits_cache.js`, `transaction_enrichment/standard_lands.py`, `scripts/public_data_bridge.py`)에 있다.
- 지금 4197은 **field-ui worktree의 서버 코드 + ui-standard-traits-gpt의 HTML** 조합이다. 이 상태로 새 화면만 올리면
  서버가 `FIELD_ROUTE_NOT_ALLOWED`를 돌려준다. 새 화면은 서버 기능 표지(`capabilities`)를 먼저 확인하고, 없으면 요청을 보내지 않고
  후보마다 **"서버 미지원"** 으로 표시한다(조용히 실패하지 않음).
- 그래서 4197 서버 프로세스를 **이 브랜치 worktree의 `scripts/field_server.js`** 로 다시 띄워야 한다.

## 반영(사용자 PC, PowerShell)
```powershell
# 0) 이 브랜치 worktree 준비(기존 미커밋 작업이 있는 worktree는 쓰지 않음)
cd C:\Users\chohy\Documents\GitHub\bosang-strategy-os
git fetch origin claude/bso-standard-land-direct-query-exgzzi
git worktree add .claude\worktrees\std-direct origin/claude/bso-standard-land-direct-query-exgzzi
cd .claude\worktrees\std-direct

# 1) 화면 빌드(색인 내장이 필요하면 --index local-data\notice-index\<색인>.json 추가 — dist/는 커밋 금지)
node scripts\build_notice_field.js --out dist\notice-field\field-std-direct.html

# 2) 4197에서 돌던 시험 서버 창만 Ctrl+C로 종료(운영 서버·다른 포트는 그대로)
# 3) 같은 포트·같은 인증 조건으로 이 worktree 서버 시작
#    --env: 키가 있는 기존 .env 경로(키는 이 프로세스 환경에만, 출력 안 함)
#    BSO_FIELD_STATE_DIR: 기존 페어링·토큰을 유지하려면 기존 시험 서버의 local-data\field-server 경로 지정
$env:BSO_FIELD_STATE_DIR = "<기존 시험 서버 worktree>\local-data\field-server"
node scripts\field_server.js --page dist\notice-field\field-std-direct.html --port 4197 --require-token --allowed-login <tailnet 로그인> --env <기존 .env 경로>

# 4) Tailscale Serve 10005 → 127.0.0.1:4197 (이미 같은 매핑이면 생략 · Funnel 사용 안 함)
& "C:\Program Files\Tailscale\tailscale.exe" serve status
```

## 반영 확인(서버·화면이 모두 이 브랜치인지)
```powershell
node scripts\verify_standard_traits_live.js --check-deployed https://<PC>.<tailnet>.ts.net:10005
```
- `server.server_rev = field-server/std-direct-1`, `capabilities`에 `standard_traits` 포함, `page.ui_rev = std-direct-1` 이면 통과(종료코드 0).
- 하나라도 다르면 종료코드 1과 사유(서버 코드 다름 / 화면 HTML 다름 / 인증 실패).

## 실제 VWorld 검증(합성 시험만으로 성공 선언 금지)
```powershell
node scripts\verify_standard_traits_live.js --pnu <대상 19자리 PNU> --year 2026 --env <기존 .env 경로>
```
- 이 체크아웃 서버를 루프백 임시 포트로 띄워(토큰 없음·이 PC 안에서만) 대상 → 주변 표준지 → 화면과 같은 엔진의 후보 ①②③ →
  후보별 PNU·공시연도 직접조회 → 같은 요청 반복(캐시)까지 실행.
- 출력: 후보별 상태 · 요청/응답 PNU·연도 일치 · 이용상황·도로접면·형상·지세·면적 · 불일치 항목 · VWorld 호출 수(1차/2차) · 캐시 재사용.
- 보고서: `local-data\field-server\std-direct-live-<시각>.json`(gitignore, 공개·커밋 금지). 키·토큰은 출력·파일에 없음.
- 통과 기준: 후보 전원 `OK` + PNU·연도 일치 + 2차 VWorld 호출 0회.

## 실기 확인(사용자)
1. PC 1440: 지도 600~800px, 지도 오른쪽에 선택 표준지 요약(공시지가·거리·면적·용도지역·지목·이용상황·도로접면·형상·지세).
2. Fold8 펼침 884: ② 표준지비교에서 지도 560px + 오른쪽 요약.
3. Fold8 커버 412: 지도 가용 폭 전체, ② 카드에 지번·공시지가·거리·면적·용도지역·지목 + 4특성.
4. 후보 ①②③에 "이 필지 확인 안 됨" 문구가 없고, 정상 조회 값에는 추가 주석이 없음.
5. 다른 표준지(목록 '제외·반경 밖' 또는 지도 표식) 선택 → 그 필지만 직접조회되어 갱신.
6. 실패·불일치가 생기면 짧은 칩 + "다시 조회" 버튼.

## 되돌리기
- 4197 서버 창 Ctrl+C → 이전 worktree의 기존 명령으로 다시 시작. 데이터·상담기록 이동 없음(서버 캐시는 메모리뿐).
