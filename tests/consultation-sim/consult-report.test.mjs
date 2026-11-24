// 상담 4요소 · 실무기본서 증빙 게이트 · 표준지 검토요건 · 6단 상담 검토서 — 합성 데이터만(실호출·실제 기본서 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyIntake, evaluateIntake, nextActionsFor, parseIsoDate } from '../../browser/consultation-sim/core/consult-intake.js';
import { MANUAL_SCHEMA, buildEvidenceGates, sectionStatus, EVIDENCE_STATE, getManualEvidenceGates } from '../../browser/consultation-sim/core/manual-pack.js';
import { buildConsultReport, REPORT_SECTIONS } from '../../browser/consultation-sim/core/consult-report.js';
import { compareFactors, standardReviewRequirements } from '../../browser/consultation-sim/core/standard-land-engine.js';
import { createConsultationSession } from '../../browser/consultation-sim/core/consultation-session.js';
import { createSyntheticAdapter } from '../../browser/consultation-sim/adapters/synthetic-adapter.js';

const NOW = new Date(2026, 10, 24, 9, 0, 0); // 기기 현지 2026-11-24
const PREFIX = { T: 46, S: 11, B: 12, R: 6, Y: 12, N: 10, L: 9, H: 9, P: 83 };
function makePack(mutate = () => {}) {
  const codes = [];
  for (const [p, n] of Object.entries(PREFIX)) for (let i = 1; i <= n; i++) {
    const code = `${p}-${String(i).padStart(2, '0')}`;
    codes.push({ code, title: `합성 유형 ${code}`, pdf_page_start: 100 + i, pdf_page_end: 101 + i, book_page_start: 98 + i,
      sections: { '쟁점': `${code} 합성 쟁점`, '판단기준': `${code} 합성 판단기준 문장(실제 기본서 아님)`, '근거': '합성 근거 표기', '확인자료': '합성 확인자료 목록', '편람쪽': '합성' } });
  }
  const pack = { schema: MANUAL_SCHEMA, classification: 'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB',
    source: { review_status: 'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL', source_pdf_sha256: 'SYNTHETIC' },
    all_pages_text: Array.from({ length: 320 }, (_, j) => ({ pdf_page: j + 1, text: '합성' })), issue_codes: codes };
  mutate(pack);
  return pack;
}
const entry = (pack, code) => pack.issue_codes.find((e) => e.code === code);

async function syntheticDraft(lot = '123-4', ctx = '가상특별시 누리구 새솔동') {
  const s = createConsultationSession({ adapter: createSyntheticAdapter({ baseDelayMs: 1 }) });
  await s.lookup({ context: ctx, lotText: lot, baseYear: 2026 });
  return s.state.draft;
}
// 실데이터 경로 판정 확인용: 합성 응답을 실데이터처럼 표시한 테스트 전용 사본(화면·배포에 쓰지 않음)
function asLive(draft) {
  const d = structuredClone(draft);
  d.synthetic = false; d.analysis.standard.synthetic = false; d.analysis.standard.source = '표준지 공시지가(테스트)';
  return d;
}

test('상담 4요소: 미입력은 미확정, 법정기한 계산 없음', () => {
  const r = evaluateIntake(emptyIntake(), { now: NOW });
  assert.equal(r.items.length, 4);
  assert.deepEqual(r.items.map((i) => i.label), ['고객의 목표', '현재 사업·보상 절차 단계', '기한 및 기산일', '현재 판단·결정 권한자']);
  assert.ok(r.items.every((i) => i.status === 'UNDETERMINED' && i.value_text === '미확정'));
  assert.equal(r.legal_deadline_computed, false);
  assert.equal(r.items[2].remaining_days, null);
  assert.match(r.items[2].note, /법정기한을 계산하지 않음/);
});

test('상담 4요소: 기산일만 입력하면 기한은 만들지 않음, 문서 기재 기한만 남은 일수 표시', () => {
  const onlyTrigger = evaluateIntake({ trigger_event: '재결서 정본 수령', trigger_date: '2026-11-20', trigger_source: '수령증' }, { now: NOW });
  const dl = onlyTrigger.items[2];
  assert.equal(dl.remaining_days, null, '기산일로부터 기한을 계산하지 않는다');
  assert.doesNotMatch(dl.value_text, /문서 기재 기한/);
  const withDeadline = evaluateIntake({ trigger_event: '협의요청서 수령', trigger_date: '2026-11-20', trigger_source: '협의요청서',
    stated_deadline: '2026-12-04', deadline_source: '협의요청서 기재 협의기간' }, { now: NOW });
  assert.equal(withDeadline.items[2].status, 'RECORDED_BY_COUNSELOR');
  assert.equal(withDeadline.items[2].remaining_days, 10);
  assert.match(withDeadline.items[2].value_text, /입력 기한까지 10일/);
  assert.match(nextActionsFor(withDeadline)[0], /10일 남았습니다 — 담당 전문가에게 즉시 공유/);
});

