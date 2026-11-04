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
  return value && text(value.actor) && text(value.reference) && value.revision === revision && Number.isFinite(Date.parse(value.recorded_at));
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
    for (const [key, value] of Object.entries(row.checks)) if (!REVIEW_CHECKS.includes(key) || !validEvidence(value, row.revision)) throw new Error('현재 수정본의 검수 근거가 올바르지 않습니다.');
    if (row.status !== 'DRAFT' && !REVIEW_CHECKS.every((key) => validEvidence(row.checks[key], row.revision))) throw new Error('문서 검수 근거가 부족합니다.');
    if (['APPROVED', 'SUBMITTED'].includes(row.status) && !validEvidence(row.approval, row.revision)) throw new Error('현재 수정본의 승인 근거가 없습니다.');
    if (row.status === 'SUBMITTED' && !validEvidence(row.submission, row.revision)) throw new Error('제출 근거가 없습니다.');
    const taskIds = new Set();
    for (const task of row.followups) {
      if (!text(task.id) || taskIds.has(task.id) || !['OPEN', 'DONE'].includes(task.status)) throw new Error('후속조치 형식이 올바르지 않습니다.');
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
