// 상담 기록 결속(필지·기준연도·데이터 모드·상담 ID) — 교차 혼입 0건 고정. 합성 데이터만.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsultRecord, syncRecord, recordMatches, recordForOutput, canContinueFrom, continueFrom, startNewConsultation, recordHasInput } from '../../browser/consultation-sim/core/consult-record.js';
import { buildConsultReport } from '../../browser/consultation-sim/core/consult-report.js';
import { scrubSecrets, createConsultationSession } from '../../browser/consultation-sim/core/consultation-session.js';
import { sectionStatus } from '../../browser/consultation-sim/core/manual-pack.js';
import { createSyntheticAdapter } from '../../browser/consultation-sim/adapters/synthetic-adapter.js';

const NURI = '가상특별시 누리구 새솔동';
async function draftOf(lot, baseYear = 2026) {
  const s = createConsultationSession({ adapter: createSyntheticAdapter({ baseDelayMs: 1 }) });
  await s.lookup({ context: NURI, lotText: lot, baseYear });
  return s.state.draft;
}
// 화면 흐름 재현: 조회 전환 때 draft가 비었다가 새 draft가 들어온다
function flow(record, previous, nextDraft) {
  const a = syncRecord({ record, previous, draft: null });
  const b = syncRecord({ record: a.record, previous: a.previous, draft: nextDraft });
  return { ...b, notice: b.notice || a.notice };
}

test('다른 필지(123-4 → 150): 상담 4요소·증빙 이월 0건, 검토서에 이전 메모 없음', async () => {
  const d1 = await draftOf('123-4'); const d2 = await draftOf('150');
  let { record } = syncRecord({ draft: d1 });
  record.intake.goal = 'NEGOTIATION'; record.intake.goal_note = '가상상담A_별도목표'; record.intake.authority = 'CLIENT';
  record.evidence.t01_actual_use_env = 'SECURED';
  const r = flow(record, null, d2);
  assert.notEqual(r.record.record_id, record.record_id);
  assert.equal(recordHasInput(r.record), false);
  assert.equal(r.previous.record_id, record.record_id, '이전 기록은 보관만');
  assert.equal(canContinueFrom(r.previous, d2, r.record), false, '다른 필지는 이어 쓰기도 불가');
  const text = buildConsultReport({ draft: d2, record: r.record }).text;
  assert.doesNotMatch(text, /가상상담A_별도목표|협의 대응/);
  assert.match(text, /고객의 목표: 미확정/);
});

test('같은 PNU·다른 기준연도(2026 → 2025): 증빙 SECURED 자동승계 0건, 이어 쓰기도 불가', async () => {
  const d26 = await draftOf('123-4', 2026); const d25 = await draftOf('123-4', 2025);
  assert.equal(d26.parcel.pnu, d25.parcel.pnu);
  let { record } = syncRecord({ draft: d26 });
  record.evidence.t01_actual_use_env = 'SECURED';
  const r = flow(record, null, d25);
  assert.deepEqual(r.record.evidence, {});
  assert.equal(canContinueFrom(r.previous, d25, r.record), false);
  assert.equal(continueFrom(r.previous, d25), null);
  const g = buildConsultReport({ draft: d25, record: r.record }).gates.find((x) => x.code === 'T-01');
  assert.equal(g.requirements.find((x) => x.id === 't01_actual_use_env').state, 'HOLD');
});

test('같은 필지 재조회: 자동 이월 없음, 같은 모드·PNU·연도에서 상담자 명시 시에만 이어 쓰기', async () => {
  const a = await draftOf('123-4'); const b = await draftOf('123-4');
  assert.notEqual(a.draft_id, b.draft_id);
  let { record } = syncRecord({ draft: a });
  record.intake.stage = 'NEGOTIATION';
  const r = flow(record, null, b);
  assert.equal(r.record.intake.stage, '');
  assert.match(r.notice, /이월하지 않았습니다/);
  assert.equal(canContinueFrom(r.previous, b, r.record), true);
  const cont = continueFrom(r.previous, b);
  assert.equal(cont.record_id, record.record_id, '같은 상담 ID 유지');
  assert.equal(cont.intake.stage, 'NEGOTIATION');
  assert.ok(recordMatches(cont, b) && !recordMatches(cont, a));
});

