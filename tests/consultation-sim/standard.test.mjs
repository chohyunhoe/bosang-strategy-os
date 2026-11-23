// PR-2 비교표준지 엔진·상담 초동의견 — 합성 데이터만(실호출 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStandardCandidates, compareFactors, roadClass, useGroup, normalizeStandardRow, FACTOR_KEYS } from '../../browser/consultation-sim/core/standard-land-engine.js';
import { buildConsultOpinion, FORBIDDEN_PHRASES } from '../../browser/consultation-sim/core/consult-opinion.js';
import { createConsultationSession } from '../../browser/consultation-sim/core/consultation-session.js';
import { createSyntheticAdapter } from '../../browser/consultation-sim/adapters/synthetic-adapter.js';

const NURI = '가상특별시 누리구 새솔동';
const run = async (context, lotText, baseYear = 2026, opts = {}) => {
  const s = createConsultationSession({ adapter: createSyntheticAdapter({ baseDelayMs: 1, ...opts }) });
  await s.lookup({ context, lotText, baseYear });
  return s.state.draft;
};

test('후보 3건: 용도지역·이용상황군 일치만, 유사도→거리 순, 가장 가까운 표준지(상업)는 배제', async () => {
  const d = await run(NURI, '123-4');
  const st = d.analysis.standard;
  assert.equal(st.status, 'FOUND');
  assert.equal(st.candidates.length, 3);
  assert.deepEqual(st.candidates.map((c) => c.row.pnu.slice(11, 15)), ['0200', '0110', '0400']);
  for (const c of st.candidates) {
    assert.equal(c.row.zoning, '제2종일반주거지역');
    assert.equal(useGroup(c.row.land_use), '주거');
    assert.equal(c.factors.length, 8);
    assert.deepEqual(c.factors.map((x) => x.label), FACTOR_KEYS.map(([, l]) => l));
    assert.ok(c.selection_reasons.some((r) => r.startsWith('거리 ')));
  }
  assert.ok(st.nearest_excluded, '가장 가까운 표준지 정보');
  assert.equal(st.nearest_excluded.pnu.slice(11, 15), '0128');
  assert.match(st.nearest_excluded.reasons.join(), /용도지역 상이/);
  const reasons = st.excluded.flatMap((x) => x.reasons).join(' | ');
  assert.match(reasons, /이용상황군 상이\(전: 농지/);
  assert.match(reasons, /기준연도 2026 공시 아님\(2025\)/);
  assert.ok(st.notes.some((n) => n.includes('확정하지 않음')));
});

test('후보 1건(임야)·0건(상업 대상)', async () => {
  const one = await run('가상도 연습군 숲내면 바위리', '산 12-3');
  assert.equal(one.analysis.standard.status, 'FOUND');
  assert.equal(one.analysis.standard.candidates.length, 1);
  assert.match(one.analysis.standard.excluded[0].reasons.join(), /용도지역 상이\(계획관리지역\)/);
  const none = await run('가상특별시 한빛구 새솔동', '123-4');
  assert.equal(none.analysis.standard.status, 'NONE');
  assert.equal(none.analysis.standard.candidates.length, 0);
  assert.match(none.analysis.opinion.standard[0].text, /찾지 못했습니다/);
  assert.ok(none.analysis.opinion.issues.some((i) => i.title === '비교표준지 선정 적정성'));
});

test('요인 비교: 확인 자료·가설·확인 필요 구분, 자료 없으면 가설 없음', () => {
  const target = { zoning: 'A', land_use: '단독', road_access: '세로한면(가)', shape: '세로장방형', elevation: '평지', area_m2: 400, land_category: '대' };
  const std = normalizeStandardRow({ pnu: '9', stdrYear: '2026', prposArea1Nm: 'A', ladUseSittnNm: '다세대', roadSideCodeNm: '소로한면', tpgrphFrmCodeNm: '부정형', tpgrphHgCodeNm: '평지', lndpclAr: '100', pblntfPclnd: '1' });
  const f = Object.fromEntries(compareFactors(target, std, 250).map((x) => [x.key, x]));
  assert.equal(f.zoning.relation, 'SAME');
  assert.equal(f.street.hypothesis.direction, 'TARGET_WORSE');
  assert.equal(f.lot.hypothesis.direction, 'TARGET_BETTER', '대상 정형 vs 표준지 부정형');
  assert.match(f.lot.hypothesis.text, /4\.0배/);
  for (const k of ['access', 'environment', 'surroundings']) { assert.equal(f[k].status, 'NEEDS_CHECK'); assert.equal(f[k].hypothesis, null); }
  assert.match(f.access.facts[0], /250m/);
  const blank = Object.fromEntries(compareFactors({ zoning: 'A', land_use: '단독' }, normalizeStandardRow({ prposArea1Nm: 'A', ladUseSittnNm: '단독', roadSideCodeNm: '' }), null).map((x) => [x.key, x]));
  assert.equal(blank.street.status, 'NEEDS_CHECK');
  assert.equal(blank.street.hypothesis, null, '빈 도로접면(실호출 사례)으로 우열 가설 금지');
  assert.equal(blank.lot.hypothesis, null);
  assert.equal(roadClass('세로각지(가)'), 2.5);
  assert.equal(roadClass('맹지'), 0);
  assert.equal(roadClass(''), null);
});

test('대상 핵심값 미확보·중복행 충돌·빈 응답', () => {
  assert.equal(analyzeStandardCandidates({ target: { zoning: null, land_use: '단독' }, rows: [{}], baseYear: 2026 }).status, 'INSUFFICIENT_TARGET');
  const row = { pnu: '9901101000101100000', stdrYear: '2026', prposArea1Nm: 'A', ladUseSittnNm: '단독', pblntfPclnd: '100', lastUpdtDt: '2026-01-01' };
  const conflict = analyzeStandardCandidates({ target: { zoning: 'A', land_use: '단독' }, rows: [row, { ...row, pblntfPclnd: '200', lastUpdtDt: '2026-02-01' }], baseYear: 2026 });
  assert.equal(conflict.status, 'NONE');
  assert.match(conflict.excluded[0].reasons[0], /값 충돌\(pblntfPclnd\)/);
  const dup = analyzeStandardCandidates({ target: { zoning: 'A', land_use: '단독' }, rows: [row, { ...row, lastUpdtDt: '2026-02-01' }], baseYear: 2026 });
  assert.equal(dup.candidates.length, 1, 'lastUpdtDt만 다른 중복은 1건으로 정리');
  assert.equal(analyzeStandardCandidates({ target: { zoning: 'A', land_use: '단독' }, rows: [], baseYear: 2026 }).status, 'NONE');
});

test('상담 초동의견 4부: 근거 연결, 합성 표시, 단정 표현 없음', async () => {
  for (const [ctx, lot] of [[NURI, '123-4'], [NURI, '130'], [NURI, '125'], ['가상도 연습군 숲내면 바위리', '산 12-3'], ['가상특별시 한빛구 새솔동', '123-4']]) {
    const d = await run(ctx, lot);
    const o = d.analysis.opinion;
    assert.ok(o.features.length && o.standard.length && o.script, `${lot}: 4부 구성`);
    assert.deepEqual(o.forbidden_hits, [], `${lot}: 금지 표현`);
    for (const x of [...o.features, ...o.issues]) assert.ok(Array.isArray(x.basis), 'basis 배열');
    assert.ok(o.issues.every((i) => i.basis.length > 0), `${lot}: 쟁점은 근거 필드 필수`);
    assert.match(o.features[0].text, /^\[합성 시연자료\]/);
    assert.match(o.script, /^\(시연자료 기준\)/);
    assert.match(o.script, /말씀드릴 수는 없고/);
    assert.ok(o.materials.includes('사업인정 고시문·보상계획 공고문'));
  }
  const d130 = await run(NURI, '130');
  assert.ok(d130.analysis.opinion.issues.some((i) => i.title === '현실적 이용상황'));
  const d123 = await run(NURI, '123-4');
  assert.ok(d123.analysis.opinion.issues.some((i) => i.title === '획지조건' || i.title === '가로(도로)조건' || i.title.startsWith('행정적')));
  assert.ok(FORBIDDEN_PHRASES.some((re) => re.test('보상금이 오릅니다')), '금지 표현 검사기 자체 동작');
});

test('API 장애 시 표준지 FAILED·임의 후보 없음, 늦은 응답 폐기', async () => {
  const down = await run(NURI, '123-4', 2026, { scenario: 'API_DOWN' });
  assert.equal(down.analysis.standard.status, 'FAILED');
  assert.match(down.analysis.opinion.standard[0].text, /임의 후보를 만들지 않습니다/);
  const s = createConsultationSession({ adapter: createSyntheticAdapter({ baseDelayMs: 1 }) });
  const slow = s.lookup({ context: NURI, lotText: '150', baseYear: 2026 });
  await new Promise((r) => setTimeout(r, 30));
  await s.lookup({ context: '가상도 연습군 숲내면 바위리', lotText: '산 12-3', baseYear: 2026 });
  await slow;
  assert.equal(s.state.draft.analysis.standard.candidates.length, 1, '이전 필지 표준지 결과 혼입 없음');
});
