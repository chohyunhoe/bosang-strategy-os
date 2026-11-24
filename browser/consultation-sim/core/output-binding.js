// 생성 출력물(복사 검토서·정밀검토 과업·저장 결과) 결속 (결정론 · 네트워크·저장 없음)
// 원칙(fail-closed)
// - 출력물은 만들 때의 상태 서명(상담 ID·조회 ID·입력 revision·지식팩 식별·검토서 내용)과 함께 보관한다.
// - 화면을 그릴 때마다 현재 서명과 비교하고, 하나라도 다르면 이전 출력물을 표시하지 않고 지운다.
// - 서명은 비교용이며 보안 해시가 아니다(개인정보를 담지 않도록 값 대신 해시만 둔다).

// FNV-1a 32비트 — 같은 입력이면 같은 값. 충돌 가능성이 있어 내용 해시와 구성요소를 함께 비교한다.
export function hashText(value) {
  const s = String(value == null ? '' : value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// 상담자 입력 revision: 4요소·증빙 확보 표시·필드 수정값·검수 여부
export function inputRevision(record, draft) {
  const fields = Object.values(draft?.fields || {}).map((f) => [f.key, f.override ? [f.override.value, f.override.by, f.override.reason] : null, Boolean(f.reviewed)]);
  return hashText(JSON.stringify([record?.intake || null, record?.evidence || null, fields]));
}

export function outputSignature({ draft = null, record = null, pack = { token: 0, connected: false }, reportText = '' } = {}) {
  if (!draft) return 'NO_DRAFT';
  return [
    `rec=${record?.record_id || 'NONE'}`,
    `draft=${draft.draft_id}`,
    `input=${inputRevision(record, draft)}`,
    `pack=${Number(pack?.token) || 0}:${pack?.connected ? 'CONNECTED' : 'NONE'}`,
    `report=${hashText(reportText)}`,
  ].join('|');
}

export function isOutputCurrent(output, signature) {
  return Boolean(output && typeof output.sig === 'string' && output.sig === signature && signature !== 'NO_DRAFT');
}

// ── 비동기 출력 작업(클립보드 복사·파일 저장) 경합 방지 ────────────────────────────────
// 작업 시작 시점의 토큰을 보존하고, await 이후 현재 값과 하나라도 다르면 결과를 화면에 올리지 않는다.
// - sig: 결속 서명(상담·조회·입력·지식팩·검토서 내용)
// - epoch: 무효화 세대. 상태 변경·새 상담·조회·지식팩 선택마다 증가 — 입력을 바꿨다 되돌려 서명이 같아져도 이전 작업은 무효.
// - attempt: 같은 종류의 작업 번호. 더 늦게 시작한 작업이 있으면 먼저 시작한 작업 결과는 버린다.
export function outputAttemptToken({ sig, epoch, attempt }) {
  return Object.freeze({ sig, epoch, attempt });
}
export function isAttemptCurrent(token, current) {
  return Boolean(token && current && token.sig !== 'NO_DRAFT'
    && token.sig === current.sig && token.epoch === current.epoch && token.attempt === current.attempt);
}