test('동일 PNU 다른 의뢰인: 새 상담 ID로 분리, 이전 기록 결속 상실 시 출력 거부', async () => {
  const d = await draftOf('123-4');
  let { record } = syncRecord({ draft: d });
  record.intake.goal_note = '의뢰인A 메모';
  const next = startNewConsultation(d);
  assert.notEqual(next.record_id, record.record_id);
  assert.equal(recordHasInput(next), false);
  const rep = buildConsultReport({ draft: d, record: next });
  assert.equal(rep.binding_ok, true);
  assert.doesNotMatch(rep.text, /의뢰인A 메모/);
  assert.match(rep.text, new RegExp(`상담 ID: ${next.record_id}`));
});

test('결속 불일치 기록은 출력하지 않음(검토서·과업에서 상담정보 제외, binding_ok=false)', async () => {
  const d1 = await draftOf('123-4'); const d2 = await draftOf('150');
  const { record } = syncRecord({ draft: d1 });
  record.intake.goal_note = '타 필지 메모'; record.evidence.t05_recognition = 'UNAVAILABLE';
  assert.equal(recordForOutput(record, d2), null);
  const rep = buildConsultReport({ draft: d2, record });
  assert.equal(rep.binding_ok, false);
  assert.equal(rep.record_binding.status, 'MISMATCH');
  assert.doesNotMatch(rep.text, /타 필지 메모|미충족\(확보 불가\)/);
  assert.match(rep.text, /상담 기록 결속 불일치/);
  // 모드가 다르면 같은 draft_id·PNU라도 불일치
  const fake = structuredClone(record); fake.binding.data_mode = 'VWORLD_DIRECT';
  assert.equal(recordMatches(fake, d1), false);
  assert.equal(recordMatches(createConsultRecord(null), d1), false, '미결속 기록은 출력 불가');
});

test('모드 전환·새 조회 중(draft 없음): 결속 기록은 내려두고 미결속 새 기록, 조회 전 입력은 첫 조회에만 결속', async () => {
  const d1 = await draftOf('123-4');
  let { record } = syncRecord({ draft: d1 });
  record.intake.goal = 'OBJECTION';
  const a = syncRecord({ record, draft: null });
  assert.equal(a.record.binding, null);
  assert.equal(a.previous.record_id, record.record_id);
  a.record.intake.goal_note = '조회 전 메모';
  const d2 = await draftOf('150');
  const b = syncRecord({ record: a.record, previous: a.previous, draft: d2 });
  assert.equal(b.record.intake.goal_note, '조회 전 메모');
  assert.equal(b.record.intake.goal, '', '이전 필지 값은 없음');
  assert.ok(recordMatches(b.record, d2));
});

test('직전 기록은 바로 다음 전환 1회에만 보관(오래된 기록이 이어 쓰기 대상으로 남지 않음)', async () => {
  const a = await draftOf('123-4'); const b = await draftOf('123-4'); const c = await draftOf('123-4');
  let { record } = syncRecord({ draft: a });
  record.intake.goal_note = '의뢰인A';
  const r1 = flow(record, null, b);           // A 보관
  assert.equal(canContinueFrom(r1.previous, b, r1.record), true);
  const r2 = flow(r1.record, r1.previous, c); // 빈 기록에서 다시 전환 → A는 더 이상 보관하지 않음
  assert.equal(r2.previous, null);
  assert.equal(canContinueFrom(r2.previous, c, r2.record), false);
});

test('저장 JSON·검토서: 상담 자유입력의 API 키 흔적 제거', async () => {
  const d = await draftOf('123-4');
  const { record } = syncRecord({ draft: d });
  record.intake.trigger_event = '협의요청서 수령'; record.intake.trigger_date = '2026-11-20';
  record.intake.trigger_source = '통지서 https://example.invalid/doc?serviceKey=ABCD1234SECRET&x=1';
  const text = buildConsultReport({ draft: d, record }).text;
  assert.doesNotMatch(text, /ABCD1234SECRET/);
  assert.match(text, /serviceKey=\[REDACTED\]/);
  // 앱 저장 경로와 같은 정화(consult_record = scrubSecrets({...}))
  const saved = scrubSecrets({ record_id: record.record_id, intake: { ...record.intake }, evidence_inputs: { ...record.evidence } });
  assert.ok(!JSON.stringify(saved).includes('ABCD1234SECRET'));
  assert.equal(saved.intake.trigger_date, '2026-11-20');
});

test('기본서 섹션: 자리표시 줄만 여러 개면 원본 확인 필요', () => {
  for (const v of ['-\n-', 'TODO\nTODO', '없음\n\n-', '—\r\n—']) assert.equal(sectionStatus(v).ok, false, JSON.stringify(v));
  assert.equal(sectionStatus('-\n감정평가서 선정사유').ok, true);
});
