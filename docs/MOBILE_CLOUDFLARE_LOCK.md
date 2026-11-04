# BSO 모바일 구동 — Cloudflare Workers Static Assets 고정안

상태: READY_FOR_DEPLOY_VERIFY
기준일: 2026-08-21
대상: 보상전략 OS v1.0 LTR 모바일 정적 RC

## 목적

Netlify 크레딧과 무관하게 동일한 privacy-minimized release candidate를 모바일에서 계속 사용할 수 있도록 Cloudflare Workers Static Assets를 독립 배포경로로 고정한다.

## 배포 계약

- Repository: `bpcbjvggtp-source/bosang-strategy-os`
- Production branch: `main`
- Build command: `npm ci && npm run release:build`
- Deploy command: `npx wrangler deploy`
- Root directory: repository root
- Static assets directory: `./dist/release-candidate`
- Worker name: `bosang-strategy-os-mobile`
- Case data/API key/local_only/node_modules/repository source: 배포 금지

## Wrangler 계약

`wrangler.toml`의 `[assets] directory`는 반드시 `./dist/release-candidate`로 고정한다. 저장소 루트 `.`를 assets로 지정하지 않는다.

```toml
name = "bosang-strategy-os-mobile"
compatibility_date = "2026-08-21"
send_metrics = false

[assets]
directory = "./dist/release-candidate"
```

## Cloudflare Build 설정

- Production branch: `main`
- Build command: `npm ci && npm run release:build`
- Deploy command: `npx wrangler deploy`
- Root directory: 비움(저장소 루트)

배포 후 `https://bosang-strategy-os-mobile.chohyunhoe.workers.dev`를 iPhone Safari에서 연다.

## 모바일 완료기준

다음 6개를 모두 통과하면 모바일 구동을 DONE으로 본다.

1. iPhone Safari에서 BSO 첫 화면이 10초 이내 정상 표시된다. `Hello World` 기본 Worker 화면이면 실패다.
2. PC 전용 2열 레이아웃이 모바일 폭에서 겹치거나 잘리지 않는다.
3. 평가서 PDF 선택 UI가 열리고 브라우저 OCR 경로가 로드된다.
4. 탭/버튼/Review 화면을 손가락으로 조작할 수 있다.
5. 페이지 새로고침 후에도 정적 리소스 404가 없다.
6. 배포 번들에 실사건 PDF, API key, `local_only`, `node_modules` 파일이 없다.

## 운영 원칙

- 모바일: 열람, 현장 후보 확인, 브라우저 기반 입력·검토 중심.
- PC 로컬: 대량 OCR, 로컬 Output Bridge, DOCX/XLSX/PDF 생성, 민감 원문 처리 중심.
- Cloudflare는 Netlify의 대체 배포경로일 뿐 데이터 저장소로 사용하지 않는다.
- Netlify 재과금 또는 크레딧 충전은 필수조건이 아니다.

## 장애 시 판정

- `Hello World`: 기본 Worker가 서빙 중이며 Static Assets 연결 실패.
- assets가 5천여 파일로 잡힘: `[assets] directory`가 저장소 루트로 잘못 설정됨.
- Cloudflare 빌드 실패: `npm ci`와 `npm run release:build` 로그부터 확인한다.
- 정적 리소스 404: `dist/release-candidate`와 release manifest를 확인한다.
- 모바일 UI만 깨짐: 배포 문제가 아니라 responsive-browser 회귀로 분류한다.
- PDF/OCR만 실패: 정적 배포가 아니라 브라우저 OCR/메모리 제약 문제로 분류한다.

## 버전 종료기준

Workers 실주소에서 위 모바일 완료기준 6개를 통과하면 이 작업축은 종료한다. 신규 기능, GIS 패키지, 현장 CRM 확장은 별도 버전으로 분리한다.
