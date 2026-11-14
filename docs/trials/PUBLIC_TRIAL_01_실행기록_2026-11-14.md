# PUBLIC_TRIAL_01 실행 기록 (2026-11-14)

**최종 상태: BLOCKED** — 지도 0건, 의견서 0건 생성. (둘 중 하나도 생성되지 않아 PARTIAL이 아님)

이번 시험은 진단과 산출물 생성까지만 다룬다. 기존 코드는 수정하지 않았고, 신규 키 발급·과금·네트워크 설정 변경도 하지 않았다.

## 1. 기준 커밋·실행 경로

| 항목 | 값 |
|---|---|
| 브랜치 | `claude/bso-repo-diagnostic-output-cjlrsf` |
| 시험 기준 커밋 SHA | `df310bc147d7f79f6a3a840a4047408fa4502d70` (BSO GIS: adopt cadastral aerial SOP and fail-closed portable runner) |
| 작업트리 | `bso/RUN_CADASTRAL_AERIAL.cmd` 줄바꿈(CRLF→LF) 차이만 있음. 이번 작업 범위가 아니라 수정·커밋하지 않음 |
| 확인한 지침 | `AGENTS.md`, `core_workflow.md`, `README.md`, `docs/BSO_GIS_지적경계_항공사진_SOP_v1.md`, `bso/tools/README_CADASTRAL_AERIAL.md` |
| GIS 경로 | `python bso/tools/cadastral_aerial.py --config <case.json> --out <dir>` (Windows: `bso/RUN_CADASTRAL_AERIAL.cmd`) |
| 의견서 경로 | `python -m brief_output.opinion_package_entry <case.json> <out_dir> [map.png]` → `brief_output/opinion_package.py` (DOCX, 10개 절) |

## 2. 기존 테스트 결과

| 테스트 | 결과 |
|---|---|
| `pytest bso/tests/test_cadastral_aerial.py` | 11 passed. 처음에는 1건 실패(`KOREAN_FONT_NOT_FOUND`): 컨테이너에 한글 폰트가 없었기 때문이며, CI와 같이 `fonts-nanum`을 설치한 뒤 통과 |
| `pytest brief_output/` | 78 passed |
| `node tests/validate_static_site.js` | Static site contract checks passed |

CI 테스트는 합성 SHP와 모의 타일을 쓰므로 실제 VWorld·Esri 응답이나 실제 위치 정합을 증명하지 않는다(SOP §완료상태).

## 3. 키 상태 (값·헤더는 기록하지 않음)

| 키 | 사용처 | 설정 여부 | 인증 확인 |
|---|---|---|---|
| `VWORLD_API_KEY` | VWorld 위성 WMTS(`cadastral_aerial.py`, provider=vworld), 브라우저 WFS 지적도·토지특성(`browser/product-v2`, `scripts/vworld_batch_lookup.js`) | **미설정** (환경변수 없음, `.env` 없음, 환경 네트워크 시크릿 0건) | **미실시** — 키가 없고 `api.vworld.kr`도 프록시가 403으로 차단 |
| `VWORLD_DOMAIN` | VWorld 요청 Referer | **미설정** | 해당 없음 |
| `PUBLIC_DATA_API_KEY` | data.go.kr 보조조회(`.env.example`) | **미설정** | **미실시** |
| (Esri World Imagery) | `provider=esri` 대체 영상 | 키 불필요 | 연결 불가 — `server.arcgisonline.com` 프록시 403 |

참고: 기존 VWorld WMTS 경로는 키를 URL 경로에 넣는다. 이 클라우드 환경의 자격증명 주입은 헤더 방식이므로, 키를 등록하더라도 기존 경로를 그대로 쓰려면 별도로 확인해야 한다.

## 4. 시험 필지

- 후보: 서울특별시 중구 태평로1가 31 (서울시청 부지, 공공 소유이며 고객과 무관)
- 입력 PNU: `1114010300100310000`. **법정동코드 부분(1114010300)은 공식 조회로 확인하지 않은 후보값**이다. PNU와 지번의 형식상 일치만 통과했고, 연속지적도 대비 exact-one 매칭은 수행하지 못했다.
- 공부면적·지목: 토지대장으로 확인하지 못함

## 5. GIS 실행 결과

| 회차 | 입력 | 결과 |
|---|---|---|
| 1 | 실제 확보값만 사용(공부면적 없음) | `BLOCKED: REGISTERED_AREA_INVALID` (exit 2) |
| 2 | 게이트 진단용으로 면적 자리에 임시값을 넣음(산출물에 쓰이지 않음) | `BLOCKED: CADASTRAL_ZIP_NOT_FOUND` (exit 2) |

