# bosang-strategy-os

> **Windows PC Release v1**: `RUN_BSO.cmd`를 실행하세요. 결과물 준비는 `SETUP_BSO_OUTPUT.cmd`, 사용·검증 기준은 [Release v1 안내](docs/releases/BSO_RELEASE_V1.md)를 따릅니다. 현재 버전은 `1.0.0-rc.2`입니다.

Windows PC 실무용 진입점은 `RUN_BSO.cmd`이며, 검증된 Product 런타임을 `dist/release-v1`으로 빌드합니다. 아래 stable16·v2.1 문서는 기존 기능 기준과 이전 실행 경로의 기록입니다. `bosang_os_v04_alpha2_stable16.html`과 루트 `index.html`은 보존하며 v1 실행 화면과 구분합니다.

최상위 기준선은 [`core_workflow.md`](core_workflow.md)에 정의한 **평가서 업로드부터 의견서 제출검토까지의 실무 흐름**입니다. 보상전략 OS는 단순 HTML 대시보드가 아니라 토지보상 감정평가서를 의견서 작성 가능한 검토자료로 전환하는 실무 프로토타입이며, 향후 기능 판단은 이 core workflow를 기준으로 합니다.

## 중요한 고지

본 프로토타입은 감정평가 결과 산정, 추천, 대체, 보상금 증액 가능성 판단을 하지 않는 검토 보조도구입니다. 본 화면은 법률판단, 감정평가 판단, 보상액 산정에 대한 확정 의견을 제공하지 않으며 제출 전 감정평가서 원문, 현장자료, 공적자료, 전문가 검토가 필요합니다.

## Windows 더블클릭 실행

저장소 루트의 [`RUN_BSO_V01.cmd`](RUN_BSO_V01.cmd)를 더블클릭하면 비개발자용 실행 창이 열립니다. 다음 두 검증 중 하나를 선택합니다.

- **신림동 1513-2**: 프라임·라인 PDF 선택 → 비밀번호 입력 → 원문 Ground Truth 14개 항목 대조 → 산식·역산 → PNU exact-one 검증 → 항공사진 지도 → 2페이지 PDF
- **광명시흥 과림동**: 시흥시 연속지적도 `.shp` 선택 → 같은 이름의 `.shx/.dbf/.prj/.cpg` 확인 → PNU exact-one 검증 → 대상토지·비교표준지 지도 → 2페이지 PDF

VWorld API Key와 PDF 비밀번호는 실행 중 로컬 환경에서만 사용하며 저장소·결과 PDF·실행 기록에 남기지 않습니다. 실행 결과는 `output/runs/<실행시각>/`에 저장됩니다. 광명시흥 평가사례는 원문에 `무지내동`까지만 공개되어 있으므로 지번·PNU·위치를 추정하지 않고 페이지 2에 **사례 위치도 생성 불가**로 표시합니다.

## 기준선

- 최우선 기능 기준선: `bosang_os_v04_alpha2_stable16.html`
- 현재 배포 진입점: `index.html`
- 이전 HEAD의 단순 정적 화면 백업: `index.head-backup.html`
- 모바일 단일파일 확인용 기존 산출물: `index_standalone.html`
- 정적 회귀 테스트: `tests/validate_static_site.js`

## stable16에서 보존하는 핵심 기능

- **보상전략 OS v0.4-alpha2-stable16 앱셸**: sticky header, 좌측 내비게이션, 5개 Workflow, 개발자 상세 화면을 포함합니다.
- **5개 Workflow 구조**: 관제 및 원본, 토지 및 공적자료, 평가논리 검토, 지장물 및 단가, 쟁점 및 의견서 흐름을 유지합니다.
- **개발자 상세 화면**: 업로드·JSON 관리, 원본·추출상태, OCR 검수 작업대, v0.4 문서해석 작업대, 편입토지 상세, 공적자료 상세, 표준지·사례 상세, 필지별 단가 상세, 편입토지↔표준지 상세, 표준지↔사례 상세, 그 밖의 요인 상세, 지장물 상세, 쟁점 상세, 문안 상세, 리스크 상세, JSON/API/OCR 메뉴를 유지합니다.
- **공적 토지특성 보강 구조**: `public_land_characteristics`, `public_land_data_enrichment`, `land_characteristics`, `land_characteristic_crosscheck`와 `renderPublicData()` 화면을 유지합니다.
- **필지별 평가결과 비교**: `comparison_summary_by_land`, `land_appraisal_results`를 기준으로 법인별 표준지, 개별요인 누계, 그 밖의 요인, 적용단가, 금액 비교표를 표시합니다.
- **편입토지↔표준지 개별요인 비교**: `subject_to_standard_factor_comparisons`와 `renderSubjectFactors()`를 유지하며, 공적 API 보강 스펙과 평가서 기재 스펙, 핵심 차이 칩, 압축 스펙카드를 함께 표시합니다.
- **표준지↔거래사례 개별요인 비교**: `standard_to_comp_case_factor_comparisons`와 `renderCaseFactors()`를 유지합니다.
- **그 밖의 요인 상세**: `other_factor_reviews`를 기준으로 사례단가, 시점수정, 개별요인, 사례기준, 공시지가기준, 격차율, 결정치 비교를 표시합니다.
- **OCR 검수 작업대**: `ocr_review_items`, `v04_ocr_factor_candidates`, 이미지 PDF OCR 후보 생성, 크롭/원문 검수, 확정값 JSON 반영, `subject_to_standard_factor_comparisons` 반영 흐름을 유지합니다.
- **PDF.js 기반 문서해석 작업대**: PDF.js text items를 좌표 기반 산정변수 작업대로 재구성합니다.
- **쟁점·문안·리스크 구조**: 쟁점 후보, 의견서 보조문안, 리스크 경고를 검토 보조 자료로 표시합니다.

## VWorld 공란 특성정보 보강 주 플로우

보상전략 OS의 VWorld 주 플로우는 `output/vworld_results.json`을 사용자가 먼저 만드는 것이 아니라, 평가서 업로드와 해석 이후 앱 안에 생성된 편입토지 상세 데이터의 공란 특성정보를 보강하는 흐름입니다. 화면에서는 **공란 특성정보 일괄 보강** 카드가 먼저 보이도록 하며, 다음 순서를 명확히 따릅니다.

1. 평가서 해석 결과에서 편입토지 상세 생성
2. 도로접면·형상·지세·이용상황 등 공란 탐지
3. VWorld API Key 1회 입력
4. 공란 필드 원클릭 일괄 보강
5. 보강값은 검토 보강자료로 저장

공란 탐지 요약은 전체 편입토지 수, 편입토지 상세 초안 수, VWorld 보강 필요 필지 수, **VWorld 보강 대기 초안 수**, PNU 보유 필지 수, PNU 보유 초안 수, PNU 누락 필지 수, PNU 누락 초안 수, 도로접면 공란 수, 형상 공란 수, 지세 공란 수, 이용상황 공란 수를 함께 보여줍니다. 보강 대상 필드는 `road_frontage_public`, `terrain_shape_public`, `terrain_height_public`, `land_use_status_public`, `zoning_public`, `land_area_public`, `land_category_public`, `official_land_price_public`입니다. 조회 결과는 `public_land_characteristics`와 `land_characteristics`에 검토 보강자료로만 저장하고, **평가서값은 자동으로 덮어쓰지 않습니다**. VWorld API Key는 현재 세션 입력값으로만 사용하며 코드, JSON, 문서, 외부 서버에 저장하지 않습니다. 기준연도별 조회값 차이는 보존하고, 실패 필지와 PNU 누락 필지는 수동입력 fallback으로 연결합니다.

### PR-29E: 편입토지 상세 초안과 VWorld 공란 보강 연결

