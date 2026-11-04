# 공적 토지특성정보 외부 API 보강 설계

## 1. 목적과 원칙

이 문서는 보상전략 OS의 공적 토지특성정보 공란을 브이월드 API로 보강하기 위한 설계 메모입니다. 이번 PR-10의 범위는 설계와 리스크 정리이며, 실제 API 호출 코드·VWorld API Key·외부 저장소 연동은 구현하지 않습니다.

- 브이월드 조회값은 **검토 보강자료**입니다.
- 브이월드 조회값은 감정평가 판단, 법률자문, 보상액 산정, 보상금 증액 가능성 판단을 대체하지 않습니다.
- 조회 실패·응답 없음·후보 불일치가 발생해도 기존 **공적자료 수동 보강** 워크플로우로 이어져야 합니다.
- VWorld API Key는 코드에 하드코딩하지 않고, 실행 환경의 비밀값 또는 사용자가 직접 입력하는 임시 세션 값으로 다루는 방향을 원칙으로 합니다.
- 단일 HTML 정적 앱의 stable16 기능 기준선과 기존 데이터 키를 삭제하지 않습니다.

## 2. API 연동 목적

브이월드 API 연동의 목적은 평가서·수동입력·샘플 JSON에서 비어 있거나 검수 대기 중인 공적 토지특성 필드를 자동 후보값으로 채워, 실무자가 원문·공부·현장자료와 대조할 수 있는 출발점을 제공하는 것입니다.

구체적인 목적은 다음과 같습니다.

1. `land_characteristics`와 `public_land_characteristics`의 공란 필드에 후보값을 제시합니다.
2. `land_characteristic_crosscheck`에 브이월드 조회 결과와 평가서 기재값의 차이를 검토 상태로 기록합니다.
3. PNU 또는 지번주소 기반 조회가 실패해도 수동입력 화면으로 자연스럽게 전환합니다.
4. 브이월드 응답 원문 전체가 아니라 화면 검토에 필요한 최소 필드, 조회 상태, 출처 메타데이터만 로컬 JSON에 저장합니다.

## 3. 브이월드 API로 보강할 필드

브이월드 보강 대상 필드는 토지특성 검토에 필요한 공적자료 후보값으로 한정합니다. 모든 값은 검토 보조 후보이며, 감정평가 결과 산정값으로 사용하지 않습니다.

| 구분 | 화면/JSON 키 | 설명 | 저장 위치 |
| --- | --- | --- | --- |
| 토지 식별 | `pnu` | 필지 고유번호 후보 | `land_characteristics`, `public_land_characteristics` |
| 토지 식별 | `parcel_address` | 지번주소 표시값 | `land_characteristics`, `public_land_characteristics` |
| 토지 식별 | `legal_dong_name` | 법정동명 | `public_land_data_enrichment.lookup_input` |
| 토지 식별 | `is_mountain` | 산 여부 | `public_land_data_enrichment.lookup_input` |
| 토지 식별 | `main_lot_number` | 본번 | `public_land_data_enrichment.lookup_input` |
| 토지 식별 | `sub_lot_number` | 부번 | `public_land_data_enrichment.lookup_input` |
| 공적 특성 | `land_category_public` | 공적 지목 후보 | `land_characteristics`, `public_land_characteristics` |
| 공적 특성 | `land_use_status_public` | 공적 이용상황 후보 | `land_characteristics`, `public_land_characteristics` |
| 공적 특성 | `zoning_public` | 공적 용도지역 후보 | `public_land_characteristics` |
| 공적 특성 | `zoning_appraisal` | 평가서 기재 용도지역과 대조할 기준값 | `land_characteristics` |
| 공적 특성 | `road_frontage_public` | 도로접면 후보 | `land_characteristics`, `public_land_characteristics` |
| 공적 특성 | `terrain_height_public` | 지형고저 후보 | `land_characteristics`, `public_land_characteristics` |
| 공적 특성 | `terrain_shape_public` | 지형형상 후보 | `land_characteristics`, `public_land_characteristics` |
| 가격 참고 | `official_land_price_public` | 개별공시지가 후보 | `land_characteristics`, `public_land_characteristics` |
| 메타데이터 | `public_lookup_date` | 조회일자 | `land_characteristics`, `public_land_characteristics` |
| 메타데이터 | `public_data_source` | 자료출처/브이월드 API명 | `land_characteristics`, `public_land_characteristics` |
| 메타데이터 | `lookup_status` | 조회 상태 | `public_land_data_enrichment` |
| 메타데이터 | `lookup_error_code` | 실패/제한 코드 | `public_land_data_enrichment` |

