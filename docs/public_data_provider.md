# 공공데이터포털 Provider 기반 (public_data 패키지)

작성일: 2026-08-19 / 버전: v0.1

## 1. 목적과 경계

보상전략 OS와 신규사업 모니터링이 공공데이터포털(data.go.kr) API를 안정적으로
재사용하기 위한 **최소 공통 기반**이다. 다음은 하지 않는다.

- 감정평가 결론·보상액·증액 가능성 판단 (검토 보조 후보값만 생성)
- 거래사례 자동 확정 (실거래가 후보는 전 건 `review_required=True`)
- 나라장터 신호만으로 사업 확정·수임가능 판정 (`EARLY_SIGNAL` + 사람 검수)

기존 공간정보 계열(연속지적도·토지특성·공시지가·토지이용계획 등)은 계속
`VWorldProvider`(`transaction_enrichment.providers.VWorldLandCharacteristicsProvider`,
`bso/src/bso_graphics/vworld_*`, `lk-gis-agent/app/adapters/vworld_wfs.py`)가 담당한다.
이 패키지는 VWorld 를 대체하지 않는다.

## 2. 인증키 관리

- 환경변수 `PUBLIC_DATA_API_KEY` (공공데이터포털 일반인증키 **Decoding** 원문).
  URL 인코딩은 `PublicDataProvider.build_url` 이 처리한다.
- 레거시 호환: `PUBLIC_DATA_SERVICE_KEY` 도 fallback 으로 읽는다
  (기존 `transaction_enrichment.providers.PublicDataLandCharacteristicsProvider` stub 의 변수명).
- 로컬: 저장소 루트 `.env` (gitignore 됨, `.env.example` 에는 변수명만 존재).
  CLI/integration test 는 `public_data.core.load_env_file()` 로 읽는다(값 미출력).
- 운영(Netlify): 현재 netlify.toml 은 정적 배포 전용이며 프론트엔드에서 공공데이터
  API 를 직접 호출하지 않는다. 서버사이드 호출이 필요해지면 Netlify Function 또는
  기존 서버사이드 프록시에 환경변수로 주입한다(브라우저 번들 노출 금지).
- 마스킹: 모든 오류·repr 은 `redact_secrets` 를 거친다
  (`key=`, `serviceKey=` 파라미터와 키 원문·URL인코딩 변형 모두 `[REDACTED]`).

## 3. 구조

```
public_data/
  core.py        PublicDataProvider(키/전송 허브), SourceMeta, FetchResult, fail-safe 규약
  legal_dong.py  P0-A 행안부 법정동코드(StanReginCd) — 주소 정규화·코드 매핑·JOIN 기준, build_pnu
  building.py    P0-B 건축HUB 건축물대장(기본개요·표제부·총괄표제부·층별·부속지번·지역지구구역)
                 + 평가서 기재사항 교차검증 Flag(crosscheck_building; MATCH/MISMATCH/NOT_COMPARABLE)
  stores.py      P0-C 소상공인 상가(상권)정보 (시군구/행정동/PNU/반경/폴리곤 조회, XML 전용)
  factoryon.py   P0-C FactoryOn 공장등록 필지정보(회사명 필수 단건조회)·생산정보(명세 미확보)
  rtms.py        Phase2 실거래가 3종(토지 LandTrade / 공장·창고 InduTrade / 상업업무 NrgTrade)
  g2b.py         Phase2 나라장터 4종(발주계획·사전규격·입찰공고·계약) → EARLY_SIGNAL
  candidates.py  현장후보 파이프라인(경계 JOIN·후보표·QGIS CSV)
  run_field_candidates.py  현장후보 CLI (출력: <dir>/local_only/)
  run_early_signal.py      EARLY_SIGNAL CLI (출력: <dir>/local_only/)
```

표준 라이브러리만 사용한다(추가 의존성 없음). 모든 dataset client 는
전송 주입(`transport`)이 가능해 단위테스트는 실호출 없이 검증한다.

## 4. 공통 메타데이터 (SourceMeta)

모든 외부 레코드 결과에 부여: `source_dataset, source_provider, source_updated_at,
retrieved_at, effective_date, pnu, project_id, raw_hash, freshness_grade,
review_required(기본 True), source_url, source_record_id, confidence,
normalization_status`.

`freshness_grade`: LIVE / DAILY / PERIODIC / SNAPSHOT / UNKNOWN.
API 응답이라고 실시간으로 간주하지 않는다(상가정보=SNAPSHOT, 실거래가=PERIODIC 등).

## 5. Fail-safe 규약

