# 보상전략 OS v0.1 PC 검증 게이트

## 결론

사용자가 직접 해야 하는 일은 두 가지입니다.

1. `RUN_PC_GATE.cmd`를 더블클릭하고, 자동으로 열린 브라우저에서 익명화된 **텍스트형 또는 부분 비추출 혼합형 감정평가서 PDF 1건**을 선택합니다.
2. 실행 창에 `자동 계수 수신`이 표시된 뒤 원문과 화면을 육안 대조하고, `P` / `W` / `F` 중 하나를 입력합니다.

- `P`: PASS
- `W`: PASS_WITH_WARNINGS
- `F`: FAIL

텍스트 추출, 구조화 Parser, 후보 생성, 합성 지도 주입, 결과 정렬 화면 이동, 회귀검증과 판정기록 생성은 자동으로 수행됩니다.
브라우저가 Parser 실행 수, 평가법인명 인식 수, 편입토지 행 후보·인식 수, 비교표준지·평가행 수와 안전 상태를 로컬 실행 기록에 전달하기 전에는 판정 입력창이 열리지 않습니다.
브라우저 준비상태는 `READY_FOR_VISUAL_REVIEW` 또는 `READY_WITH_REVIEW` 입니다. 후자는 하드 블로커가 없고 검토항목만 남은 상태이며 육안 판정으로 넘어갑니다.
`pc-gate/0.8`은 이 값을 실행기에서 다시 계산하므로 브라우저가 `READY`를 보고해도 하드 블로커가 있으면 `BLOCKED/FAIL`로 고정합니다.

## v0.1 검증 범위

- 실제 PDF: 익명화 `TEXT_PDF` 또는 일부 페이지만 텍스트층이 비어 있는 `PARTIAL_TEXT_LAYER_PDF` 1건
- 실제 PDF 분석: 평가법인·기준시점·편입토지·비교표준지·평가행·평가총액
- 지도: 실제 PDF의 좌표를 추정하지 않고 비식별 합성 형상으로 지도 렌더링과 결과 정렬만 검증
- 부분 비추출 혼합형 PDF: OCR 후보가 전체의 35% 이하이면 0자 페이지와 후반 표 페이지를 우선해 최대 16쪽까지 브라우저 안에서 로컬 OCR
- OCR 후보가 16쪽을 조금 넘더라도 전체 후보를 폐기하지 않고 우선순위 16쪽을 처리하며, 후보·선택·복구·수용·제외 수만 실행기록에 남김. 다만 제외 페이지가 1쪽이라도 남거나 OCR 예산 제한이 발생하면 v0.8 최종 게이트는 차단
- 1차 OCR 후 평가법인·비교표준지·편입토지·평가행이 누락되거나 편입토지 행 후보보다 적으면 관련 표지·표준지·후반 토지표 페이지만 3.0배로 다시 OCR합니다. 그래도 불완전하면 같은 페이지만 2.2배 대안 렌더링으로 한 번 더 비교하며, Parser 구조화 점수가 더 높은 페이지 텍스트만 보존합니다.
- 평가법인명이 계속 누락되면 표지의 `감정평가법인` 표식 주변만 3.0·4.0배로 분리해 여러 페이지 분할 모드로 다시 읽습니다. 서로 다른 해상도 2개 이상과 분할 모드 2개 이상에서 같은 이름 후보가 3회 이상 합의되고 차순위보다 2회 이상 앞설 때만 Parser 후보로 사용합니다. 개별 OCR 원문·변형 후보·해시 지문은 저장하지 않으며, 합의된 구조화 법인명만 핵심 추출 화면에 `검수 필요`로 표시합니다. `PC_GATE_RESULT.json`에는 법인명을 기록하지 않습니다.
- 텍스트가 완전히 비어 있는 후보만 16쪽을 초과하면 `OCR_PAGE_BUDGET_EXCEEDED`로 차단
- 전체 이미지 PDF: `OCR_REQUIRED` 또는 `BLOCKED`로 중단하며 자동확정하지 않음

실제 PDF의 좌표를 추정하거나 OCR 결과를 자동확정하지 않습니다. 선택 OCR 결과도 `NEEDS_REVIEW`, `auto_confirmed:false`를 유지합니다.