PR-29E는 PR-29D의 후보 검수·구조화 이후 생성된 `draft_land_details`와 기존 VWorld **공란 특성정보 일괄 보강** 흐름 및 `bulkEnrichBlankPublicLandCharacteristics()` 실행 경로를 연결하는 단계입니다. `draft_land_details`의 공란 특성정보가 **편입토지 상세 초안 기반** 라벨과 함께 표시되며 `blank_field_flags`로 남아 있고 PNU 또는 PNU 후보가 있으면 VWorld 보강 대상으로 표시됩니다. PNU 누락 초안은 `PNU_MISSING` 또는 `NEEDS_MANUAL_INPUT` 상태로 두고 수동입력 또는 고급 fallback으로 처리합니다.

- “편입토지 상세 초안의 공란 특성정보를 VWorld 검토 보강자료로 채웁니다.”
- “VWorld 보강값은 평가서 추출값을 자동으로 덮어쓰지 않습니다.”
- “보강 결과는 편입토지 상세 초안 옆에 병기되며, 수동검수 후 반영 여부를 결정해야 합니다.”
- “PNU가 없는 초안은 수동입력 또는 고급 fallback으로 처리합니다.”
- “VWorld 보강은 후보 검수·구조화 이후 단계입니다.”

보강 성공값은 `draft_land_details`의 `vworld_enrichment_status`, `vworld_enrichment_summary`, `vworld_enrichment_preview`, `public_enrichment_review_status`에 병기하고, 기존 `public_land_characteristics` / `land_characteristics`에는 PR-26B 방식의 검토 보강자료로만 반영합니다. 원문 후보의 `source_candidate_id`, `source_file_name`, `raw_text_snippet`은 유지하며, CONFIRMED 상태의 draft라도 감정평가 확정값이 아니라 수동검수 대상 초안입니다. PR-29F 이후에는 이 보강자료를 법인별 수치 비교와 쟁점 후보 연계로 확장할 예정입니다.

JSON import는 고급 fallback입니다. 대량처리 또는 브라우저 조회가 어려운 로컬 환경에서 `scripts/vworld_batch_lookup.js`로 생성한 `output/vworld_results.json`을 가져오는 보조 경로이며, 주 사용자 흐름은 편입토지 상세의 공란 필드를 앱 안에서 원클릭으로 보강하는 것입니다.



## VWorld 토지특성 로컬 batch 조회(고급/로컬 batch fallback)

기존 **VWorld 토지특성 로컬 batch 조회** 기능은 삭제하지 않고 고급/로컬 batch fallback으로 유지합니다. 100~200필지 단위로 VWorld 토지특성속성조회를 실행해야 하는 경우에는 단일 HTML 앱을 대규모 수정하지 않고 로컬 Node.js 스크립트 [`scripts/vworld_batch_lookup.js`](scripts/vworld_batch_lookup.js)를 사용합니다. 이 도구는 보상전략 OS core workflow의 “평가서에 없는 편입토지정보를 VWorld로 자동 보강” 단계를 200필지 실무에 맞게 처리하기 위한 검토 보조용 batch 도구입니다. VWorld 최신 endpoint, 호출 제한, 도메인 정책은 변경될 수 있으므로 실행 전 **VWorld 공식 문서 확인 필요**입니다.

### 준비

실행 전 .env 생성 필요: 실제 API Key와 등록 도메인은 로컬 전용 `.env`에만 입력합니다.

1. VWorld API Key와 등록 도메인은 사용자가 직접 준비합니다.
2. `.env.example`을 복사해 로컬 전용 `.env`를 만들고 실제 값을 입력합니다. 실제 `.env`와 API Key는 저장소에 커밋하지 않습니다.

```bash
cp .env.example .env
```

`.env` 예시는 다음 키만 포함합니다. 실제 키는 `.env.example`에 넣지 않습니다.

```bash
VWORLD_API_KEY=your_vworld_api_key_here
VWORLD_DOMAIN=your_registered_domain_here
VWORLD_DEFAULT_YEAR=2025
```

### 입력 CSV

기본 입력 파일은 [`input/pnu_list_sample.csv`](input/pnu_list_sample.csv)입니다. 기본 컬럼은 `case_id`, `land_id`, `pnu`, `parcel_address`, `stdrYear`이며, `stdrYear`는 행별 선택값입니다. 샘플 CSV는 개인정보 또는 민감주소가 아닌 익명화·가공 예시만 포함합니다.

### 실행

```bash
node scripts/vworld_batch_lookup.js --input input/pnu_list_sample.csv --output output/vworld_results.json --year 2025 --delay 300 --limit 200
```

지원 옵션은 다음과 같습니다.

- `--input`: 입력 CSV 경로입니다. 기본값은 `input/pnu_list_sample.csv`입니다.
- `--output`: 결과 JSON 경로입니다. 기본값은 `output/vworld_results.json`입니다.
- `--year`: 기본 기준연도입니다. 행별 `stdrYear` 또는 `VWORLD_DEFAULT_YEAR`보다 우선합니다.
- `--delay`: 요청 사이 대기 시간(ms)입니다. 기본값은 `300`입니다.
- `--limit`: 처리 상한입니다. 100~200필지 검토용 도구이므로 최대 200건으로 제한합니다.

### 결과와 보안 원칙

결과 JSON은 기본적으로 `output/vworld_results.json`에 생성됩니다. 결과에는 정규화된 공적자료 보강 필드, 조회 상태, 실패 사유, 중복 후보 수, 수동 검수 필요 메시지만 저장합니다. API Key, 전체 요청 URL, 원문 VWorld 응답 전체는 저장하지 않습니다.

생성된 JSON은 추후 보상전략 OS에 import해 `public_land_characteristics`와 `public_land_data_enrichment` 등 공적자료 보강자료로 반영하는 흐름을 전제로 합니다. VWorld 조회값은 검토 보조자료이며 평가서값을 자동으로 덮어쓰지 않습니다. 결과없음, PNU 누락, PNU 형식 오류, 조회 실패, 동일 PNU/기준연도 중복 후보는 수동 검수 및 전문가 검토 필요 대상으로 유지합니다.

### PR-26A: VWorld batch 결과 JSON import preview

`index.html`의 공적자료 보강 화면에는 **VWorld batch 결과 JSON import** 카드가 있으며, `output/vworld_results.json` 내용을 붙여넣어 import 전 preview만 확인합니다. 이 preview는 `lookup_batch_id`, `stdrYear`, `lookup_created_at`, 전체 `results` 수, `VWORLD_LOOKUP_SUCCESS`, `VWORLD_NO_RESULT`, `VWORLD_LOOKUP_FAILED`, `PNU_MISSING`, `PNU_INVALID` 건수와 첫 3건 미리보기를 표시합니다.

PR-26A 단계에서는 batch import preview만 제공하며 `public_land_characteristics`, `land_characteristics`, `land_characteristic_crosscheck`에는 실제 데이터를 반영하지 않습니다. 로컬 batch 조회 결과를 검토 보강자료로 반영하기 전 미리 확인하는 용도이며, 평가서값이나 공적자료 데이터에 아직 반영하지 않습니다. 원문 VWorld 응답과 API Key는 저장하지 않습니다.

### PR-26B: VWorld batch 결과 검토 보강자료 반영

preview 확인 후 **검토 보강자료로 반영** 버튼을 누르면 `status === "VWORLD_LOOKUP_SUCCESS"`인 행만 `public_land_characteristics`와 `land_characteristics`에 반영합니다. `public_input_origin`은 `VWORLD_BATCH_IMPORT`, `public_data_source`는 `VWorld`로 저장하며 `public_land_data_enrichment.lookup_status`는 `VWORLD_BATCH_IMPORTED`로 기록합니다. import 메타는 `vworld_batch_import_summary`에 `lookup_batch_id`, `stdrYear`, `lookup_created_at`, `import_created_at`, 상태별 건수와 “평가서값 자동 덮어쓰기 없음” 안내를 함께 저장합니다.

