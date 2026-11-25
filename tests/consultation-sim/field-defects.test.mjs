// PR #36 결함 회귀(2026-11-25 독립 점검에서 재현) — 합성 데이터만, 네트워크 없음. 수정 전 실패하던 사례를 고정한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../../browser/consultation-sim/core/field-bundle.js';
import { buildStandardReview, standardTraits, targetTraits, TRAIT_STATUS } from '../../browser/consultation-sim/core/field-standard.js';
import { queryStandardLands, queryPublicData, errorText } from '../../browser/consultation-sim/core/field-public-data.js';

const { BUNDLE, createBridgeCache, bundleTotals, confirmedAreaBasis, buildBundleSummary } = B;

// ── 표준지: 엔진이 고른 행만 표시 ──
const P = '9999910201100010000';
const R = (x = {}) => ({ pnu: P, stdrYear: '2026', pblntfPclnd: '100000', prposAreaNm1: '계획관리지역', lndcgrCodeNm: '답', ladUseSittnNm: '답', ldCode: P.slice(0, 10), ldCodeNm: '가상도 표준리', mnnmSlno: '1',
  roadSideCodeNm: '맹지', tpgrphFrmCodeNm: '부정형', tpgrphHgCodeNm: '평지', name_filled_from_land_characteristics: [], ...x });
const review = (rows, located = true) => buildStandardReview({
  response: { ok: true, status: 'OK', target: { centroid: [127, 36] }, search: { year: 2026, radius_m: 1000, legal_dongs: [], legal_dongs_not_queried: [] }, rows,
    locations: Object.fromEntries(rows.map((r) => [r.pnu, located ? { status: 'EXACT_ONE', centroid: [127.001, 36], distance_m: 100 } : { status: 'NOT_FOUND' }])), limits: {}, name_resolution: { unresolved: [] } },
  target: { zoning: '계획관리지역', land_use: '답', land_category: '답' } });
const bothOrders = (a, b) => [[a, b], [b, a]];

test('표준지 연도: 같은 PNU의 2025 행이 섞여도 2026 후보에는 2026 행 값만 · 순서 무관', () => {
  for (const rows of bothOrders(R(), R({ stdrYear: '2025', roadSideCodeNm: '세로(가)', pblntfPclnd: '90000' }))) {
    const c = review(rows).list.find((x) => x.kind === 'CANDIDATE');
    assert.equal(c.year, 2026); assert.equal(c.price, 100000);
    assert.equal(c.traits.road_access.value, '맹지'); assert.equal(String(c.traits.road_access.year), '2026');
    const old = review(rows).list.find((x) => x.year === 2025);
    assert.equal(old.kind, 'EXCLUDED'); assert.equal(old.traits.road_access.value, '세로(가)'); assert.equal(String(old.traits.road_access.year), '2025');
  }
});

test('표준지 충돌: 같은 PNU·연도 값이 다르면 임의 선택 없이 값 충돌 · 순서 무관 · 후보 아님', () => {
  const out = bothOrders(R(), R({ roadSideCodeNm: '세로(가)' })).map((rows) => review(rows).list[0]);
  for (const x of out) {
    assert.equal(x.kind, 'EXCLUDED'); assert.match(x.status_label, /값 충돌·확인 필요/);
    assert.equal(x.traits.road_access.status, 'CONFLICT'); assert.equal(x.traits.road_access.value, null);
    assert.deepEqual(x.traits.road_access.values, ['맹지', '세로(가)']);
    assert.equal(x.traits.shape.value, '부정형'); // 모든 행이 같은 값
  }
  assert.deepEqual(out[0].traits, out[1].traits);
});

test('표준지 충돌: 공시지가도 한쪽 값을 표시하지 않음', () => {
  const x = review([R(), R({ pblntfPclnd: '120000' })]).list[0];
  assert.equal(x.price, null); assert.deepEqual(x.conflict?.fields, ['pblntfPclnd']); assert.equal(x.conflict.row_count, 2);
  assert.equal(x.traits.road_access.value, '맹지');
});