- 산출물: 0건. 네트워크 요청 전에 fail-closed로 멈춤(설계대로 동작).
- PNU exact-one, 원본 좌표계(EPSG:5174)→WGS84/WebMercator 변환, 영상 정합: **검증 불가**(원본 경계가 없음)
- 출처·기준일·축척·참고용 표기: 지도가 생성되지 않아 검수 불가

**부족한 입력**
1. 서울 중구 연속지적도 원본 ZIP(SHP/SHX/DBF, EPSG:5174). VWorld 공간정보 다운로드는 로그인이 필요하므로 사용자가 직접 확보해야 한다.
2. 공부면적과 지목(토지대장·토지이음 열람)
3. 영상 원천 접근: `server.arcgisonline.com`(Esri, 키 불필요) 또는 `api.vworld.kr`와 `VWORLD_API_KEY`를 네트워크에서 허용해야 함
4. PNU 법정동코드 공식 확인

## 6. 의견서 실행 결과

- 입력: 같은 필지 1건(`lands`), 평가서·평가행·보상자료 없음
- 결과: `FAIL_CLOSED: 평가행이 없습니다. 분석보고서를 생성할 근거가 없습니다.` (exit 2), DOCX 0건
- 원인: 기존 어댑터(`brief_output/killerkit_adapter.py` `adapt_case`)는 평가행(`land_appraisal_results`)과 평가서 문서 정보가 필수다. 평가행을 지어내지 않는 한 기존 경로로는 "평가서 없는 토지현황 전용 의견서"를 만들 수 없다.
- 실행하려면 둘 중 하나가 필요하다. ① 실제 평가서 기반 평가행 1건 이상 확보, ② 평가행 없이 토지현황만 담는 출력모드를 추가하는 코드 변경(이번 범위 밖이라 하지 않음)
- 금액·증액률: 미확정(입력 없음)

## 7. 검수 결과

| 대상 | 생성 | 열람 검수 |
|---|---|---|
| 지적경계·항공사진 중첩도 | 아니오 | 불가 |
| 검토의견서 | 아니오 | 불가 |

## 8. 남은 제약 구분

- **입력 부족**: 연속지적도 ZIP, 공부면적·지목, 평가서(평가행)
- **환경 제약**: 네트워크 허용 호스트 0개(VWorld·Esri 차단), VWorld 키 미설정
- **코드 결함 아님**: 두 경로의 차단은 모두 설계된 fail-closed 게이트가 동작한 것이다
- **제품 공백(선택)**: 평가서 없는 토지현황 전용 의견서 모드가 없음
- **로컬 게이트**: Windows 실행, 실제 PDF·지도 육안 검수, 담당변호사 승인

## 9. 추가 진단: API 직접 조회 시도 (같은 날)

이 저장소 전용 개인 환경을 만들고, 이 세션을 그 네트워크로 옮겼다. 허용 호스트는 `api.vworld.kr`, `apis.data.go.kr`, `server.arcgisonline.com` 3개다.

| 원천 | 결과 | 판정 |
|---|---|---|
| Esri World Imagery 타일 | HTTP 200, image/jpeg | **영상 확보 가능** |
| `api.vworld.kr` (지적도·토지특성·위성영상) | 프록시 터널은 200으로 열림. TLS 핸드셰이크 직후 서버가 연결을 끊음(5회 재시도 모두 실패) | **클라우드에서 접근 불가.** VWorld 운영기구가 국외·해외 클라우드 IP 접속 제한을 안내한 바 있음(국가공간정보 보안관리규정 제13조). 키가 있어도 이 환경에서는 해결되지 않음 |
| `apis.data.go.kr/1611000/nsdi/*` (토지임야·토지특성·개별공시지가·연속지적) | `NO_OPENAPI_SERVICE_ERROR` (서비스 없음·폐기) | 공공데이터포털 경유 지적·토지대장 조회 경로 없음 |
| 저장소가 쓰는 data.go.kr API | 실거래가·건축물대장·법정동코드만 있음 | 지적경계 대체 불가 |

결론: 이 클라우드 세션에서는 공개 지적경계를 확보할 경로가 없다. 지도 생성은 계속 BLOCKED이며, 근거 없는 경계는 그리지 않았다. 원격 연결로 쓸 수 있는 사용자 PC 폴더도 0개였다.

해소 경로: 국내 IP PC에서 VWorld 조회 또는 연속지적도 ZIP 다운로드 → `bso/RUN_CADASTRAL_AERIAL.cmd` 실행, 또는 그 PC를 Remote Control로 이 세션에 연결.
