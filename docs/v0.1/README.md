# 보상전략 OS v0.1 종료 패키지

이 디렉터리는 **BSO v0.1 MVP라는 제품 릴리즈 마일스톤**의 범위와 종료 기준을 고정하는 문서 패키지다.

버전 표기는 다음처럼 구분한다.

- **BSO v0.1 MVP**: 이직 포트폴리오·내부 실무 자동화 MVP의 제품 릴리즈 명칭
- **v0.4-alpha2-stable16**: 현재 HTML/UI 구현체의 내부 개발 기준선

따라서 stable16 UI의 내부 버전 번호를 v0.1로 되돌리거나 재명명하지 않는다. v0.1 문서는 현재 구현자산을 하나의 MVP로 종료·설명하기 위한 제품 관제 계층이다.

## 문서

1. [RELEASE_CONTROL.md](RELEASE_CONTROL.md) — 현재 상태, 동결 범위, 남은 로컬 게이트
2. [FUNCTION_DEFINITION.md](FUNCTION_DEFINITION.md) — 기능정의서
3. [SCREEN_SPEC.md](SCREEN_SPEC.md) — 화면설계서
4. [DATA_MODEL.md](DATA_MODEL.md) — 데이터 구조표
5. [RISK_CHECKLIST.md](RISK_CHECKLIST.md) — 리스크 체크리스트
6. [PORTFOLIO.md](PORTFOLIO.md) — 포트폴리오 설명문

## 상태

`CHAT_IMPLEMENTATION_COMPLETE / LOCAL_GATE_PENDING`

챗/GitHub에서 가능한 문서·구조·보안 경계 정리는 완료 상태로 본다. 이후에는 최신 main 기준 PC Gate와 필요한 경우 Windows/QGIS 실기 게이트만 수행한다.

로컬 게이트에서 실제 실패가 확인되지 않은 영역은 다시 설계하지 않는다.