test('표준지 충돌: 위치 미확인 목록도 첫 행을 고르지 않음 · 갱신일만 다르면 정상 · 기준연도 행 우선', () => {
  const h = review([R(), R({ roadSideCodeNm: '세로(가)' })], false).list[0];
  assert.equal(h.kind, 'HELD'); assert.equal(h.traits.road_access.status, 'CONFLICT'); assert.match(h.status_label, /값 충돌/);
  const held2 = review([R({ stdrYear: '2025', roadSideCodeNm: '세로(가)' }), R()], false).list;
  assert.equal(held2.find((x) => x.year === 2026)?.traits.road_access.value, '맹지');
  const ok = review([R({ lastUpdtDt: '2026-05-01' }), R({ lastUpdtDt: '2026-06-01' })]).list;
  assert.equal(ok.length, 1); assert.equal(ok[0].kind, 'CANDIDATE'); assert.equal(ok[0].traits.road_access.status, 'API_NAME');
});

test('표준지 특성: 명칭 출처를 필지별로 구분(같은 필지 · 다른 필지·행 · 미구분) · 괄호 보존', () => {
  const raw = (s) => ({ ...R({ roadSideCode: '08', roadSideCodeNm: '세로(불)' }), name_filled_from_land_characteristics: ['roadSideCodeNm'], ...(s ? { name_sources: { roadSideCodeNm: s } } : {}) });
  assert.equal(standardTraits(raw('SAME_PNU_LC')).road_access.status, 'NAME_SAME_PNU');
  for (const s of ['OTHER_PNU_LC', 'STANDARD_ROW', 'UNVERIFIED_LC']) assert.equal(standardTraits(raw(s)).road_access.status, 'NAME_OTHER');
  assert.equal(standardTraits(raw(null)).road_access.status, 'NAME_FROM_LC');
  assert.match(TRAIT_STATUS.NAME_OTHER, /이 필지 값으로 확인 안 됨/);
  assert.equal(standardTraits(raw('SAME_PNU_LC')).road_access.value, '세로(불)');
});

test('대상 특성: 표준지 속성이 아니라 토지특성 출처로 표시', () => {
  const t = targetTraits([{ key: 'road_access', value: '맹지', base_year: 2026, source: 'VWorld 토지특성' }]);
  assert.equal(t.road_access.status, 'TARGET_LC'); assert.match(TRAIT_STATUS.TARGET_LC, /토지특성/);
});

// ── 면적 이중 합산 ──
const N = { notice_no: '가상 고시 1', notice_date: '2000-01-01', project: '가상사업' };
const p = (n, x = {}) => ({ n, label: `필지${n}`, kind: 'ROW', notice: N, pnu: `999991010110${String(n).padStart(3, '0')}0000`, lot_key: `숲내읍|바위리|0|${n}|0`, area_basis_date: '1999-12-01', ownership: {}, card: {},
  facts: { jimok: '답', ledger_area_m2: 1000, incorporated_area_m2: 300 }, ...x });

test('면적: 같은 PNU가 두 번 담기면 합계 보류(두 배 금지) · 근거 표시 · 나머지만 합산', () => {
  const ps = [p(1), p(2, { pnu: p(1).pnu }), p(3)];
  const t = bundleTotals(ps);
  assert.deepEqual(t.groups.map((g) => [g.ledger, g.incorporated, g.numbers]), [[1000, 300, [3]]]);
  assert.deepEqual(t.held, [{ reason: 'SAME_PNU', numbers: [1, 2] }]);
  const s = buildBundleSummary({ parcels: ps });
  assert.match(s, /합계 보류 2필지\(①②\) — 같은 PNU/); assert.doesNotMatch(s, /2,000/); assert.doesNotMatch(s, /\d{19}/);
});

test('면적: PNU 미조회라도 같은 고시·같은 지번 행이면 보류 · 이어진 중복(3건)도 · 색인 밖 같은 PNU는 중복 제외 표시', () => {
  const same = bundleTotals([p(1, { pnu: null }), p(2, { pnu: null, lot_key: p(1).lot_key })]);
  assert.deepEqual(same.groups, []); assert.deepEqual(same.held, [{ reason: 'SAME_LOT', numbers: [1, 2] }]);
  const three = bundleTotals([p(1), p(2, { pnu: p(1).pnu }), p(3, { lot_key: p(2).lot_key })]);
  assert.deepEqual(three.groups, []); assert.deepEqual([...new Set(three.held.flatMap((h) => h.numbers))].sort(), [1, 2, 3]);
  const d = bundleTotals([p(1), p(2, { kind: 'DIRECT', facts: null, pnu: p(1).pnu })]);
  assert.deepEqual(d.groups.map((g) => g.ledger), [1000]); assert.deepEqual(d.excluded, [2]); assert.deepEqual(d.duplicates, [{ n: 2, of: [1] }]);
});

