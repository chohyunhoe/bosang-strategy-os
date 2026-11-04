# VWorld 일괄조회 큐 + 로컬 프록시 설계

문서 파일명: `vworld_batch_lookup_design.md`

## 1. 작업 목적

이 문서는 보상전략 OS의 core workflow 중 4단계인 **평가서에 없는 편입토지정보를 VWorld로 자동 보강**하는 흐름을 100~200필지 실무 처리에 맞게 확장하기 위한 설계 기준입니다. 현재 단건 PNU 조회, CORS/브라우저 차단 시 원문 URL 새 탭 열기, JSON/XML 응답 붙여넣기 fallback은 검증용·소량 처리용으로 유지합니다. 다만 200필지 실무에서는 반복 조회, 실패 추적, 기준연도 관리, 결과 JSON 반영이 필요하므로 별도 일괄조회 큐와 로컬 프록시 운영 구조를 둡니다.

PR-24는 실제 Node.js 프록시 구현이 아니라 설계 문서화였습니다. PR-25에서는 설계 기준에 따라 로컬 실행 스크립트 [`scripts/vworld_batch_lookup.js`](scripts/vworld_batch_lookup.js)를 추가합니다. `index.html`의 기존 단건 VWorld 조회, 원문 붙여넣기 fallback, 수동입력 fallback은 삭제하지 않습니다.

## 2. 역할별 검토

### GPT 역할 — 총괄 PM / 범위 통제

- 이번 설계는 최상위 실무 플로우의 4단계인 VWorld 자동 보강을 200필지 운영 가능한 구조로 확장합니다.
- 실제 Node.js 프록시, 서버리스 함수, 대규모 UI 개편은 이번 PR 범위가 아니므로 MVP 범위를 벗어나지 않습니다.
- stable16 기준선의 데이터 키, `data-section`, 렌더 함수, 단건 조회와 paste fallback은 그대로 보존합니다.
- VWorld 조회값은 검토 보강자료이며 평가서값을 자동 덮어쓰지 않도록 설계합니다.
- 감정평가 대체, 법률자문 확정, 보상금 증액 가능성 단정 표현을 사용하지 않습니다.

### Gemini 역할 — UX / 데이터 구조 설계

- 실무자는 평가서 업로드 후 `lands` 또는 PNU 목록을 기준으로 기준연도 `stdrYear`를 지정하고, 외부 일괄조회 도구에서 결과 JSON을 만든 뒤 보상전략 OS에 import하는 순서로 이동합니다.
- 단일 HTML 앱셸은 유지하고, 100~200필지 네트워크 처리는 로컬 프록시가 담당합니다.
- 성공/결과없음/실패/수동입력 필요 상태를 명시해 검토자가 필지별 후속 작업을 확인할 수 있게 합니다.
- 결과 JSON은 `public_land_characteristics`, `public_land_data_enrichment`, `land_characteristics`, `land_characteristic_crosscheck`에 반영 가능한 정규화 필드 중심으로 설계합니다.
- 모바일/데스크톱 화면에서는 대량 네트워크 실행 버튼보다 import된 결과의 상태 요약, 필지별 검수, 실패 필지 fallback 연결을 우선합니다.

### Claude 역할 — 문구 / 안전 표현

- 문서 전반에서 VWorld 조회값은 “검토 보조”, “보강자료”, “쟁점 후보 생성 단서”로 표현합니다.
- 실패 필지는 “수동 검수”, “수동입력 fallback”, “전문가 검토 필요”로 연결합니다.
- 조회 성공을 공적 사실 확정으로 설명하지 않고, 기준연도와 출처가 다른 자료로 구분합니다.
- 개인정보 원문, API Key, 원문 VWorld 응답 전체를 저장하거나 장기 보관하는 전제를 두지 않습니다.

### Perplexity 역할 — 외부 리서치 필요 여부

- 최신 VWorld API endpoint, 호출 제한, 과금·쿼터, API Key 발급 정책, CORS 정책은 변경될 수 있으므로 실제 구현 전 별도 리서치 필요입니다.
- 이 문서는 endpoint나 정책을 확정하지 않고, 일괄조회 운영 구조와 보안 원칙만 정의합니다.

## 3. 200필지 기준 운영 문제 정리

단건 브라우저 조회는 1~3필지 데모에는 충분하지만, 100~200필지 실무에서는 다음 문제가 발생합니다.

