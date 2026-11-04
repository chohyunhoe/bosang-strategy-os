# 브이월드 API 런타임 QA 체크리스트

이 문서는 `index.html`의 브이월드 토지특성 조회 보조 UI가 실제 브라우저 환경에서 어떤 상태로 안내되는지 확인하기 위한 수동 QA 문서입니다. 브이월드 조회값은 확정 사실이 아니라 검토 보강자료이며, 평가서값을 자동 덮어쓰지 않습니다. VWorld API Key는 현재 브라우저 세션 입력값으로만 사용하고 코드·샘플 JSON·외부 서버에 저장하지 않습니다.

## 사전 준비

1. 로컬 정적 서버 또는 GitHub Pages에서 `index.html`을 엽니다. `file://` 직접 실행 시에는 `window.location.hostname`이 비어 있을 수 있으므로 `domain`을 키 등록값에 맞게 직접 입력하고, 브라우저 보안 정책으로 실패할 수 있음을 함께 기록합니다.
2. `sample_case_gongju.json`을 적용한 뒤 **공적자료 상세** 화면의 **공적자료 수동 보강** 카드로 이동합니다.
3. 브라우저 개발자도구 Console/Network 탭을 열어 CORS, HTTP 상태, 응답 본문 형식을 함께 확인합니다.
4. 실제 발급받은 `VWorld API Key`가 있으면 현재 세션 입력칸에만 입력합니다. 키를 문서, JSON, 스크린샷, 커밋에 남기지 않습니다.
5. `domain`은 `window.location.hostname` 자동감지값 또는 키 등록 도메인과 일치하는 직접 입력값을 사용하고, `stdrYear`는 현재연도-1 기본값 또는 검수 대상 기준연도 4자리를 입력합니다. 사용자가 직접 입력한 기준연도는 기본값보다 우선합니다.
6. PNU는 숫자 19자리인지 먼저 확인합니다. PNU가 없고 지번주소가 있으면 주소검색 API(`https://map.vworld.kr/search.do`)로 PNU 후보를 찾되, 후보값은 자동 확정하지 않습니다.


- 본 기능은 브이월드 API Key 입력을 전제로 하며, 키는 세션 입력값으로만 사용하고 코드/JSON에 저장하지 않습니다.
- 브라우저 환경, CORS, 키 권한, 요청 제한에 따라 조회가 실패할 수 있으며, 실패 시 수동입력 fallback을 사용합니다. CORS/도메인 차단이 의심되면 원문 요청 URL 테스트 + paste fallback으로 이어갑니다.

## 체크리스트

- PNU 미입력 시 안내는 숫자 19자리 검증 및 주소검색 후보 흐름과 함께 확인합니다.

