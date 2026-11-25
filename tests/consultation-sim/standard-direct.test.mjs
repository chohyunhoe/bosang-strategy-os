// 표준지 개별 직접조회 병합(applyDirect) · 대상 목록(directTargets) · 브리지 호출(queryStandardTraits) — 합성 데이터만.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStandardReview, applyDirect, directTargets, compareDirectField, DIRECT_FIELDS, buildStdMatrix } from '../../browser/consultation-sim/core/field-standard.js';
import { queryStandardTraits } from '../../browser/consultation-sim/core/field-public-data.js';
import { PROV, provTrait } from '../../browser/consultation-sim/core/field-provenance.js';

const P = (k) => `99999102011${String(k).padStart(4, '0')}0000`;
const row = (k, extra = {}) => ({ pnu: P(k), stdrYear: '2026', pblntfPclnd: String(100000 + k), prposArea1: '22', prposAreaNm1: '계획관리지역', lndcgrCode: '02', lndcgrCodeNm: '답',
  ladUseSittn: '510', ladUseSittnNm: '답', roadSideCode: '05', roadSideCodeNm: '세로(가)', tpgrphFrmCode: '05', tpgrphFrmCodeNm: '부정형', tpgrphHgCode: '02', tpgrphHgCodeNm: '평지',
  lndpclAr: '1,200', ldCode: '9999910201', ldCodeNm: '가상도 가상시 표준리', mnnmSlno: String(k), ...extra });
const response = (rows) => ({ ok: true, status: 'OK', target: { pnu: P(9), centroid: [127, 36] },
  search: { year: 2026, radius_m: 1000, legal_dongs: [{ ld_code: '9999910201', name: '가상', status: 'OK' }], legal_dongs_not_queried: [] }, rows,
  locations: Object.fromEntries(rows.map((r, i) => [r.pnu, { status: 'EXACT_ONE', centroid: [127 + i * 0.001, 36], distance_m: 100 + i * 50 }])), limits: {}, name_resolution: { unresolved: [] }, request_count: { total: 5 } });
const target = { zoning: '계획관리지역', land_use: '답', land_category: '답', road_access: '세로(가)', shape: '부정형', elevation: '평지' };
const lc = (k, extra = {}) => ({ pnu: P(k), stdrYear: '2026', prposArea1: '22', prposArea1Nm: '계획관리지역', lndcgrCode: '02', lndcgrCodeNm: '답', ladUseSittn: '510', ladUseSittnNm: '답',
  roadSideCode: '05', roadSideCodeNm: '세로(가)', tpgrphFrmCode: '05', tpgrphFrmCodeNm: '부정형', tpgrphHgCode: '02', tpgrphHgCodeNm: '평지', lndpclAr: '1200', ...extra });

test('직접조회 일치: 이 필지 확인값(기재·수신)으로 표시 · 코드 사전 명칭 상태(NAME_OTHER)를 대체', () => {
  // 서버 learn_names가 다른 필지 응답으로 명칭을 채운 경우(NAME_OTHER)
  const r1 = row(1, { roadSideCodeNm: '세로(가)', name_filled_from_land_characteristics: ['roadSideCodeNm'], name_sources: { roadSideCodeNm: 'OTHER_PNU_LC' } });
  const sr = buildStandardReview({ response: response([r1, row(2), row(3)]), target });
  const c1 = sr.list.find((x) => x.pnu === P(1));
  assert.equal(c1.traits.road_access.status, 'NAME_OTHER');
  const d = applyDirect(c1, { status: 'OK', record: lc(1), fetched_at: '2026-11-26T00:00:00Z' });
  assert.equal(d.traits.road_access.status, 'DIRECT_MATCH'); assert.equal(d.traits.road_access.value, '세로(가)');
  assert.equal(provTrait('DIRECT_MATCH'), PROV.RECEIVED); assert.equal(provTrait('DIRECT_MISMATCH'), PROV.UNVERIFIED);
  assert.deepEqual(d.direct.mismatches, []); assert.equal(d.area, 1200); assert.equal(d.rank, c1.rank);
  // 매트릭스: 직접조회 일치 값은 추가 주석 없이(text 없음) 기재·수신
  const mx = buildStdMatrix({ pdValues: [], columns: [d] });
  const cell = mx.rows.find((r) => r.key === 'road_access').cells[0];
  assert.equal(cell.tier, PROV.RECEIVED); assert.equal(cell.text, null); assert.equal(cell.value, '세로(가)');
  assert.equal(mx.rows.find((r) => r.key === 'area').cells[0].value, '1,200㎡');
});

test('직접조회 불일치: 표준지 API 코드와 토지특성 코드가 다르면 양쪽 원본 보존 · 값 고르지 않음', () => {
  const sr = buildStandardReview({ response: response([row(1), row(2), row(3)]), target });
  const c = sr.list.find((x) => x.pnu === P(2));
  const d = applyDirect(c, { status: 'OK', record: lc(2, { roadSideCode: '12', roadSideCodeNm: '맹지', prposArea1: '71', prposArea1Nm: '농림지역', lndpclAr: '900' }) });
  assert.deepEqual(d.direct.mismatches.sort(), ['area', 'road_access', 'zoning']);
  assert.equal(d.traits.road_access.status, 'DIRECT_MISMATCH'); assert.equal(d.traits.road_access.value, null);
  assert.deepEqual(d.traits.road_access.std, { value: '세로(가)', code: '05' }); assert.deepEqual(d.traits.road_access.direct, { value: '맹지', code: '12' });
  assert.equal(d.zoning, null); assert.equal(d.area, null);
  const mx = buildStdMatrix({ pdValues: [], columns: [d] });
  const z = mx.rows.find((r) => r.key === 'zoning').cells[0];
  assert.equal(z.status, 'DIRECT_MISMATCH'); assert.match(z.text, /표준지 계획관리지역 \/ 토지특성 농림지역/); assert.equal(z.tier, PROV.UNVERIFIED);
  assert.match(mx.rows.find((r) => r.key === 'road_access').cells[0].text, /표준지 세로\(가\) \/ 토지특성 맹지/);
  // 후보 판정(순위)은 표준지공시지가 API 값 그대로 — 직접조회로 선정이 바뀌지 않음
  assert.deepEqual(sr.list.filter((x) => x.kind === 'CANDIDATE').map((x) => x.pnu), buildStandardReview({ response: response([row(1), row(2), row(3)]), target }).list.filter((x) => x.kind === 'CANDIDATE').map((x) => x.pnu));
});

