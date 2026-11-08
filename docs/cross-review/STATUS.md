# LK 교차검증 구현 상태와 인수 대장

기준일: 2026-11-07. 현재 전체 상태는 **PARTIAL**이다. 이 문서는 설계 완료, 모의 구현, 실제 API 실행, 실제 BSO 반영과 운영 배포를 구분한다.

## 현재 확인된 사실

| 항목 | 확인 결과와 범위 |
|---|---|
| 저장소 기준 | `b4a117574b892197b9fdfb6dcf9cd7ab5c68175e`, PR 20 병합 커밋. 이번 검토 브랜치 `feat/lk-independent-cross-review`의 출발점 |
| 기존 접수 | `lk-bso-job/1.0`, PUBLIC·SYNTHETIC 제한, `PENDING_APPROVAL`, 중복·입력 변조 차단 계약 보존 |
| 기존 실행 기록 | 저장소 문서에 2026-11-05 n8n 실행 301·302의 합성 접수/중복 시험, 모델 호출 0회 기록. 현재 서버를 직접 확인한 증거와 구분 |
| 기존 BSO 결과 회수 | 수동 JSON 가져오기. 자동 쓰기 및 read-back 종단 증거 미확인 |
| n8n 서비스 | 사용자가 알려준 n8n Cloud 주소에서 HTTPS 200과 로그인 화면을 직접 확인. 관리 API는 인증 없이 401을 반환. 실제 주소와 접근 관측은 Git 제외 운영 기록에 보관하며, 설치 버전·플랜·활성 흐름·무료 잔액은 로그인 후 확인 필요 |
| 별도 실행 호스트 | `hhjo-ThinkPad`는 오프라인으로 관측됐으나 n8n Cloud 편집기 접속의 전제는 아님. Python/SQLite 원장을 실행할 상시 호스트·영속 디스크·승인된 HTTPS 연결의 존재와 비용은 아직 미확인 |
| 자격증명 | 사용자는 기존 n8n 자격증명 재사용 선택. 비밀값 미열람·새 키 미생성 |
| 비용 정책 | 사용자 지시 `FREE_CREDITS_ONLY`. 실제 계정별 잔액·만료·모델 지원·단가 확인 전 실제 호출 차단, 유료 fallback 없음 |
| 원본 자료 | 이번 개발 시험은 합성자료만 사용. 실제 평가서 전송·이미지 검증 미실시 |
| 현재 제공 범위 | 사업자 어댑터는 `EXTRACTED_TEXT_ONLY`. PDF 이미지·도면 판독, 긴 자료의 분할 실행 계획, 비공개 사건자료 경로, BSO 자동 쓰기/read-back 미구현. 일반 서술 초안의 소유자 수치는 검증된 추출 어댑터 전까지 보류. 비용은 사용량×설정 단가 계산이며 최종 청구서 검증과 구분 |
| 외부 알림·제출 | 미연결·미실시. 사람 승인·실제 제출을 자동 부여하지 않음 |

## 단계별 상태

| 단계 | 상태 | 증거 / 남은 조건 |
|---|---|---|
| A 현황 확정 | PARTIAL | 저장소·기존 계약과 n8n Cloud 접속 확인. 관리 로그인 후 버전·플랜·활성 흐름·계정 참조·변경 전 운영 백업 확인 필요 |
| B 모의 구현 | DONE (MOCK_ONLY) | 입력 계약·영속 원장·원본 고정·예산 예약·응답 검증·모의 BSO 어댑터·비활성 n8n 템플릿 구현. 최종 통합 Python 96개·신규 JS 12개·Chromium 1개 및 기존 회귀 PASS. 구현 범위·운영 미검증 영역은 아래 구분 |
| C 실제 공개 시험 | BLOCKED | n8n 관리 인증, 계정별 무료 크레딧·만료·모델·단가 및 Cloud에서 접근 가능한 원장 호스트 미확인. 실제 모델 호출 0회 |
| D 사건자료 시험 | BLOCKED | 별도 승인된 사건자료 경로·자료 전송 범위·원본 이미지·예산·C 단계 증거 필요 |
| E 운영 반영 | BLOCKED | n8n Cloud의 실제 설정·원장 HTTPS 연결·적용 커밋·활성화·실제 BSO 자동 read-back·복구 실행 미확인 |

