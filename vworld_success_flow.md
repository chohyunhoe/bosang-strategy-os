# VWorld 토지특성 성공 조회 흐름

이 문서는 실제 VWorld `getLandCharacteristics` 토지특성 조회 성공 응답을 기준으로, 기준연도별 조회값 반영 흐름과 포트폴리오 시연 루트를 정리합니다. 이번 문서는 기능 추가가 아니라 이미 구현된 `landCharacteristicss.field` 파서, `totalCount=0` 결과 없음 처리, 기준연도 기본값 현재연도-1, 동일 PNU/동일 기준연도 후보의 `lastUpdtDt` 최신값 우선 선택, 기준연도별 조회값 보존 흐름을 QA 관점에서 설명합니다.

## 검토 전제와 주의 문구

- 브이월드 조회값은 검토 보강자료입니다.
- 평가서값을 자동으로 덮어쓰지 않습니다.
- 기준연도별 차이는 검토 단서이며 평가상 문제 여부를 단정하지 않습니다.
- 감정평가 결과 산정, 보상금 증액 가능성 단정, 법률자문 확정 표현으로 사용하지 않습니다.
- VWorld API Key는 화면 세션 입력값으로만 사용하고 코드, JSON, 문서, 커밋, 이슈, PR 본문에 저장하지 않습니다.
- QA 기록에는 성공 여부, 조회 기준연도, 선택된 후보의 요약 진단만 남기고 원문 응답 전체는 저장하지 않습니다.

## 실제 성공 응답 구조

성공 응답에서 확인한 주요 root는 `landCharacteristicss`입니다. 이 root 아래에 `field[]`, `pageNo`, `resultCode`, `totalCount`, `numOfRows`, `resultMsg`가 위치합니다. 실제 성공 판정은 `resultCode` 문자열만 보지 않고, `landCharacteristicss.field` 후보와 매핑 가능한 필드가 있는지도 함께 확인합니다.

주요 `field` 키와 내부 정규화 매핑은 다음처럼 정리합니다.

| VWorld field 키 | 의미 | 내부 보강 필드 |
| --- | --- | --- |
| `pnu` | 19자리 PNU | `pnu` |
| `stdrYear` | 기준연도 | `public_standard_year` |
| `lndcgrCodeNm` | 지목 | `land_category_public` |
| `lndpclAr` | 면적 | `land_area_public` |
| `prposArea1Nm` | 주 용도지역 | `zoning_public` |
| `prposArea2Nm` | 보조 용도지역 | `zoning_secondary_public` |
| `ladUseSittnNm` | 이용상황 | `land_use_status_public` |
| `tpgrphHgCodeNm` | 지형고저 | `terrain_height_public` |
| `tpgrphFrmCodeNm` | 지형형상 | `terrain_shape_public` |
| `roadSideCodeNm` | 도로접면 | `road_frontage_public` |
| `pblntfPclnd` | 개별공시지가 | `official_land_price_public` |
| `lastUpdtDt` | 최종갱신일 | `public_last_updated_at` |
| `ldCodeNm` | 법정동명 | `legal_dong_public` |
| `mnnmSlno` | 지번 | `parcel_number_public` |

파싱 진단에서는 응답 root, `totalCount`, 기준연도, `field` 후보 개수, 동일 PNU/기준연도 중복 후보 개수, 선택된 후보의 `lastUpdtDt`, 매핑 성공 필드, 누락 필드, 결과 없음 여부를 함께 확인합니다. `response.totalCount === "0"` 또는 `landCharacteristicss.totalCount === "0"`이고 적용 가능한 `field`가 없으면 성공값으로 보지 않고 `VWORLD_NO_RESULT` / `NO_RESULT_FOR_YEAR` 확인 대상으로 분리합니다.

## 성공 반영 흐름