`VWORLD_NO_RESULT`, `VWORLD_LOOKUP_FAILED`, `PNU_MISSING`, `PNU_INVALID` 행은 `vworld_batch_review_queue`에 남겨 수동입력 fallback으로 이어지도록 관리합니다. PR-26B 단계에서는 `land_characteristic_crosscheck`를 생성하거나 갱신하지 않았으며, 평가서값은 자동으로 덮어쓰지 않습니다. API Key, 전체 요청 URL, 원문 VWorld 응답 전체는 저장하지 않습니다.

### PR-26C: VWorld batch crosscheck 생성/갱신

PR-26C부터 batch import 반영 완료 후 `updateVWorldBatchImportCrosscheck()`가 `status === "VWORLD_LOOKUP_SUCCESS"` 행만 대상으로 `land_characteristic_crosscheck`를 생성 또는 갱신합니다. `VWORLD_NO_RESULT`, `VWORLD_LOOKUP_FAILED`, `PNU_MISSING`, `PNU_INVALID` 행은 crosscheck 대상이 아니라 `vworld_batch_review_queue`와 수동입력 fallback에 남깁니다.

비교 대상 필드는 지목, 면적, 용도지역, 이용상황, 도로접면, 지형고저, 지형형상, 개별공시지가, 기준연도입니다. 각 crosscheck row는 평가서값 후보와 VWorld 조회값을 `appraisal_value`, `public_data_value`, `source`, `public_standard_year`, `public_last_updated_at`, `review_status_code`로 분리 보존합니다. 상태값은 `MATCHED`, `DIFFERENT`, `PUBLIC_DATA_MISSING`, `APPRAISAL_VALUE_MISSING`, `NEEDS_REVIEW`만 사용해 차이를 검토 단서로 표시합니다. 차이값은 검토 단서이며 평가상 문제 여부를 단정하지 않습니다. 원문·공부·현장자료 수동 검수 필요.

import summary에는 crosscheck 생성 수, 갱신 수, 검토 필요 수를 함께 표시하고 `vworld_batch_import_summary`에도 저장합니다. VWorld 조회값의 `public_standard_year`와 `public_last_updated_at`을 남겨 평가 기준시점과 조회 기준연도를 구분해 검토하도록 안내하며, 평가서값은 자동으로 덮어쓰지 않습니다.

### PR-26D: VWorld batch import summary·문서·QA 마감

PR-26D에서는 PR-25 로컬 batch 실행 → PR-26 앱 import 흐름을 문서·테스트·QA 기준으로 마감합니다. 흐름은 `scripts/vworld_batch_lookup.js`로 `output/vworld_results.json` 생성 → 앱의 **VWorld batch 결과 JSON import** 카드에서 preview → 반영 → crosscheck → summary 확인 순서입니다.

import summary UI와 `vworld_batch_import_summary`는 총 results 수, 반영 성공 수, 결과 없음 수, 실패 수, PNU 누락/오류 수, crosscheck 생성/갱신 수, 검토 필요 수, 수동입력 필요 수를 함께 정리합니다. import 이력은 `lookup_batch_id`, `stdrYear`, `lookup_created_at`, `import_created_at`, `source: VWorld`를 표시하며, 원문 응답/API Key 비저장 안내를 유지합니다.

정상 `VWORLD_LOOKUP_SUCCESS` 행만 `public_land_characteristics`와 `land_characteristics`에 검토 보강자료로 반영하고, `VWORLD_NO_RESULT`, `VWORLD_LOOKUP_FAILED`, `PNU_MISSING`, `PNU_INVALID` 행은 수동입력 필요 대상으로 `vworld_batch_review_queue`에 남깁니다. 평가서값 자동 덮어쓰기 금지, 원문 응답/API Key 저장 금지, 수동 검수 필요 원칙은 preview·반영·crosscheck·summary 전 단계에서 동일하게 적용합니다.

## 데모 실행 방법

`index.html`은 GitHub Pages 또는 로컬 정적 서버에서 시연합니다. 브라우저 보안 정책 때문에 `index.html`을 `file://`로 직접 열면 일부 로컬 파일 접근이나 업로드 검수 흐름이 제한될 수 있으므로, 포트폴리오 제출/면접 시연에서는 아래 두 방식 중 하나를 사용합니다. 단일 파일 확인은 `index_standalone.html`을 사용할 수 있지만, 기능 기준은 stable16 기반 `index.html`입니다.

### GitHub Pages 배포

1. GitHub 저장소의 기본 브랜치에 `index.html`, `sample_case_gongju.json`, `README.md`, `demo_walkthrough.md`, `manual_qa_checklist.md`, `portfolio_demo_notes.md`가 포함되어 있는지 확인합니다.
2. GitHub 저장소 화면에서 **Settings → Pages**로 이동합니다.
3. **Build and deployment**의 Source를 **Deploy from a branch**로 선택합니다.
4. Branch는 배포 기준 브랜치, Folder는 `/ (root)`를 선택한 뒤 저장합니다.
5. Pages가 제공하는 URL에서 `/index.html`을 열고, 화면 상단의 stable16 앱셸과 5단계 워크벤치가 표시되는지 확인합니다.
6. 데모 데이터는 `sample_case_gongju.json` 파일 내용을 복사해 JSON 입력창에 붙여넣거나, 브라우저의 파일 업로드 흐름으로 적용합니다.

### 로컬 실행

```bash
python3 -m http.server 8000
```

그다음 브라우저에서 <http://localhost:8000/index.html>을 엽니다. 다른 포트를 사용해야 한다면 `python3 -m http.server 8080`처럼 포트 번호를 바꾸고, 브라우저 주소도 같은 포트로 접속합니다.

### sample_case_gongju.json 적용 절차

`sample_case_gongju.json`은 stable16 화면 검수용 익명화·가공 데모 데이터입니다. 실제 주민명, 주민등록번호, 민감주소를 포함하지 않으며, 감정평가 판단이나 보상금 증액 가능성을 단정하기 위한 자료가 아닙니다.

1. GitHub Pages URL 또는 로컬 서버 URL에서 `index.html`을 엽니다.
2. 좌측 메뉴의 **업로드·JSON 관리** 또는 5단계 Workflow의 **1. 원본 등록**으로 이동합니다.
3. `sample_case_gongju.json` 파일을 열어 전체 JSON을 복사한 뒤 JSON 입력창에 붙여넣거나, 파일 업로드 버튼으로 해당 파일을 선택합니다.
4. 적용 후 **공적자료 상세**, **필지별 단가 상세**, **편입토지↔표준지 상세**, **표준지↔사례 상세**, **그 밖의 요인 상세**, **OCR 검수 작업대**, **쟁점 상세**, **문안 상세**, **리스크 상세**에 데모 행이 표시되는지 확인합니다.
5. 데이터키 보존 검수 시 `public_land_characteristics`, `comparison_summary_by_land`, `subject_to_standard_factor_comparisons`, `standard_to_comp_case_factor_comparisons`, `other_factor_reviews`, `ocr_review_items`, `issue_candidates`, `draft_sentences`, `risk_warnings`가 비어 있지 않은지 확인합니다.

### 시연 전 확인 문서

