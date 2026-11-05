// Local manual records only: no identity verification, file inspection, or submission service.
export const REVIEW_CHECKS = Object.freeze(['SOURCE', 'NUMBERS', 'LEGAL', 'FORMAT']);
export const DOCUMENT_STATES = Object.freeze(['DRAFT', 'REVIEWED', 'APPROVED', 'SUBMITTED']);
const copy = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => typeof value === 'string' ? value.trim() : '';
function required(value, label) {
  const result = text(value);
  if (!result || result.length > 1000) throw new Error(`${label}을 입력하세요(1~1000자).`);
  return result;
}
function dateOnly(value) {
  const result = required(value, '기한');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) throw new Error('유효한 기한을 입력하세요.');
  return result;
}
function evidence(actor, reference, revision) {
  return { actor: required(actor, '기록자'), reference: required(reference, '근거'), revision, recorded_at: new Date().toISOString() };
}
function validEvidence(value, revision) {
  return value && text(value.actor) && text(value.actor).length <= 1000 && text(value.reference) && text(value.reference).length <= 1000 && value.revision === revision && Number.isFinite(Date.parse(value.recorded_at));
}
export function validateDocumentWorkflow(rows) {
  if (!Array.isArray(rows) || rows.length > 200) throw new Error('문서 목록 형식이 올바르지 않습니다.');
  const ids = new Set();
  for (const row of rows) {
    if (!row || !text(row.id) || ids.has(row.id)) throw new Error('문서 ID가 없거나 중복됩니다.');
    ids.add(row.id);
    for (const key of ['title', 'purpose', 'owner', 'template_ref', 'source_ref']) required(row[key], key);
    if (!Number.isSafeInteger(row.revision) || row.revision < 1 || !DOCUMENT_STATES.includes(row.status) || !Array.isArray(row.history) || !Array.isArray(row.followups) || !row.checks || typeof row.checks !== 'object' || Array.isArray(row.checks)) throw new Error('문서 상태 형식이 올바르지 않습니다.');
    if (!validEvidence(row.created, 1)) throw new Error('문서 등록 근거가 없습니다.');
    if (row.artifact != null && (!text(row.artifact.name) || !/^[a-f0-9]{64}$/.test(row.artifact.sha256 || '') || !Number.isSafeInteger(row.artifact.size) || row.artifact.size < 0 || row.artifact.revision !== row.revision)) throw new Error('문서 파일 지문 형식이 올바르지 않습니다.');
    for (const collection of ['handoffs', 'execution_receipts']) {
      if (row[collection] !== undefined && (!Array.isArray(row[collection]) || row[collection].length > 200)) throw new Error('실행 기록 형식이 올바르지 않습니다.');
      const jobIds = new Set();
      for (const item of row[collection] || []) {
        if (!item || !text(item.job_id) || jobIds.has(item.job_id) || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.revision > row.revision || !/^[a-f0-9]{64}$/.test(item.input_sha256 || '') || !/^[a-f0-9]{64}$/.test(item.artifact_sha256 || '')) throw new Error('실행 기록의 작업·수정본 연결이 올바르지 않습니다.');
        jobIds.add(item.job_id);
        if (collection === 'execution_receipts' && (item.human_approved !== false || !['NEEDS_GPT_REVIEW', 'BLOCKED'].includes(item.status) || !/^[a-f0-9]{64}$/.test(item.output_sha256 || '') || !text(item.execution_id))) throw new Error('실행결과를 사람의 승인으로 가져올 수 없습니다.');
      }
    }
    for (const receipt of row.execution_receipts || []) {
      const request = row.handoffs?.find((item) => item.job_id === receipt.job_id);
      if (receipt.document_id !== row.id || !request || request.revision !== receipt.revision || request.input_sha256 !== receipt.input_sha256 || request.artifact_sha256 !== receipt.artifact_sha256) throw new Error('실행결과가 등록된 문서 작업요청과 일치하지 않습니다.');
    }
    for (const event of row.history) {
      if (!event || !Number.isSafeInteger(event.revision) || event.revision < 1 || event.revision > row.revision || !validEvidence(event, event.revision) || !['REGISTER', 'CHECK', 'APPROVE', 'SUBMIT', 'REVISE', 'ADD_FOLLOWUP', 'COMPLETE_FOLLOWUP', 'ATTACH_ARTIFACT', 'HANDOFF_REQUEST', 'IMPORT_EXECUTION'].includes(event.action)) throw new Error('문서 변경 이력 형식이 올바르지 않습니다.');
    }
    for (const [key, value] of Object.entries(row.checks)) if (!REVIEW_CHECKS.includes(key) || !validEvidence(value, row.revision)) throw new Error('현재 수정본의 검수 근거가 올바르지 않습니다.');
    if (row.status !== 'DRAFT' && !REVIEW_CHECKS.every((key) => validEvidence(row.checks[key], row.revision))) throw new Error('문서 검수 근거가 부족합니다.');
    if (['APPROVED', 'SUBMITTED'].includes(row.status) && !validEvidence(row.approval, row.revision)) throw new Error('현재 수정본의 승인 근거가 없습니다.');
    if (row.status === 'SUBMITTED' && !validEvidence(row.submission, row.revision)) throw new Error('제출 근거가 없습니다.');
    const taskIds = new Set();
    for (const task of row.followups) {
      if (!task || !text(task.id) || taskIds.has(task.id) || !['OPEN', 'DONE'].includes(task.status) || !Number.isSafeInteger(task.revision) || task.revision < 1 || task.revision > row.revision || !validEvidence(task.created, task.revision)) throw new Error('후속조치 형식이 올바르지 않습니다.');
      taskIds.add(task.id); required(task.title, '후속조치'); required(task.owner, '담당자'); dateOnly(task.due_date);
      if (task.status === 'DONE' && !validEvidence(task.completion, task.revision)) throw new Error('후속조치 완료 근거가 없습니다.');
    }
  }
  return true;
}
export function registerDocument(rows, input) {
  validateDocumentWorkflow(rows);
  if (rows.length >= 200) throw new Error('문서는 사건별 최대 200건까지 등록할 수 있습니다.');
  let sequence = 1;
  while (rows.some((row) => row.id === `WORK_DOC_${sequence}`)) sequence += 1;
  const row = { id: `WORK_DOC_${sequence}`, revision: 1, status: 'DRAFT', checks: {}, approval: null, submission: null, followups: [], history: [] };
  for (const key of ['title', 'purpose', 'owner', 'template_ref', 'source_ref']) row[key] = required(input[key], key);
  row.created = evidence(input.actor, input.source_ref, 1);
  row.history.push({ action: 'REGISTER', ...row.created });
  return [...copy(rows), row];
}
export function changeDocument(rows, id, action, input = {}) {
  validateDocumentWorkflow(rows);
  const next = copy(rows);
  const row = next.find((item) => item.id === id);
  if (!row) throw new Error('현재 사건에 문서가 없습니다.');
  const record = evidence(input.actor, input.reference, row.revision);
  if (action === 'CHECK') {
    if (row.status !== 'DRAFT' || !REVIEW_CHECKS.includes(input.check)) throw new Error('작성 중 문서의 검수 항목을 선택하세요.');
    row.checks[input.check] = record;
    if (REVIEW_CHECKS.every((key) => row.checks[key])) row.status = 'REVIEWED';
  } else if (action === 'APPROVE') {
    if (row.status !== 'REVIEWED') throw new Error('원본·수치·법률·서식 검수 기록이 먼저 필요합니다.');
    row.approval = record; row.status = 'APPROVED';
  } else if (action === 'SUBMIT') {
    if (row.status !== 'APPROVED') throw new Error('현재 수정본의 승인 기록이 먼저 필요합니다.');
    row.submission = record; row.status = 'SUBMITTED';
  } else if (action === 'REVISE') {
    row.revision += 1; record.revision = row.revision;
    row.status = 'DRAFT'; row.checks = {}; row.approval = null; row.submission = null;
    row.artifact = null;
    // Open followups survive revision; historical decisions remain in history.
  } else if (action === 'ADD_FOLLOWUP') {
    const task = { id: `TASK_${row.followups.length + 1}`, title: required(input.title, '후속조치'), owner: required(input.owner, '담당자'), due_date: dateOnly(input.due_date), status: 'OPEN', revision: row.revision, created: record };
    row.followups.push(task); record.task_id = task.id;
  } else if (action === 'COMPLETE_FOLLOWUP') {
    const task = row.followups.find((item) => item.id === input.task_id);
    if (!task || task.status !== 'OPEN') throw new Error('진행 중인 후속조치를 선택하세요.');
    task.status = 'DONE'; task.completion = { ...record, revision: task.revision }; record.task_id = task.id;
  } else throw new Error('지원하지 않는 문서 작업입니다.');
  row.history.push({ action, ...(input.check ? { check: input.check } : {}), ...record });
  validateDocumentWorkflow(next);
  return next;
}
export function documentProgress(row, today = new Date().toISOString().slice(0, 10)) {
  validateDocumentWorkflow([row]);
  const pending = row.followups.filter((task) => task.status === 'OPEN');
  return { status: row.status === 'SUBMITTED' && !pending.length ? 'DONE' : 'PARTIAL', pending: pending.length, overdue: pending.filter((task) => task.due_date < today).length };
}