| 항목 | 입력/상황 | 기대 상태값·안내 | 수동 fallback 확인 |
| --- | --- | --- | --- |
| VWorld API Key 미입력 시 안내 | `VWorld API Key` 입력칸을 비우고 **브이월드 토지특성 조회** 클릭 | `NEEDS_MANUAL_INPUT`, `MISSING_API_KEY`, “VWorld API Key를 입력하지 않아 수동입력으로 전환” 계열 문구 표시 | 같은 카드의 `PNU`, `공적 지목`, `공적 이용상황` 등 수동 입력칸과 붙여넣기 영역이 계속 사용 가능해야 함 |
| PNU 미입력/19자리 검증 안내 | VWorld API Key는 입력하고 필지별 `브이월드 조회용 PNU 후보`를 비우거나 숫자 19자리가 아닌 값을 입력 | `PNU_CANDIDATE_REQUIRED` 또는 `PNU_LENGTH_INVALID` 안내. 지번주소가 있으면 **지번주소 기반 PNU 후보 찾기** 버튼으로 주소검색 가능 | PNU 후보는 자동 확정하지 않고 직접 입력·수동 검수 후 조회하거나 수동 조회값 붙여넣기로 이동 가능해야 함 |
| 브이월드 조회 성공 시 표시값 | 유효한 VWorld API Key, `domain`, `stdrYear`, 숫자 19자리 단일 PNU로 조회 성공 | `API_LOOKUP_SUCCESS`, `출처`, `조회일자`, `기준연도`, `검토 보강자료` 표시. `public_land_characteristics`, `land_characteristics`, `land_characteristic_crosscheck`에 후보값 반영 | 평가서 지목·이용상황·용도지역 원값은 자동 덮어쓰지 않아야 하며, 필요 시 **검수 완료 표시** 전 수동 검토 가능해야 함 |
| 브이월드 브이월드 조회 실패 시 상태값 | 응답 없음, 빈 후보, 서비스 오류 등 | `API_LOOKUP_FAILED` 또는 `NEEDS_MANUAL_INPUT`, 오류 코드와 수동입력 fallback 안내 표시 | 수동 보강값 입력 후 **수동 보강값 반영** 버튼이 동작해야 함 |
| CORS 또는 HTTP 오류 시 안내 | 브라우저 직접 호출이 CORS로 차단되거나 4xx/5xx 발생 | `API_LOOKUP_FAILED`, `BROWSER_CALL_BLOCKED_OR_HTTP_ERROR` 또는 `HTTP_ERROR`, “브라우저 환경에 따라 차단”, “수동입력 fallback” 안내 표시 | 동일 화면에서 외부 공적자료 조회 결과를 직접 입력할 수 있어야 함 |
| 원문 요청 URL 보기 | 필지 카드에서 접힘 영역을 열기 | 화면 표시용 URL의 `key`는 마스킹되고 `pnu`, `stdrYear`, `domain`, `format=json`이 보임 | **key 포함 URL 공유 금지** 안내가 보이고 실제 키는 코드/JSON에 저장되지 않아야 함 |
| 새 탭 원문 테스트 | 키·domain·PNU 입력 후 **새 탭에서 VWorld 원문 열기** 클릭 | 현재 입력한 키를 포함한 URL을 새 탭으로 열어 VWorld JSON/XML 원문을 사용자가 직접 확인 | 키 포함 URL은 민감정보이므로 QA 기록·메신저·이슈에 공유하지 않음 |
| VWorld 응답 붙여넣기 paste fallback | 새 탭 원문 JSON/XML을 **VWorld 응답 붙여넣기**에 넣고 **붙여넣은 VWorld 응답 반영** 클릭 | 실제 성공 응답 root `landCharacteristicss`의 `field[]` 또는 단일 `field`와 `landCharacteristicss.fields`, `landCharacteristics.field`, `landCharacteristics.fields`, 기존 `response.result.items`, `response.result.item`, `response.result.featureCollection.features`, `response.result`, `result.items`, `result.item`, `items`, `item`, `features`, 단일 객체와 XML `item`/`items`/`field`/`result`/`response` 후보를 방어적으로 파싱해 성공 시 `API_LOOKUP_SUCCESS`, 실패 시 파싱 오류와 수동입력 fallback 유지 | 성공해도 `public_land_characteristics` / `land_characteristics` 검토 보강자료로만 반영하고 평가서값은 자동 덮어쓰지 않음 |
| XML 응답 파싱 실패 시 안내 | XML 응답이 깨졌거나 예상 구조가 아님 | `API_LOOKUP_FAILED`, `XML_PARSE_FAILED`, “XML 응답 파싱 실패” 및 원문 확인/수동입력 안내 표시 | 붙여넣기 영역에 확인된 값을 `항목: 값` 형식으로 넣을 수 있어야 함 |
| JSON 응답 파싱 실패 시 안내 | JSON 응답이 깨졌거나 HTML 오류문이 JSON처럼 도착 | `API_LOOKUP_FAILED`, `JSON_PARSE_FAILED`, “JSON 응답 파싱 실패” 및 원문 확인/수동입력 안내 표시 | 수동 입력칸이 유지되고 저장 JSON에 VWorld API Key가 남지 않아야 함 |
| raw parser 진단 표시 | 다양한 JSON/XML 구조 또는 단일 객체 응답을 붙여넣기 | **응답 구조 미리보기 / 파싱 진단**에 응답 형식, 응답 root(`landCharacteristicss` 등), 최상위 키 목록, `resultCode`, `resultMsg`, `totalCount`, item 후보 개수, field 후보 개수, 선택된 후보의 `lastUpdtDt`, 매핑 성공 필드, 누락 필드, 중복 후보 처리 기준, 실패 사유, 수동입력 fallback 안내 표시 | 실패 사유는 `NO_ITEM_FOUND`, `FIELD_MAPPING_FAILED`, `UNSUPPORTED_RESPONSE_SHAPE`까지 구체적으로 구분해야 함 |
| API Key 포함 붙여넣기 경고 | 붙여넣은 원문 또는 URL에 `key=` 또는 `apiKey=` 포함 | “붙여넣은 응답 또는 URL에 API Key가 포함되어 있을 수 있습니다. 외부 공유 전 제거하세요.” 경고 표시 | 실제 key/apiKey 값은 저장 JSON에 포함하지 않음 |
| 주소검색 PNU 후보 확인 | PNU 입력 없이 지번주소가 있는 필지에서 **지번주소 기반 PNU 후보 찾기** 클릭 | 주소검색은 `apiKey` 파라미터를 사용하고, 후보가 있으면 `PNU_CANDIDATE_REQUIRED`/후보 목록 표시. 후보는 자동 확정하지 않음 | 후보를 사람이 검수한 뒤 19자리 PNU 입력칸에 반영하거나 수동입력으로 검수할 수 있어야 함 |
| 복수 후보 발생 시 안내 | PNU 후보를 쉼표 등으로 2개 이상 넣거나 API 응답 후보가 2개 이상 | `MULTIPLE_CANDIDATES`, “자동 반영하지 않고 수동 검수” 안내 표시 | 단일 후보를 다시 입력하거나 수동입력으로 검수할 수 있어야 함 |
| 응답값 없음 안내 | 정상 HTTP 응답이지만 적용 가능한 토지특성 후보가 없음 | `NEEDS_MANUAL_INPUT`, `NO_API_RESPONSE`, “응답값 없음” 및 수동입력 전환 문구 표시 | 수동입력으로 계속 진행 버튼을 눌러 같은 카드 입력칸으로 이동할 수 있어야 함 |
| 수동입력 fallback 연결 여부 | 위 실패/차단/파싱/복수 후보 상태 뒤 수동 값 입력 | `MANUAL_EDITED` 또는 `CONFIRMED`로 이어질 수 있어야 함 | **수동입력으로 계속 진행**, **수동 보강값 반영**과 **검수 완료 표시**가 남아 있어야 하며 브이월드 조회값을 확정 사실로 표현하지 않아야 함 |