- 수동 QA 체크리스트: [`manual_qa_checklist.md`](manual_qa_checklist.md)
- 포트폴리오/면접 시연 메모: [`portfolio_demo_notes.md`](portfolio_demo_notes.md)
- 공적 토지특성정보 API 보강 설계: [`public_data_api_design.md`](public_data_api_design.md)
- VWorld 토지특성 성공 조회 흐름: [`vworld_success_flow.md`](vworld_success_flow.md)
- VWorld 일괄조회 큐 + 로컬 프록시 설계: [`vworld_batch_lookup_design.md`](vworld_batch_lookup_design.md)

### VWorld 조회 성공 흐름 문서

- 100~200필지 실무 처리를 위한 VWorld 일괄조회 큐, 로컬 Node.js 프록시, 결과 JSON 반영 설계는 [`vworld_batch_lookup_design.md`](vworld_batch_lookup_design.md)에 정리했습니다. 단건 조회와 원문 붙여넣기 fallback은 검증용으로 유지하며, VWorld API Key는 저장하지 않음, 원문 VWorld 응답 전체를 장기 저장하지 않음, 평가서값은 자동 덮어쓰지 않음 원칙을 따릅니다.
- 실제 VWorld 토지특성 성공 응답 구조와 기준연도별 조회값 반영 흐름은 [`vworld_success_flow.md`](vworld_success_flow.md)에 정리했습니다.
- 대표 예시는 PNU `9999999999100780001` 기준 2024년 계획관리지역·부정형·공시지가 516112, 2025년 용도미지정·사다리형·공시지가 529203입니다. 기준연도별 값이 다를 수 있으므로 평가 기준시점과 조회 기준연도를 구분해 검토해야 합니다.
- 브이월드 조회값은 검토 보강자료입니다. 평가서값을 자동으로 덮어쓰지 않습니다. 기준연도별 차이는 검토 단서이며 평가상 문제 여부를 단정하지 않습니다.
- 시연 기록에는 성공 여부, 기준연도, 파싱 진단만 남기고 VWorld API Key와 원문 응답 전체는 저장하지 않습니다.

## 데모 walkthrough

- 포트폴리오 시연용 5단계 워크벤치 검수 문서: [`demo_walkthrough.md`](demo_walkthrough.md)
- 이 문서는 `sample_case_gongju.json` 적용 순서, 단계별 시연 포인트, 핵심 카드 설명, 3분 발표 스크립트, 수동 QA 체크리스트를 포함합니다.

## 데모 JSON 적용 방법

`sample_case_gongju.json`은 stable16 화면 검수용 익명화·가공 데모 데이터입니다. 실제 주민명, 주민등록번호, 민감주소를 포함하지 않으며, 감정평가 판단이나 보상금 증액 가능성을 단정하기 위한 자료가 아닙니다.

1. 로컬 서버를 실행한 뒤 브라우저에서 `index.html`을 엽니다.
2. 좌측 메뉴에서 **업로드·JSON 관리** 또는 상단 Workflow의 **관제 및 원본** 흐름으로 이동합니다.
3. `sample_case_gongju.json` 내용을 JSON 입력창에 붙여넣거나 파일 업로드로 적용합니다.
4. 공적자료 상세, 필지별 단가 상세, 편입토지↔표준지 상세, 표준지↔사례 상세, 그 밖의 요인 상세, OCR 검수 작업대, 쟁점 상세, 문안 상세, 리스크 상세 화면에 데모 행이 표시되는지 확인합니다.

## 테스트

```bash
node tests/validate_static_site.js
```

테스트는 stable16 핵심 문자열, 렌더 함수, 공적자료/API/OCR/개별요인 비교/OCR 검수/PDF.js 문서해석 작업대 회귀 계약을 확인합니다.

### 모바일 Codespaces QA 실행

모바일 Codespaces에서 터미널 명령어 복사·붙여넣기가 어려우면 Command Palette 또는 메뉴에서 **Run Task**를 사용합니다.

1. Command Palette 또는 메뉴에서 **Run Task**를 실행합니다.
2. **Bosang: Cycle** task를 선택합니다.
3. 실행이 끝나면 마지막 `SUMMARY` 블록만 확인합니다.

직접 명령어 입력은 선택사항이며, 필요한 경우 같은 Run Task 목록에서 **Bosang: Parser Actual QA** 또는 **Bosang: Static Validate**를 선택해 실행할 수 있습니다.

## 토지특성정보 공란 시 처리 흐름

평가서 등록 또는 `sample_case_gongju.json` 적용 후 `lands`는 존재하지만 `land_characteristics`, `public_land_characteristics`, `land_characteristic_crosscheck`의 주요 공적자료 필드가 비어 있으면 빈 화면으로 두지 않고 **공적자료 보강 필요** 워크플로우로 연결합니다.

- 감지 대상 필드는 `zoning_appraisal`, `road_frontage_public`, `terrain_height_public`, `terrain_shape_public`, `official_land_price_public`, `pnu`, `land_category_public`, `land_use_status_public`입니다.
- 필지별 보강 행이 없으면 기본 `land_characteristics` 행을 만들고, PNU가 없으면 `PUBLIC_DATA_MISSING` 및 `PNU_REQUIRED` 상태로 표시합니다.
- `land_characteristic_crosscheck`가 비어 있거나 공란 필드의 교차검수 행이 부족하면 필지별 기본 교차검수 행을 생성해 `조회 필요`, `수동입력 필요`, `브이월드 조회 대기`, `PNU 후보 필요`, `공적자료 보강 필요` 중 하나로 안내합니다.
- 관제 화면의 **현재 해야 할 일** 카드는 공적자료 공란을 감지하면 **공적자료 보강**으로 이동합니다.
- **공적자료 수동 보강** 카드에서 필지별 `PNU`, `공적 지목`, `공적 이용상황`, `용도지역`, `도로접면`, `지형고저`, `지형형상`, `개별공시지가`, `조회일자`, `자료출처`를 직접 입력하거나 `항목: 값` 형식으로 붙여넣을 수 있습니다.
- 수동 보강값은 `land_characteristics.manual_public_input` 및 `public_land_characteristics.manual_public_input`에 사용자 입력 보강자료로 분리 저장되며, 평가서 지목·이용상황·용도지역 입력값을 자동 덮어쓰지 않습니다.
- 값을 반영하면 관련 `land_characteristic_crosscheck`의 `NEEDS_REVIEW` 또는 `MANUAL_INPUT_REQUIRED` 계열 상태가 `MANUAL_EDITED`로 바뀌고, **검수 완료 표시** 버튼으로 `CONFIRMED` 상태를 기록할 수 있습니다.
- 수동입력 흐름과 브이월드 API 조회 흐름 모두 브이월드 조회값을 확정 사실처럼 표시하지 않습니다. 화면 안내처럼 “조회값/입력값은 검토 보조자료이며 실제 현황과 다를 수 있음”을 전제로 원문·공부·현장자료 확인 전에는 검토 보조 상태로만 다룹니다.

## 브이월드 토지특성 조회 사용법

`공적자료 상세` 화면의 **공적자료 수동 보강** 카드에는 PR-10 설계(`public_data_api_design.md`)를 기준으로 한 최소 브이월드 토지특성 조회 보조 UI가 포함됩니다. 브이월드 조회값은 확정 공적자료가 아니라 **검토 보강자료**이며, 평가서값을 자동으로 덮어쓰지 않습니다.

