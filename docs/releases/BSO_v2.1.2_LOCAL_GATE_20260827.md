# BSO Product v2.1.2 로컬 릴리즈 게이트

기준일: 2026-08-27  
브랜치: `release/v2.1.2-monday`  
기준 커밋: `e870a97`

## 결론

상태는 `PRODUCTION_DEPLOYED / LOCAL_SMOKE_PASS / CASE_DATA_REVIEW_PENDING`이다.

앱 실행, 복수 평가서 병합, 검수 차단, VWorld API 실무지도, 관계도 분리, 항공사진 인셋과 세션 진단 로그가 실노트북에서 동작했다. 남은 항목은 주소 또는 PNU가 불명확한 사건자료 검수이며 코드 실패로 분류하지 않는다.

## 실제 실행 결과

| 항목 | 결과 |
| --- | --- |
| 앱 상태 | READY |
| 평가서 | 3건 |
| 평가법인 | 3건 |
| 편입토지 | 5건 |
| 필지별 평가결과 | 5건 |
| 비교표준지 | 9건 |
| 평가·거래사례 | 4건 |
| 검수 | 완료 10건 / 보류 1건 |
| VWorld 배경 | PHOTO |
| PNU exact 폴리곤 | 12건 |
| 점 대체 | 0건 |
| 전체 위치도 | 1장 |
| 편입토지–비교표준지 | 2장 |
| 비교표준지–평가·거래사례 | 6장 |
| 항공사진 인셋 | 18/18 성공 |
| 지도 생성 | 약 0.94초 |
| 스캔 평가서 OCR | 19쪽, 작업자 2개, 약 85초 |

## 안전 게이트

- 유효한 소재지와 검증된 19자리 PNU가 모두 없는 비교표준지는 검수완료할 수 없다.
- 주소검색 결과가 복수이면 첫 후보를 자동 채택하지 않는다.
- 명시적 편입토지–비교표준지 또는 비교표준지–사례 관계가 없으면 관계도를 추정 생성하지 않는다.
- VWorld 조회값과 지도 형상은 `review_required=true`, `auto_confirmed=false`를 유지한다.
- API 키는 CaseStore, localStorage, sessionStorage, indexedDB, 수행 로그 및 릴리즈 파일에 저장하지 않는다.
- 수행 로그는 집계와 비식별 항목 참조만 포함하고 사건명, 파일명, 주소, PNU, 금액, 원문을 포함하지 않는다.

## 남은 사건자료 검수

- 주소검색이 유일하지 않은 대상 또는 비교표준지 3건
- 지번 형태가 아닌 OCR 오염 비교표준지 행 1건

위 항목은 원문 또는 공적자료에서 실제 소재지와 PNU를 확인해야 한다. 임의 보정이나 자동 법률·감정평가 결론은 생성하지 않는다.

## Production 직접 배포

- 사용자 승인 후 GitHub Actions 대신 Wrangler 직접 경로로 배포했다.
- Worker: `bosang-strategy-os-mobile`
- URL: `https://bosang-strategy-os-mobile.chohyunhoe.workers.dev`
- Deployment ID: `2abcc90d-76d5-41fe-9c4e-a27075a45b33`
- Version ID: `acbd004f-6e27-4e22-8821-e4be7015d2d3`
- 배포시 정적 파일 38개를 확인했고 바인딩 또는 비밀값은 없었다.
- 공개 URL은 HTTP 200, 화면 제목과 본문은 v2.1.2, manifest는 `bso-product-v2.1.2-release/1.0` 및 `production_entry=true`로 확인했다.
- 브라우저 초기 화면에서 평가서 업로드 경로, 7개 업무 내비게이션, 실행보드를 확인했으며 수평 overflow와 콘솔 오류는 없었다.
- GitHub Actions는 계정 결제 또는 spending limit로 job step 실행 전에 중단돼 코드 테스트 결과로 사용하지 않았다.

## 릴리즈 경계

- 기능 삭제 없음
- 실제 평가서, API 키, 원본 연속지적도, 로컬 지도 산출물은 릴리즈에 포함하지 않음
- QGIS 정밀도면은 선택적 로컬 capability로 유지
- Cloudflare production 배포 완료
- `main` 승격은 별도 결정으로 남김
