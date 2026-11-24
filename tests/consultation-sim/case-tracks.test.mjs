// Issue #31 사업·보상 유형 분기 — 합성 시나리오 S1·S2·S3 + 유형 미확인. 합성 데이터만(실호출·비공개 지식팩 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyIntake, evaluateIntake, nextActionsFor } from '../../browser/consultation-sim/core/consult-intake.js';
import { buildCaseTrack } from '../../browser/consultation-sim/core/case-tracks.js';
import { buildConsultReport } from '../../browser/consultation-sim/core/consult-report.js';
import { syncRecord, startNewConsultation } from '../../browser/consultation-sim/core/consult-record.js';
import { inputRevision } from '../../browser/consultation-sim/core/output-binding.js';
import { createConsultationSession } from '../../browser/consultation-sim/core/consultation-session.js';
import { createSyntheticAdapter } from '../../browser/consultation-sim/adapters/synthetic-adapter.js';

const NOW = new Date(2026, 10, 24, 9, 0, 0);
async function draft() {
  const s = createConsultationSession({ adapter: createSyntheticAdapter({ baseDelayMs: 1 }) });
  await s.lookup({ context: '가상특별시 누리구 새솔동', lotText: '123-4', baseYear: 2026 });
  return s.state.draft;
}
function report(d, intake) {
  const { record } = syncRecord({ draft: d });
  record.intake = { ...emptyIntake(), ...intake };
  return buildConsultReport({ draft: d, record, now: NOW });
}
// 수용재결 불복 트랙의 자동 안내 문구(GPT 재현에서 S2에 잘못 나온 항목)
const ADJUDICATION_ROUTE = ['이의재결서 확보', '이의재결 감정평가서', '행정소송 제기 기간', '재결서 정본 송달일', '재결 감정평가서 확보', '재결·이의재결 단계 감정평가서 간 비교 검토', '이의신청·행정소송 기간'];

test('S2 종전자산평가 이의(목표·단계 OBJECTION): 수용재결·이의재결·행정소송 자동 안내·과업 0건, 원문 확인 표시', async () => {
  const d = await draft();
  const r = report(d, { case_type: 'PRIOR_ASSET', goal: 'OBJECTION', stage: 'OBJECTION' });
  for (const s of ADJUDICATION_ROUTE) assert.ok(!r.text.includes(s), `자동 안내 금지: ${s}`);
  for (const a of r.actions) assert.doesNotMatch(a, /재결|행정소송|소송/, a);
  assert.ok(!r.tasks.some((t) => /재결|소송/.test(t.title)));
  assert.ok(r.tasks.some((t) => t.title.includes('종전자산평가 이의 검토')));
  assert.match(r.text, /도시정비법 제74조\(관리처분계획의 인가 등\) 등 — 현행 원문 확인 필요/);
  assert.match(r.text, /\[주의\] 선택한 절차 단계 "이의신청·이의재결"는 토지보상법 수용 절차 분류/);
  assert.match(r.text, /토지수용 재결·이의재결·행정소송 절차·기간과 자동 동일시하지 않음/);
  assert.match(r.text, /통지서·공람 공고문/);
  assert.equal(r.track.legal_deadline_computed, false);
  assert.deepEqual(r.forbidden_hits, []);
});

test('S1 지장물 협의(NEGOTIATION): 물건조서·현장 재조사·보완평가·서면 회신·재협의 체크리스트와 과업', async () => {
  const d = await draft();
  const r = report(d, { case_type: 'OBJECTS', goal: 'NEGOTIATION', stage: 'NEGOTIATION' });
  const c = r.track.checklists.find((x) => x.id === 'objects');
  assert.ok(c);
  const all = [...c.facts, ...c.evidence, ...c.procedure, ...c.next].join(' ');
  for (const k of ['물건조서', '소유·설치·시공 자료', '규격·수량', '공사 전후', '평가 누락', '현장 재조사', '보완평가', '서면', '재협의']) assert.ok(all.includes(k), k);
  assert.ok(r.tasks.some((t) => t.title === '누락 지장물 현장 재조사·보완평가 요청 검토'));
  assert.ok(r.tasks.some((t) => t.title === '물건조서·감정평가서 대조(누락 항목)'));
  assert.match(r.text, /토지보상법 제75조\(건축물등 물건에 대한 보상\) — 현행 원문 확인 필요/);
  assert.match(r.text, /지장물 보상은 토지 평가\(비교표준지\)와 별도 구조 — 보상액은 산정하지 않음/);
  assert.ok(r.materials.includes('물건조서 사본(누락 항목 표시)'));
  assert.deepEqual(r.forbidden_hits, []);
});