export async function sha256Bytes(bytes) {
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function attachDocumentArtifact(rows, id, artifact, actor) {
  validateDocumentWorkflow(rows);
  const existing = rows.find((row) => row.id === id);
  if (!existing) throw new Error('문서를 찾을 수 없습니다.');
  if (!artifact || !text(artifact.name) || text(artifact.name).length > 255 || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '') || !Number.isSafeInteger(artifact.size) || artifact.size < 0) throw new Error('파일 지문이 올바르지 않습니다.');
  const changed = existing.artifact ? existing.artifact.sha256 !== artifact.sha256 : existing.status !== 'DRAFT';
  const next = changed ? changeDocument(rows, id, 'REVISE', { actor, reference: `파일 변경 SHA-256 ${artifact.sha256}` }) : copy(rows);
  const row = next.find((item) => item.id === id);
  row.artifact = { name: text(artifact.name), size: artifact.size, sha256: artifact.sha256, revision: row.revision };
  row.history.push({ action: 'ATTACH_ARTIFACT', ...evidence(actor, artifact.sha256, row.revision) });
  validateDocumentWorkflow(next); return next;
}

export async function createDocumentHandoff(rows, id, prompt, dataClass, actor) {
  validateDocumentWorkflow(rows);
  if (!['PUBLIC', 'SYNTHETIC'].includes(dataClass)) throw new Error('공개·합성 입력만 작업요청으로 내보낼 수 있습니다.');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 24000) throw new Error('작업지시는 1~24000자로 입력하세요.');
  const next = copy(rows), row = next.find((item) => item.id === id);
  if (!row?.artifact) throw new Error('먼저 문서 파일의 지문을 등록하세요.');
  if ((row.handoffs || []).length >= 200) throw new Error('작업요청 기록 한도에 도달했습니다.');
  const inputHash = await sha256Bytes(new TextEncoder().encode(prompt));
  const job = { schema_version: 'lk-bso-job/1.0', job_id: `BSO_${globalThis.crypto.randomUUID().replaceAll('-', '')}`, status: 'READY', attempts: 0, data_class: dataClass, prompt, input_sha256: inputHash, bso_context: { schema_version: 'lk-bso-job/1.0', document_id: row.id, revision: row.revision, artifact_sha256: row.artifact.sha256 } };
  // Keep only metadata in the case backup; prompt and file bytes are not retained here.
  row.handoffs = [...(row.handoffs || []), { job_id: job.job_id, revision: row.revision, artifact_sha256: row.artifact.sha256, input_sha256: inputHash }];
  row.history.push({ action: 'HANDOFF_REQUEST', ...evidence(actor, job.job_id, row.revision) });
  validateDocumentWorkflow(next); return { rows: next, job };
}

