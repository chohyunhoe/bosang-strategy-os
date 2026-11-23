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

// ── 2026-11-23 실호출로 확인한 표준지 응답 스키마 회귀 (값은 전부 가상, 실제 사례 하드코딩 없음) ──
const realSchemaRow = (year, i, over = {}) => ({
  pnu: `99011010001${String(500 + i).padStart(4, '0')}0000`, stdrYear: String(year), ldCodeNm: '가상특별시 누리구 새솔동', mnnmSlno: String(500 + i),
  lndcgrCodeNm: '대', lndpclAr: String(300 + i * 10), prposAreaNm1: '제2종일반주거지역', prposAreaNm2: '지정되지않음',
  ladUseSittnNm: '단독', roadSideCodeNm: '세로한면(가)', tpgrphFrmCodeNm: '가로장방형', tpgrphHgCodeNm: '평지',
  pblntfPclnd: String(1500000 + i * 10000), lastUpdtDt: `${year}-03-01`, ...over,
});
const sevenRows = (year) => [
  realSchemaRow(year, 0), realSchemaRow(year, 1, { ladUseSittnNm: '다세대' }), realSchemaRow(year, 2, { roadSideCodeNm: '소로한면' }),
  realSchemaRow(year, 3, { prposAreaNm1: '일반상업지역', ladUseSittnNm: '상업용' }), realSchemaRow(year, 4, { ladUseSittnNm: '전', lndcgrCodeNm: '전' }),
  realSchemaRow(year, 5, { prposAreaNm1: '제1종일반주거지역' }), realSchemaRow(year, 6, { roadSideCodeNm: '', tpgrphFrmCodeNm: '' }),
];
const TARGET = { zoning: '제2종일반주거지역', zoning_secondary: null, land_use: '단독', land_category: '대', road_access: '세로한면(가)', shape: '세로장방형', elevation: '평지', area_m2: 400 };

test('실스키마(prposAreaNm1/2) 7행 × 2025·2026: 용도지역 전부 해석, 후보·배제 사유 정상', () => {
  for (const year of [2025, 2026]) {
    const rows = sevenRows(year);
    rows.forEach((r) => assert.equal(normalizeStandardRow(r).zoning, r.prposAreaNm1, '용도지역 매핑'));
    assert.equal(normalizeStandardRow(rows[0]).zoning_secondary, '지정되지않음');
    const r = analyzeStandardCandidates({ target: TARGET, rows, baseYear: year, scope: { label: '같은 법정동(9901101000)' } });
    assert.equal(r.status, 'FOUND', `${year}`);
    assert.equal(r.mapping.mapped_counts.zoning, 7);
    assert.equal(r.candidates.length, 3);
    const reasons = r.excluded.flatMap((x) => x.reasons).join(' | ');
    assert.doesNotMatch(reasons, /용도지역 미기재/, '실스키마에서 미기재 오판 없음');
    assert.match(reasons, /용도지역 상이\(일반상업지역\)/);
    assert.match(reasons, /용도지역 상이\(제1종일반주거지역\)/);
    assert.match(reasons, /이용상황군 상이\(전: 농지/);
    assert.match(reasons, /유사 후보 3건 초과/);
    assert.ok(r.notes.some((n) => n.includes('인접 법정동')), '조회 범위 한계 고지');
  }
});

test('토지특성 계열 별칭(prposArea1Nm)도 보존, 핵심 필드 해석 실패 시 전부 배제 대신 판정 보류', () => {
  const legacy = sevenRows(2026).map(({ prposAreaNm1, prposAreaNm2, ...rest }) => ({ ...rest, prposArea1Nm: prposAreaNm1, prposArea2Nm: prposAreaNm2 }));
  assert.equal(analyzeStandardCandidates({ target: TARGET, rows: legacy, baseYear: 2026 }).status, 'FOUND');
  const unknown = sevenRows(2026).map(({ prposAreaNm1, prposAreaNm2, ...rest }) => ({ ...rest, prposAreaX: prposAreaNm1 }));
  const held = analyzeStandardCandidates({ target: TARGET, rows: unknown, baseYear: 2026 });
  assert.equal(held.status, 'SCHEMA_UNMAPPED');
  assert.deepEqual(held.mapping.unmapped.map((u) => u.key), ['zoning']);
  assert.ok(held.mapping.response_field_names.includes('prposAreaX'));
  assert.equal(held.excluded.length, 0, '미기재로 전부 배제하지 않음');
});

test('의견 ②는 조회 범위 한계(인접 법정동 미비교)를 밝힘', async () => {
  const d = await run(NURI, '123-4');
  assert.ok(d.analysis.opinion.standard.some((x) => /인접 법정동 등 다른 지역 표준지는 비교하지 않았고/.test(x.text)));
  const fake = { ...d, analysis: { ...d.analysis, standard: analyzeStandardCandidates({ target: TARGET, rows: sevenRows(2026).map(({ prposAreaNm1, ...r }) => r), baseYear: 2026 }) } };
  assert.match(buildConsultOpinion(fake).standard[0].text, /해석하지 못해 후보 판정을 보류/);
});