test('다른 필지·연도 레코드·실패·충돌은 값으로 쓰지 않음 · 표준지 API에 명칭이 없으면 직접조회 값', () => {
  const sr = buildStandardReview({ response: response([row(1, { roadSideCodeNm: '', tpgrphHgCodeNm: '' }), row(2), row(3)]), target });
  const c = sr.list.find((x) => x.pnu === P(1));
  assert.equal(c.traits.road_access.status, 'CODE_ONLY');
  const wrong = applyDirect(c, { status: 'OK', record: lc(2) });
  assert.equal(wrong.direct.status, 'MISMATCH'); assert.equal(wrong.traits.road_access.status, 'CODE_ONLY');
  const wrongYear = applyDirect(c, { status: 'OK', record: lc(1, { stdrYear: '2025' }) });
  assert.equal(wrongYear.direct.status, 'MISMATCH');
  for (const status of ['FAILED', 'ROW_CONFLICT', 'NOT_FOUND', 'UNSUPPORTED']) {
    const x = applyDirect(c, { status, code: 'X' });
    assert.equal(x.direct.status, status); assert.equal(x.traits.road_access.status, 'CODE_ONLY');
  }
  const ok = applyDirect(c, { status: 'OK', record: lc(1) });
  assert.equal(ok.traits.road_access.status, 'DIRECT_MATCH'); // 코드 05 = 05, 명칭은 이 필지 직접조회 응답
  assert.equal(ok.traits.road_access.value, '세로(가)');
  // 코드 없음 + 명칭 없음 → 직접조회 값만
  assert.equal(compareDirectField(DIRECT_FIELDS[2], {}, lc(1)).status, 'DIRECT_ONLY');
  // 직접조회에 값이 없으면 표준지 API 값 유지
  assert.equal(compareDirectField(DIRECT_FIELDS[2], { ladUseSittn: '510', ladUseSittnNm: '답' }, {}).status, 'DIRECT_EMPTY');
});

test('직접조회 대상: 후보 ①②③ + 선택 표준지만(최대 4) · 전수 조회 없음', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((k) => row(k, k > 3 ? { prposAreaNm1: '자연녹지지역' } : {}));
  const sr = buildStandardReview({ response: response(rows), target });
  const t = directTargets(sr, P(5));
  assert.equal(t.length, 4); assert.ok(t.some((x) => x.pnu === P(5)));
  assert.deepEqual(directTargets(sr, null).map((x) => x.year), [2026, 2026, 2026]);
  assert.equal(directTargets(sr, sr.list.find((x) => x.kind === 'CANDIDATE').pnu).length, 3); // 후보를 고르면 중복 없음
});

test('queryStandardTraits: 요청 PNU·연도와 같은 응답 항목만 · 구버전 서버 경로 거절 · 4건 상한', async () => {
  const loc = { protocol: 'http:', hostname: '127.0.0.1' };
  const reqs = [];
  const fetchImpl = async (url, init) => { reqs.push([url, JSON.parse(init.body)]); return { json: async () => ({ ok: true, request_count: { land_characteristics: 2 },
    items: [{ pnu: P(2), year: 2026, status: 'OK', record: lc(2), cache: { reused: true, stored_at: '2026-11-26T01:00:00Z' } }, { pnu: P(1), year: 2025, status: 'OK', record: lc(1) }] }), headers: { get: () => null } }; };
  const r = await queryStandardTraits({ fetchImpl, location: loc, items: [{ pnu: P(1), year: 2026 }, { pnu: P(2), year: '2026' }, { pnu: P(1), year: 2026 }] });
  assert.equal(reqs.length, 1); assert.equal(reqs[0][0], '/__public_data_bridge/standard_traits'); assert.equal(reqs[0][1].items.length, 2);
  assert.equal(r.items[0].status, 'FAILED'); assert.equal(r.items[0].code, 'ITEM_MISSING'); // 응답이 2025년 항목뿐 → 받지 않음
  assert.equal(r.items[1].status, 'OK'); assert.equal(r.items[1].reused, true);
  const old = async () => ({ json: async () => ({ ok: false, error_code: 'FIELD_ROUTE_NOT_ALLOWED' }), headers: { get: () => null } });
  const o = await queryStandardTraits({ fetchImpl: old, location: loc, items: [{ pnu: P(1), year: 2026 }] });
  assert.equal(o.ok, false); assert.match(o.reason, /구버전 서버/);
  const many = await queryStandardTraits({ fetchImpl, location: loc, items: [1, 2, 3, 4, 5].map((k) => ({ pnu: P(k), year: 2026 })) });
  assert.equal(many.error_code, 'TOO_MANY_ITEMS'); assert.equal(reqs.length, 1);
  assert.equal((await queryStandardTraits({ fetchImpl, location: { protocol: 'file:' }, items: [{ pnu: P(1), year: 2026 }] })).error_code, 'OFFLINE');
});