## 4. 입력값 요구사항

브이월드 조회 전 입력값은 원본 평가서, 샘플 JSON, 사용자의 수동입력값에서 구성합니다. 필수값이 부족하면 브이월드 API를 호출하지 않고 `PNU_REQUIRED` 또는 `MANUAL_INPUT_REQUIRED` 상태로 수동입력 워크플로우를 보여줍니다.

### 4.1 지번주소

- 최소 요구사항: 시·군·구, 법정동, 지번을 식별할 수 있는 문자열입니다.
- 예: `익명도 익명시 ○○동 산 3-1` 형식의 표시 주소입니다.
- 주소 파싱 결과는 확정값이 아니며, 법정동·산 여부·본번·부번 후보를 만들기 위한 입력으로만 사용합니다.

### 4.2 법정동

- 브이월드 API가 법정동 코드 또는 법정동명을 요구할 수 있으므로, 주소 파싱 또는 사용자 입력으로 확보합니다.
- 행정동과 법정동이 다를 수 있으므로 자동 변환 결과는 `lookup_input.legal_dong_name` 후보로 저장하고 사용자가 검수합니다.

### 4.3 산 여부

- `산`, `임야`, 주소의 `산` 접두어 등으로 후보를 추정할 수 있습니다.
- 브이월드 API 입력에는 `is_mountain: true/false` 또는 산지 구분 코드로 전달하는 설계를 가정합니다.
- 산 여부가 불명확하면 복수 후보 상태로 처리하고 단일 후보를 자동 확정하지 않습니다.

### 4.4 본번/부번

- 본번은 필수, 부번은 없을 수 있습니다.
- `3-1`은 본번 `3`, 부번 `1` 후보로 저장합니다.
- `3`처럼 부번이 없는 경우 부번은 빈 문자열 또는 `0` 등 브이월드 API 규격에 맞추되, 내부 저장은 빈 문자열을 우선합니다.

### 4.5 PNU 후보

- PNU가 이미 있으면 1차 조회 키로 사용합니다.
- PNU가 없으면 지번주소·법정동·산 여부·본번·부번으로 PNU 후보를 생성하거나 API 검색 후보를 받습니다.
- 후보가 2개 이상이면 `MULTIPLE_CANDIDATES` 상태로 저장하고 사용자의 선택을 요구합니다.
- 브이월드 응답 PNU와 기존 `lands` 또는 `land_characteristics`의 PNU가 다르면 `PNU_MISMATCH` 상태로 수동 검수합니다.

## 5. 브이월드 응답값 데이터 키 매핑표

아래 표는 브이월드 응답을 내부 JSON 데이터 키로 매핑하는 설계안입니다. 실제 API 제공 필드명은 기관별로 다를 수 있으므로, 구현 단계에서 어댑터 레이어에서 변환합니다.