`B`의 시험이 통과해도 전체 자동 검증 구축은 `DONE`이 아니다. 정상 사례와 의도적 불일치 사례의 실제 Claude·Gemini·GPT 호출, 수정 후 새 버전 재검증, 실제 BSO 반영 후 동일 버전 읽기 확인이 필요하다.

## 현재 구현의 경계

- 결정론적 업무 게이트는 `OWNER_COMPARISON`과 제한된 `FORMATTING`·`FORMAT_REVIEW`를 지원한다. 다른 업무는 P1 `TASK_SCOPE_UNSUPPORTED`로 보류한다. 일반 법률·의견서 전체의 자동 근거 검증기는 구현하지 않았다.
- 수치 규칙은 원·천원과 명시적 합계/곱셈, 최종 `HALF_UP`·`DOWN` 반올림을 다룬다. ㎡·평, 지분비율, 중간 단계 반올림과 그 밖의 산식은 전용 규칙이 필요하며 알 수 없는 규칙은 보류한다.
- 일반 서술형 초안의 소유자 수치, PDF 이미지·도면의 실제 판독, 긴 자료의 분할 계획, 비공개 사건자료 경로, BSO 자동 쓰기·읽기 확인은 지원 범위 밖이다. 검증된 어댑터가 준비되기 전 모델의 통과 응답으로 이 경계를 해제하지 않는다.
- n8n Cloud에서 `127.0.0.1:8791`은 별도 원장 호스트를 가리키지 않는다. Cloud의 Code/Execute Command로 현재 Python/SQLite 서버를 내부 실행할 수 있다고 가정하지 않는다. 검증된 기존 호스트의 인증된 HTTPS 연결이 필요하며, 세션용 작업 환경이나 새 유료 호스팅을 운영 호스트로 자동 채택하지 않는다.
- n8n Gateway·Assistant 잔액과 개별 사업자의 직접 API 크레딧은 구분한다. 현재 HTTP 사업자 어댑터에 Gateway 크레딧을 직접 적용하지 않는다. 실제 지원 경로·잔액·자동 충전 여부를 확인하기 전 호출하지 않는다.

## 30개 인수 항목

각 행의 `MOCK PASS`는 해당 합성 입력에 대한 게이트를 확인했다는 뜻이며 실제 운영 통과와 다르다. 한 결과를 다른 항목에 일괄 복제하지 않는다. 모의 게이트의 통과는 실제 사건 정확도·원본 이미지 판독·운영 동시성·자동 반영 성공을 보증하지 않는다.

