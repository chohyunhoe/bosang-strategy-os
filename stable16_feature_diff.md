# stable16 대비 현재 HEAD 누락 기능 diff

## 기준

- 비교 기준 원본: `bosang_os_v04_alpha2_stable16.html`
- 비교 대상: 작업 시작 시점의 `index.html` 73줄 단순 정적 렌더러
- 백업 파일: `index.head-backup.html`

## 현재 HEAD에서 빠져 있던 stable16 기능

1. `보상전략 OS v0.4-alpha2-stable16` 앱셸, sticky header, 좌측 내비게이션, 개발자 상세 메뉴.
2. 5개 Workflow 구조: 관제 및 원본, 토지 및 공적자료, 평가논리 검토, 지장물 및 단가, 쟁점 및 의견서.
3. 업로드·JSON 관리, 원본·추출상태, OCR 검수 작업대, v0.4 문서해석 작업대 등 개발자 상세 화면 전체.
4. 공적 토지특성 보강 구조: `public_land_characteristics`, `public_land_data_enrichment`, `land_characteristics`, `land_characteristic_crosscheck`, `renderPublicData()`.
5. 필지별 평가결과 비교 구조: `comparison_summary_by_land`, `land_appraisal_results`, 법인별 표준지·개별요인·그 밖의 요인·단가·금액 비교표.
6. 편입토지↔표준지 개별요인 비교: `subject_to_standard_factor_comparisons`, `renderSubjectFactors()`, 공적 API 보강 스펙/평가서 기재 스펙 비교, 핵심 차이 칩, 압축 스펙카드.
7. 표준지↔거래사례 개별요인 비교: `standard_to_comp_case_factor_comparisons`, `renderCaseFactors()`.
8. 그 밖의 요인 상세: `other_factor_reviews`, 사례단가, 시점수정, 개별요인, 사례기준, 공시지가기준, 격차율, 결정치 비교.
9. OCR 검수 작업대: `ocr_review_items`, `v04_ocr_factor_candidates`, 이미지 PDF OCR 후보 생성, 크롭/원문 검수, 확정값 JSON 반영, `subject_to_standard_factor_comparisons` 반영.
10. PDF.js 기반 문서해석 작업대와 `documentWorkspace` 렌더링 흐름.
11. 쟁점 후보, 의견서 보조문안, 리스크 경고 구조.

## 복원 방식

`bosang_os_v04_alpha2_stable16.html`을 `index.html`의 기능 기준으로 복원했고, 회귀 테스트는 stable16 핵심 기능 문자열 및 렌더 함수 존재 여부를 검증하도록 갱신했습니다. 내비게이션의 편입토지↔표준지 상세 라벨은 회귀 테스트 요구 문구와 일치하도록 명시형 문구로 보강했습니다.

## 미복원 항목

작업 범위 내 미복원 항목은 없습니다. `index_standalone.html`은 기존 모바일 단일파일 산출물로 유지했으며, stable16 기능 기준 파일은 `index.html`입니다.