| 브이월드 응답 의미 | 내부 데이터 키 | 대상 배열 | 처리 방식 |
| --- | --- | --- | --- |
| 필지 고유번호 | `pnu` | `public_land_characteristics`, `land_characteristics` | 기존값이 없을 때 후보로 저장, 기존값과 다르면 불일치 상태 기록 |
| 지번주소 | `parcel_address` | `public_land_characteristics`, `land_characteristics` | 표시·대조용 문자열로 저장 |
| 공적 지목 | `land_category_public` | `public_land_characteristics`, `land_characteristics` | 평가서 기재 지목과 별도 보관 |
| 토지 이용상황 | `land_use_status_public` | `public_land_characteristics`, `land_characteristics` | 공적 후보값으로 저장 |
| 용도지역 | `zoning_public` | `public_land_characteristics` | 공적 후보값으로 저장 |
| 평가서 대조용 용도지역 | `zoning_appraisal` | `land_characteristics` | 기존 평가서 값이 있으면 덮어쓰지 않음 |
| 도로접면 | `road_frontage_public` | `public_land_characteristics`, `land_characteristics` | API 후보값으로 저장 |
| 지형고저 | `terrain_height_public` | `public_land_characteristics`, `land_characteristics` | API 후보값으로 저장 |
| 지형형상 | `terrain_shape_public` | `public_land_characteristics`, `land_characteristics` | API 후보값으로 저장 |
| 개별공시지가 | `official_land_price_public` | `public_land_characteristics`, `land_characteristics` | 수치·기준연도 메타데이터와 함께 검토 |
| 조회 기준일 | `public_lookup_date` | `public_land_characteristics`, `land_characteristics` | API 호출 또는 수동 반영 일자 |
| 자료 출처 | `public_data_source` | `public_land_characteristics`, `land_characteristics` | 브이월드 API명/기관명/수동입력 여부 |
| 조회 입력값 | `lookup_input` | `public_land_data_enrichment` | 주소·법정동·산 여부·본번·부번·PNU 후보 저장 |
| 조회 상태 | `lookup_status` | `public_land_data_enrichment`, `land_characteristic_crosscheck` | `LOOKUP_READY`, `LOOKUP_FAILED`, `MULTIPLE_CANDIDATES` 등 |
| 오류 코드 | `lookup_error_code` | `public_land_data_enrichment` | 실패 원인 분류 저장 |
| 검토 메모 | `review_note` | `land_characteristic_crosscheck` | 실무자 검수 메모 저장 |
| 수동 보강 입력 | `manual_public_input` | `public_land_characteristics`, `land_characteristics` | API 실패 후 사용자 입력값 분리 저장 |

## 6. 실패 케이스 처리 설계

| 실패 케이스 | 감지 조건 | 상태 코드 후보 | 사용자 안내/후속 흐름 |
| --- | --- | --- | --- |
| 조회 실패 | HTTP 오류, API 오류 코드, 파싱 실패 | `LOOKUP_FAILED` | 실패 사유를 표시하고 공적자료 수동 보강 카드로 이동 |
| 복수 후보 | 주소 또는 PNU 후보가 2개 이상 | `MULTIPLE_CANDIDATES` | 후보 목록을 표시하고 사용자가 PNU를 선택하거나 직접 입력 |
| PNU 불일치 | 기존 PNU와 브이월드 응답 PNU가 다름 | `PNU_MISMATCH` | 자동 덮어쓰지 않고 교차검수 행에 불일치 기록 |
| 브이월드 응답 없음 | 정상 호출이나 결과 배열이 비어 있음 | `NO_API_RESPONSE` | 조회값 없음으로 표시하고 수동입력 유지 |
| CORS 또는 브라우저 호출 제한 | 브라우저 직접 호출 차단, preflight 실패 | `BROWSER_CALL_BLOCKED` | 로컬 프록시·서버리스 함수·수동 붙여넣기 대안을 안내 |
| VWorld API Key 누락 | VWorld API Key 입력/환경값 없음 | `MISSING_API_KEY` | VWorld API Key를 코드에 저장하지 말라는 안내와 수동 워크플로우 제공 |
| 입력값 부족 | 법정동·본번·PNU 등 필수값 부족 | `PNU_REQUIRED`, `MANUAL_INPUT_REQUIRED` | 지번주소/PNU 입력폼과 붙여넣기 입력을 보여줌 |
| 응답 구조 변경 | 예상 필드명 누락 | `API_SCHEMA_CHANGED` | 원문 전체 저장 없이 최소 오류 메타데이터만 남기고 수동 검수 |

실패 상태는 사용자에게 차단 오류로만 보이지 않아야 합니다. 모든 실패 상태는 `공적자료 보강 필요` 또는 `공적자료 수동 보강` 흐름과 연결하여 stable16의 수동입력/붙여넣기 기능으로 이어집니다.

## 7. 개인정보 및 보안 리스크

- 지번주소와 PNU는 개인식별정보 자체는 아닐 수 있으나 특정 소유자·사건 문서와 결합하면 민감한 사건 정보가 될 수 있습니다.
- VWorld API Key를 HTML, JavaScript, 샘플 JSON, README에 하드코딩하면 GitHub Pages 배포 시 외부에 노출될 수 있습니다.
- 브라우저 직접 호출은 네트워크 탭에 요청 URL, 쿼리 파라미터, VWorld API Key가 드러날 수 있습니다.
- 브이월드 응답 원문 전체를 장기 저장하면 불필요한 행정자료·주소·메타데이터가 JSON에 남을 수 있습니다.
- 외부 서버 저장을 전제하지 않는 현재 앱 특성상, 기본 설계는 브라우저 메모리 또는 사용자가 내려받는 로컬 JSON 중심이어야 합니다.
- 샘플 데이터와 데모 문서에는 실제 주민명, 주민등록번호, 민감주소를 넣지 않습니다.
- 브이월드 조회 로그가 필요한 경우에도 사건명·소유자명·문서 원문을 포함하지 않고, 최소한의 조회 상태와 오류 코드만 남깁니다.