## 자동 수행 항목

- Node.js·npm 실행환경 확인
- 의존성 설치
- Parser 및 Release Candidate 회귀검증
- 개인정보 최소화 릴리즈 재빌드
- 실행별 판정기록 폴더 생성
- 로컬 정적 서버 실행 및 준비상태 확인
- `?pc_gate=1` 브라우저 자동 열기
- PDF 선택 후 텍스트 추출 → 부분 비추출 페이지 로컬 선택 OCR → 구조화 Parser → 후보 생성 자동 연쇄
- Parser 미실행, 평가법인명 미인식, 편입토지 0필지, 비교표준지 0건 또는 평가행 0건이면 결과 정렬로 넘기지 않고 `BLOCKED` 처리
- PDF 1건에는 Parser 실행·Parser 평가서·저장된 평가서가 각각 정확히 1건이어야 함. 버전이 다른 브라우저 보고, 중복 평가서 또는 중복 실행은 `BLOCKED` 처리
- 편입토지 완전성은 조서 행 계측으로 판정함. `subject_land_data_row_candidates == subject_land_parsed_rows` 이고 `subject_land_lost_rows == 0` 이어야 함
- 평가행이 편입토지보다 **많으면** 자동 생성·복제·추정 의심으로 `BLOCKED`
- 평가행이 편입토지보다 **적더라도**, 파서 손실 지표(`appraisal_row_reject_starts_with_address_count`, `unmatched_identity`, `ambiguous_identity`, `unindexable_lands`, `duplicates`, Parser 제외·미연결)가 모두 0이고 구조화된 평가행이 전부 연결됐다면 차단하지 않고 검토항목 `APPRAISAL_ROW_COVERAGE_GAP` 으로 기록함. 현황분리행처럼 원문 산출근거가 편입토지보다 적은 서식이 있기 때문이며, **없는 평가행을 만들어 채우지 않음**
- 위 손실 지표가 하나라도 0이 아니면 `APPRAISAL_ROWS_LOST_BY_PARSER` 로 `BLOCKED`
- 정규화 과정에서 합쳐지거나 연결되지 않아 버려진 행도 `BLOCKED` 처리
- 각 평가행이 현재 평가서에서 유일하게 식별된 비교표준지와 연결되지 않으면 `BLOCKED` 처리
- 선택 OCR 제외 페이지가 있거나 OCR 페이지 예산 제한이 발생하면 `BLOCKED` 처리
- `NEEDS_REVIEW`, `auto_confirmed:false` 경계 확인
- 브라우저 런타임 계수를 로컬 `PC_GATE_RESULT.json`에 자동 기록
- 평가법인 국소 OCR은 시도·후보·합의 횟수와 채택 여부만 기록하고, 회사명·OCR 원문·해시 지문은 기록하지 않음
- 런타임 보고, 구조 완전성, `NaN`·`undefined`, 자동확정 금지 중 하나라도 실패하면 PASS 입력 차단
- 비식별 합성 지도 주입 및 결과 정렬 화면 이동

## 입력 전 보안 확인

실제 평가서 원문을 저장소, GitHub 이슈 또는 PR에 첨부하지 않습니다. 사건명, 성명, 주민등록번호, 계좌, 상세주소, 보상금 등 재식별 요소를 마스킹한 사본만 로컬에서 사용합니다.

PDF 파일과 선택 OCR 이미지는 브라우저 메모리에서 처리되며 저장소나 외부 서버에 쓰지 않습니다. PC 게이트는 `127.0.0.1` 로컬 서버에서 실행됩니다.

## 육안 확인 항목

- 평가법인명과 기준시점
- 편입토지 소재지·지목·면적
- 비교표준지 기호·소재지·공시지가
- 공시지가·시점수정·지역요인·개별요인·그 밖의 요인
- 개별요인 세부항목과 source reference
- 적용단가·평가액
- 지도에 “합성” 범위가 명시되고 지도·수치표 결과 정렬이 깨지지 않는지
- 모바일 폭에서 표와 카드가 잘리지 않는지
- `NaN`, `undefined`, 확인되지 않은 자동확정이 없는지

## 판정 기준