test('면적: 같은 고시라도 사업·고시번호·고시일이 다르면 합산하지 않음', () => {
  const g = (x) => bundleTotals([p(1), p(2, x)]).groups.length;
  assert.equal(g({}), 1);
  assert.equal(g({ notice: { ...N, project: '다른사업' } }), 2);
  assert.equal(g({ notice: { ...N, notice_date: '2001-01-01' } }), 2);
  assert.equal(g({ notice: { ...N, notice_no: '가상 고시 2' } }), 2);
});

// ── 세목표 면적 기준일(감정평가 가격시점과 별개) ──
const B1 = '1999-12-01'; const B2 = '1999-11-01';
const shape = (t) => t.groups.map((g) => [g.area_basis_date, g.ledger, g.incorporated, g.numbers]);

test('면적 기준일: 둘 다 공란이면 같은 기준으로 보지 않고 합계 보류(GPT 재현 사례)', () => {
  for (const v of ['', '   ', null, undefined]) {
    const ps = [1, 2].map((n) => ({ ...p(n), area_basis_date: v })); const t = bundleTotals(ps);
    assert.deepEqual(t.groups, []); assert.deepEqual(t.basisUnconfirmed, [1, 2]);
    const s = buildBundleSummary({ parcels: ps });
    assert.match(s, /합산할 고시 기재 면적 없음/); assert.match(s, /합계 보류 2필지\(①②\) — 세목표 면적 기준일 미확인/); assert.doesNotMatch(s, /2,000|필지 중 \d필지/);
    assert.match(s, /① 필지1 · 답 · 공부 1,000㎡ · 편입 300㎡/); // 필지별 기재값은 그대로
  }
});

test('면적 기준일: 일부 필지만 입력하면 확인된 필지끼리만 합산 · 나머지 보류', () => {
  const ps = [p(1), p(2, { area_basis_date: '' }), p(3), p(4, { area_basis_date: '' })]; const t = bundleTotals(ps);
  assert.deepEqual(shape(t), [[B1, 2000, 600, [1, 3]]]); assert.deepEqual(t.basisUnconfirmed, [2, 4]);
  const s = buildBundleSummary({ parcels: ps });
  assert.match(s, /4필지 중 2필지\(①③\) · 사업 가상사업 · 세목표 면적 기준일 1999-12-01/); assert.match(s, /합계 보류 2필지\(②④\) — 세목표 면적 기준일 미확인/); assert.doesNotMatch(s, /4,000/);
});

test('면적 기준일: 일부만 적은 날짜·없는 날짜·입력 중 연도는 같은 문자열이어도 미확인', () => {
  for (const v of ['1999', '1999-12', '1999-12-', '1999-12-1', '1999-02-30', '1999-13-01', '0002-12-01', '미확인', 19991201]) {
    const t = bundleTotals([p(1, { area_basis_date: v }), p(2, { area_basis_date: v })]);
    assert.deepEqual([t.groups, t.basisUnconfirmed], [[], [1, 2]], String(v));
  }
  assert.equal(confirmedAreaBasis(' 2000-02-29 '), '2000-02-29');
});

test('면적 기준일: 같은 확인일이면 합산 · 다른 확인일이면 나눠 표시하고 전체 합계 없음', () => {
  assert.deepEqual(shape(bundleTotals([p(1), p(2)])), [[B1, 2000, 600, [1, 2]]]);
  const ps = [p(1), p(2, { area_basis_date: B2 })];
  assert.deepEqual(shape(bundleTotals(ps)), [[B1, 1000, 300, [1]], [B2, 1000, 300, [2]]]);
  const s = buildBundleSummary({ parcels: ps });
  assert.match(s, /세목표 면적 기준일 1999-12-01/); assert.match(s, /세목표 면적 기준일 1999-11-01/); assert.match(s, /전체 합계를 내지 않음/); assert.doesNotMatch(s, /2,000|기준일 미확인/);
});

test('면적 기준일: 감정평가 가격시점은 기준일을 대신하거나 합산을 가르지 않음 · 중복 보류가 먼저 · 다른 고시는 같은 기준일이어도 따로', () => {
  const v = bundleTotals([1, 2].map((n) => p(n, { area_basis_date: '', valuation_date: '2026-12-15' })));
  assert.deepEqual([v.groups, v.basisUnconfirmed], [[], [1, 2]]);
  assert.deepEqual(shape(bundleTotals([p(1, { valuation_date: '2026-12-15' }), p(2, { valuation_date: '' })])), [[B1, 2000, 600, [1, 2]]]);
  const d = bundleTotals([p(1, { area_basis_date: '' }), p(2, { area_basis_date: '', pnu: p(1).pnu })]);
  assert.deepEqual([d.groups, d.basisUnconfirmed, d.held], [[], [], [{ reason: 'SAME_PNU', numbers: [1, 2] }]]);
  assert.equal(bundleTotals([p(1), p(2, { notice: { ...N, notice_no: '가상 고시 2' } })]).groups.length, 2);
});

