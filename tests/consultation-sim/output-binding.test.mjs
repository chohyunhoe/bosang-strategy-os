// 생성 출력물 결속 서명 — 상담 ID·조회 ID·입력 revision·지식팩 식별·검토서 내용 중 하나라도 바뀌면 불일치. 합성 데이터만.
import test from 'node:test';
import assert from 'node:assert/strict';
import { outputSignature, isOutputCurrent, inputRevision, hashText } from '../../browser/consultation-sim/core/output-binding.js';
import { syncRecord, startNewConsultation } from '../../browser/consultation-sim/core/consult-record.js';
import { buildConsultReport } from '../../browser/consultation-sim/core/consult-report.js';
import { MANUAL_SCHEMA } from '../../browser/consultation-sim/core/manual-pack.js';
import { createConsultationSession } from '../../browser/consultation-sim/core/consultation-session.js';
import { createSyntheticAdapter } from '../../browser/consultation-sim/adapters/synthetic-adapter.js';

async function draftOf(lot) {
  const s = createConsultationSession({ adapter: createSyntheticAdapter({ baseDelayMs: 1 }) });
  await s.lookup({ context: '가상특별시 누리구 새솔동', lotText: lot, baseYear: 2026 });
  return s.state.draft;
}
const sigOf = (draft, record, pack = null, token = 0) => outputSignature({ draft, record, pack: { token, connected: Boolean(pack) },
  reportText: buildConsultReport({ draft, record, pack }).text });
function sentinelPack() {
  const P = { T: 46, S: 11, B: 12, R: 6, Y: 12, N: 10, L: 9, H: 9, P: 83 }; const codes = [];
  for (const [p, n] of Object.entries(P)) for (let i = 1; i <= n; i++) {
    const code = `${p}-${String(i).padStart(2, '0')}`;
    codes.push({ code, title: `합성 ${code}`, pdf_page_start: 1, pdf_page_end: 1, book_page_start: 1,
      sections: { '쟁점': '합성', '판단기준': code === 'T-01' ? 'PACK_SECRET_SENTINEL_SYNTHETIC_NO_REAL_DATA' : '합성 판단기준', '근거': '합성', '확인자료': '합성 확인자료', '편람쪽': '합성' } });
  }
  return { schema: MANUAL_SCHEMA, classification: 'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB', source: { review_status: 'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL' },
    all_pages_text: Array.from({ length: 320 }, (_, j) => ({ pdf_page: j + 1, text: '' })), issue_codes: codes };
}

test('같은 상태는 같은 서명, 조회 없음은 항상 불일치', async () => {
  const d = await draftOf('123-4');
  const { record } = syncRecord({ draft: d });
  assert.equal(sigOf(d, record), sigOf(d, record));
  assert.equal(outputSignature({ draft: null }), 'NO_DRAFT');
  assert.equal(isOutputCurrent({ sig: 'NO_DRAFT' }, 'NO_DRAFT'), false);
  assert.equal(isOutputCurrent(null, sigOf(d, record)), false);
  assert.equal(hashText('a'), hashText('a')); assert.notEqual(hashText('a'), hashText('b'));
});

test('새 상담(같은 필지): 상담 ID가 바뀌면 이전 출력물 불일치', async () => {
  const d = await draftOf('123-4');
  const { record } = syncRecord({ draft: d });
  record.intake.goal_note = 'CASE_A_OLD_PRIVATE_Memo';
  const out = { sig: sigOf(d, record) };
  const next = startNewConsultation(d);
  assert.equal(isOutputCurrent(out, sigOf(d, next)), false);
});

test('같은 상담 안 입력·증빙·수정값·검수 변경: 이전 출력물 불일치', async () => {
  const d = await draftOf('123-4');
  const { record } = syncRecord({ draft: d });
  record.intake.goal_note = 'OLD_GOAL_INPUT_A';
  const out = { sig: sigOf(d, record) };
  record.intake.goal_note = 'NEW_GOAL_INPUT_B';
  assert.equal(isOutputCurrent(out, sigOf(d, record)), false);
  const out2 = { sig: sigOf(d, record) };
  record.evidence.t05_recognition = 'SECURED';
  assert.equal(isOutputCurrent(out2, sigOf(d, record)), false);
  const r0 = inputRevision(record, d);
  d.fields.road_access.override = { value: '소로한면', by: '상담자', reason: '', at: 'x' };
  const r1 = inputRevision(record, d);
  d.fields.road_access.reviewed = true;
  assert.notEqual(r0, r1); assert.notEqual(r1, inputRevision(record, d));
});

test('지식팩 교체·해제: 식별값이 바뀌면 이전 발췌 출력물 불일치', async () => {
  const d = await draftOf('123-4');
  const { record } = syncRecord({ draft: d });
  const pack = sentinelPack();
  const withPack = buildConsultReport({ draft: d, record, pack }).text;
  assert.match(withPack, /PACK_SECRET_SENTINEL_SYNTHETIC_NO_REAL_DATA/);
  const out = { sig: sigOf(d, record, pack, 1) };
  assert.equal(isOutputCurrent(out, sigOf(d, record, null, 2)), false, '로드 실패로 해제');
  assert.equal(isOutputCurrent(out, sigOf(d, record, pack, 2)), false, '같은 내용 팩이라도 재선택이면 새 식별값');
  assert.doesNotMatch(buildConsultReport({ draft: d, record, pack: null }).text, /PACK_SECRET_SENTINEL/);
});