test('상담 4요소: 잘못된 날짜·역순 기한은 입력 확인 필요', () => {
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('2026/11/24'), null);
  assert.ok(parseIsoDate('2026-02-28'));
  const bad = evaluateIntake({ trigger_date: '2026-13-01' }, { now: NOW }).items[2];
  assert.equal(bad.status, 'INPUT_INVALID');
  const reversed = evaluateIntake({ trigger_date: '2026-11-20', stated_deadline: '2026-11-10' }, { now: NOW }).items[2];
  assert.equal(reversed.status, 'INPUT_INVALID');
  assert.match(reversed.note, /기산일보다 앞섬/);
});

test('다음 조치: 단계별 자료확보만 안내, 기간 수치·법정기한 단정 없음', () => {
  for (const case_type of ['', 'LAND', 'OBJECTS', 'REMAINDER', 'PRIOR_ASSET', 'OTHER']) for (const stage of ['', 'PRE_RECOGNITION', 'RECOGNITION', 'COMPENSATION_PLAN', 'APPRAISAL', 'NEGOTIATION', 'ADJUDICATION_REQUEST', 'ADJUDICATION', 'OBJECTION', 'LITIGATION']) {
    const actions = nextActionsFor(evaluateIntake({ stage, case_type }, { now: NOW }));
    assert.ok(actions.length >= 1);
    for (const a of actions) assert.doesNotMatch(a, /\d+\s*(일|개월|년)\s*(이내|안에|내에|까지)/, `${case_type}/${stage}: ${a}`);
  }
  // 불복 경로 안내는 사업·보상 유형이 토지보상법 계열로 기록된 경우에만(Issue #31)
  const adj = nextActionsFor(evaluateIntake({ stage: 'ADJUDICATION', case_type: 'LAND' }, { now: NOW }));
  assert.ok(adj.some((a) => /BSO 미계산/.test(a)));
  assert.ok(adj.some((a) => /권한자/.test(a)));
});

test('기본서 섹션 충분성: 빈값·자리표시는 원본 확인 필요, 길이로 질을 추정하지 않음', () => {
  for (const v of ['', '  ', '-', '—', '없음', '미기재', 'TODO', 'N/A', '?', undefined, null]) assert.equal(sectionStatus(v).ok, false, String(v));
  assert.equal(sectionStatus('등기부').ok, true);
  assert.equal(sectionStatus(['감정평가서', '현장사진']).text, '감정평가서\n현장사진');
});

test('증빙 게이트: 지식팩 미연결이면 전부 판정 보류(T-09는 개시요건 없음), 원문 위치 미확인', async () => {
  const d = await syntheticDraft();
  const gates = buildEvidenceGates({ pack: null, draft: d });
  assert.deepEqual(gates.map((g) => g.code), ['T-01', 'T-05', 'T-09', 'T-12']);
  assert.deepEqual(gates.map((g) => g.state), ['HOLD', 'HOLD', 'NOT_TRIGGERED', 'HOLD']);
  assert.ok(gates.filter((g) => g.code !== 'T-09').every((g) => /지식팩 미연결/.test(g.reason)));
  assert.ok(gates.every((g) => g.automatic_legal_conclusion === false && g.source.official_text_status.startsWith('NOT_VERIFIED')));
  // 모든 자료를 확보로 표시해도 지식팩 없이 '충족'으로 넘어가지 않는다
  const all = Object.fromEntries(gates.flatMap((g) => [...g.requirements, ...(g.trigger ? [g.trigger] : [])]).map((r) => [r.id, 'SECURED']));
  assert.ok(buildEvidenceGates({ pack: null, draft: d, evidence: all }).every((g) => g.state === 'HOLD'));
});

test('증빙 게이트: 기본서 판단기준·확인자료가 부족하면 추정하지 않고 원본 확인 필요', async () => {
  const d = asLive(await syntheticDraft());
  const pack = makePack((p) => { entry(p, 'T-05').sections['판단기준'] = '-'; entry(p, 'T-12').sections['확인자료'] = ''; p.issue_codes = p.issue_codes.filter((e) => e.code !== 'T-01'); });
  const ev = { t05_recognition: 'SECURED', t05_dates: 'SECURED', t05_factor_table: 'SECURED', t12_dated_photos: 'SECURED', t12_permits: 'SECURED', t12_appraisal: 'SECURED' };
  const g = Object.fromEntries(buildEvidenceGates({ pack, draft: d, evidence: ev }).map((x) => [x.code, x]));
  assert.equal(g['T-01'].state, 'HOLD'); assert.match(g['T-01'].reason, /T-01 항목 없음 — 원본 확인 필요/);
  assert.equal(g['T-05'].state, 'HOLD'); assert.match(g['T-05'].reason, /판단기준\(성립요건\) 원문·요약 부족 — 원본 확인 필요/);
  assert.equal(g['T-12'].state, 'HOLD'); assert.match(g['T-12'].reason, /확인자료 원문·요약 부족/);
});