// ── 호출 상한 ──
const post = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const U = (op) => `/__public_data_bridge/${op}`;
const tiles = (i, n = 4) => ({ pnu: String(i), tiles: Array.from({ length: n }, (_, k) => [i, k]) });
const res = (j, status = 200) => new Response(JSON.stringify(j), { status });
const tick = () => new Promise((r) => setImmediate(r));

test('지적 상한: 동시 요청도 보내기 전에 예약 — 최악(요청당 8회)이어도 합계 40회를 넘지 않음', async () => {
  let rel; const gate = new Promise((r) => { rel = r; }); let sent = 0; let vworld = 0;
  const c = createBridgeCache({ fetchImpl: async () => { sent += 1; await gate; vworld += 8; return res({ ok: true, mode: 'TILES', tiles: [], request_count: 8 }); } });
  const all = Array.from({ length: 9 }, (_, i) => c.fetch(U('parcel_map'), post(tiles(i))));
  await tick();
  assert.equal(sent, 5); assert.equal(c.stats.cad_reserved, 40);
  rel(); const js = await Promise.all(all.map(async (x) => (await x).json()));
  assert.equal(vworld, 40); assert.equal(c.stats.vworld_cad, 40); assert.equal(c.stats.cad_reserved, 0);
  assert.equal(js.filter((j) => j.error_code === 'BUNDLE_CAD_LIMIT').length, 4);
});

test('지적 상한: 순차 — 남은 예산보다 최대 소비가 크면 보내지 않음 · 작은 요청은 남은 예산 안에서 허용', async () => {
  let vworld = 0;
  const c = createBridgeCache({ fetchImpl: async (_u, i) => { const n = Math.min(8, JSON.parse(i.body).tiles.length * 3); vworld += n; return res({ ok: true, mode: 'TILES', tiles: [], request_count: n }); } });
  for (let i = 0; i < 4; i += 1) await c.fetch(U('parcel_map'), post(tiles(i)));
  await c.fetch(U('parcel_map'), post(tiles(50, 2))); // 32 + 6 = 38
  assert.equal(c.stats.vworld_cad, 38);
  assert.equal((await (await c.fetch(U('parcel_map'), post(tiles(60)))).json()).error_code, 'BUNDLE_CAD_LIMIT');
  assert.equal(vworld, 38); assert.equal(c.cadLeft(), 0); // 한 칸 최대 3회도 남은 2회를 넘음
});

test('지적 상한: 실패·시간초과·집계 없는 응답은 0으로 치지 않고 미확인(최대치)으로 남김 · 서버가 VWorld 전에 거절한 것만 0', async () => {
  let n = 0; const reply = [{ ok: false, error_code: 'PUBLIC_DATA_TIMEOUT' }, { ok: true, mode: 'TILES', tiles: [] }, { ok: false, error_code: 'RATE_LIMITED' }];
  const c = createBridgeCache({ fetchImpl: async () => res(reply[n++]) });
  for (let i = 0; i < 3; i += 1) await c.fetch(U('parcel_map'), post(tiles(i)));
  assert.equal(c.stats.vworld_cad, 0); assert.equal(c.stats.cad_unknown, 16); assert.equal(c.stats.cad_reserved, 0);
  const d = createBridgeCache({ fetchImpl: async () => { throw new Error('x'); } });
  for (let i = 0; i < 9; i += 1) await d.fetch(U('parcel_map'), post(tiles(i)));
  assert.equal(d.stats.cad_unknown, 40); assert.equal(d.stats.network, 5); // 실패를 반복해도 상한 안
});