## 8. 단일 HTML에서 직접 API 호출할 때의 한계

단일 HTML 정적 앱에서 브이월드 API를 직접 호출하는 방식은 구현이 단순하지만 다음 한계가 큽니다.

1. CORS 정책 때문에 브라우저 호출이 차단될 수 있습니다.
2. VWorld API Key가 클라이언트 코드 또는 브라우저 개발자도구에 노출될 수 있습니다.
3. 브이월드 API의 XML/JSON 형식, 인코딩, 오류 코드 차이를 브라우저 코드가 모두 처리해야 합니다.
4. 요청 제한, 장애, 응답 지연에 대한 재시도·캐시·감사 로그를 안전하게 관리하기 어렵습니다.
5. `file://` 실행 환경에서는 네트워크·로컬 파일 접근 제약이 더 커질 수 있습니다.
6. 정적 GitHub Pages만으로는 비밀값 보호와 서버 측 프록시 처리가 불가능합니다.

따라서 브라우저 직접 호출은 내부 테스트용 또는 VWorld API Key 보호 문제가 없는 제한적 검증에 한정하고, 기본 추천안으로 두지 않습니다.

## 9. 실제 구현 방식 후보

| 후보 | 장점 | 한계/리스크 | 적합도 |
| --- | --- | --- | --- |
| 브라우저 직접 호출 | 단일 HTML 유지, 배포 단순 | CORS, VWorld API Key 노출, 브라우저별 제한 | 낮음. 공개·무키 API 검증용에 한정 |
| 로컬 프록시 | VWorld API Key를 로컬 환경변수로 보호 가능, CORS 회피 | 사용자가 로컬 서버를 실행해야 함, 배포형 데모에는 추가 절차 필요 | 중간. 실무자 로컬 검토용 후보 |
| GitHub Pages + 서버리스 함수 | 정적 UI와 비밀값 보호를 분리, 배포 시연 가능 | 별도 플랫폼 설정 필요, 호출 비용·한도·로그 관리 필요 | 높음. 공개 데모 이후 확장 후보 |
| 수동 붙여넣기 유지 | VWorld API Key 불필요, 실패 시 안정적, 현재 기능과 호환 | 자동화 수준 낮음, 사용자 입력 검수 필요 | 필수 유지. 모든 방식의 fallback |

## 10. 추천 구현 순서

1. **현재 수동 붙여넣기 유지**: PR-08/PR-09의 공란 처리와 수동입력 워크플로우를 기준선으로 고정합니다.
2. **API 어댑터 인터페이스만 설계**: 실제 호출 없이 `lookup_input`, `lookup_status`, `lookup_error_code`, 데이터 키 매핑을 테스트합니다.
3. **로컬 프록시 PoC**: VWorld API Key를 환경변수로 주입하고 브라우저에는 프록시 URL만 노출하는 방식을 검토합니다.
4. **서버리스 함수 검토**: GitHub Pages 배포와 함께 사용할 수 있는 최소 프록시를 비교합니다.
5. **브라우저 직접 호출은 제한적 실험**: CORS와 VWorld API Key 보호 문제가 없는 검증 조건에 대해서만 별도 실험으로 둡니다.
6. **실패 fallback 회귀 테스트**: 조회 실패, 복수 후보, PNU 불일치, VWorld API Key 누락 상태가 모두 수동입력으로 이어지는지 테스트합니다.

## 11. 구현 시 금지/주의 문구

- 실제 API 호출 코드는 이 PR에서 추가하지 않습니다.
- VWorld API Key를 코드, 문서 예시, 샘플 JSON에 하드코딩하지 않습니다.
- 외부 서버 저장을 전제로 설계하지 않습니다.
- 브이월드 조회값을 감정평가 결과 산정값, 법률자문 확정 의견, 보상금 증액 가능성 판단으로 표현하지 않습니다.
- 조회값은 항상 원문·공부·현장자료와 전문가 검토가 필요한 보강자료로 표시합니다.