## VWorld batch 결과 JSON import QA 체크리스트

이 체크리스트는 PR-25 로컬 batch 실행 결과(`output/vworld_results.json`)를 PR-26 앱 import 흐름에서 preview → 반영 → crosscheck → summary까지 확인하기 위한 항목입니다. 실제 API Key, 전체 요청 URL, 원문 VWorld 응답 전체는 QA 기록에 저장하지 않습니다.

| 항목 | 입력/상황 | 기대 상태값·안내 | 수동 fallback 확인 |
| --- | --- | --- | --- |
| 정상 JSON preview | `source: "VWorld"`, `lookup_batch_id`, `stdrYear`, `lookup_created_at`, `results` 배열이 있는 JSON을 붙여넣고 **batch import preview** 클릭 | 총 results 수, 반영 성공 수, 결과 없음 수, 실패 수, PNU 누락/오류 수, 검토 필요 수, 수동입력 필요 수와 첫 3건이 표시됨 | preview 단계에서는 평가서값이나 공적자료 데이터에 아직 반영하지 않아야 함 |
| success row 반영 | `VWORLD_LOOKUP_SUCCESS` 행 포함 JSON을 **검토 보강자료로 반영** | `public_land_characteristics`, `land_characteristics`에 `public_input_origin: VWORLD_BATCH_IMPORT`, `public_data_source: VWorld`, `VWORLD_BATCH_IMPORTED` 메타가 남음 | 평가서값 보호 확인: 평가서 지목·이용상황·용도지역·평가 단가는 자동으로 덮어쓰지 않습니다 |
| no_result row 처리 | `VWORLD_NO_RESULT` 행 포함 | 성공값처럼 반영하지 않고 `vworld_batch_review_queue`에 결과 없음 수로 집계 | 수동입력 필요 대상으로 남고 다른 기준연도 재조회 또는 수동 보강을 안내 |
| failed row 처리 | `VWORLD_LOOKUP_FAILED` 행 포함 | 실패 수와 검토 필요 수에 집계되고 오류 메시지 요약만 표시 | 원문 VWorld 응답 전체나 전체 요청 URL은 저장하지 않고 수동입력 fallback 유지 |
| PNU_MISSING/PNU_INVALID 처리 | PNU 누락 또는 숫자 19자리 형식 오류 행 포함 | PNU 누락/오류 수에 합산되고 review queue에 `PNU_MISSING` 또는 `PNU_INVALID`로 남음 | 주소검색 또는 수동 PNU 입력 후 수동 검수 필요 |
| crosscheck 생성 확인 | 성공 행 반영 후 summary 확인 | `land_characteristic_crosscheck` 생성/갱신 수와 crosscheck 검토 필요 수가 표시됨 | 차이값은 검토 단서이며 원문·공부·현장자료 수동 검수 필요 문구 확인 |
| import 이력 확인 | 반영 완료 summary 확인 | `lookup_batch_id`, `stdrYear`, `lookup_created_at`, `import_created_at`, `source: VWorld` 표시 | import 이력은 원문 응답/API Key 없이 요약 메타만 저장 |
| 평가서값 보호 확인 | 성공 행의 공적 지목·이용상황·용도지역이 평가서값과 다름 | 공적 보강값과 평가서값이 분리 표시되고 `평가서값 자동 덮어쓰기 없음` 안내가 보임 | 차이를 평가상 문제로 단정하지 않고 전문가 검토 필요 대상으로 유지 |
| API Key/원문 응답 비저장 확인 | import 후 JSON 내보내기 또는 textarea 확인 | API Key, 전체 요청 URL, 원문 VWorld 응답 전체가 저장 JSON에 없어야 함 | 저장되는 값은 정규화 필드, 상태, 요약 진단, import summary에 한정 |