1. **반복 입력 비용**: PNU, 기준연도, API Key를 필지마다 입력하면 검토 시간이 과도하게 증가합니다.
2. **CORS/브라우저 차단**: 브라우저 직접 호출은 CORS, referer/domain 제한, mixed content, 확장 프로그램 차단 등 환경 차이가 큽니다.
3. **API Key 노출 위험**: 브라우저 URL, 개발자 도구, 복사한 원문 요청 URL에 key가 노출될 수 있습니다.
4. **실패 추적 곤란**: 200필지 중 성공/결과없음/실패/재시도 대상이 섞이면 수동 표기가 어렵습니다.
5. **기준연도 혼선**: `stdrYear`가 필지별로 다르거나 재조회 시점이 다르면 비교 기준이 흐려질 수 있습니다.
6. **중복 후보 검수 필요**: 같은 PNU·기준연도 조회에서 복수 후보가 반환되면 `vworld_duplicate_candidate_count`와 수동 검수가 필요합니다.
7. **원문 응답 저장 위험**: 원문 VWorld 응답 전체를 장기 저장하면 불필요한 개인정보·운영 로그·key 포함 문자열 보관 위험이 커집니다.
8. **평가서값 덮어쓰기 위험**: 대량 import가 평가서 원문값을 자동 수정하면 출처 구분과 검토 보조 원칙이 훼손됩니다.
9. **수동 fallback 연결 필요**: PNU 누락, PNU 형식 오류, 결과없음, 조회 실패는 수동입력 또는 원문 붙여넣기 fallback으로 자연스럽게 이어져야 합니다.

## 4. 방식 비교

| 방식 | 장점 | 한계 | 권장 용도 |
| --- | --- | --- | --- |
| 단건 브라우저 조회 | 현재 앱에서 즉시 검증 가능, 소량 데모에 적합 | 200필지 반복 불가, CORS/도메인 차단, 키 노출 위험 | 1~3필지 검증, 오류 재현 |
| 브라우저 batch 조회 | 별도 서버 없이 버튼 하나로 시도 가능 | CORS, 도메인, 요청 제한, 키 노출 문제가 누적되고 브라우저 탭 중단에 취약 | 권장하지 않음 |
| 로컬 Node.js 프록시 | CORS 회피, `.env` 또는 세션 입력으로 key 관리, 재시도·로그·export 통제 가능 | 별도 로컬 실행 절차와 구현 필요 | **최종 권장안** |
| 서버리스 함수 | 배포 후 팀 공유가 쉬움, 브라우저 CORS 부담 감소 | API Key 서버 보관, 접근통제, 실무자료 원문 클라우드 전송·저장 전제가 생길 수 있음 | 기관 보안 검토 후 선택 가능 |
| 수동 붙여넣기 유지 | CORS 차단 시 검증 가능, 단건 실패 복구 가능 | 100~200필지 처리에는 비효율적 | fallback 유지 |

## 5. 최종 권장안: 로컬 Node.js 프록시 + 결과 JSON 반영

최종 권장 구조는 **로컬 Node.js 프록시 + 결과 JSON 반영**입니다.

- 브라우저 직접 batch는 CORS, 도메인, 요청 제한, 키 노출 문제가 있습니다.
- 로컬 프록시는 CORS를 회피하고 VWorld API Key를 로컬 `.env` 또는 세션 입력으로 관리할 수 있습니다.
- 200필지 조회 시 성공/실패/재시도 로그 관리가 가능합니다.
- 결과 JSON만 보상전략 OS에 업로드하면 되므로 단일 HTML 구조를 유지할 수 있습니다.
- 실무자료 원문을 외부 서버에 저장하지 않는 운영이 가능합니다.
- 보상전략 OS는 결과 JSON을 검토 보강자료로 import하고, 평가서값은 자동 덮어쓰지 않습니다.

## 6. 일괄조회 데이터 흐름

1. **입력 준비**
   - 보상전략 OS의 `lands` 배열 또는 별도 PNU 목록 CSV/JSON을 기준으로 `land_id`, `pnu`, `parcel_address`를 준비합니다.
   - 기준연도 `stdrYear`를 일괄 지정합니다. 필요한 경우 같은 사건에서 연도별 batch를 분리합니다.
2. **키 입력**
   - VWorld API Key는 저장소, 결과 JSON, README, 로그에 저장하지 않습니다.
   - 로컬 프록시 실행 시 `.env` 또는 실행 세션 입력으로만 사용합니다.
3. **큐 생성**
   - 각 필지는 최초 `BATCH_PENDING` 상태로 큐에 들어갑니다.
   - PNU가 없으면 `PNU_MISSING`, 형식이 맞지 않으면 `PNU_INVALID`로 분기하고 VWorld 조회를 수행하지 않습니다.