| 번호 | 합성 입력과 기대 결과 | 모의 결과·증거 | 실제 운영 게이트 |
|---|---|---|---|
| 1 | 표 열 순서를 바꾸어도 소유자별 대응 불변 | MOCK PASS: 기존 [ownership_column_order.test.js](../../parser/tests/ownership_column_order.test.js) 및 [소유자 브라우저 회귀](../../tests/product-v2-browser/ownership_identity.spec.js) Chromium 합성시험 PASS. 신규 모듈에 표 파서를 복제하지 않음 | 실제 원본 표의 머리글 의미 확인 |
| 2 | 소유자 행 순서를 바꾸어도 대응 불변 | MOCK PASS: `test_02_owner_rows_and_03_upload_order_do_not_identify_owners`의 행 순서 assertion ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 평가서 원본 위치 대조 |
| 3 | 업로드 순서를 바꾸어도 대응 불변 | MOCK PASS: `test_02_owner_rows_and_03_upload_order_do_not_identify_owners`의 업로드 순서 assertion ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 여러 평가서의 식별자·대응표 확인 |
| 4 | 합계가 같도록 소유자 금액을 교환하면 오류 검출 | MOCK PASS: `test_04_equal_total_swapped_owners_detected` ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 소유자·물건별 원본 금액 대조 |
| 5 | 조합원번호·명세번호가 충돌하면 대체 추정 없이 보류 | MOCK PASS: `test_05_member_statement_collision_no_fallback` ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 번호 체계와 대응표 검증 |
| 6 | 번호 누락·중복은 원본 위치를 남겨 보류 | MOCK PASS: `test_06_missing_duplicate_owner_hold` ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 누락·중복 입력의 중단 확인 |
| 7 | 같은 필지의 다른 소유자 요인 혼입 검출 | MOCK PASS: `test_07_owner_factors_not_reused_on_same_property` ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 소유자·물건·평가서별 이미지 근거 대조 |
| 8 | 단위·정밀 십진수·반올림 위치 차이를 설명, 규칙 미상은 미해결 | MOCK PASS 범위: 원/천원·합계/곱셈·최종 HALF_UP/DOWN·규칙 미상 보류, `test_08_units_decimal_rounding_and_unknown_rule` ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 면적·지분·중간 반올림·모든 요인 산식·가격시점은 전용 규칙과 원본 확인 필요 |
| 9 | 잘린 표·누락 페이지에서 최종 사용 가능 표시 차단 | MOCK PASS: `test_09_missing_and_duplicate_pages_rejected`와 잘린 표 gate ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 PDF 전체 페이지·도면·표 범위 대조 |
| 10 | 모의 이미지 전사와 OCR이 다르면 보류 | MOCK PASS: `test_09_cropped_10_image_ocr_mismatch_11_legacy_hold`의 `MOCK_TRANSCRIPTION` 불일치 gate ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 이미지 판독과 OCR 대조는 별도 시험 |
| 11 | 구형 evidence는 재입력 전 `PARSE_HOLD` 유지 | MOCK PASS: evidence gate ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) 및 기존 CaseStore 복원 시 `PARSE_HOLD`·검수 초기화 ([Chromium 합성 브라우저](../../tests/product-v2-browser/ownership_identity.spec.js)) | 실제 사건 저장·복원·재입력 경로 확인 |
| 12 | 두 요청이 동일 원본·초안을 받고 서로의 답변을 받지 않음 | MOCK PASS: `test_independent_payloads_share_full_source_and_have_no_peer_answers` ([사업자 계약](../../tests/cross_review/test_providers.py)), 정상 pipeline ([runner 시험](../../tests/cross_review/test_engine.py)) | 실제 요청 payload·전송 해시·범위 확인 |
| 13 | 원본·manifest 해시가 다른 응답 병합 차단 | MOCK PASS: `test_13_review_source_and_artifact_binding`, 입력·manifest 변조 검사 ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 runner 입력·응답 영수증 결합 확인 |
| 14 | 두 모델이 같은 오답에 동의해도 규칙 검사가 차단 | MOCK PASS: `test_14_model_consensus_cannot_override_rules` ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 실제 원본과 결정론적 계산 결과 대조 |
| 15 | 출처·인용 위치 확인 불가는 미검증 | MOCK PASS: 근거 부재 unresolved·공식 원문 열람/적용일 gate ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 공식 원문 열람·적용 시점·위치 증거 |
| 16 | 모델 본문의 가짜 실행 주장은 실제 호출로 인정하지 않음 | MOCK PASS: `test_generated_claims_cannot_supply_actual_execution_evidence`, 공식 형식의 모의 envelope 필드 검사 ([사업자 계약](../../tests/cross_review/test_providers.py)) | 사업자 요청 ID·실제 모델·runner 시각·사용량 증거 |
| 17 | mock 실행 구간이 겹치는지 측정, 독립성과 동시성을 구분 | MOCK PASS: `test_12_17_normal_independent_overlapping_pipeline`의 모의 시계 구간 검사 ([runner 시험](../../tests/cross_review/test_engine.py)), 비대기 자식 호출 구조 ([템플릿 시험](../../tests/lk_cross_review_workflows.test.js)) | 실제 n8n 자식 실행·사업자 호출의 시작/종료 겹침 |
| 18 | 두 디스패처 경쟁 시 선점·비용 예약 1회 | MOCK PASS: `test_two_processes_only_one_dispatcher_claims`, `test_all_parallel_costs_reserved_atomically_or_none` ([원장 시험](../../tests/cross_review/test_ledger.py)) | 실제 n8n 디스패처 경쟁 시험 |
| 19 | 동일 ID·다른 입력은 호출 전 충돌 차단 | MOCK PASS: `test_idempotency_and_different_input_conflict` ([원장 시험](../../tests/cross_review/test_ledger.py)) | 운영 재접수에서 중복 호출 0회 확인 |
| 20 | 이전 산출물 버전의 지연 응답은 현재 판정에서 제외 | MOCK PASS: `test_version_change_invalidates_approval_and_excludes_old_response` ([원장 시험](../../tests/cross_review/test_ledger.py)) | 실제 지연·재시작 후 원장 감사 기록 확인 |
| 21 | 수정본은 새 해시, 기존 승인 무효화 후 재검증 | MOCK PASS: `test_21_discrepancy_revision_new_version_both_reviews_and_judge`의 수정·새 버전·두 재검토·재판정 총 7단계 ([runner 시험](../../tests/cross_review/test_engine.py)), 승인 초기화·구버전 제외 ([원장 시험](../../tests/cross_review/test_ledger.py)) | 실제 수정·양쪽 재검토·GPT 재판정 증거 |
| 22 | 한 검토자 실패 시 부분 결과 보존, 성공 종료 금지 | MOCK PASS: `test_22_one_reviewer_failure_never_succeeds` ([runner 시험](../../tests/cross_review/test_engine.py)) | 실제 한쪽 실패·비용 정산·복구 확인 |
| 23 | 접수 불명 timeout은 `BLOCKED_RECONCILE`, 자동 재호출 금지 | MOCK PASS: `test_unknown_timeout_not_redispatched_and_keeps_cost` ([원장 시험](../../tests/cross_review/test_ledger.py)), 재시작·지연 영수증 정산 ([runner 시험](../../tests/cross_review/test_engine.py)) | 실제 사업자 접수 기록과 대조 절차 확인 |
| 24 | 예산 부족·상한 도달 시 추가 호출 차단 | MOCK PASS: 병렬 비용 전부 예약·10회 시도 상한·크레딧 증거 만료·계정별 예약 경쟁·잔액 초기화 차단 ([원장 시험](../../tests/cross_review/test_ledger.py)), 최초 전체 계획 예산 gate ([runner 시험](../../tests/cross_review/test_engine.py)) | 확인된 무료 크레딧 예약·사용량·잔액 대조 |
| 25 | 중단·재시작·lease 만료 후 영속 상태로 복구 | MOCK PASS: 시작 fence·진행 중 lease 만료 조정 보류·미시작 lease 회수·미확정 비용의 재시작 후 유지 ([원장 시험](../../tests/cross_review/test_ledger.py)), `test_25_provably_unstarted_expired_reservations_can_recover` ([runner 시험](../../tests/cross_review/test_engine.py)) | 실제 호스트 오프라인/복귀·프로세스 중단 시험 |
| 26 | 비공개 자료가 공개 접수 경로로 들어오면 호출 전 차단 | MOCK PASS: `test_26_private_route_fails_closed` ([계약·규칙 시험](../../tests/cross_review/test_contract_rules.py)) | 승인된 별도 사건자료 경로 확인 |
| 27 | sentinel 키·인증 헤더가 로그·JSON·보고서에 남지 않음 | MOCK PASS: 입력 자격증명 거부 ([계약](../../tests/cross_review/test_contract_rules.py)), 오류 헤더 비노출 ([사업자](../../tests/cross_review/test_providers.py)), `test_error_messages_never_echo_unknown_secret_input` ([서버](../../tests/cross_review/test_server.py)), 비공개 envelope 내보내기 제외 ([BSO](../../tests/cross_review/test_bso.py)), 실행 데이터 비저장 ([템플릿](../../tests/lk_cross_review_workflows.test.js)) | 실제 n8n 저장 정책·비공개 백업·오류 기록 점검 |
| 28 | 문서 내 명령·URL로 shell·비인가 전송을 실행하지 않음 | MOCK PASS: 문서 지시문은 인용 자료, 모델 tools 부재·모델 경로 주입 거부 ([사업자 계약](../../tests/cross_review/test_providers.py)), HTTP 사업자 주소 고정·redirect 금지 ([템플릿](../../tests/lk_cross_review_workflows.test.js)) | 실제 runner 도구·대상 주소 제한 확인 |
| 29 | 모의 BSO read-back 불일치 시 반영 성공 금지 | MOCK CONTRACT PASS: `test_real_adapter_readback_contract_rejects_file_receipt_and_stale_version` ([BSO 비교 계약](../../tests/cross_review/test_bso.py)); 기존 importer의 저장 버전 불일치 거부 ([BSO 통합 시험](../../tests/lk_cross_review_bso.test.js)). 실제 자동 write/read는 미구현 | 실제 BSO 문서 ID·job·snapshot·버전/해시를 다시 읽어 일치 확인 |
| 30 | 검증·import·모델 응답이 사람 승인·적용·제출을 부여하지 않음 | MOCK PASS: `test_30_quick_is_not_independent_or_human_approved` ([runner](../../tests/cross_review/test_engine.py)), import 시 DRAFT·checks·human_approved 보존 및 승인 주입 거부 ([BSO 통합](../../tests/lk_cross_review_bso.test.js)) | 실제 사람 승인·적용·제출의 별도 권한·증거 확인 |