## 실제 브라우저 수동 테스트 결과 기록란

| 테스트일 | 브라우저/버전 | 실행 URL | VWorld API Key 저장 여부 | 상태값/오류코드 | 화면 안내 확인 | 수동입력 fallback 결과 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | 예: Chrome / Edge / Safari | 예: http://localhost:8000/index.html | 저장 안 함 | 예: `API_LOOKUP_FAILED` / `BROWSER_CALL_BLOCKED_OR_HTTP_ERROR` | 예: CORS/브라우저 차단 문구, **원문 요청 URL 보기**, **key 포함 URL 공유 금지**, **붙여넣은 VWorld 응답 반영** 확인 | 예: paste fallback 또는 **수동 보강값 반영** → `MANUAL_EDITED` | 실제 키·key 포함 URL·원문 응답·개인정보는 기록하지 않음 |

## 실제 VWorld 토지특성 성공 응답 구조 메모

- 확인된 root는 `landCharacteristicss`이며 하위에 `field[]`, `pageNo`, `resultCode`, `totalCount`, `numOfRows`, `resultMsg`가 있습니다.
- `field` 항목의 주요 키는 `pnu`, `lndcgrCodeNm`, `lndpclAr`, `prposArea1Nm`, `prposArea2Nm`, `ladUseSittnNm`, `tpgrphHgCodeNm`, `tpgrphFrmCodeNm`, `roadSideCodeNm`, `pblntfPclnd`, `stdrYear`, `lastUpdtDt`, `ldCodeNm`, `mnnmSlno`이며, `pblntfPclnd`는 `official_land_price_public`, `lastUpdtDt`는 `public_last_updated_at`으로 매핑합니다.
- 예시 값은 지목 `대`, 면적 `479`, 용도지역 `용도미지정`, 이용상황 `단독`, 지형고저 `완경사`, 지형형상 `사다리형`, 도로접면 `세로한면(불)`, 개별공시지가 `529203`, 기준연도 `2025`, 최종갱신일 `2026-03-26`처럼 정규화되어 `public_land_characteristics` / `land_characteristics` 검토 보강자료에만 반영되어야 합니다.
- `resultCode`가 비어 있어도 `field` 후보와 매핑 필드가 있으면 성공 후보로 처리합니다. `response.totalCount === "0"` 또는 `landCharacteristicss.totalCount === "0"`이고 `resultCode`가 비어 있으면 `VWORLD_NO_RESULT`/`NO_RESULT_FOR_YEAR`로 분리하고, 기준연도 2025·2024 등 재조회 안내를 표시합니다. 같은 PNU/기준연도 후보가 여러 건이면 최신 `lastUpdtDt` 항목을 우선 선택하되 “동일 PNU/기준연도 후보 2건 중 lastUpdtDt 최신값 2026-03-26 항목을 우선 반영” 같은 진단 문구로 중복 사실을 남깁니다.