export function importDocumentExecution(rows, id, source, actor) {
  validateDocumentWorkflow(rows);
  const receipt = source?.bso_receipt || source;
  const next = copy(rows), row = next.find((item) => item.id === id);
  if (!row?.artifact || receipt?.schema_version !== 'lk-bso-receipt/1.0' || receipt.document_id !== id || receipt.revision !== row.revision || receipt.artifact_sha256 !== row.artifact.sha256 || receipt.human_approved !== false) throw new Error('현재 문서·파일·수정본과 실행 기록이 일치하지 않습니다.');
  const request = row.handoffs?.find((item) => item.job_id === receipt.job_id);
  if (!request || request.input_sha256 !== receipt.input_sha256 || request.artifact_sha256 !== receipt.artifact_sha256 || request.revision !== receipt.revision) throw new Error('등록한 작업요청과 실행 기록이 일치하지 않습니다.');
  if (row.execution_receipts?.some((item) => item.job_id === receipt.job_id)) throw new Error('이미 기록한 실행결과입니다.');
  const record = { schema_version: receipt.schema_version, job_id: receipt.job_id, document_id: id, revision: receipt.revision, artifact_sha256: receipt.artifact_sha256, input_sha256: receipt.input_sha256, output_sha256: receipt.output_sha256, execution_id: receipt.execution_id, status: receipt.status, human_approved: false, evidence_source: 'USER_IMPORTED_NOT_AUTHENTICATED' };
  row.execution_receipts = [...(row.execution_receipts || []), record];
  row.history.push({ action: 'IMPORT_EXECUTION', ...evidence(actor, receipt.execution_id, row.revision) });
  // AI execution never fills human review checks or changes the approval/submission state.
  validateDocumentWorkflow(next); return next;
}