4. **VWorld 조회**
   - 유효한 PNU는 `BATCH_RUNNING` 상태로 전환한 뒤 VWorld API를 조회합니다.
   - 최신 endpoint, 호출 제한, 응답 구조는 구현 전 리서치 필요입니다.
5. **상태 분류**
   - 정상 매핑: `VWORLD_LOOKUP_SUCCESS`
   - 응답은 성공했으나 결과 없음: `VWORLD_NO_RESULT`
   - 네트워크, API, 파싱 실패: `VWORLD_LOOKUP_FAILED`
   - 후속 수동입력 필요: `MANUAL_INPUT_REQUIRED`
   - 중복 후보 또는 출처 차이 확인 필요: `NEEDS_REVIEW`
   - 담당자 검수 완료: `CONFIRMED`
6. **결과 JSON export**
   - 원문 VWorld 응답 전체를 장기 저장하지 않고, 필요한 정규화 필드와 상태·진단 요약만 저장합니다.
   - API Key, key 포함 요청 URL, 민감 원문 로그는 결과 JSON에 포함하지 않습니다.
7. **보상전략 OS import**
   - 결과 JSON은 `public_land_data_enrichment`와 `public_land_characteristics`에 반영 가능한 보강자료로 import합니다.
   - 평가서값은 자동 덮어쓰지 않고, 출처별 비교와 수동 검수 상태를 유지합니다.
8. **fallback 연결**
   - `PNU_MISSING`, `PNU_INVALID`, `VWORLD_NO_RESULT`, `VWORLD_LOOKUP_FAILED`, `MANUAL_INPUT_REQUIRED` 필지는 기존 수동입력 fallback 또는 원문 붙여넣기 fallback으로 연결합니다.

## 7. 상태값 기준

| 상태값 | 의미 | 후속 조치 |
| --- | --- | --- |
| `BATCH_PENDING` | 큐에 등록되었으나 아직 조회 전 | 조회 대기 |
| `BATCH_RUNNING` | 로컬 프록시가 조회 중 | 중복 실행 방지 |
| `VWORLD_LOOKUP_SUCCESS` | 정규화 필드 매핑 성공 | 검토 보강자료로 표시 |
| `VWORLD_NO_RESULT` | 조회 성공이나 결과 없음 | 기준연도/PNU 재확인 또는 수동입력 |
| `VWORLD_LOOKUP_FAILED` | 네트워크/API/파싱 실패 | 재시도 또는 fallback |
| `PNU_MISSING` | PNU 누락 | 수동 PNU 입력 필요 |
| `PNU_INVALID` | PNU 형식 오류 | PNU 정정 필요 |
| `MANUAL_INPUT_REQUIRED` | 자동 조회만으로 보강 불가 | 수동입력 fallback |
| `NEEDS_REVIEW` | 중복 후보, 연도 차이, 출처 차이 검수 필요 | 수동 검수 |
| `CONFIRMED` | 담당자 검수 완료 | 제출 전 전문가 검토 필요 |

## 8. 일괄조회 결과 JSON 스키마 초안

아래 스키마는 보상전략 OS에 import할 정규화 결과의 초안입니다. 실제 VWorld 원문 응답 전체, API Key, key 포함 요청 URL은 포함하지 않습니다.

```json
{
  "case_id": "CASE_SAMPLE",
  "lookup_batch_id": "VWORLD_BATCH_001",
  "source": "VWorld",
  "stdrYear": "2025",
  "lookup_created_at": "2026-05-12T00:00:00+09:00",
  "results": [
    {
      "land_id": "LAND_001",
      "pnu": "9999999999100780001",
      "status": "VWORLD_LOOKUP_SUCCESS",
      "public_standard_year": "2025",
      "public_last_updated_at": "2026-03-26",
      "land_category_public": "대",
      "land_area_public": "479",
      "zoning_public": "용도미지정",
      "land_use_status_public": "단독",
      "terrain_height_public": "완경사",
      "terrain_shape_public": "사다리형",
      "road_frontage_public": "세로한면(불)",
      "official_land_price_public": "529203",
      "vworld_result_total_count": "2",
      "vworld_duplicate_candidate_count": 2,
      "review_status_code": "NEEDS_REVIEW"
    }
  ],
  "errors": [
    {
      "land_id": "LAND_009",
      "pnu": "",
      "status": "PNU_MISSING",
      "message": "PNU가 없어 VWorld 조회를 수행하지 않았습니다."
    }
  ]
}
```

### 필드 원칙