test('표준지 상한: 실패 구분 집계 · 소비 미확인 전송은 3회에 포함 · 미소비 거절은 제외 · 동시 전송도 3회', async () => {
  let mode = 'fail'; let sent = 0;
  const c = createBridgeCache({ fetchImpl: async () => { sent += 1; return res(mode === 'fail' ? { ok: false, error_code: 'VWORLD_API_ERROR' } : mode === 'limit' ? { ok: false, error_code: 'RATE_LIMITED' } : { ok: true, request_count: { total: 100 } }); } });
  const go = async (i) => (await c.fetch(U('standard_lands'), post({ pnu: String(i) }))).json();
  await go(1); assert.equal(c.stats.std_failed, 1); assert.equal(c.stats.std_unknown, 1); assert.equal(c.stats.std_sent, 1);
  mode = 'limit'; await go(1); assert.equal(c.stats.std_sent, 1); // 미소비 거절은 한도에서 뺌
  mode = 'ok'; await go(1); await go(2); assert.equal(c.stats.std_ok, 2); assert.equal(c.stats.std_sent, 3);
  assert.equal((await go(3)).error_code, 'BUNDLE_STD_LIMIT'); assert.equal(sent, 4);
  const d = createBridgeCache({ fetchImpl: () => new Promise(() => {}), setTimer: () => 0, clearTimer: () => {} });
  for (let i = 0; i < 5; i += 1) d.fetch(U('standard_lands'), post({ pnu: String(i) }));
  await tick(); assert.equal(d.stats.network, 3);
});

test('표준지 실패 응답이 호출 수를 알려주면 확정 집계 · 알려주지 않으면 미확인', async () => {
  const c = createBridgeCache({ fetchImpl: async () => res({ ok: false, error_code: 'VWORLD_API_ERROR', request_count: { total: 3 } }) });
  await c.fetch(U('standard_lands'), post({ pnu: '1' }));
  assert.equal(c.stats.vworld_std, 3); assert.equal(c.stats.std_unknown, 0); assert.equal(c.stats.std_failed, 1);
});

test('표준지 한도 안내: 결과가 없는데 "저장된 결과 사용"이라고 하지 않음', () => {
  const t = errorText('BUNDLE_STD_LIMIT');
  assert.match(t, /표준지 조회 한도\(3회\)/); assert.doesNotMatch(t, /저장된 결과 사용/); assert.match(t, /저장된 결과 없음/);
});

test('묶음 전 계측: 캐시를 끈 계량기는 재전송하되 집계 · 묶음 시작(enableCache) 뒤 이전 성공 결과 재사용·한도 적용', async () => {
  let sent = 0; const c = createBridgeCache({ cache: false, fetchImpl: async () => { sent += 1; return res({ ok: true, request_count: { total: 10 } }); } });
  for (let i = 0; i < 4; i += 1) await c.fetch(U('standard_lands'), post({ pnu: '1' })); // 단일 필지 동작 그대로(한도·재사용 없음)
  assert.equal(sent, 4); assert.equal(c.stats.std_sent, 4); assert.equal(c.stats.vworld_std, 40);
  c.enableCache();
  await c.fetch(U('standard_lands'), post({ pnu: '1' })); assert.equal(sent, 4);
  assert.equal((await (await c.fetch(U('standard_lands'), post({ pnu: '2' }))).json()).error_code, 'BUNDLE_STD_LIMIT');
});

// ── 조회시각 ──
test('조회시각: 저장 결과 재사용은 원래 조회시각 유지(표준지·공적자료)', async () => {
  let clock = Date.parse('2026-11-25T01:00:00Z'); const now = () => new Date(clock);
  const c = createBridgeCache({ now, fetchImpl: async (u) => res(String(u).endsWith('standard_lands') ? { ok: true, rows: [], request_count: { total: 1 } } : String(u).endsWith('pnu_parcel') ? { ok: true, parcel: { address: 'x 1', jibun: '1 답' } } : { ok: true, record: { zoning: '계획관리지역', land_use: '답' } }) });
  const loc = { protocol: 'http:', hostname: '127.0.0.1' };
  const std = () => queryStandardLands({ fetchImpl: c.fetch, location: loc, pnu: P, year: 2026, now });
  const pd = () => queryPublicData({ fetchImpl: c.fetch, location: loc, target: { scope: 'PNU', pnu: P }, now });
  const a = await std(); const x = await pd(); clock += 3_600_000; const b = await std(); const y = await pd();
  assert.equal(a.fetched_at, '2026-11-25T01:00:00.000Z'); assert.equal(b.fetched_at, a.fetched_at); assert.equal(b.reused, true); assert.ok(!a.reused);
  assert.deepEqual(y.values.map((v) => v.fetched_at), x.values.map((v) => v.fetched_at)); assert.equal(y.attempts[0].fetched_at, x.attempts[0].fetched_at);
});

test('시간 제한 기본값은 서버 작업 제한(120초)보다 김', () => { assert.ok(BUNDLE.timeoutMs >= 125_000 && BUNDLE.timeoutMs <= 150_000); });