- `PASS`: 치명적 오추출 0건, 자동확정 0건, 실무 검토에 사용할 수 있는 구조화
- `PASS_WITH_WARNINGS`: 모든 자동 하드 게이트를 통과한 뒤 경미한 표시·레이아웃 문제만 후속 수정으로 분리 가능
- `FAIL`: 대상토지 연결 오류, 수치 오추출, 개인정보 노출, 자동확정, 이전 사건 데이터 혼입, 또는 전체 이미지 PDF로 인해 v0.1 게이트 수행 불가

다음 하드 블로커는 사용자의 `PASS_WITH_WARNINGS`로 우회할 수 없습니다.

- Parser가 실행되지 않았거나 평가서·유효한 평가법인명이 인식되지 않음
- PC 게이트 작업 큐의 PDF가 정확히 1건이 아님
- 브라우저와 실행기의 게이트 버전이 다르거나 PDF 1건에 Parser 실행·Parser 평가서·저장 평가서가 각각 1건이 아님
- PDF 페이지 수가 누락되었거나 0쪽으로 보고됨
- 편입토지 또는 평가행이 0건이거나 비교표준지가 0건임
- 평가행 중 현재 평가서의 비교표준지와 연결되지 않은 행이 있음
- 편입토지 조서 행 후보와 구조화된 행 수가 다르거나 탈락 행이 남음
- 평가행이 편입토지보다 많음(자동 생성·복제 의심)
- 평가행이 편입토지보다 적으면서 파서 손실 지표가 0이 아님
- Parser 입력 행이 정규화 후 중복으로 합쳐졌거나 평가행이 편입토지와 연결되지 않아 저장에서 제외됨
- 선택 OCR에서 제외 페이지가 발생했거나 페이지 예산 제한 상태임
- `NEEDS_REVIEW` 또는 `auto_confirmed:false` 경계를 위반함
- 자동확정, `NaN`, `undefined` 등 안전 검사가 실패하거나 진단 계수가 누락·불일치함

## 판정기록

각 실행은 `pc-gate-results/<실행시각>/`에 별도로 저장됩니다. 재실행해도 이전 판정은 덮어쓰지 않습니다.

- `PC_GATE_RESULT.json`
- `PC_GATE_CHECKLIST.txt`
- 최신 실행 폴더명: `pc-gate-results/LATEST.txt`

`PC_GATE_RESULT.json`의 `upload_count`, `parser_runs`, `appraisals`, `stored_appraisals`, `named_appraisal_companies`, `subject_land_row_candidates`, `subject_lands`, `standard_lands`, `appraisal_rows`, `linked_standard_rows`, `parser_dropped_rows`, `parser_unmatched_appraisal_rows`, `page_count`가 `null`이면 분석 완료 기록이 아닙니다. 평가법인 국소 OCR 진단인 `company_ocr_attempted`, `company_ocr_candidates`, `company_ocr_consensus`, `company_ocr_accepted`도 타입이 완전해야 합니다. `pc-gate/0.5`부터는 핵심 계수 미수신 상태에서 판정 입력을 받지 않습니다. `pc-gate/0.6`은 선택 OCR 후보가 제한을 초과하면 전체 OCR을 건너뛰던 오류를 수정했습니다. `pc-gate/0.7`은 비영 조건만 통과한 불완전 결과가 `PASS_WITH_WARNINGS`로 끝나는 것을 막았습니다. `pc-gate/0.8`은 중첩 OCR 비교표준지를 한 실제 행으로만 보존하고, 저장 행, 표준지 연결 수, Parser 드롭·미연결 수 및 실행기 버전 일치를 함께 검증합니다.
편입토지 완전성은 조서 행 계측(`후보 = 파싱`, `탈락 0`)으로 판정하며, 평가행 수를 여기에 묶던 과잉 1:1 계약은 제거했습니다. 편입토지보다 평가행이 적고 파서 손실 지표가 모두 0이면 `APPRAISAL_ROW_COVERAGE_GAP` 검토항목으로 `PC_GATE_RESULT.json` 의 `review_warnings`·`review_queue` 에 기록합니다.

## 종료

육안 판정을 입력한 뒤 서버 실행 창에서 `Ctrl+C`를 누릅니다. 정상 종료 코드로 닫힙니다.