## 모의시험 실행 기록

```sh
python -u -m unittest discover -s tests/cross_review -v
python -u scripts/run_cross_review_mock.py NEW_DIR
node --test tests/lk_cross_review_workflows.test.js tests/lk_cross_review_bso.test.js
node --test parser/tests/member_identity_factors.test.js parser/tests/ownership_column_order.test.js
node tests/validate_static_site.js
git diff --check
PLAYWRIGHT_BROWSERS_PATH=/tmp/lk-cross-review-playwright npx playwright test -c playwright.product-v2.config.js tests/product-v2-browser/ownership_identity.spec.js --project chromium-1440
```

최종 통합 실행은 Python **96개 PASS, 3.423초**였다. 구성은 계약·규칙31, 원장21, 사업자13, BSO6, runner20, 서버5다. [전체 unittest 로그](evidence/python-unittest.log)에 각 시험명과 결과를 보존했다. 신규 JS는 템플릿8·BSO4 PASS이며 기존 BSO 계약·소유자/요인·열순서 및 정적 사이트 회귀도 PASS다. 개인정보 보호 검사는 추적 경로 616개에서 PASS했다. 외부 모델 호출은 0회다.

서버 시험은 실제 localhost HTTP를 사용했다. 샌드박스의 loopback 제약 때문에 권한 확장으로 실행했으며, 외부 사업자 네트워크나 모델 호출을 사용하지 않았다. 각 시험의 합성 입력·기대 결과·assertion은 위 표의 파일에 있다. typed row 검사·출처/이미지 전사 gate·SQLite 프로세스 경쟁·재시작·localhost 인증·비활성 템플릿·기존 BSO importer의 모의 증거이며 실제 원본 판독·설치 n8n·사업자 호출·호스트 복구의 증거로 취급하지 않는다.