- `case_id`: 보상전략 OS 사건 식별자입니다.
- `lookup_batch_id`: 같은 사건 내 일괄조회 실행 단위를 구분합니다.
- `source`: `VWorld`로 표시하되 조회값은 검토 보강자료입니다.
- `stdrYear`: 일괄조회 기준연도입니다.
- `lookup_created_at`: 결과 JSON 생성 시각입니다.
- `results`: 필지별 정규화 성공 또는 검토 필요 결과입니다.
- `errors`: 조회 미수행, 실패, 수동입력 필요 필지의 요약입니다.
- `review_status_code`: import 후 수동 검수 흐름과 연결되는 상태입니다.

## 8.1 PR-26C crosscheck 연결 단계

보상전략 OS import 화면에서 `VWORLD_LOOKUP_SUCCESS` 행이 `public_land_characteristics`와 `land_characteristics`에 반영된 뒤에는 `updateVWorldBatchImportCrosscheck()`를 호출해 `land_characteristic_crosscheck`를 생성 또는 갱신합니다. 이 단계는 평가서값을 VWorld 조회값으로 덮어쓰는 단계가 아니라, 출처가 다른 값을 분리해 검토 단서로 남기는 단계입니다.

- 대상 상태: `VWORLD_LOOKUP_SUCCESS`만 crosscheck 비교 대상으로 삼습니다. `VWORLD_NO_RESULT`, `VWORLD_LOOKUP_FAILED`, `PNU_MISSING`, `PNU_INVALID`는 crosscheck가 아니라 review queue와 수동입력 fallback에 유지합니다.
- 비교 필드: 지목, 면적, 용도지역, 이용상황, 도로접면, 지형고저, 지형형상, 개별공시지가, 기준연도입니다.
- 보존 필드: `appraisal_value`, `public_data_value`, `source`, `public_standard_year`, `public_last_updated_at`, `review_status_code`를 row 단위로 유지합니다.
- 상태값: `MATCHED`, `DIFFERENT`, `PUBLIC_DATA_MISSING`, `APPRAISAL_VALUE_MISSING`, `NEEDS_REVIEW`를 사용합니다.
- 안전 문구: “차이값은 검토 단서이며 평가상 문제 여부를 단정하지 않습니다.” 및 “원문·공부·현장자료 수동 검수 필요”를 crosscheck 메모와 import summary에 유지합니다.
- 기준연도: VWorld 조회값의 `public_standard_year`를 표시하고, 평가 기준시점과 조회 기준연도를 구분해 검토해야 한다는 안내를 유지합니다.

import 후 summary에는 crosscheck 생성 수, 갱신 수, 검토 필요 수를 표시합니다. 이 숫자는 의견서 초안의 확정 근거가 아니라 수동 검수 우선순위를 잡기 위한 검토 보조 지표입니다.

## 9. 실패·재시도·로그 구조 설계

### 큐 처리 원칙

- 큐 시작 시 모든 대상 필지를 `BATCH_PENDING`으로 기록합니다.
- 조회 직전 `BATCH_RUNNING`으로 전환하고, 완료 후 최종 상태로 변경합니다.
- 동일 `lookup_batch_id`에서 같은 `land_id`·`pnu`·`stdrYear` 조합을 중복 실행하지 않습니다.
- 재시도는 실패 필지 목록만 대상으로 하며, 재시도 횟수와 마지막 오류 요약을 별도로 보관합니다.

### 실패 분류

- 입력 오류: `PNU_MISSING`, `PNU_INVALID`
- API 응답 없음: `VWORLD_NO_RESULT`
- 네트워크/API 오류: `VWORLD_LOOKUP_FAILED`
- 파싱/매핑 오류: `VWORLD_LOOKUP_FAILED` + `message`에 요약
- 자동 보강 불가: `MANUAL_INPUT_REQUIRED`
- 중복 후보·연도 차이: `NEEDS_REVIEW`

### 로그 보관 원칙

- 로그에는 `lookup_batch_id`, `land_id`, PNU 마스킹값, `stdrYear`, 상태, 오류 요약, 재시도 횟수만 남깁니다.
- VWorld API Key는 저장하지 않습니다.
- key 포함 요청 URL은 저장하지 않습니다.
- 원문 VWorld 응답 전체를 장기 저장하지 않습니다.
- 디버깅이 필요한 경우에도 원문은 로컬 임시 파일로만 제한하고, 결과 JSON export 전 제거합니다.

## 10. 개인정보 및 보안 원칙

핵심 운영 문구는 다음과 같습니다. **VWorld API Key는 저장하지 않음**, **원문 VWorld 응답 전체를 장기 저장하지 않음**, **평가서값은 자동 덮어쓰지 않음**을 모든 배치 실행과 결과 JSON 반영의 기본 조건으로 둡니다.

