# AGENTS.md — LK GIS Agent 작업 지침

이 디렉터리는 보상전략 OS의 로컬 GIS 실행 모듈이다. 저장소 루트의 `AGENTS.md`와 `core_workflow.md`를 함께 적용한다.

## 제품 역할

- 평가서 분석 결과에서 대상토지·비교표준지·평가사례를 받아 공적자료를 수집·정규화한다.
- GeoPackage, QGIS 프로젝트, PDF·PNG 검토도를 로컬에서 생성한다.
- 지도와 공적자료는 쟁점 후보 생성을 위한 검토 보조자료다.

## 절대 원칙

- 기존 `index.html`, stable16 데이터 키, `data-section`, 렌더 함수를 이 모듈 작업에서 수정하지 않는다.
- 평가서값(`*_apr`)과 공적자료값(`*_pub`)을 분리하고 자동 덮어쓰지 않는다.
- API 키, 평가서 원문, 개인정보를 브라우저·Git·산출물·외부 서버에 저장하지 않는다.
- 밸류맵·디스코·부동산플래닛은 공식 API·이용허락 확인 전 `reference_only`로만 취급한다.
- 감정평가액 산정, 보상금 증액 가능성, 법률판단 자동화 기능을 만들지 않는다.
- endpoint·레이어명·쿼터·CRS는 공식 확인 전 코드에 하드코딩하지 않는다.

## PR 원칙

- PR은 구현설계서의 분할안에 따라 작은 단위로 진행한다.
- PR-01은 scaffold와 health endpoint만 구현한다.
- 외부 API 호출은 mock 기반 테스트가 준비되기 전 추가하지 않는다.
- QGIS 의존 코드는 환경 탐지·호환성 스파이크 후 도입한다.

## 기본 테스트

```bash
pytest
python -m compileall -q app tests
ruff check app tests  # ruff가 설치된 환경
```
