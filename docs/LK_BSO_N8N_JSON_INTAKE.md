# BSO JSON → n8n 비공개 접수 대기열

## 적용 범위

BSO에서 내려받은 `BSO_*.json` 요청을 전용 비공개 Drive 폴더에 넣으면 n8n이 접수한다. 원본 문서 파일은 전송하지 않는다. 접수된 요청은 `PENDING_APPROVAL`이며, 기존 실행 디스패처는 이 상태를 실행 대상으로 선택하지 않는다. 접수는 유료 모델 실행 또는 법률·제출 승인을 뜻하지 않는다.

- 형식: `lk-bso-job/1.0`, `READY`, attempts=0.
- PUBLIC/SYNTHETIC만 허용. 이 표시는 사용자의 분류이며 내용의 독립적인 비식별 검증은 아니다.
- 본문 SHA-256, 문서 ID, 버전, 산출물 SHA-256을 확인한다.
- 같은 작업 ID와 같은 입력은 중복으로 건너뛴다. 같은 ID의 다른 입력은 차단한다.
- 대기열의 기존 결과·검토자·승인은 접수 재실행으로 덮어쓰지 않는다.
- 디스패처와 같은 원자적 잠금을 사용한다. 잠금이 사용 중이면 저장하지 않고 다음 감지/복구 때 재시도한다.
- 접수 후 본문이 바뀌면 실행 시 차단한다. 변경 요청은 BSO에서 새 작업 ID로 발급한다.
- 실행 결과의 `bso_receipt_json`은 현재 문서 버전·파일 지문·입력 해시와 결속되며 인간 승인을 부여하지 않는다.

## 운영

전용 폴더의 신규 파일 감지는 5분 간격이다. 매일 07:15 한국시간에 누락 접수를 재확인하며 수동 확인도 가능하다. 파일 수 상한은 100개, JSON 읽기 상한은 100,000바이트다. 접수 오류와 중복은 n8n 실행 영수증에 기록한다. 원본 파일을 자동으로 이동·삭제하지 않는다.

`LK_AI_JOBS`의 기존 A:X는 유지하고 Y:AB에 `bso_context_json`, `bso_receipt_json`, `intake_source_file_id`, `intake_execution_id`를 추가한다. 기존 비-BSO 작업은 종전 경로를 유지한다.

운영자가 별도로 모델 실행 범위와 비용을 승인한 뒤에만 해당 작업을 `PENDING`으로 전환한다. 이번 배포에서는 합성 접수 시험만 수행했으며 실제 모델 실행·결과 회수의 종단 시험은 수행하지 않았다. BSO의 결과 가져오기는 기존 JSON 수동 가져오기 방식이다.

## 검증 기록

2026-11-05 실제 n8n 실행 301: 합성 JSON 1건을 Sheets 대기열에 저장, `PENDING_APPROVAL`, attempts=0, 추가 제공자 허용=false, 문서 버전·파일 지문·접수 출처 보존, 잠금 해제=true. 실행 302: 같은 파일 재접수에서 `DUPLICATE_SKIPPED`, 신규 저장 0건, 잠금 해제=true. 두 접수 흐름에는 모델 노드가 없으며 외부 모델 호출은 0회다.

순수 함수 시험은 입력 위변조·비공개 분류·문서 버전 충돌·추가 필드·중복 ID·손상된 큐·접수 후 본문 변경을 확인한다. 기존 문서 이관 및 실행 결과 검증 시험도 함께 통과했다.

## 재현 및 복구

```sh
node --test tests/lk_bso_intake.test.js tests/lk_execution_contract.test.js tests/document_execution_handoff.test.js
node scripts/build_n8n_bso_intake.js PRIVATE_DISPATCHER_EXPORT.json PRIVATE_FOLDER_ID NEW_PRIVATE_INTAKE.json NEW_PRIVATE_DISPATCHER.json
```

실제 워크플로 내보내기에는 계정 연결 참조와 비공개 경로가 있으므로 저장소에 커밋하지 않는다. 빌더 출력은 설치 전 파일이다. 기존 n8n 편집기에서 JSON을 가져오면 노드가 추가될 수 있으므로 디스패처는 해당 노드의 코드·매핑만 반영하고 다시 내보내 대조한다. 새 접수 흐름은 빈 편집기에 가져온다. 배포는 n8n 버전 기록에서 되돌릴 수 있다. 비정상 중단으로 잠금이 남으면 실행 상태를 확인한 뒤 복구하며, 잠금을 임의로 무시하지 않는다.