test('증빙 게이트: 충족·미충족·판정 보류 구분과 T-09 개시요건', async () => {
  const live = asLive(await syntheticDraft());
  const pack = makePack();
  const base = Object.fromEntries(buildEvidenceGates({ pack, draft: live }).map((x) => [x.code, x]));
  assert.equal(base['T-01'].requirements[0].state, 'SATISFIED', '실데이터 표준지 후보 조회는 자동 확보');
  assert.equal(base['T-01'].state, 'HOLD');
  assert.equal(base['T-09'].state, 'NOT_TRIGGERED');
  assert.match(base['T-09'].reason, /지목·조사용 이용상황 명칭만으로 쟁점 성립하지 않음/);

  const ev = { t01_actual_use_env: 'SECURED', t01_appraisal_reason: 'SECURED', t01_dates: 'SECURED',
    t05_recognition: 'SECURED', t05_dates: 'UNAVAILABLE', t09_claim: 'SECURED', t09_photos: 'SECURED' };
  const g = Object.fromEntries(buildEvidenceGates({ pack, draft: live, evidence: ev }).map((x) => [x.code, x]));
  assert.equal(g['T-01'].state, 'READY_FOR_EXPERT');
  assert.match(g['T-01'].reason, /쟁점 성립 판단은 전문가 검토 필요/);
  assert.equal(g['T-05'].state, 'NOT_SATISFIED');
  assert.equal(g['T-09'].state, 'HOLD', '개시요건이 있어도 나머지 증빙이 없으면 보류');
  assert.equal(g['T-12'].state, 'HOLD');
  assert.equal(g['T-01'].source.pdf_page_start, 101);

  // 합성 시연자료의 표준지 후보는 실제 공적자료가 아니므로 T-01은 충족될 수 없다
  const syn = await syntheticDraft();
  const sg = buildEvidenceGates({ pack, draft: syn, evidence: ev }).find((x) => x.code === 'T-01');
  assert.equal(sg.requirements[0].state, 'HOLD');
  assert.match(sg.requirements[0].basis, /합성 시연자료/);
  assert.equal(sg.state, 'HOLD');
  // 하위호환 요약형
  const legacy = getManualEvidenceGates(pack, syn);
  assert.deepEqual(legacy.map((x) => x.code), ['T-01', 'T-05', 'T-09', 'T-12']);
  assert.equal(legacy[2].state, 'NOT_TRIGGERED');
});

test('표준지 검토요건: 4개 축 구분, 실제 현황은 항상 미확인, 순위는 적정성 아님', async () => {
  const d = await syntheticDraft();
  const st = d.analysis.standard;
  assert.equal(st.status, 'FOUND');
  for (const c of st.candidates) {
    assert.deepEqual(c.review_requirements.map((r) => r.key), ['public_restriction', 'actual_use', 'surroundings', 'distance']);
    assert.equal(c.adequacy, 'NOT_JUDGED');
    assert.equal(c.rank_basis, 'SIMILARITY_ORDER_NOT_ADEQUACY');
    assert.ok(c.review_requirements.every((r) => ['RECORD_MATCH', 'RECORD_DIFF', 'RECORD_PARTIAL', 'NOT_VERIFIED'].includes(r.status)));
    assert.ok(c.review_requirements.every((r) => r.unverified.length >= 1 && r.needs.length >= 1));
    assert.notEqual(c.review_requirements[1].status, 'RECORD_MATCH', '실제 이용상황은 조사용 표기 일치로 충족 처리하지 않음');
    assert.ok(c.review_requirements[3].confirmed.some((t) => t.includes('합성자료')), '합성 거리 표기');
  }
  assert.ok(st.notes.some((n) => n.includes('최종 적정성 순위가 아님')));
  const diff = standardReviewRequirements({ zoning: '제2종일반주거지역', zoning_secondary: '고도지구', land_use: '단독' }, { zoning: '제2종일반주거지역', land_use: '단독' }, null);
  assert.equal(diff[0].status, 'RECORD_DIFF');
  assert.equal(diff[3].status, 'NOT_VERIFIED');
});

