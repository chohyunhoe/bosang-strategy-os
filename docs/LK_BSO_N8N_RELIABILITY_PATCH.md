# LK BSO · n8n 신뢰성 패치

2026-11-05. BSO는 문서·사건별 근거를 관리하고 n8n은 기존 실행 흐름을 유지한다.

## BSO

- 파일을 브라우저에서 SHA-256으로 식별하고 이름·크기·지문만 보관한다. 파일 본문은 업로드하거나 사건 JSON에 넣지 않는다.
- 파일 내용이 바뀌면 문서 수정본을 시작하고 이전 검수·승인·제출 상태를 해제한다.
- 공개·합성 작업지시를 n8n 작업요청 JSON으로 저장한다. 이 기능 자체는 AI 호출이나 n8n 전송을 수행하지 않는다.
- 요청은 READY/attempts=0이다. n8n 대기열의 기존 접수·claim 절차가 RUNNING/attempts=1로 전환한 뒤 Worker에 전달해야 한다. BSO에서 운영 대기열로 자동 접수하는 게이트웨이는 아직 포함하지 않는다.
- 실행영수증은 작업 ID, 문서 ID, 수정본, 문서 지문, 입력 해시가 일치해야 기록할 수 있다. 중복 실행결과와 이전 수정본의 결과는 거절한다.
- 가져오기는 수동 기록으로 표시한다. 전자서명이나 인증된 서버 영수증이 아니며, 직원 신원이나 실제 AI 호출을 BSO가 독립적으로 증명하지 않는다.
- AI 실행결과는 사람의 검수·승인·제출 상태를 변경하지 않는다.
- 파일 읽기·해시 계산 중 사건이 바뀌면 기록을 취소한다.

## n8n 운영 코드

`integrations/n8n/lk-execution-contract.cjs`가 공통 검증 원본이다.

- Review Decision / Repair Decision: unresolved 항목이 남은 검토를 통과시키지 않는다. 잘못된 검토 스키마도 거절한다.
- Validate LK Queue Input: 공개·합성 입력만 허용하고, 공백·잘못된 입력·미claim 작업·입력 해시 불일치·0/음수/과도한 재시도를 거절한다. PUBLIC을 SYNTHETIC으로 바꾸던 접두어도 수정한다.
- Return LK Queue Result: 하위 작업의 작업 ID·출력 해시·검수상태·전송범위와 입력 해시를 재대조한다. 검증을 통과해도 NEEDS_GPT_REVIEW이며 사람의 승인으로 승격하지 않는다.
- BSO 문맥이 있으면 `lk-bso-receipt/1.0` 영수증을 반환한다.
- 기존 인증·모델·노드 연결·트리거를 유지하며 새 외부 AI 호출은 추가하지 않는다.

## 검증과 배포 구분

- `node tests/document_workflow.test.js`
- `node tests/document_execution_handoff.test.js`
- `node tests/lk_execution_contract.test.js`
- `integrations/n8n/lk-contract-selftest.json`: 실제 n8n 서버에서 실행할 수 있는 합성자료 전용 21개 검사. 외부 모델·외부 HTTP 노드는 없다.
- 운영 워크플로 수정 전후 JSON을 비교해 변경한 Code 노드와 기존 연결 보존 여부를 확인한다. 운영 백업에는 인증 참조나 내부 식별자가 있을 수 있으므로 공개 저장소에 넣지 않는다.
- BSO Product v2 / Windows Release v1 브라우저 검증과 구형 루트 화면의 전체 반응형 검증은 별개다. 후자의 실패를 제품 전체 통과로 보고하지 않는다.

## 아직 필요한 운영 단계

인증된 직원·사건별 접근권한, 서버 저장·서명된 실행기록, 대기열 자동 접수, 중단 지점 재개, 실제 문서의 변호사 채택·제출·회신 검증은 별도 단계다.
이 패치는 전사 시스템 전체 완성을 의미하지 않는다.