test('S3 잔여지 복수 청구: 제73조·제74조 별도 체크리스트·과업, 요건 혼용 없음, 선택형 증거는 해당 시만', async () => {
  const d = await draft();
  const r = report(d, { case_type: 'REMAINDER', goal: 'REMAINDER', stage: 'ADJUDICATION_REQUEST', claim_73: 'Y', claim_74: 'Y' });
  const ids = r.track.checklists.map((x) => x.id);
  assert.deepEqual(ids, ['remainder_73', 'remainder_74']);
  const [c73, c74] = r.track.checklists;
  for (const c of [c73, c74]) {
    for (const k of ['facts', 'evidence', 'procedure', 'next']) assert.ok(c[k].length >= 1, `${c.id}.${k}`);
    assert.ok(c.optional.every((o) => o.includes('(해당 시)')));
    assert.match(c.procedure.join(' '), /법령 원문으로 확인\(BSO 미계산\)/);
  }
  // 제73조(가격감소·공사비) 사실·증빙에 제74조 요건(종래 목적 사용의 현저한 곤란)을 섞지 않음, 그 반대도 같음
  assert.ok(![...c73.facts, ...c73.evidence].join(' ').includes('현저히 곤란'));
  assert.ok(c74.facts.some((f) => f.includes('종래의 목적에 사용하는 것이 현저히 곤란')));
  assert.ok(![...c74.facts, ...c74.evidence].join(' ').includes('가격 감소'));
  assert.ok(r.tasks.some((t) => t.title.includes('제73조')) && r.tasks.some((t) => t.title.includes('제74조')));
  assert.ok(!r.tasks.some((t) => t.title === '잔여지 등 추가 손실 검토'), '일반 잔여지 과업 1건으로 뭉치지 않음');
  assert.match(r.text, /제73조와 제74조는 요건·입증·상대방·기간이 다른 별도 청구/);
  assert.match(r.text, /청구 선택: 제73조·제74조/);
  assert.doesNotMatch(r.text, /\d+\s*년\s*(이내|이 지난)/, '청구기간 숫자 자동 표시 없음');
  // 한쪽만 선택
  assert.deepEqual(report(d, { case_type: 'REMAINDER', claim_74: 'Y' }).track.checklists.map((x) => x.id), ['remainder_74']);
  // 미선택: 판정 보류, 잔여지 과업 없음
  const none = report(d, { case_type: 'REMAINDER', goal: 'REMAINDER' });
  assert.equal(none.track.status, 'CLAIM_NOT_SELECTED');
  assert.ok(!none.tasks.some((t) => /잔여지/.test(t.title)));
});

test('유형 미확인/기타: 특정 불복 경로·법정기한·유형별 과업 자동 생성 없음, 일반 서류 확보만', async () => {
  const d = await draft();
  for (const case_type of ['', 'OTHER']) {
    const r = report(d, { case_type, goal: 'LITIGATION', stage: 'ADJUDICATION' });
    for (const s of ADJUDICATION_ROUTE) assert.ok(!r.text.includes(s), `${case_type || '미확인'}: ${s}`);
    assert.ok(r.actions.some((a) => a.includes('사업·보상 유형 확인 — 확인 전에는 특정 불복 경로')));
    assert.equal(r.track.checklists.length, 0);
    assert.ok(!r.tasks.some((t) => /재결|잔여지|지장물|종전자산/.test(t.title)));
    assert.match(r.text, /사업·보상 유형: (미확인|기타·불명확)/);
    assert.deepEqual(r.forbidden_hits, []);
  }
  // 잔여지 목표만 있고 유형 미확인이면 안내만
  assert.match(report(d, { goal: 'REMAINDER' }).text, /잔여지 청구는 사업·보상 유형에서 "잔여지"를 고르고/);
  // 토지보상법 계열로 명시하면 기존 단계 안내 유지
  const land = nextActionsFor(evaluateIntake({ case_type: 'LAND', stage: 'ADJUDICATION' }, { now: NOW }));
  assert.ok(land.includes('재결 감정평가서 확보'));
});