- VWorld API Key는 저장소, JSON, README, 로그에 저장하지 않습니다.
- 원문 VWorld 응답 전체를 장기 저장하지 않습니다.
- 필요한 정규화 필드만 결과 JSON에 저장합니다.
- 조회값은 검토 보강자료로만 표시합니다.
- 평가서값은 자동 덮어쓰지 않습니다.
- 기준연도별 값 차이를 보존합니다.
- 실패 필지는 수동입력 fallback으로 연결합니다.
- 개인정보 원문 클라우드 저장 전제 금지 원칙을 유지합니다.
- 서버리스 함수나 외부 서버를 쓰는 경우에는 API Key 보관, 접근통제, 실무자료 전송·저장 위치에 대한 별도 보안 검토가 필요합니다.

## 11. 보상전략 OS import 반영 기준

- import는 `public_land_data_enrichment`에 batch 메타와 상태를 남기고, `public_land_characteristics`에는 정규화된 공적자료 후보를 추가하는 방향을 권장합니다.
- `land_characteristics`의 평가서 기재값과 VWorld 보강값은 출처를 구분해 비교합니다.
- `land_characteristic_crosscheck`는 지목·현황·도로접면·형상·지세 차이를 쟁점 후보 생성 단서로 연결하되, 확정 판단으로 표시하지 않습니다.
- `NEEDS_REVIEW`, `MANUAL_INPUT_REQUIRED` 필지는 수동 검수 작업으로 남깁니다.
- `CONFIRMED`는 담당자 검수 완료를 의미할 뿐, 제출문 확정이나 전문가 검토 완료를 의미하지 않습니다.

## 12. 구현 범위 메모

이번 문서 PR에서 하지 않는 일은 다음과 같습니다.

- 실제 Node.js 로컬 프록시 구현
- 서버리스 함수 구현
- `index.html` 대규모 수정
- 기존 단건 VWorld 조회 삭제
- 원문 붙여넣기 fallback 삭제
- 기존 데이터 키, 렌더 함수, `data-section` 변경
- API Key 하드코딩
- 원문 응답 전체 저장 전제 도입


## PR-26A~26D 앱 import 구현 요약

- **PR-26A preview**: 앱의 **VWorld batch 결과 JSON import** 카드에서 `output/vworld_results.json`을 붙여넣거나 선택 파일로 불러와 `lookup_batch_id`, `stdrYear`, `lookup_created_at`, `source: VWorld`, 총 results 수와 상태별 건수를 미리 확인합니다. 이 단계에서는 평가서값이나 공적자료 데이터에 아직 반영하지 않습니다.
- **PR-26B 반영**: `VWORLD_LOOKUP_SUCCESS` 행만 `public_land_characteristics` / `land_characteristics`에 `VWORLD_BATCH_IMPORT` 출처의 검토 보강자료로 반영하고, 결과 없음·실패·PNU 누락/오류 행은 `vworld_batch_review_queue`에 남겨 수동입력 fallback으로 연결합니다. 평가서값은 자동으로 덮어쓰지 않습니다.
- **PR-26C crosscheck**: 반영 완료 후 `updateVWorldBatchImportCrosscheck()`가 성공 행만 대상으로 `land_characteristic_crosscheck`를 생성 또는 갱신합니다. 상태값은 `MATCHED`, `DIFFERENT`, `PUBLIC_DATA_MISSING`, `APPRAISAL_VALUE_MISSING`, `NEEDS_REVIEW`로 제한하며, 차이값은 검토 단서입니다.
- **PR-26D summary/QA**: import summary는 총 results 수, 반영 성공 수, 결과 없음 수, 실패 수, PNU 누락/오류 수, crosscheck 생성/갱신 수, 검토 필요 수, 수동입력 필요 수를 표시합니다. import 이력으로 `lookup_batch_id`, `stdrYear`, `lookup_created_at`, `import_created_at`, `source: VWorld`를 남기되 원문 VWorld 응답과 API Key는 저장하지 않습니다.

### 남은 과제

- 실제 브라우저·실제 키 환경의 batch import QA는 `api_runtime_qa.md` 체크리스트에 따라 별도 기록이 필요합니다.
- VWorld 최신 endpoint, 호출 제한, 도메인 정책은 변경될 수 있으므로 운영 전 공식 문서 확인이 필요합니다.
- 결과 없음 또는 실패 행의 재조회 연도 추천과 주소검색 기반 PNU 후보 보강은 수동 검수 흐름을 해치지 않는 범위에서 후속 검토합니다.
- 대량 사건의 개인정보·민감주소 취급 정책과 로컬 산출물 보관 기간은 배포 환경별 운영 기준으로 확정해야 합니다.
