// 상담 기록(상담 4요소 + 증빙 확보 표시) 결속 모델 (결정론 · 네트워크·저장 없음)
// 원칙(fail-closed)
// - 상담 기록은 하나의 조회 결과(draft_id)와 데이터 모드·PNU·기준연도에 묶인다.
// - 다른 필지·기준연도·데이터 모드·새 조회로 바뀌면 기록을 자동으로 넘기지 않는다(새 기록 시작).
// - 같은 필지라도 '새 상담(다른 의뢰인)'은 새 상담 ID로 분리한다.
// - 직전 기록을 이어 쓰는 것은 같은 모드·PNU·기준연도에서 상담자가 명시적으로 누를 때만 허용한다.
// - 출력(복사·저장·과업)은 현재 화면의 draft와 결속이 일치하는 기록만 사용한다.
import { emptyIntake } from './consult-intake.js';

export const RECORD_SCHEMA = 'bso-consult-record/0.1';
let recordSeq = 0;
const clone = (v) => JSON.parse(JSON.stringify(v));

export function bindingOf(draft) {
  if (!draft) return null;
  return { draft_id: draft.draft_id, data_mode: draft.data_mode, pnu: draft.parcel?.pnu || null, base_year: Number(draft.binding?.base_year) };
}

export function createConsultRecord(draft = null, now = Date.now()) {
  recordSeq += 1;
  return {
    schema: RECORD_SCHEMA,
    record_id: `CR-${Number(now).toString(36)}-${recordSeq.toString(36)}`,
    binding: bindingOf(draft),
    intake: emptyIntake(),
    evidence: {},
  };
}

export function recordMatches(record, draft) {
  if (!record?.binding || !draft) return false;
  const b = record.binding;
  return b.draft_id === draft.draft_id && b.data_mode === draft.data_mode
    && b.pnu === draft.parcel?.pnu && b.base_year === Number(draft.binding?.base_year);
}

const sameParcelScope = (a, b) => Boolean(a && b && a.data_mode === b.data_mode && a.pnu === b.pnu && a.base_year === b.base_year);

export function recordHasInput(record) {
  if (!record) return false;
  const intakeInput = Object.entries(record.intake || {}).some(([k, v]) => k !== 'schema' && String(v ?? '').trim() !== '');
  const evidenceInput = Object.values(record.evidence || {}).some((v) => String(v ?? '') !== '');
  return intakeInput || evidenceInput;
}

const describe = (b) => (b ? `${b.pnu} · ${b.base_year}년 · ${b.data_mode}` : '조회 전');

// 화면의 현재 draft에 맞춰 활성 기록을 정한다. 반환 객체만 사용하고 입력 객체는 바꾸지 않는다.
// - draft 없음(새 조회 중·실패·모드 전환): 결속된 기록은 보관(previous)으로 내리고 미결속 새 기록을 연다.
// - 미결속 기록 + draft: 조회 전에 적은 입력은 처음 결속되는 draft로 들어간다(다른 필지에서 온 값이 아님).
// - 결속 불일치: 새 기록. 이전 기록은 이월하지 않고 previous로만 보관한다.
// - previous는 직전 전환 1회에만 유효하다(더 오래된 기록이 나중에 '이어 쓰기' 대상으로 남지 않게).
export function syncRecord({ record = null, previous = null, draft = null, now = Date.now() } = {}) {
  if (!record) record = createConsultRecord(null, now);
  if (!draft) {
    if (!record.binding) return { record, previous, changed: false, notice: null };
    return { record: createConsultRecord(null, now), previous: recordHasInput(record) ? record : null, changed: true,
      notice: recordHasInput(record) ? `이전 상담 기록(${describe(record.binding)})은 새 조회에 이월하지 않았습니다.` : null };
  }
  if (!record.binding) return { record: { ...record, binding: bindingOf(draft) }, previous, changed: true, notice: null };
  if (recordMatches(record, draft)) return { record, previous, changed: false, notice: null };
  return { record: createConsultRecord(draft, now), previous: recordHasInput(record) ? record : null, changed: true,
    notice: recordHasInput(record) ? `이전 상담 기록(${describe(record.binding)})은 이 조회에 이월하지 않았습니다.` : null };
}

// 같은 모드·PNU·기준연도의 직전 기록이 있고 현재 기록이 비어 있을 때만 '이어 쓰기' 버튼을 보인다.
export function canContinueFrom(previous, draft, current) {
  return Boolean(previous && draft && recordHasInput(previous) && !recordHasInput(current)
    && sameParcelScope(previous.binding, bindingOf(draft)));
}

// 상담자의 명시 동작으로만 호출. 같은 상담 ID를 유지하고 현재 조회에 다시 결속한다.
export function continueFrom(previous, draft) {
  if (!previous || !sameParcelScope(previous.binding, bindingOf(draft))) return null;
  return { ...clone(previous), binding: bindingOf(draft), continued_from_draft: previous.binding.draft_id };
}

// 같은 필지에서 다른 의뢰인·새 상담을 시작: 새 상담 ID, 빈 입력.
export function startNewConsultation(draft, now = Date.now()) { return createConsultRecord(draft, now); }

// 출력용: 결속이 맞지 않으면 null(이전 고객 정보를 출력하지 않는다).
export function recordForOutput(record, draft) { return recordMatches(record, draft) ? record : null; }