다음 상황에서 기존 기능을 실패시키지 않는다: 인증 실패, 활용승인 미완료(returnReasonCode 20),
rate limit(22), 빈 응답, 필드 변경, 네트워크 장애, 주소/PNU 변환 실패.

- dataset client 의 공개 메서드는 예외 대신 `FetchResult(ok=False, status="PARTIAL",
  error_code=...)` 를 반환한다.
- 빈 응답은 `ok=True, records=[], status="REVIEW_REQUIRED"`.
- 페이지 초과분이 있으면 `status="PARTIAL"` (자동 확정 금지).
- CLI 는 소스 하나가 실패해도 나머지를 계속 수집하고 `failures` 로 보고한다.
- 실데이터가 불확실하면 자동 확정하지 않고 `review_required` / `MULTIPLE_CANDIDATES`
  계열 코드로 사람 검수에 넘긴다 (`LegalDongCodeClient.resolve_exact` 등).

## 6. Endpoint 검증 상태 (2026-08-19 실호출 확인)

| 데이터셋 | endpoint | 상태 |
| --- | --- | --- |
| 법정동코드 | 1741000/StanReginCd/getStanReginCdList | ✅ 검증됨 (100건 응답) |
| 건축HUB 대장 6종 | 1613000/BldRgstHubService/getBr* | ✅ 검증됨 (기본개요·표제부 실데이터 확인) |
| 상가(상권)정보 | B553077/api/open/sdsc2/* | ✅ 검증됨 — 시군구·반경·폴리곤·PNU 조회 정상. **XML 전용, 법정동코드 미지원** |
| 실거래가 3종 | 1613000/RTMSDataSvc{Land,Indu,Nrg}Trade | ✅ 검증됨 (토지·공장창고·상업업무용 모두 정상 응답) |
| 나라장터 입찰공고 | 1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch | ✅ 검증됨 (용역 13건, 공사 `...CnstwkPPSSrch` 12건도 정상) |
| 나라장터 사전규격 | 1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc | ✅ 검증됨 |
| 나라장터 계약 | 1230000/**ao**/CntrctInfoService/getCntrctInfoListServcPPSSrch | ⚠️ **경로 확인됨** — 활용신청 승인만 필요(returnReasonCode=30). 승인 시 코드 변경 없이 동작 |
| 나라장터 발주계획 | 1230000/ao/OrderPlanSttusService/... | ❌ returnReasonCode=12(서비스 없음/폐기) — 서비스명 자체가 다름. 공식 명세 필요 |
| FactoryOn 필지정보 | B550624/fctryRegistLndpclInfo/getFctryLndpclService | ✅ 검증됨 (cmpnyNm 조회 14건) |
| FactoryOn 생산정보 | B550624/fctryRegistInfo/... | ❌ 공식 활용명세 미확보 — 추측 금지, 명세 확인 후 진행 |

미확인 endpoint 는 코드 수정 없이 환경변수로 교체할 수 있다:
`PUBLIC_DATA_FACTORYON_PROD_ENDPOINT`, `PUBLIC_DATA_FACTORYON_PARCEL_ENDPOINT`,
`PUBLIC_DATA_G2B_ORDER_PLAN_ENDPOINT`, `PUBLIC_DATA_G2B_PRE_SPEC_ENDPOINT`,
`PUBLIC_DATA_G2B_BID_NOTICE_ENDPOINT`, `PUBLIC_DATA_G2B_CONTRACT_ENDPOINT`.

### 6.1 상가(상권)정보 제약 — 설계에 영향 있음

실호출로 확인된 사실:

- 이 API 는 **XML 만 반환**한다. `type=json` 을 붙이면 응답이 깨진다.
- 정상 동작 경로: `storeListInDong(divId=signguCd)`, `storeListInRadius`,
  `storeListInPolygon`, `storeListInPnu` — 사업지구 경계가 좌표로 있으면
  **폴리곤 조회가 가장 정확한 경로**다.
- `storeListInDong` 의 `divId` 는 `ctprvnCd`(시도) / `signguCd`(시군구) /
  `adongCd`(행정동) 만 허용한다. **법정동코드(`ldongCd`)는 미지원**이며
  `resultCode=10 INVALID_REQUEST_PARAMETER` 로 거절된다.

보상 실무는 법정동 기준이므로, 수집 경로를 다음으로 정한다.

1. **시군구 단위 수집 → 사업지구 경계 폴리곤·좌표로 필터** (기본 경로,
   `run_field_candidates --sigungu-cd`)