1. `VWorld API Key` 입력칸에 브이월드에서 발급받은 키를 현재 브라우저 세션에서만 입력합니다. VWorld API Key는 `index.html`, 샘플 JSON, 저장 JSON에 하드코딩하지 않습니다. NED API는 인증키 파라미터명을 `key`로, 주소검색 API는 `apiKey`로 구분합니다.
2. `domain`은 `window.location.hostname` 자동감지를 기본으로 하며, `file://` 실행이나 키 등록 도메인과 다른 환경에서는 사용자가 직접 입력합니다. `기준연도 stdrYear`는 현재연도-1을 기본값으로 두되 사용자가 4자리 연도로 수정하면 해당 입력값을 우선 적용합니다. 예를 들어 2026년에 실행하면 기본 조회 기준연도는 2025입니다.
3. 필지별 `브이월드 조회용 PNU 후보`에는 숫자 19자리 PNU 후보 1개만 입력합니다. 19자리가 아니면 `PNU_LENGTH_INVALID`/`PNU_CANDIDATE_REQUIRED`로 보고 토지특성 조회를 막습니다.
4. PNU가 없고 지번주소가 있으면 **지번주소 기반 PNU 후보 찾기** 버튼으로 주소검색 endpoint `https://map.vworld.kr/search.do`를 `category=jibun`, `q=지번주소`, `output=json`, `pageIndex=1`, `pageUnit=10`, `apiKey` 파라미터로 호출합니다. 주소검색 결과 PNU는 후보값이며 자동 확정하지 않고 필지 카드에 후보로 표시합니다.
5. **브이월드 토지특성 조회** 버튼을 누르면 토지특성속성조회 endpoint `https://api.vworld.kr/ned/data/getLandCharacteristics`에 `pnu`, `stdrYear`, `format=json`, `key`, `domain`을 붙여 브라우저에서 직접 호출합니다. 토지임야목록조회 후보 endpoint는 `https://api.vworld.kr/ned/data/ladfrlList`이며 UI에 참고 endpoint로 표시합니다.
6. 실제 VWorld 토지특성 성공 응답은 최상위 `landCharacteristicss` 아래 `field[]`, `pageNo`, `resultCode`, `totalCount`, `numOfRows`, `resultMsg`를 두는 구조를 확인했습니다. `field` 항목에는 `pnu`, `lndcgrCodeNm`, `lndpclAr`, `prposArea1Nm`, `prposArea2Nm`, `ladUseSittnNm`, `tpgrphHgCodeNm`, `tpgrphFrmCodeNm`, `roadSideCodeNm`, `pblntfPclnd`, `stdrYear`, `lastUpdtDt`, `ldCodeNm`, `mnnmSlno` 등이 포함될 수 있습니다.
7. 성공하면 `public_land_characteristics`와 `land_characteristics`의 `pnu`, `land_category_public`(지목명), `land_area_public`(면적), `zoning_public`(용도지역명), `zoning_secondary_public`, `land_use_status_public`(토지이용상황), `terrain_height_public`, `terrain_shape_public`, `road_frontage_public`, `official_land_price_public`, `public_standard_year`, `public_last_updated_at`, `legal_dong_public`, `parcel_number_public`, `public_lookup_date`, `public_data_source`, `vworld_result_total_count`, `vworld_duplicate_candidate_count`에 조회 후보값과 진단 메타데이터를 저장하고, `land_characteristic_crosscheck`에 평가서값과 브이월드 조회값의 비교 메모를 남깁니다. 예시 응답의 지목 `대`, 면적 `479`, 용도지역 `용도미지정`, 이용상황 `단독`, 지형고저 `완경사`, 지형형상 `사다리형`, 도로접면 `세로한면(불)`, 개별공시지가 `529203`, 기준연도 `2025`, 최종갱신일 `2026-03-26`은 검토 보강자료로 정규화됩니다. 이때 평가서 지목·이용상황·용도지역 값은 유지됩니다.
8. VWorld API Key 누락, 지번주소 분리 실패, PNU 후보 부족, 복수 후보, CORS/브라우저 차단, HTTP 오류, XML 파싱 실패, JSON 파싱 실패, 브이월드 API 오류, 응답값 없음, `response.totalCount === "0"` 또는 `landCharacteristicss.totalCount === "0"`인 결과 없음 응답은 `NEEDS_MANUAL_INPUT`, `PNU_CANDIDATE_REQUIRED`, `MULTIPLE_CANDIDATES`, `API_LOOKUP_FAILED`, `VWORLD_NO_RESULT`, `NO_RESULT_FOR_YEAR` 등으로 표시하고 기존 **공적자료 수동 보강** 입력·붙여넣기 fallback을 사용합니다.
9. 브라우저 `fetch()`가 CORS/도메인 문제로 막히면 필지 카드의 **원문 요청 URL 보기** 접힘 영역을 열어 화면 표시용 마스킹 URL을 확인합니다. **새 탭에서 VWorld 원문 열기**와 **원문 URL 복사(key 포함)**는 현재 입력한 키를 URL에 포함하지만 저장하지 않습니다. **key 포함 URL 공유 금지** 안내처럼 인증키가 들어간 URL은 외부 공유·문서 저장·이슈 첨부를 하지 않습니다.
10. 새 탭에서 받은 JSON/XML 원문은 **VWorld 응답 붙여넣기** textarea에 그대로 붙여넣고 **붙여넣은 VWorld 응답 반영**을 누릅니다. 이 paste fallback은 `landCharacteristicss.field`, `landCharacteristicss.fields`, `landCharacteristics.field`, `landCharacteristics.fields`, `response.result.items`, `response.result.item`, `response.result.featureCollection.features`, `response.result`, `result.items`, `result.item`, `items`, `item`, `features`, 단일 객체 응답을 후보 경로로 탐색하고, XML은 `DOMParser`로 `item`/`items`/`field`/`result`/`response` 하위 노드를 대소문자 차이를 허용해 읽습니다. `landCharacteristicss.field`가 배열이면 전체 항목을 후보로, 단일 객체이면 1건 후보로 읽습니다. `resultCode`가 비어 있어도 `field` 후보와 매핑값이 있으면 성공 응답으로 처리합니다. 같은 PNU와 같은 `stdrYear` 후보가 여러 건이면 동일 PNU/기준연도 최신 `lastUpdtDt` 우선 규칙으로 선택하고, “동일 PNU/기준연도 후보 2건 중 lastUpdtDt 최신값 2026-03-26 항목을 우선 반영”처럼 중복 후보가 있었음을 진단에 남깁니다. `response.totalCount` 또는 `landCharacteristicss.totalCount`가 `"0"`이고 `resultCode`가 비어 있으면 API 실패가 아니라 결과 없음(`VWORLD_NO_RESULT`/`NO_RESULT_FOR_YEAR`)으로 분리하며 “조회는 성공했지만 해당 기준연도/PNU 조건의 토지특성 결과가 없습니다. 기준연도를 2025, 2024 등으로 바꿔 다시 조회해보세요.” 안내를 표시합니다. 성공 시 `public_land_characteristics`와 `land_characteristics`에 검토 보강자료로만 반영하며, 파싱 실패 시 `JSON_PARSE_FAILED`, `XML_PARSE_FAILED`, `NO_ITEM_FOUND`, `FIELD_MAPPING_FAILED`, `UNSUPPORTED_RESPONSE_SHAPE` 중 가능한 사유와 수동입력 fallback을 표시합니다.
11. 붙여넣기 영역 아래 **응답 구조 미리보기 / 파싱 진단**에는 응답 형식(JSON/XML/알 수 없음), 응답 root(`landCharacteristicss` 또는 `response`), 최상위 키 목록, `resultCode`, `resultMsg`, `totalCount`, 기준연도, field 후보 개수, item 후보 개수, 후보 경로, 동일 PNU/기준연도 중복 후보 개수, 선택된 후보의 `lastUpdtDt`, 결과 없음 여부, 추천 재조회 연도, 매핑 성공 필드, 누락 필드, 중복 후보 처리 기준, 실패 사유, 수동입력 fallback 안내가 표시됩니다. 붙여넣은 원문 또는 URL에 `key=`/`apiKey=`가 있으면 “붙여넣은 응답 또는 URL에 API Key가 포함되어 있을 수 있습니다. 외부 공유 전 제거하세요.” 경고를 띄우며, key/apiKey 값은 저장 JSON에 포함하지 않습니다.
12. 브라우저에서 조회가 차단될 수 있으며, 이 경우 수동 보강을 사용합니다. 조회 실패 메시지와 **수동입력으로 계속 진행** 버튼이 표시되면 동일 화면에서 수동 조회값을 입력하거나 붙여넣고 **수동 보강값 반영**으로 이어갑니다. 원문 문서와 VWorld API Key는 외부 서버에 저장하지 않습니다.

