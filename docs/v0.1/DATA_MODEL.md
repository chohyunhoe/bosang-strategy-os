# 보상전략 OS v0.1 데이터 구조표

## 1. 원칙

v0.1은 기존 stable16 데이터 키를 보존한다. 신규 스키마 재설계보다 출처·상태·검토단계를 명확히 하는 것을 우선한다.

## 2. 핵심 엔터티

| 엔터티 | 역할 | 주요 내용 | 자동확정 |
|---|---|---|---|
| appraisal | 평가서 단위 | 파일/법인/기준시점/추출상태 | 금지 |
| land | 편입토지 | 소재지·지목·면적·PNU | 원문 확인 전 금지 |
| standard_land | 비교표준지 | 기호·소재지·공시지가·특성 | 모호 시 금지 |
| comp_case | 거래/평가사례 | 사례 위치·단가·특성·시점 | 모호 시 금지 |
| appraisal_result | 법인별 평가행 | 요인·단가·금액 | 원문값 보존 |
| factor_comparison | 개별요인 비교 | 대상↔표준지, 표준지↔사례 | 판단 자동확정 금지 |
| other_factor_review | 그 밖의 요인 | 사례·시점·요인·결정치 | 적정성 자동확정 금지 |
| public_enrichment | 공적자료 보강 | VWorld 조회값·연도·상태 | 평가서값 덮어쓰기 금지 |
| issue_candidate | 쟁점 후보 | 근거·검토포인트·상태 | 확정 판단 금지 |
| draft_sentence | 주장문 초안 | 쟁점 기반 작업문안 | 제출 자동확정 금지 |
| risk_warning | 리스크 | 표현·데이터·연결 위험 | 수동 해소 필요 |

## 3. 절대 보존 키

| 키 | 용도 |
|---|---|
| `public_land_characteristics` | 공적 토지특성 보강값 |
| `public_land_data_enrichment` | 공적자료 보강 실행/상태 |
| `land_characteristics` | 토지특성 통합 검토 구조 |
| `land_characteristic_crosscheck` | 원문/공적자료 교차확인 |
| `comparison_summary_by_land` | 필지별 법인 비교 요약 |
| `land_appraisal_results` | 법인별 평가행 |
| `subject_to_standard_factor_comparisons` | 편입토지↔표준지 개별요인 |
| `standard_to_comp_case_factor_comparisons` | 표준지↔사례 개별요인 |
| `other_factor_reviews` | 그 밖의 요인 검토 |
| `ocr_review_items` | OCR 검수 큐 |
| `issue_candidates` | 쟁점 후보 |
| `draft_sentences` | 주장문 초안 |
| `risk_warnings` | 리스크 경고 |

## 4. 출처 계층

모든 중요 값은 가능한 한 다음 출처 중 하나를 식별한다.

1. `APPRAISAL_SOURCE` — 감정평가서 원문
2. `USER_CONFIRMED` — 사용자가 명시적으로 확인/입력
3. `VWORLD_ENRICHMENT` — 공적 API 보강자료
4. `OCR_CANDIDATE` — OCR 추출 후보
5. `REVERSE_INFERENCE` — 산식 역산 추론
6. `DERIVED_DISPLAY` — 원문값을 바꾸지 않는 화면 계산/표시

출처가 다른 값을 하나의 확정값으로 병합하지 않는다.

## 5. 검토 상태

| 상태 | 의미 |
|---|---|
| `NEEDS_REVIEW` | 검수 전 후보 |
| `REVIEW_REQUIRED` | 모호성/추론/외부자료로 사람 검토 필요 |
| `CONFIRMED` | 명시적 원문 또는 수동 확인 완료 |
| `BLOCKED` | 필수 연결 실패로 다음 단계 진행 금지 |
| `NOT_IDENTIFIABLE` | 원문으로 세부값 식별 불가 |
| `REVERSE_INFERENCE` | 역산에 의한 추론값 |

`REVERSE_INFERENCE`는 검토 상태와 출처 성격을 함께 나타내며 원문값으로 승격하지 않는다.

## 6. 평가행 구조

법인별 평가행 최소 필드:

- appraisal_id
- land_id
- appraisal_company
- standard_land_id 또는 standard_symbol
- official_price
- time_correction
- regional_factor
- individual_factor
- other_factor
- unit_price
- amount
- source_reference
- review_status

필수 원칙:
- 숫자 누락 시 임의로 1.0 등을 보간하지 않음
- 동일 필지 중복 연결 차단
- 비교표준지 연결이 모호하면 BLOCKED 또는 REVIEW_REQUIRED

## 7. 개별요인 구조

편입토지↔표준지 및 표준지↔사례 비교는 최소 다음 축을 보존한다.

- 가로조건
- 접근조건
- 환경조건
- 획지조건
- 행정적조건
- 기타조건
- 누계

원문에 세부값이 없으면 누계를 분해해 생성하지 않는다.

## 8. 공적자료 보강 구조

보강 필드 예시:

- road_frontage_public
- terrain_shape_public
- terrain_height_public
- land_use_status_public
- zoning_public
- land_area_public
- land_category_public
- official_land_price_public

부가 메타:
- source
- standard_year
- lookup_status
- pnu_resolution_status
- review_status

평가서 필드와 공적자료 필드는 별도로 유지한다.

## 9. 쟁점/문안 구조

### issue_candidates

- issue_id
- land_id
- category
- supporting_sources
- factual_basis
- review_question
- status

### draft_sentences

- sentence_id
- issue_id
- draft_text
- source_links
- review_status

### risk_warnings

- warning_id
- target_id
- risk_type
- message
- severity
- resolved

## 10. 개인정보·보안 데이터 경계

저장소 커밋 금지:
- 실제 원문 PDF
- 비밀번호
- API Key
- 상세주소가 포함된 실사건 원자료
- 실제 PNU/거래값이 포함된 live 결과
- 주민번호·계좌·보상금 등 개인정보

회귀테스트는 합성 또는 비식별 fixture를 사용한다.
