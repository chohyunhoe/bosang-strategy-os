# BSO GIS 지적경계·항공사진 SOP v1.0 (2026-11-08)

적용 대상: 토지보상 상담용 필지 경계 중첩 위치도. 본 문서는 **재사용 로직과 검증 기준**이며,
특정 소유자의 실자료·연속지적도·인증정보를 저장소에 공개하지 않는다.

## 처리 흐름
보안·원본 확보 → PNU 19자리 및 지번 자기일치 → 연속지적도 ZIP(SHP/SHX/DBF) PNU exact-one →
JIBUN 및 지목 일치 → 도형 유효성·EPSG:5174 명시 → WGS84/영상 WebMercator 변환 →
항공타일 취득 → 경계·면적·출처 표기 → PNG/JPG/PDF/GeoJSON·verification.json →
육안 검수 → 변호사 승인 → 사건별 적용결과 BSO 기록.

**차단:** 필지별 0건 또는 복수건, 지번·지목 불일치, 잘못된 CRS·지역 bounds, 누락 타일,
오류 도형, 원본 ZIP 손상 시 지도 출력을 금지한다. 근거 없는 지적선/경계점은 만들지 않는다.

**좌표변환:** 원본 PRJ의 변환 파라미터 누락 가능성을 고려해 알려진 지적원본에 대해
`EPSG:5174`를 명시적으로 선택한다. 좌표변환 결과는 대상 행정구역 경계,
독립 기준 좌표 또는 별도 7변수 변환값과 교차 확인한다. 외부 검산 없이
센티미터 단위 정합성을 주장하지 않는다.

**영상품질:** 국내망 VWorld가 사용 불가하면 Esri World Imagery를 명시적인 대체 제공자로
선택할 수 있다. 제공자·원본·촬영일·위치정확도는 증빙이 있을 때만 기재한다.
영상·도형의 육안 정합은 법적 경계 확정을 의미하지 않는다.

**면적:** 공부면적·편입면적·연속지적도 도형면적은 각기 별도 값으로 남긴다.
도형면적 오차는 주의 표시하고 자동 정정하지 않는다. **법적 면적은 토지대장,
법적 경계는 지적측량에 따라 별도 확인**한다.

## BSO 적용위치
- 신규 독립 실행기 `bso/tools/cadastral_aerial.py`
- 실행/의존성 `bso/RUN_CADASTRAL_AERIAL.cmd`, `bso/tools/requirements_cadastral_aerial.txt`
- 사용 가이드 `bso/tools/README_CADASTRAL_AERIAL.md`
- 합성 SHP·API mock 회귀 `bso/tests/test_cadastral_aerial.py`
- 기존 `RUN_SUBJECT_ONLY_GIS.cmd`·QGIS/VWorld 모듈은 변경하지 않는다.

## 완료상태
CI(합성·mock)는 **회귀 검증**만 나타낸다. 실사건에 대한 `DONE` 판단은
실제 SHP로 필지 추출·API 이미지 다운로드·실제 산출물 재열람까지 확인해야 한다.
원본 조서 미대조, 영상 출처 교체 또는 대외 사용 전 승인 미완료는 별도 `PARTIAL`로 남긴다.

상세 사용법: [BSO portable runner](../bso/tools/README_CADASTRAL_AERIAL.md).