test('트랙은 입력만으로 결정(추정 없음)·법률결론·보상액·기한 계산 없음', () => {
  for (const type of ['', 'LAND', 'OBJECTS', 'REMAINDER', 'PRIOR_ASSET', 'OTHER']) {
    const t = buildCaseTrack({ ...emptyIntake(), case_type: type, claim_73: 'Y', claim_74: 'Y', goal: 'OBJECTION', stage: 'OBJECTION' });
    assert.equal(t.legal_conclusion, false); assert.equal(t.amounts_computed, false); assert.equal(t.legal_deadline_computed, false);
    assert.ok(t.tasks.every((x) => x.status === 'BLOCKED'));
  }
  // 목표가 OBJECTION이어도 유형을 추정하지 않음
  assert.equal(buildCaseTrack({ ...emptyIntake(), goal: 'OBJECTION', stage: 'OBJECTION' }).case_type, null);
  // 청구 선택값은 잔여지 유형에서만 쓰임
  assert.equal(buildCaseTrack({ ...emptyIntake(), case_type: 'OBJECTS', claim_73: 'Y' }).checklists.some((c) => c.id.startsWith('remainder')), false);
});

test('상담 기록 격리·출력 결속에 사업·보상 유형 포함', async () => {
  const d = await draft();
  assert.deepEqual([emptyIntake().case_type, emptyIntake().claim_73, emptyIntake().claim_74], ['', '', '']);
  const { record } = syncRecord({ draft: d });
  record.intake.case_type = 'PRIOR_ASSET';
  const next = startNewConsultation(d);
  assert.equal(next.intake.case_type, '', '새 상담에 유형 이월 없음');
  const before = inputRevision(record, d);
  record.intake.case_type = 'REMAINDER';
  assert.notEqual(inputRevision(record, d), before, '유형 변경 시 이전 출력물 무효');
});

test('PR #32 P0: 종전자산평가 이의 + 토지수용위원회 권한자 → 경고·미검증 표시·완료 미산입, 입력값 보존', async () => {
  const d = await draft();
  for (const authority of ['LAND_COMMITTEE_LOCAL', 'LAND_COMMITTEE_CENTRAL']) {
    const name = authority === 'LAND_COMMITTEE_LOCAL' ? '지방토지수용위원회' : '중앙토지수용위원회';
    const intake = { ...emptyIntake(), case_type: 'PRIOR_ASSET', authority };
    const ev = evaluateIntake(intake, { now: NOW });
    const a = ev.items.find((i) => i.element === 'authority');
    assert.equal(a.status, 'UNVERIFIED_MISMATCH');
    assert.equal(a.value_text, name, '입력값은 그대로');
    assert.equal(ev.recorded_count, 0, '미검증 입력은 완료로 세지 않음');
    assert.ok(ev.undetermined.includes('현재 판단·결정 권한자'));
    const t = buildCaseTrack(intake);
    assert.ok(t.warnings.some((w) => w.includes(`입력 권한자 "${name}"는 토지수용 재결 계열 기관`) && w.includes('원문 확인 필요')));
    const r = report(d, intake);
    assert.match(r.text, new RegExp(`- 현재 판단·결정 권한자: ${name} \\[미검증 입력 · 유형 불일치\\]`));
    assert.match(r.text, new RegExp(`- 판단·결정 권한자: ${name} \\[미검증 입력 · 유형 불일치 — 통지서·법령 원문 확인 필요\\]`));
    assert.ok(r.actions.some((x) => x.includes('결정 주체인지 통지서·법령 원문으로 확인 — 현재 미검증 입력')));
    assert.ok(!r.text.includes(`- 현재 판단·결정 권한자: ${name} [상담자 기록]`));
    assert.deepEqual(r.forbidden_hits, []);
  }
  // 다른 조합은 영향 없음(추정·변경 없음)
  const ok1 = evaluateIntake({ ...emptyIntake(), case_type: 'PRIOR_ASSET', authority: 'PROJECT_OPERATOR' }, { now: NOW }).items[3];
  assert.equal(ok1.status, 'RECORDED_BY_COUNSELOR');
  const ok2 = evaluateIntake({ ...emptyIntake(), case_type: 'LAND', authority: 'LAND_COMMITTEE_CENTRAL' }, { now: NOW }).items[3];
  assert.equal(ok2.status, 'RECORDED_BY_COUNSELOR');
  assert.equal(buildCaseTrack({ ...emptyIntake(), case_type: 'LAND', authority: 'LAND_COMMITTEE_CENTRAL' }).warnings.length, 0);
  const ok3 = evaluateIntake({ ...emptyIntake(), authority: 'LAND_COMMITTEE_LOCAL' }, { now: NOW }).items[3];
  assert.equal(ok3.status, 'RECORDED_BY_COUNSELOR', '유형 미확인에서는 불일치로 추정하지 않음');
});