### 실제 API 수동 테스트 절차

브이월드 토지특성 조회는 실제 브라우저 환경, 브이월드 키 권한, CORS 정책에 따라 성공·실패가 달라질 수 있습니다. 브라우저에서 조회가 차단될 수 있으며, 이 경우 수동 보강을 사용합니다. 자세한 런타임 체크리스트와 실제 브라우저 수동 테스트 결과 기록란은 `api_runtime_qa.md`를 함께 확인합니다.

1. `python3 -m http.server 8000` 또는 GitHub Pages에서 `index.html`을 열고 `sample_case_gongju.json`을 적용합니다.
2. **공적자료 상세** → **공적자료 수동 보강** 카드에서 `VWorld API Key`를 현재 세션 입력칸에만 입력합니다. VWorld API Key는 코드, JSON, 문서, 외부 서버에 저장하지 않습니다.
3. 필지별 `브이월드 조회용 PNU 후보`에 단일 PNU를 입력하고 **브이월드 토지특성 조회**를 누릅니다. 버튼 주변의 “브라우저 환경에 따라 조회가 차단될 수 있으며, 이 경우 수동입력을 사용하세요” 안내를 확인합니다.
4. 성공 시 `API_LOOKUP_SUCCESS`, 출처, 조회일자, 검토 보강자료 문구가 표시되는지 확인합니다. 평가서 지목·이용상황·용도지역 값은 유지되어야 합니다.
5. VWorld API Key 미입력, PNU 미입력, 복수 후보, CORS 또는 HTTP 오류, XML 응답 파싱 실패, JSON 응답 파싱 실패, 응답값 없음 상황에서는 `NEEDS_MANUAL_INPUT`, `PNU_CANDIDATE_REQUIRED`, `MULTIPLE_CANDIDATES`, `API_LOOKUP_FAILED` 등 상태와 수동입력 fallback 안내가 표시되는지 확인합니다.
6. CORS/도메인 차단이면 **원문 요청 URL 보기**를 열고 마스킹 URL, **key 포함 URL 공유 금지** 안내, **새 탭에서 VWorld 원문 열기**, **원문 URL 복사(key 포함)** 동작을 확인합니다. 복사 URL에는 key가 포함되므로 QA 기록에는 실제 URL을 남기지 않습니다.
7. 새 탭 응답 JSON/XML을 **VWorld 응답 붙여넣기**에 넣고 **붙여넣은 VWorld 응답 반영**을 눌러 paste fallback이 `public_land_characteristics`/`land_characteristics` 검토 보강자료로만 반영되는지 확인합니다.
8. **응답 구조 미리보기 / 파싱 진단**에서 최상위 키 목록, item 후보 개수, 매핑 성공 필드, 누락 필드, 실패 사유가 표시되는지 확인하고, `key=` 또는 `apiKey=`가 포함된 붙여넣기 입력은 API Key 경고가 표시되며 저장 JSON에는 남지 않는지 확인합니다.
9. 실패 뒤에도 같은 카드에서 **수동입력으로 계속 진행** 버튼, 수동 입력칸, 붙여넣기 영역을 사용해 **수동 보강값 반영** 및 **검수 완료 표시**로 이어지는지 확인합니다.

- 기준연도별 값 차이를 보존하기 위해 `public_standard_year`, `public_last_updated_at`, `public_data_source`, `public_lookup_date`, `vworld_result_total_count`, `vworld_duplicate_candidate_count`를 조회 후보와 함께 유지합니다. 같은 PNU 9999999999100780001도 2024년 계획관리지역/부정형/516112, 2025년 용도미지정/사다리형/529203, 2026년 totalCount=0처럼 다를 수 있으므로 단순 최신값으로 설명하지 않습니다.

## PR-29A 평가서 추출 작업 큐

실사용자 워크플로우는 **평가서 업로드 → 평가서 법리·평가 원리·산식 구조 해석 → 의견서 작성 필수 텍스트 및 표 추출 → 편입토지 상세 생성 → 공란 특성정보 VWorld 보강 → 법인별 수치 비교 → 쟁점 후보 도출 → 의견서 초안 → 제출검토** 순서입니다.

- 업로드 전 사용자는 **원본 파일 등록**을 수행하고, 업로드된 평가서는 먼저 텍스트·표 추출 작업 큐에 등록됩니다.
- 비교표준지, 편입토지, 거래사례, 개별요인표, 그 밖의 요인 검토에 필요한 정보를 먼저 갈무리합니다.
- VWorld 보강은 편입토지 상세 생성 후 공란 특성정보를 보완하는 단계입니다.
- 업로드 후 바로 VWorld 보강이 아니라 평가서 해석·추출이 먼저입니다.
- 이번 화면은 자동 판단이 아니라 해석·추출 작업을 시작하기 위한 검토 큐입니다.

평가서 추출 작업 큐에는 파일명, 파일 크기, 업로드 시각, 평가법인 입력 또는 미지정, 추출 상태, 업로드 후 **다음 작업**을 표시합니다. 상태값은 `UPLOADED`, `TEXT_EXTRACTION_PENDING`, `TEXT_EXTRACTED`, `OCR_REQUIRED`, `EXTRACTION_FAILED`, `NEEDS_REVIEW`를 사용합니다. 사용자는 **평가서 해석 시작** 또는 **텍스트 추출 시작** CTA로 `텍스트 추출 대기` 상태를 확인하고, 다음 작업으로 **OCR 필요 여부 확인** 및 수동 검수를 진행합니다. 실제 고정밀 해석·OCR 엔진은 이번 범위에 포함하지 않으며, 추출값은 검토 보조자료로 다루고 전문가 검토 필요 상태를 유지합니다.

### PR-29B: 평가서 PDF 텍스트 추출 미리보기

PR-29B는 PR-29A의 **평가서 추출 작업 큐** 다음 단계로, 텍스트 기반 PDF에 대해 기존 PDF.js textContent 흐름을 재사용해 **텍스트 추출 미리보기**를 시도하는 단계입니다. `TEXT_EXTRACTED`, `OCR_REQUIRED`, `EXTRACTION_FAILED`, `MANUAL_TEXT_PASTE`, `NEEDS_REVIEW` 상태를 통해 원문 검토 후보를 분리합니다.

