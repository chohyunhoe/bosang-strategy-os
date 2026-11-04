# LK GIS Agent

`LK GIS Agent`는 보상전략 OS의 지도·공적자료 수집 작업을 사용자 PC에서 수행하는
로컬 실행 모듈입니다. 구현은 작은 PR 단위로 진행하며, 기존 보상전략 OS의 stable16 영역과
분리합니다.

## 현재 구현 범위

### PR-01 — scaffold·health

- FastAPI 애플리케이션 엔트리
- `GET /v1/health`
- `127.0.0.1` 또는 `::1` 외 바인딩 거부
- wildcard CORS 거부
- QGIS Python 환경 감지 결과 반환

### PR-02 — 데이터 계약

- 사건·필지·평가사례 입력 계약
- 평가서값과 공적자료값 분리
- 검수 상태·결정 및 결과 산출물 계약
- 평가서 발췌값 불변성 및 경로이탈 차단

### PR-03 — PNU 정규화 계약

- 일반·산 지번 주소 파싱
- 19자리 PNU 조립·분해·검증
- 대장구분과 산 지번 표기의 불일치 차단
- 법정동코드 loader 인터페이스
- 코드북 출처·버전 보존
- 미해석·중복해석 오류의 명시적 상태화

### PR-04 — Source Adapter·VWorld geometry mock

- 공적자료 Source Adapter 공통 계약
- 자동반영 소스 allowlist registry
- reference-only 소스의 자동 등록 차단
- endpoint·레이어명·필터·CRS 외부설정형 VWorld geometry adapter
- GeoJSON Polygon·MultiPolygon 및 PNU 일치 검증
- raw 응답과 provenance 기록
- 인증·HTTP·전송·미검색·중복·응답형식 오류 분리
- credential 계열 파라미터를 제거한 요청 해시

### PR-05 — 공공데이터 속성 adapter mock

- 토지특성·개별공시지가·표준지공시지가 profile 계약
- endpoint·요청 파라미터·응답경로·필드명을 외부설정으로 주입
- PNU 일치 검증과 최신/지정 기준연도 선택
- 토지특성·가격 필드의 canonical 변환
- 표준지 일련번호를 별도 metadata로 보존
- 숫자·연도 변환오류, 미검색, 중복연도, 응답형식 오류 분리
- raw 응답과 attribute provenance 기록

### PR-06 — reconcile·GeoPackage builder

- 평가서값과 공적자료값의 필드별 일치·불일치·미수집 판정
- 평가서값 자동 변경 없이 `review_queue` 생성
- 역할별 대상토지·비교표준지·평가사례 공간 레이어 분리
- provenance·sources·review_queue·ref_notes·job_meta 테이블 생성
- Polygon·MultiPolygon을 GeoPackage geometry BLOB으로 직렬화
- 임시파일 기반 원자적 생성과 실패 시 잔여파일 제거
- reference-only 메모의 `exported=0` 강제

### PR-07 — PyQGIS 환경 스파이크·Recipe steps 1~5

- QGIS import·OSGeo4W launcher·`qgis_process` 환경 탐지
- in-process / subprocess / unavailable 실행모드 판정
- 프로젝트 초기화 및 target CRS 적용
- GeoPackage 허용 레이어만 역할별 로드
- LK 역할별 QML 스타일 적용
- 대상토지·표준지·사례 라벨 표현식 적용
- API 키를 결과에 남기지 않는 임시 XYZ 배경지도 로드
- 대상 노랑·표준지 빨강·사례 파랑·사업구역 자주색 QML 제공
- QGIS가 없는 CI에서는 fake runtime으로 1~5단계 순서와 보안 경계 검증

실제 Windows PC에서는 다음 명령으로 QGIS 환경을 먼저 확인합니다.

```bash
lk-gis-qgis-probe
```

QGIS 최소 버전과 in-process/subprocess 최종 선택은 이 출력과 회사 PC의 OSGeo4W 실행시험 후
확정합니다. PR-07은 프로젝트 저장·PDF 출력까지 수행하지 않으며, 배경지도 레이어도
`persist=False`로만 추가합니다.

PR-04와 PR-05는 mock transport로 경계만 검증합니다. 실제 VWorld·공공데이터 endpoint,
레이어명, 서비스별 필드명, 쿼터, 인증키 및 좌표계는 공식문서 확인 후 `sources.yaml`에서
공급하며 코드에 하드코딩하지 않습니다.

PR-06 GeoPackage는 공적값과 평가서값을 별도 컬럼에 보존하며, 두 값을 합친 확정값 컬럼을
생성하지 않습니다.

아직 포함하지 않는 기능:

- API 키 저장
- 실제 법정동코드 파일·주소 API 연결
- VWorld·공공데이터 실서비스 HTTP transport
- 실제 공공데이터 서비스 설정파일
- QGZ·PDF·PNG 저장 및 레이아웃 출력
- 보상전략 OS UI 연결

## 실행

```bash
cd lk-gis-agent
python -m venv .venv
.venv/Scripts/activate
pip install -e ".[dev]"
lk-gis-agent
```

기본 주소: `http://127.0.0.1:8765/v1/health`

## 테스트

```bash
pytest
ruff check app tests
python -m compileall -q app tests
```

## 보안 기준

- 외부 인터페이스 바인딩 금지
- API 키 하드코딩 금지
- 원본 평가서·개인정보 외부 서버 저장 금지
- 공적자료와 평가서값 자동 덮어쓰기 금지
- 감정평가액·증액 가능성·법률판단 자동화 금지

상세 설계는 `../docs/LK_GIS_Recipe_Engine_v0.1_구현설계서_v1.md`를 따릅니다.