브라우저 회귀는 Chromium `chromium-1440`에서 합성자료 1개 시험 PASS, 2.8초였다. 실제 BSO parser·CaseStore 경로의 열/행 순서와 구형 evidence 복원 보류를 확인했다. WebKit은 이번 실행에서 시험하지 않았다. 위 임시 브라우저 경로는 이번 검증 환경의 설치 위치다.

후속 Cloud 접근 점검에서는 편집기·공개 상태 경로 HTTP 200과 인증 없는 관리 API HTTP 401을 확인했다. 비공개 설정의 `runner.base_url`로 승인된 HTTPS 주소·경로 접두사를 지정하는 설정을 추가했다. 템플릿 시험은 10개 PASS이며 기존 기본 JSON은 그대로다. HTTPS 경로의 일관성·redirect 차단·인증정보/로컬 주소/URL 변형 거부를 검사했으며, 실제 원장 DNS·TLS·Cloud 연결을 검증한 결과는 아니다. 로그인·워크플로 수정·제공자 호출은 수행하지 않았다.

정상 모의 사례는 검토2·판정1, 불일치 모의 사례는 수정·새 버전·재검토2·재판정을 포함한 총 7단계로 검증했다. 원장의 비용 `0.03`·`0.07`은 모의 계산값이며 실제 사업자의 실행·청구·무료 크레딧 사용 증거가 아니다.