- 텍스트 기반 PDF는 페이지별 텍스트를 읽어 페이지 수, 추출 텍스트 길이, 추출 방식, 상태를 `00_extract_staging` 후보로 저장하되, 기본 화면에는 page_texts, preview_text, raw_text_snippet 원문 덩어리를 펼쳐 노출하지 않습니다.
- 화면에는 **문서 구성 요약 카드**로 페이지 수, 텍스트 확인 페이지, 원문 노출 방식, 다음 작업을 먼저 보여주고, 원문은 접힘/스크롤 패널에서만 검토합니다.
- 텍스트 추출 결과는 원문 검토용 후보이며, 자동 확정값이 아닙니다.
- 이미지 기반 PDF는 OCR_REQUIRED로 분리하고, 앱 내부 OCR 작업대에서 OCR 후보를 생성·검수하도록 안내합니다. 기존 표현인 “이미지 기반 PDF는 OCR_REQUIRED” 상태는 유지합니다.
- 추출 실패 또는 원본 File 객체가 없는 경우에는 앱 내부 OCR 작업대를 먼저 사용하고, 외부 OCR 결과 가져오기는 고급 fallback으로만 사용합니다. fallback 저장 시 `source_type = MANUAL_TEXT_PASTE`, `review_status_code = NEEDS_REVIEW`로 유지합니다.
- 비교표준지, 편입토지, 거래사례, 개별요인표, 그 밖의 요인 검토 정보는 다음 단계에서 후보로 갈무리합니다.
- VWorld 보강은 편입토지 상세 생성 후 공란 특성정보를 보완하는 단계입니다.
- 필수정보 후보 추출은 PR-29C 이후 단계이며, PR-29B의 추출 결과는 수동 검수 전 확정값이 아닙니다.

### PR-29C: 필수정보 후보 추출

PR-29C는 `00_extract_staging`에 저장된 `TEXT_EXTRACTED` 또는 `MANUAL_TEXT_PASTE` 평가서 원문 텍스트 후보를 입력으로, 의견서 작성에 필요한 **필수정보 후보 추출**을 수행하는 단계입니다. 후보값은 자동 확정값이 아닙니다. 모든 결과는 `NEEDS_REVIEW` 수동검수 대기 상태로 남기며, `AUTO_CANDIDATE` 또는 `LOW_CONFIDENCE` 생성 상태와 함께 원문 근거를 보존합니다.

- 필수정보 후보 추출은 평가서 원문에서 의견서 작성에 필요한 검토 항목을 찾는 단계입니다.
- 후보값은 자동 확정값이 아니며, 수동검수 후 반영해야 합니다.
- 비교표준지, 편입토지, 거래사례, 개별요인표, 그 밖의 요인 검토 정보는 후보로만 표시됩니다.
- 후보 유형은 사건/평가 기본정보 후보, 편입토지 후보, 비교표준지 후보, 거래사례 후보, 개별요인표 후보, 그 밖의 요인 후보, 수치 후보로 나누어 compact 후보 테이블에 표시합니다.
- 후보 테이블은 추출값·신뢰도·검토상태·다음 작업을 우선 표시하고, 원문 근거는 접힘/스크롤 패널로 열어 수동 검수합니다.
- 수동검수 후 편입토지 상세/표준지/사례/개별요인 구조로 반영해야 하며, 평가액·단가·면적·공시지가 등 주요 수치도 자동 확정하지 않습니다.
- PR-29D 이후 편입토지 상세 생성 및 VWorld 공란 보강으로 연결됩니다. VWorld 보강은 편입토지 상세 후보가 검수된 후 공란 특성정보를 보완하는 단계입니다.

### PR-29D: 후보 검수·구조화

PR-29D는 PR-29C에서 생성한 `00_extraction_candidates`를 입력으로 사용하는 **후보 검수·구조화** 단계입니다. 후보 검수·구조화는 원문 후보를 실무 검토용 초안 데이터로 정리하는 단계입니다. 후보값은 자동 확정하지 않고, 사용자가 행별로 수동 검수·수동 수정·반영 보류·구조화 초안 반영을 선택한 경우에만 draft/staging 구조로 승격합니다.

- 구조화 초안은 감정평가 결과나 법률 판단의 확정값이 아닙니다.
- 후보값은 초안 데이터로만 승격되며 stable16 본 데이터 직접 덮어쓰기 없음 원칙을 유지합니다.
- 후보 상태는 `NEEDS_REVIEW`, `MANUAL_EDITED`, `CONFIRMED`, `REJECTED`, `LOW_CONFIDENCE`로 표시합니다. `CONFIRMED`도 실무 검수 완료 후보일 뿐 감정평가 확정값이 아닙니다.
- 편입토지 후보와 단가·평가액 등 수치 후보는 `draft_land_details`의 **편입토지 상세 초안**으로만 저장하고, 도로접면·형상·지세·이용상황 등 공란은 `blank_field_flags`와 `next_action = "VWorld 공란 보강 대기"`로 표시합니다.
- 비교표준지는 평가 기준이고, 거래사례는 그 밖의 요인 검토용 참조자료입니다. `STANDARD_LAND`는 `standard_land_draft_candidates`, `TRANSACTION_CASE`는 `transaction_case_draft_candidates`로 분리해 표준지와 거래사례를 혼동하지 않습니다.
- 기타조건은 개별요인 비교의 하위 항목이며, 그 밖의 요인 보정률 자체가 아닙니다. `SUBJECT_TO_STANDARD_FACTOR`는 `subject_to_standard_factor_draft_candidates`, `CASE_TO_STANDARD_FACTOR`는 `case_to_standard_factor_draft_candidates`, `OTHER_FACTOR`는 `other_factor_draft_candidates`로 분리합니다.
- 승격 row는 `draft_id`, `source_candidate_id`, `source_file_name`, `target_entity_type`, `parsed_value`, `raw_text_snippet`, `review_status_code`, `promoted_at`, `next_action`을 포함합니다.
- 편입토지 상세 초안의 공란이 VWorld 보강 대상으로 이어지며, PR-29E 이후 VWorld 공란 보강과 법인별 비교 연결 예정입니다. VWorld 보강은 후보 검수·구조화 이후 단계로 유지합니다.

## PR-29F 법인별 수치 비교 매트릭스

PR-29F는 평가서 업로드, 텍스트 추출, 필수정보 후보 추출, 후보 검수·구조화, 편입토지 상세 초안 생성, VWorld 공란 보강 다음에 이어지는 **법인별 수치 비교 매트릭스** 단계입니다.

- 법인별 수치 비교는 평가서에서 추출·검수된 후보값을 나란히 보여주는 검토 보조 화면입니다.
- 수치 차이는 보상금 증액 가능성이나 평가 오류를 의미하지 않습니다.
- 차이가 큰 항목은 원문·산식·개별요인표를 수동검수해야 합니다.
- VWorld 보강값은 토지특성 검토 보강자료이며 평가액 산정값을 대체하지 않습니다.
- 그 밖의 요인과 기타조건을 혼동하지 않도록 구분해 표시합니다.
- 비교 매트릭스는 `appraisal_company_comparison_matrix`와 `draft_land_appraisal_comparisons` draft/staging 구조에 저장되며, 기존 본 데이터인 `land_appraisal_results` 또는 `comparison_summary_by_land`를 직접 덮어쓰지 않습니다.
- PR-29G 이후에는 차이 검토 결과를 쟁점 후보로 연결할 예정입니다. 이 단계에서도 쟁점은 확정이 아니라 검토 보조용 후보로만 다룹니다.

## PR-29G 수치 비교 기반 쟁점 후보 연결

PR-29G는 PR-29F의 법인별 수치 비교 결과를 **수치 비교 기반 쟁점 후보**로 연결하는 단계입니다. 이 단계는 `appraisal_company_comparison_matrix`와 `draft_land_appraisal_comparisons`를 입력으로 사용하고, 기존 `issue_candidates`를 직접 덮어쓰지 않으며 선택·검수 전 후보를 `draft_issue_candidates`에 저장합니다.