2. 필지 단위 확인이 필요하면 `stores_in_pnu`
3. 경계가 좌표로 있으면 `stores_in_polygon` / `stores_in_radius`

`stores_in_legal_dong()` 은 삭제하지 않고 **fail-closed** 로 남겨
`STORE_LEGAL_DONG_UNSUPPORTED` 와 대체 경로를 안내한다(잘못된 조회를 조용히
보내지 않기 위함).

### 6.3 FactoryOn 조회 모델 — 설계에 영향 있음

공식 명세상 필지정보는 **회사명(`cmpnyNm`)이 필수**인 단건 조회 API다.

    GET /B550624/fctryRegistLndpclInfo/getFctryLndpclService
    필수: serviceKey, cmpnyNm
    선택: pageNo, numOfRows, fctryManageNo, rprsntvNm

즉 **"사업지구 내 공장 전체를 훑는" 용도로 쓸 수 없다.** 초기 설계의 지역
전체조회 가정(`*_by_region`)은 제거했고, 다음으로 역할을 재배치한다.

- **현장후보 발굴**: 상가(상권)정보 폴리곤/반경 조회 (사업지구 경계 기반)
- **FactoryOn**: 이미 확보한 회사명·공장관리번호의 필지정보 **보강·확인**

`parcels_by_region()` / `factories_by_region()` 은 삭제하지 않고 fail-closed 로
남겨 `FACTORYON_REGION_QUERY_UNSUPPORTED` 와 대체 경로를 안내한다(실제 API 를
호출하지 않는다).

### 6.4 나라장터 경로 판별법 (returnReasonCode 로 구분)

같은 400/403이라도 본문 사유코드가 원인을 가른다.

- `returnReasonCode=12` (NO_OPENAPI_SERVICE) → **그 경로에 서비스가 없다.**
  서비스명·오퍼레이션명이 틀린 것이므로 활용신청으로는 해결되지 않는다.
- `returnReasonCode=30` (SERVICE_KEY_IS_NOT_REGISTERED) → **경로는 실재한다.**
  해당 서비스에 활용신청이 안 된 것이므로 승인만 받으면 코드 변경 없이 동작한다.

계약서비스는 `at`/`ad`/무접두에서 12, `ao` 에서 30이 나와 **`ao` prefix 가 실재
경로**임이 드러났다. 발주계획은 4종 모두 12이므로 서비스명 자체를 다시 확인해야 한다.

### 6.2 인증키 형태

포털 마이페이지의 **Encoding 키**를 붙여넣으면 `urlencode` 가 다시 인코딩해
(`%2B` → `%252B`) 키가 깨진다. `normalize_service_key()` 가 `%` 를 포함한 키를
Encoding 키로 보고 1회 unquote 하며, `provider.key_form` 으로
`DECODED` / `PERCENT_ENCODED_NORMALIZED` / `MISSING` 을 확인할 수 있다(키 값은 미출력).

## 7. 테스트

```
# 단위테스트(실호출 없음)
python -m unittest tests.test_public_data

# 기존 회귀 포함
python -m unittest tests.test_transaction_enrichment tests.test_public_data

# 실호출 integration (PUBLIC_DATA_API_KEY 존재 시에만 실행, 없으면 SKIP)
python -m unittest tests.test_public_data_integration -v

# endpoint·파라미터 진단 프로브 (수동 실행 전용, 자동 테스트 아님)
python -m tests.probe_public_data
```

integration test 는 응답 원문을 fixture 로 커밋하지 않으며, 승인 대기·트래픽
제한 등 분류된 오류코드는 fail-safe 동작 확인으로 대체한다.

## 8. 사용 예 (로컬 전용 출력)

```
# 현장후보표 (상가 + FactoryOn), 출력은 output/public_data/local_only/
python -m public_data.run_field_candidates --sigungu-cd <시군구5자리> \
    --boundary boundary.json --company "<회사명>" --output-dir output/public_data

# 나라장터 EARLY_SIGNAL → 모니터링 시트 편입용 CSV(상태='확인 필요' 고정)
python -m public_data.run_early_signal --begin 202608010000 --end 202608312359 \
    --output-dir output/public_data
```

실주소·PNU 가 포함되는 출력은 전부 `local_only/` 아래(gitignore) 에 생성된다.

## 9. 남은 작업(후속 버전 후보)

- FactoryOn 생산정보 공식 활용명세 확보, 나라장터 발주계획·계약 요청주소 확정
- 실거래가 후보 → transaction_enrichment 거래사례 검토 플로우 연결 심화
- 지방인허가·국가기록원 등 확장 (이번 버전 범위 아님)