export async function importDocumentResult(rows, id, source, actor) {
  validateDocumentWorkflow(rows);
  if (Array.isArray(source)) {
    if (source.length !== 1) throw new Error('결과는 한 건씩 선택하세요.');
    source = source[0];
  }
  if (source?.json) source = source.json;
  const bundle = source?.bso_result || source;
  if (bundle?.schema_version !== 'lk-bso-result/1.0') {
    if (source?.bso_result !== undefined || source?.output !== undefined || String(bundle?.schema_version || '').startsWith('lk-bso-result/')) throw new Error('지원하는 결과 패키지 버전이 아닙니다.');
    if (source?.schema_version === 'lk-bso-receipt/1.0' || source?.bso_receipt) return { rows: importDocumentExecution(rows, id, source, actor), preview: null };
    throw new Error('지원하는 실행결과 JSON이 아닙니다.');
  }
  const receipt = bundle.bso_receipt;
  if (typeof bundle.output !== 'string' || bundle.output.length > 100000 || bundle.verification?.human_approved !== false || bundle.verification?.legal_accuracy_approved !== false || bundle.verification?.output_sha256_checked !== true) throw new Error('결과 본문·검증 형식이 올바르지 않습니다.');
  const digest = await sha256Bytes(new TextEncoder().encode(bundle.output));
  if (digest !== receipt?.output_sha256 || (receipt?.status === 'BLOCKED' && bundle.output !== '') || (receipt?.status === 'NEEDS_GPT_REVIEW' && (!bundle.output.trim() || bundle.verification.provider_guard_passed !== true))) throw new Error('결과 본문과 실행 지문이 일치하지 않습니다.');
  const current = rows.find(row => row.id === id);
  const previous = current?.execution_receipts?.find(item => item.job_id === receipt.job_id);
  const preview = { document_id: id, revision: receipt.revision, job_id: receipt.job_id, output: bundle.output, status: receipt.status };
  if (previous) {
    required(actor, '기록자');
    const keys = ['schema_version', 'job_id', 'document_id', 'revision', 'artifact_sha256', 'input_sha256', 'output_sha256', 'execution_id', 'status', 'human_approved'];
    if (!current.artifact || receipt.revision !== current.revision || receipt.artifact_sha256 !== current.artifact.sha256 || keys.some(key => previous[key] !== receipt[key])) throw new Error('기존 실행 기록과 다른 결과는 다시 열 수 없습니다.');
    return { rows: copy(rows), preview, reopened: true };
  }
  const next = importDocumentExecution(rows, id, receipt, actor);
  return { rows: next, preview, reopened: false };
}