test('형상·도로조건 분류만으로 대상 우세·열세 가설을 만들지 않음(전 조합)', () => {
  const roads = ['광대한면', '중로한면', '소로한면', '소로각지', '세로한면(가)', '세로(불)', '맹지', null];
  const shapes = ['정방형', '가로장방형', '사다리형', '부정형', '자루형', '삼각형', null];
  const elev = ['평지', '완경사', '급경사', '고지', null];
  for (const tr of roads) for (const sr of roads) for (const ts of shapes) for (const ss of shapes) for (const te of elev) {
    const fs = compareFactors({ zoning: 'A', land_use: '단독', road_access: tr, shape: ts, elevation: te, area_m2: 100 },
      { zoning: 'A', land_use: '단독', road_access: sr, shape: ss, elevation: '평지', area_m2: 500 }, 120);
    for (const f of fs) if (f.hypothesis) assert.ok(['SIMILAR', 'UNDETERMINED'].includes(f.hypothesis.direction), `${f.key}: ${f.hypothesis.direction}`);
  }
});

test('상담 검토서: 6단 순서 고정, 미확정 표시, 금지표현 없음, 지식팩 미연결 명시', async () => {
  const d = await syntheticDraft();
  const r = buildConsultReport({ draft: d, intake: emptyIntake(), now: NOW });
  const idx = REPORT_SECTIONS.map((t, i) => r.text.indexOf(`\n${i + 1}. ${t}\n`));
  assert.ok(idx.every((v) => v > 0), JSON.stringify(idx));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, '섹션 순서');
  const section = (n) => r.text.slice(idx[n - 1], n < 6 ? idx[n] : undefined);
  assert.match(section(1), /■ 합성 시연자료\(실제 공적자료 아님\)/);
  assert.match(section(1), /고객의 목표: 미확정 \[미확정\]/);
  assert.match(section(2), /■ 표준지 검토요건\(공법상 제한·실제 이용상황·주위환경·거리\)/);
  assert.match(section(2), /후보 1\(검토 순서 · 적정성 순위 아님\)/);
  assert.match(section(2), /실제 이용상황: 대상·표준지의 현실적 이용상황/);
  assert.match(section(2), /최종 비교표준지 선정·보정률·보상금 산정은 수행하지 않았습니다/);
  assert.match(section(3), /비공개 지식팩 미연결/);
  assert.match(section(3), /T-01 비교표준지 선정\(기본서 제목 미연결\) · 원문 위치 미확인/);
  assert.match(section(4), /T-01 비교표준지 선정: 판정 보류/);
  assert.match(section(4), /T-09 지목과 현실 이용상황: 검토 개시요건 없음/);
  assert.match(section(5), /절차 단계: 미확정/);
  assert.match(section(5), /■ 상담 멘트\(초안\)/);
  assert.match(section(6), /■ 정밀검토 과업/);
  assert.match(section(6), /감정평가서 비교표준지 선정사유/);
  assert.doesNotMatch(r.text, /\[내부 전용/);
  assert.deepEqual(r.forbidden_hits, []);
  assert.equal(r.intake.legal_deadline_computed, false);
  assert.ok(!r.tasks.some((t) => t.code === 'T-09'), '개시요건 없는 T-09는 과업으로 제안하지 않음');
});

test('상담 검토서: 지식팩 연결 시 코드·원문 위치·성립요건 발췌, 부족분은 원본 확인 필요, 근거는 공식원문 미대조 표시', async () => {
  const d = await syntheticDraft();
  const pack = makePack((p) => { entry(p, 'T-12').sections['판단기준'] = '없음'; entry(p, 'T-01').sections['판단기준'] = `가${'나'.repeat(400)}`; });
  const r = buildConsultReport({ draft: d, pack, now: NOW,
    intake: { case_type: 'LAND', goal: 'OBJECTION', stage: 'ADJUDICATION', stage_basis: '재결서', authority: 'LAND_COMMITTEE_LOCAL',
      trigger_event: '재결서 정본 수령', trigger_date: '2026-11-20', trigger_source: '수령증' } });
  assert.match(r.text, /내부 전용\(기본서 발췌 포함\)/);
  assert.match(r.text, /- T-01 합성 유형 T-01 · 책 99쪽 · PDF 101–102쪽/);
  assert.match(r.text, /성립요건\(기본서 판단기준\): 가나+…/);
  assert.match(r.text, /T-12 합성 유형 T-12[^\n]*\n {2}· 성립요건\(기본서 판단기준\): 원문·요약 부족 — 원본 확인 필요/);
  assert.match(r.text, /근거\(기본서 기재 · 현행 법령·판례 공식 원문 미대조\)/);
  assert.match(r.text, /현재 사업·보상 절차 단계: 수용재결\(재결서 수령\) · 근거: 재결서 \[상담자 기록\]/);
  assert.match(r.text, /이의신청·행정소송 기간은 법령 원문·재결서 안내문으로 확인\(BSO 미계산\)/);
  assert.ok(r.tasks.some((t) => t.title.includes('재결·이의재결')));
  assert.deepEqual(r.forbidden_hits, []);
});