- 쟁점 후보는 평가상 문제나 위법성을 확정하는 판단이 아닙니다.
- 수치 차이는 검토 단서이며, 보상금 증액 가능성을 의미하지 않습니다.
- 개별요인과 그 밖의 요인은 구분해 검토해야 합니다.
- VWorld 보강값은 토지특성 검토 보강자료이며 평가액 산정값을 대체하지 않습니다.
- `INFO`, `LAND`, `STD`, `COMP`, `IND`, `OTH`, `VWORLD`, `VALUE_COMPARE`, `EVD`, `RISK` issue_type_code로 후보 원인을 구분합니다.
- A~C등급 후보만 의견서 보조문안 단계로 넘기고, D등급은 반영 보류합니다.
- `source_ref_ids`, `source_file_name`, `source_type`을 남겨 이후 사용자가 선택·검수한 후보를 기존 `issue_candidates`와 연결할 수 있게 합니다.
- D등급 또는 사실 부족 항목은 반영 보류하고, 금지표현 경고를 함께 표시합니다.
- PR-29H 이후 의견서 보조문안 생성과 연결 예정이며, PR-29G에서는 기존 `draft_sentences`를 직접 생성하지 않습니다.

### PR-30A: 모바일 워크플로우 및 UX 안정화

PR-30A는 신규 기능 추가가 아니라 모바일 워크플로우 및 UX 안정화 단계입니다. 평가서 업로드 → 추출 상태 확인 → OCR 필요 여부 확인 → 후보 검수·구조화 → VWorld 보강 → 수치 비교 → 쟁점 후보 흐름에서 사용자가 다음 작업을 잃지 않도록 정리합니다.

- 업로드 전/후 CTA를 분리합니다. 업로드 전에는 **원본 파일 등록**을 중심으로 표시하고, 업로드 후에는 반복되는 시작 CTA 대신 **다음 작업** 카드만 주요 CTA로 사용합니다.
- 업로드 후에는 **다음 작업**이 primary CTA로 표시됩니다. 원본 파일 추가·교체는 **원본 추가·교체** secondary support card로 유지되어 평가서 파일 추가와 **구조화 JSON 불러오기** 보조 경로를 제공합니다.
- 시작하기 CTA는 반복하지 않지만 원본 등록 기능은 사라지지 않음: 기존 원본 등록 기능은 숨기지 않고 support card 위계로 낮춰 추가 등록, 잘못 올린 파일 교체, 다른 평가법인 평가서 추가를 계속 처리합니다.
- 진행상태는 실제 저장 데이터 기준으로 계산합니다. 업로드 파일, 추출 상태, 후보·초안·검토자료, VWorld 보강 대기, 쟁점 후보 수를 기준으로 표시하며 완료 표시는 자동 확정값을 의미하지 않습니다.
- 모바일에서는 파일별 테이블을 카드형 리스트로 표시합니다. 파일명, 평가법인명 또는 미지정, 추출 상태, OCR 필요 여부, 후보 수, 검토 필요 수, 다음 작업, primary action 1개를 먼저 보이게 합니다.
- `OCR_REQUIRED`는 내부 OCR 작업대가 우선입니다. 외부 OCR은 고급 fallback이며, Gemini 등 외부 OCR 결과 import는 앱 내 OCR 시도 후 사용하는 보조 경로로만 안내합니다.
- 디자인 시스템은 **Primary / Support / Notice card** 기준으로 정리합니다. Primary는 현재 단계 핵심 작업, Support는 보조 정보, Notice는 주의·검토 필요 안내에 사용합니다.

PR-30A부터 업로드 후 화면은 **평가서 해석·추출 진행상태**를 먼저 확인하고, 상태에 맞는 **다음 작업**으로 이동하는 방식으로 정리합니다.

PR-30A-2에서는 원본 등록 탭과 overview 첫 화면의 렌더 우선순위를 고정합니다.

- 원본 등록 탭의 첫 화면은 사건 요약보다 작업 진입 카드가 우선함을 기준으로 합니다.
- 업로드 전에는 **원본 파일 등록**이 최상단에 표시됩니다.
- 업로드 후에는 **다음 작업**과 **평가서 해석·추출 진행상태**가 최상단에 표시됩니다.
- **원본 추가·교체**는 업로드 후 support card로 유지되며 사건 요약보다 위에 배치됩니다.

PR-30A 운영 문구: OCR_REQUIRED는 내부 OCR 작업대 우선 상태이며, 외부 OCR은 고급 fallback입니다.

### PR-30B-1: 파일 선택 input 연결 복구

PR-30B-1은 PR-30B 전체 구현이 아니라 모바일 첫 화면의 **파일 선택** 버튼과 실제 업로드 `input[type=file]` 연결을 복구하는 단계입니다.

- 업로드 전 **원본 파일 등록**의 **파일 선택**과 업로드 후 **원본 추가·교체**의 **평가서 파일 추가**는 모두 같은 업로드 큐(`document_uploads`)와 `registerUploadedPdfFiles()` 흐름에 연결됩니다.
- 파일 선택 후에는 **파일이 등록되었습니다** 상태를 표시하고, 화면은 업로드 큐 기준의 **다음 작업** 상태로 갱신됩니다.
- 추가 등록된 파일도 자동 확정값이 아니며, 텍스트 추출과 수동검수가 필요합니다.

### PR-30B-2: 업로드 후 추출 결과 화면 UX 핫픽스

PR-30B-2는 신규 기능 추가가 아니라 PR-30B-1 이후 확인된 업로드 후 화면 혼선을 줄이는 UX 핫픽스입니다.

- PR-30B-2는 업로드 후 **원본 파일 등록** 카드 반복 노출과 `TEXT_EXTRACTED` 결과 화면의 혼선을 정리하는 UX 핫픽스입니다.
- 업로드 후에는 **등록된 평가서** 또는 **다음 작업** 카드가 우선 표시되며, 원본 추가·교체는 support card 경로로만 유지됩니다.
- `TEXT_EXTRACTED` 상태에서는 **필수정보 후보 추출**이 primary action입니다.
- **수동 텍스트 입력**과 **외부 OCR 결과 가져오기 (고급)** fallback은 `OCR_REQUIRED`/`EXTRACTION_FAILED` 또는 고급 경로에서만 노출됩니다.
- 등록된 파일은 자동 확정값이 아니며, 텍스트 추출과 수동검수를 거쳐 후보값으로 정리됩니다.

## PR-30B-3 텍스트 추출 상태/CTA 및 모바일 후보 카드

PR-30B-3는 신규 기능 추가가 아니라 텍스트 추출 상태/CTA 명확화와 모바일 후보 카드 전환 작업입니다. 업로드 직후에는 **텍스트 추출 대기** 상태와 **텍스트 추출 시작** CTA를 표시하고, 추출 실행 직후에는 **텍스트 추출 중…** 상태로 PDF.js 텍스트 레이어와 OCR 필요 여부 확인 중임을 안내합니다.

`TEXT_EXTRACTED` 후에는 **필수정보 후보 추출**이 primary action입니다. 이 상태의 추출 텍스트는 검토 전 후보이며, 수동 텍스트 입력·외부 OCR/Gemini importer·raw JSON paste는 기본 화면에 노출하지 않고 필요한 경우 접힘형 고급 fallback에서만 확인합니다.

필수정보 후보 추출 후 데스크톱에서는 기존 후보 table 흐름을 유지하고, 모바일에서는 후보 테이블 대신 **카드형 리스트**를 우선 표시합니다. 모바일 후보 카드는 후보값, 근거 보기, 신뢰도(높음/보통/낮음), 검토상태(검수 필요 등), 다음 작업: 수동검수를 짧게 보여주며 원문 대조 후 반영 여부를 결정하는 검토 전 후보 맥락을 유지합니다.

외부 OCR/Gemini는 고급 fallback이며 `TEXT_EXTRACTED` 기본 화면에 노출하지 않습니다. `OCR_REQUIRED` 또는 `EXTRACTION_FAILED` 상태에서는 앱 내 OCR 작업대 이동 또는 수동 텍스트 입력을 우선하고, 외부 OCR 결과 가져오기 (고급)는 접힘 영역에서만 안내합니다.