재현 스크립트의 `NEW_DIR`는 아직 없는 출력 디렉터리여야 한다. 기존 파일을 덮어쓰지 않는다. 공개된 증거는 모두 합성자료이며 다음 네 파일에 해시·모의 영수증·산출물 버전·모의 export 결과가 있다.

- 정상 사례: [검토 증거](evidence/normal-mock-evidence.json), [BSO 수동 import 패키지](evidence/normal-bso-package.json). 모의 3단계, 산출물 v1.
- 불일치 사례: [수정·재검증 증거](evidence/discrepancy-mock-evidence.json), [BSO 수동 import 패키지](evidence/discrepancy-bso-package.json). 모의 7단계, 수정본 v2. 패키지의 BSO 수정본 대응표도 합성값이며 실제 BSO 저장/반영 증거가 아니다.

두 증거는 `actual_provider_calls:0`, `actual_bso_auto_writes:0`, `actual_billed_cost:null`, 무료 크레딧 잔액 `UNVERIFIED`를 명시한다. 패키지 생성·파일 read-back을 실제 BSO 자동 반영 완료로 표시하지 않는다.

현재 소유자 수치 검산은 실제 초안 JSON에서 추출한 구조화 행을 사용한다. 검증되지 않은 별도 후보 행을 초안의 실제 내용으로 간주하지 않는다. 일반 서술형 초안의 소유자별 수치는 검증된 추출 어댑터가 없으면 P1 보류하며, 이 제한을 모델 응답으로 해제하지 않는다.

## 실제 실행·해시·비용 대장

현재 실제 모델 실행 ID는 **없음**이며, 무료 크레딧 잔액과 실제 사업자 비용은 **미확정**이다. 외부 모델 호출은 0회이고 원장의 `0.03`·`0.07` 등은 계산 시험용 모의 비용이다. 이를 실제 계정의 사용량·잔액·청구액 0원으로 바꾸어 기록하지 않는다.

실제 시험을 시작하면 다음을 원장과 접근 제한된 증거 보관소에 남긴다. 이 문서에는 개인정보와 비밀값을 넣지 않는다.

- job·case·snapshot·manifest·산출물 버전/해시, 원본 doc ID·SHA-256·페이지·OCR/추출 버전.
- reviewer·attempt·설정 모델·실제 모델·사업자 요청 ID·n8n 실행 ID·시작/종료 시각·제공한 입력 해시·프롬프트 버전·응답 해시.
- 검토 범위·누락·규칙 검사·근거별 판정·미해결 쟁점·수정 이력·승인 무효화 기록.
- 통화·가격 기준일·무료 크레딧 확인 시각/만료·예약·실제 사용량·비용·미확정 비용·실패 시도.
- BSO 반영 문서 ID·반영 시각·read-back 결과·검증 상태·승인 상태. 업무 적용·외부 제출 증거는 별도로 기록.

## 담당자에게 제시할 결과

사건·산출물 버전 → 검증 상태 → 실제 검토 AI → 원본 검토 범위 → 핵심 차이 최대 3건 → 소유자별·요인별 대조 → 미해결 쟁점과 필요한 결정 → 원본 위치 → 비용·소요시간 → 다음 조치 순서로 제시한다. 모의 실행에는 실제 검토 AI가 실행된 것으로 표시하지 않는다.

설치·중지·재개·비용 변경·오류 조사·자격증명 교체·롤백은 [RUNBOOK.md](RUNBOOK.md)를 따른다. 현 호스트·무료 크레딧·실제 반영 증거가 확보될 때까지 미실행 항목을 운영 완료로 바꾸지 않는다.