## 실제 브라우저 테스트 가능 여부

- 실제 브라우저 테스트는 가능합니다. 단, 브이월드 키 권한, 요청 제한, 브라우저 CORS 정책에 따라 조회가 실패하거나 차단될 수 있습니다.
- 차단 또는 실패가 발생해도 이는 화면의 주요 검수 대상입니다. 실패 상태값, 안내 문구, 수동입력 fallback 연결을 확인합니다.
- 이 저장소는 신규 API endpoint, VWorld API Key 하드코딩, 외부 서버 저장 기능을 추가하지 않습니다.

- 파싱 진단 UI는 응답 root(`landCharacteristicss` 또는 `response`), `totalCount`, 기준연도, field 후보 개수, 동일 PNU/기준연도 중복 후보 개수, 선택된 후보의 `lastUpdtDt`, 매핑 성공 필드, 누락 필드, 결과 없음 여부, 추천 재조회 연도를 확인합니다.

## VWorld 성공 확인 체크리스트

성공 확인은 실제 API Key나 원문 응답을 저장하지 않고, 화면 표시와 파싱 진단만 기록합니다. 브이월드 조회값은 검토 보강자료입니다. 평가서값을 자동으로 덮어쓰지 않습니다. 기준연도별 차이는 검토 단서이며 평가상 문제 여부를 단정하지 않습니다.

| 확인 항목 | 기대 결과 | 기록 메모 |
| --- | --- | --- |
| 성공 응답 root | `landCharacteristicss` root와 `landCharacteristicss.field` 후보가 확인됩니다. | 원문 전체와 API Key는 기록하지 않음 |
| 공시지가 매핑 | `pblntfPclnd` 값이 `official_land_price_public`으로 표시됩니다. | 예: 2025년 `529203` |
| 최종갱신일 매핑 | `lastUpdtDt` 값이 `public_last_updated_at`으로 표시됩니다. | 예: `2026-03-26` |
| 기준연도 보존 | `public_standard_year` 또는 `stdrYear`별 조회값이 서로 덮어써지지 않습니다. | 2024년/2025년 비교 |
| 2024년 예시 | PNU `9999999999100780001`, 계획관리지역, 부정형, 공시지가 516112 | 평가 기준시점과 조회 기준연도 구분 |
| 2025년 예시 | PNU `9999999999100780001`, 용도미지정, 사다리형, 공시지가 529203 | 평가 기준시점과 조회 기준연도 구분 |
| 중복 후보 처리 | 동일 PNU/같은 기준연도 후보 중 `lastUpdtDt` 최신값 우선 선택 문구가 남습니다. | 자동 확정 사실처럼 표현하지 않음 |
| 결과 없음 분리 | `totalCount=0`은 `VWORLD_NO_RESULT` 또는 `NO_RESULT_FOR_YEAR`로 분리되고 성공값처럼 반영되지 않습니다. | 필요 시 다른 기준연도 재조회 안내 |
| 평가서값 보호 | 평가서 지목·이용상황·용도지역·평가 단가는 자동 덮어쓰기 되지 않습니다. | 검토 보강자료로만 표시 |
| 원문/키 비저장 | 성공 기록에도 VWorld API Key와 원문 응답 전체를 저장하지 않습니다. | 성공 여부·기준연도·요약 진단만 기록 |

성공 시연의 상세 문맥은 `vworld_success_flow.md`를 참조합니다.