1. 사용자가 PNU `9999999999100780001`과 조회 기준연도(`stdrYear`)를 입력하거나 기본값을 사용합니다.
2. 기준연도 기본값은 현재연도-1입니다. 예를 들어 2026년 실행 시 기본 조회 기준연도는 2025년입니다.
3. VWorld 응답 root `landCharacteristicss`에서 `field[]` 후보를 수집합니다.
4. 같은 PNU와 같은 기준연도 후보가 여러 건이면 `lastUpdtDt` 최신값을 우선 선택합니다. 예: “동일 PNU/기준연도 후보 2건 중 lastUpdtDt 최신값 2026-03-26 항목을 우선 반영”.
5. 선택된 후보는 `public_land_characteristics`, `land_characteristics`, `land_characteristic_crosscheck`의 검토 보강자료로만 반영합니다.
6. 평가서 지목·이용상황·용도지역·단가 등 원문 평가서값은 유지하고 자동 덮어쓰지 않습니다.
7. 기준연도별 값은 서로 덮어쓰지 않고, 조회 기준연도와 평가 기준시점을 구분해 검토합니다.

## 기준연도별 값 차이 예시

동일 PNU라도 기준연도별 VWorld 토지특성 값은 다를 수 있습니다. 아래 예시는 포트폴리오 시연에서 “조회 기준연도 선택에 따라 검토 보강자료가 달라질 수 있음”을 설명하기 위한 대표 케이스입니다.

| PNU | 기준연도 | 용도지역 | 지형형상 | 공시지가 |
| --- | --- | --- | --- | --- |
| `9999999999100780001` | 2024년 | 계획관리지역 | 부정형 | 516112 |
| `9999999999100780001` | 2025년 | 용도미지정 | 사다리형 | 529203 |

기준연도별 값이 다를 수 있으므로 평가 기준시점과 조회 기준연도를 구분해 검토해야 합니다.

위 차이는 기준연도별 조회값이 다를 수 있다는 검토 단서입니다. 따라서 평가 기준시점과 조회 기준연도를 구분해 검토해야 하며, 이 차이만으로 평가상 문제 여부, 감정평가 결과 산정, 보상금 증액 가능성, 법률적 결론을 단정하지 않습니다.

## 포트폴리오 성공 시연 루트

1. `index.html`을 GitHub Pages 또는 로컬 정적 서버에서 엽니다.
2. `sample_case_gongju.json`을 적용해 stable16 화면과 공적자료 상세 화면이 정상 표시되는지 확인합니다.
3. **공적자료 상세** 또는 **JSON/API/OCR** 흐름에서 **브이월드 토지특성 조회** 보조 UI를 찾습니다.
4. VWorld API Key를 세션 입력칸에만 입력하고, 저장 JSON이나 문서에 남기지 않는다고 설명합니다.
5. PNU `9999999999100780001`과 `stdrYear=2025`를 입력해 성공 응답 구조 `landCharacteristicss.field`가 파싱되는 흐름을 설명합니다.
6. 화면 또는 파싱 진단에서 `pblntfPclnd → official_land_price_public`, `lastUpdtDt → public_last_updated_at` 매핑을 확인합니다.
7. 같은 PNU로 `stdrYear=2024`를 재조회한 예시와 비교해 2024년 계획관리지역·부정형·공시지가 516112, 2025년 용도미지정·사다리형·공시지가 529203 차이를 설명합니다.
8. 마지막으로 “브이월드 조회값은 검토 보강자료이며 평가서값을 자동으로 덮어쓰지 않습니다”와 “기준연도별 차이는 검토 단서이며 평가상 문제 여부를 단정하지 않습니다”를 명시합니다.

## QA 확인 체크리스트

- [ ] `vworld_success_flow.md` 링크가 README의 시연 전 확인 문서에 노출됩니다.
- [ ] 성공 응답 root가 `landCharacteristicss`로 설명됩니다.
- [ ] `landCharacteristicss.field`의 `pblntfPclnd`와 `lastUpdtDt` 매핑이 문서화되어 있습니다.
- [ ] PNU `9999999999100780001`의 2024년/2025년 기준연도별 값 차이가 문서화되어 있습니다.
- [ ] 기준연도별 조회값 보존과 평가 기준시점/조회 기준연도 구분 문구가 있습니다.
- [ ] 브이월드 조회값은 검토 보강자료이며 평가서값을 자동으로 덮어쓰지 않는다는 주의 문구가 있습니다.
- [ ] 감정평가 결과 산정, 보상금 증액 가능성 단정, 법률자문 확정 표현이 없습니다.
