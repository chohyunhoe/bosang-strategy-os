# LK GIS Recipe Engine v0.1 — 구현설계 기준선

- 문서 버전: v1.1 reviewed (2026-07-30)
- 상태: 조건부 승인 / PR-01 실행 개시
- 목적: 보상전략 OS의 `지도 로드 및 토지 현황 비교` 단계를 로컬 원터치 파이프라인으로 구현

## 1. 결론

보상전략 OS UI에서 사건·대상토지·비교표준지·평가사례를 선택하고
`토지특성·지도 일괄 생성`을 실행하면, 사용자 PC의 Local GIS Agent가 공적자료를
수집·정규화하고 GeoPackage·QGZ·PDF·PNG를 생성하는 구조를 채택한다.

기존 단일 HTML과 stable16 기능은 유지하며, 구현은 저장소의 `lk-gis-agent/` 서브프로젝트로
격리한다.

## 2. 승인된 아키텍처

```text
보상전략 OS UI
  -> localhost FastAPI Local GIS Agent
  -> Source Adapter(VWorld·공공데이터·사용자파일)
  -> PNU Normalizer
  -> *_pub / *_apr Reconcile
  -> GeoPackage Builder
  -> PyQGIS Recipe Engine
  -> GPKG / QGZ / PDF / PNG / review_queue / provenance
```

핵심 원칙:

- 평가서값(`*_apr`)과 공적자료값(`*_pub`) 분리
- 평가서값 자동 덮어쓰기 금지
- 성공 자료 자동 반영, 실패·불일치 필지만 `NEEDS_REVIEW`
- 민간플랫폼은 공식 API·이용허락 확인 전 `reference_only`
- API 키·원문·개인정보 외부 서버 저장 금지
- 감정평가액·증액 가능성·법률판단 자동화 금지

## 3. 구현 전 확인사항

1. QGIS 최소 버전은 현재 사용 환경을 자동 탐지한 뒤 M0 호환성 테스트로 확정한다.
2. FastAPI와 PyQGIS의 동일 프로세스/별도 서브프로세스 구조는 QGIS 환경 스파이크 후 결정한다.
3. endpoint·레이어명·쿼터·CRS는 `config/sources.yaml`에서만 관리하고 공식 확인 전 하드코딩하지 않는다.
4. `*_apr` 불변성은 쓰기 경로 분리, GPKG 컬럼 분리, 회귀 테스트로 강제한다.
5. localhost 보안은 loopback bind + Origin allowlist + 페어링 토큰을 함께 사용한다.
6. 사용자 파일은 사건 작업 디렉터리 밖을 접근하지 못하도록 path traversal 검증을 둔다.
7. QGZ 저장 전 데이터소스 URI에서 인증키가 제거되었는지 검사한다.
8. raw 응답의 보존기간과 사건 종료 후 삭제 절차를 운영설정으로 둔다.

## 4. 최소 데이터 계약

### case_job.json

```json
{
  "schema_version": "0.1",
  "case": {"case_id": "LK-2026-GMSH-001", "case_name": "광명시흥 과림동 PoC"},
  "parcels": [
    {"role": "SUBJECT", "addr_jibun": "경기도 시흥시 과림동 120-7", "pnu": null},
    {"role": "SUBJECT", "addr_jibun": "경기도 시흥시 과림동 120-8", "pnu": null},
    {"role": "STANDARD", "addr_jibun": "경기도 시흥시 과림동 130-7", "pnu": null}
  ],
  "options": {"target_crs": null, "outputs": ["gpkg", "qgz", "pdf", "png"]}
}
```

### 필지 공통 컬럼

- 키: `pnu`, `role`, `addr_jibun`
- 공적자료: `area_pub`, `jimok_pub`, `land_use_pub`, `road_pub`, `shape_pub`, `topo_pub`, `use_zone_pub`, `price_indv_pub`, `price_base_year_pub`
- 평가서: `area_apr`, `jimok_apr`, `land_use_apr`, `road_apr`, `shape_apr`, `topo_apr`, `note_apr`, `apr_source_doc`
- 검수: `recon_status`, `mismatch_fields`
- 출처: `geom_source_id`, `attr_source_ids`

### GPKG 레이어

- 공간: `subject_parcels`, `standard_parcels`, `case_parcels`, `biz_zone`
- 비공간: `provenance`, `sources`, `review_queue`, `ref_notes`, `job_meta`

## 5. localhost API 기준

- `GET /v1/health`
- `GET /v1/config/sources`
- `PUT /v1/config/keys`
- `POST /v1/jobs`
- `GET /v1/jobs/{id}`
- `GET /v1/jobs/{id}/result`
- `GET /v1/jobs/{id}/artifacts/{name}`
- `GET /v1/jobs/{id}/review`
- `POST /v1/jobs/{id}/review/{item}/resolve`
- `POST /v1/jobs/{id}/retry`
- `POST /v1/jobs/{id}/cancel`

PR-01에서는 `GET /v1/health`만 구현한다.

## 6. QGIS Recipe Engine 9단계

1. 프로젝트 초기화·CRS 적용
2. GPKG 화이트리스트 레이어 로드
3. QML 스타일 적용
4. 역할별 라벨 적용
5. 공적 배경지도 로드
6. extent·축척 계산
7. 관계선·거리 등 검토용 주석 생성
8. QPT 레이아웃 바인딩
9. PDF·PNG·QGZ 저장 및 해시 기록

LK 지도 규칙:

- 대상토지: 노랑
- 비교표준지: 빨강
- 평가사례: 파랑
- 사업구역: 자주색 반투명

## 7. 상태·실패 처리

Job 상태:

`QUEUED -> RUNNING -> DONE | DONE_WITH_REVIEW | FAILED | CANCELED`

실행 phase:

`FETCHING -> NORMALIZING -> RECONCILING -> BUILDING_GPKG -> RENDERING -> PACKAGING`

필지 상태:

`PENDING -> FETCHING -> NORMALIZED -> OK | NEEDS_REVIEW | FAILED`

필지 단위 실패는 전체 성공 필지의 산출을 막지 않는다. 지오메트리가 없는 필지는 미표시하고
도면·result에 누락 사실을 명시한다.

## 8. 광명시흥 PoC

대상:

- SUBJECT: 과림동 120-7, 120-8
- STANDARD: 과림동 130-7
- CASE: 평가사례 1건

완료기준:

- API 키·개인정보 산출물 검출 0건
- 평가서값 자동 덮어쓰기 0건
- 불일치 1건 주입 시 review_queue 1건
- GPKG·QGZ·PDF·PNG 생성
- 노랑·빨강·파랑·자주 색상 규칙 반영
- 한 필지 실패 시 나머지 필지 산출 지속
- provenance에서 원본 raw까지 역추적 가능

## 9. PR 분할

1. PR-01 scaffold·health
2. PR-02 case_job/result/parcel/review 모델
3. PR-03 PNU normalizer
4. PR-04 adapter framework + VWorld geometry mock
5. PR-05 공공데이터 속성 adapter mock
6. PR-06 reconcile + GPKG builder
7. PR-07 QGIS engine steps 1~5
8. PR-08 layout·export steps 6~9
9. PR-09 runner·상태머신·retry·cache
10. PR-10 review API·keyring·산출물 키 누출 검사
11. PR-11 200필지 batch·Atlas·resume

## 10. PR-01 결정

PR-01은 FastAPI scaffold, local-only settings, health endpoint, QGIS 환경 탐지, 기본 테스트만
추가한다. API 키·외부 호출·QGIS 렌더링·보상전략 OS UI 연결은 포함하지 않는다.
