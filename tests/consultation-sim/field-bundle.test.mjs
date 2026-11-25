// 다필지 상담 묶음(순수 함수 · 브리지 캐시) — 합성 데이터만, 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLE, parcelKey, parcelLabel, circled, pnuConflicts, ownershipNeedsWarning, ownershipText, bundleTotals, buildBundleSummary, buildBundleDetail, createBridgeCache } from '../../browser/consultation-sim/core/field-bundle.js';
import { standardTraits, targetTraits, TRAIT_FIELDS } from '../../browser/consultation-sim/core/field-standard.js';
import { renderBundleMap, MAP } from '../../browser/consultation-sim/core/field-map.js';

const N1 = { notice_no: '가상 고시 제0000-1호', notice_date: '2000-01-01' };
const N2 = { notice_no: '가상 고시 제0000-2호', notice_date: '2001-05-05' };
const card = (label, extra = {}) => ({ text: `[상세 ${label}]\n- 미확인 A\n- 미확인 B`, chosen: [], next: ['받은 통지문 원문으로 현재 절차 단계 확인'], unverified: ['A', 'B'], ...extra });
const row = (n, ledger, inc, notice = N1, extra = {}) => ({ n, label: `바위리 ${n}`, kind: 'ROW', notice, ownership: { basis: 'DOCUMENT', coown: 'SOLE' },
  facts: { jimok: '답', ledger_area_m2: ledger, incorporated_area_m2: inc, arithmetic: { incorporated_ratio_pct: Math.round((inc / ledger) * 1000) / 10, partial: inc < ledger } }, card: card(n), ...extra });

test('필지 키·이름·번호: 색인 행은 고시+일련, 색인 밖은 PNU·주소 · 같은 PNU는 경고만', () => {
  assert.equal(parcelKey({ row: { serial: 3 }, notice: { id: 'x' } }), 'N:x:3');
  assert.equal(parcelKey({ direct: { pnu: '1234567890123456789' } }), 'P:1234567890123456789');
  assert.equal(parcelKey({ direct: { address: ' 가상도  연습시 1 ' } }), 'A:가상도 연습시 1');
  assert.equal(parcelLabel({ row: { ri: '바위리', lot_label: '12-3' } }), '바위리 12-3');
  assert.equal(circled(10), '⑩'); assert.equal(circled(11), '(11)');
  assert.deepEqual(pnuConflicts([{ pnu: 'A' }, { pnu: 'B' }, { pnu: 'A' }, { pnu: null }]), [{ pnu: 'A', numbers: [1, 3] }]);
  assert.equal(BUNDLE.maxParcels, 10); assert.equal(BUNDLE.stdLookups, 3); assert.equal(BUNDLE.cadCalls, 40);
});

test('소유 확인: 서류 확인된 단독소유만 경고 없음 · 기본(미확인)은 경고', () => {
  assert.equal(ownershipNeedsWarning({ basis: 'DOCUMENT', coown: 'SOLE' }), false);
  for (const o of [{}, { basis: 'STATEMENT', coown: 'SOLE' }, { basis: 'DOCUMENT', coown: 'CO_UNKNOWN' }, { basis: 'DOCUMENT', coown: 'CO_DOCUMENT' }, { basis: 'DOCUMENT', coown: 'UNKNOWN' }]) assert.equal(ownershipNeedsWarning(o), true);
  assert.equal(ownershipText({}), '소유: 미확인 · 공동소유 여부 미확인');
});

test('면적 합계: 같은 고시끼리만 · 다른 고시는 따로(전체 합계 없음) · 색인 밖·면적 없는 필지는 제외 수 표시', () => {
  const t = bundleTotals([row(1, 1000, 1000), row(2, 500, 200), row(3, 300, 300, N2), { n: 4, label: 'PNU x', kind: 'DIRECT', ownership: {}, card: card(4) }]);
  assert.deepEqual(t.groups.map((g) => [g.notice_no, g.ledger, g.incorporated, g.numbers]), [[N1.notice_no, 1500, 1200, [1, 2]], [N2.notice_no, 300, 300, [3]]]);
  assert.deepEqual(t.excluded, [4]);
  const s = buildBundleSummary({ parcels: [row(1, 1000, 1000), row(2, 500, 200), row(3, 300, 300, N2), { n: 4, label: 'PNU x', kind: 'DIRECT', ownership: {}, card: card(4) }], now: new Date('2000-01-02T00:00:00Z') });
  assert.match(s, /가상 고시 제0000-1호\(2000-01-01\): 공부 1,500㎡ · 편입 1,200㎡ · 4필지 중 2필지\(①②\)/);
  assert.match(s, /가상 고시 제0000-2호\(2001-05-05\): 공부 300㎡ · 편입 300㎡ · 4필지 중 1필지\(③\)/);
  assert.match(s, /고시·기준일이 달라 전체 합계를 내지 않음/);
  assert.match(s, /합계 제외 1필지\(④\)/);
  assert.match(s, /④ PNU x · 고시 색인 밖\(편입 여부·면적 미확인\)/);
});

test('통합 요약: 1·3·10필지 줄 수 · 지분 미확인 경고 · 지분 반영·보상액·묶음 편입률 없음 · 개별 메모 미포함·공통 메모 포함', () => {
  for (const n of [1, 3, 10]) {
    const ps = Array.from({ length: n }, (_, i) => row(i + 1, 100 * (i + 1), 50 * (i + 1)));
    const lines = buildBundleSummary({ parcels: ps }).split('\n');
    assert.ok(lines.length >= n + 6 && lines.length <= n + 10, `n=${n} lines=${lines.length}`);
  }
  const ps = [row(1, 1000, 1000, N1, { ownership: { basis: 'STATEMENT', coown: 'CO_UNKNOWN' }, card: card(1, { text: '[상세 1] 개별 메모: 비밀', chosen: [{ label: '지장물 누락' }] }) }), row(2, 500, 200, N1, { card: card(2, { chosen: [{ label: '지장물 누락' }, { label: '잔여지' }] }) })];
  const s = buildBundleSummary({ parcels: ps, commonMemo: '공통 확인 사항' });
  assert.match(s, /⚠ 소유 미확인·공동소유\(지분 미확인\) 1필지\(①\) — 합계는 본인 몫 면적이 아님/);
  assert.match(s, /① 바위리 1 · 답 · 공부 1,000㎡ · 편입 1,000㎡ · \[산술\] 편입률 100% · 소유: 상담자 진술 · 공동소유\(지분 미확인\)/);
  assert.match(s, /쟁점: 지장물 누락\(①②\) · 잔여지\(②\)/);
  assert.match(s, /공통 메모: 공통 확인 사항/);
  assert.doesNotMatch(s, /비밀/); // 개별 메모(상세본에만)
  assert.doesNotMatch(s, /지분\s*\d|본인 몫\s*\d|보상액\s*\d|원\b|묶음 편입률/);
  assert.match(s, /지분 계산 없음/);
});

test('필지별 상세본: 각 필지 상세 검토본(card.text)을 바이트 그대로 포함 · 소유 확인 머리줄', () => {
  const ps = [row(1, 1000, 1000), row(2, 500, 200, N1, { ownership: { basis: 'UNCONFIRMED', coown: 'UNKNOWN' } })];
  const d = buildBundleDetail({ parcels: ps, commonMemo: 'M' });
  for (const p of ps) assert.ok(d.includes(p.card.text));
  assert.match(d, /===== ② 바위리 2 · 소유: 미확인 · 공동소유 여부 미확인 =====/);
  assert.match(d, /■ 공통 메모\nM/); assert.match(d, /면적 합계·지분 계산 없음/);
});

// ── 브리지 캐시 ──
function fakeFetch(handler) {
  const log = [];
  const f = async (url, init = {}) => { log.push({ url, body: init.body || null, method: init.method || 'GET' }); const r = await handler(url, init); return new Response(JSON.stringify(r), { status: 200 }); };
  return { f, log };
}
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('브리지 캐시: 같은 조회는 한 번만 전송 · 진행 중 요청 공유 · 실패는 저장 안 함 · GET은 통과', async () => {
  let fail = true;
  const { f, log } = fakeFetch(async (url) => (url.endsWith('/vworld_land') && fail ? { ok: false, error_code: 'X' } : { ok: true, v: 1 }));
  const c = createBridgeCache({ fetchImpl: f });
  const a = await (await c.fetch('/__public_data_bridge/vworld_land', post({ pnu: '1' }))).json();
  assert.equal(a.ok, false); fail = false;
  const b = await (await c.fetch('/__public_data_bridge/vworld_land', post({ pnu: '1' }))).json();
  assert.equal(b.ok, true); assert.equal(log.length, 2); // 실패는 재전송
  await c.fetch('/__public_data_bridge/vworld_land', post({ pnu: '1' }));
  assert.equal(log.length, 2); assert.equal(c.stats.reuse, 1);
  const [x, y] = await Promise.all([c.fetch('/__public_data_bridge/pnu_parcel', post({ pnu: '2' })), c.fetch('/__public_data_bridge/pnu_parcel', post({ pnu: '2' }))]);
  assert.equal((await x.json()).ok, true); assert.equal((await y.json()).ok, true); assert.equal(log.length, 3); assert.equal(c.stats.reuse, 2);
  await c.fetch('/__public_data_bridge/status', { cache: 'no-store' }); await c.fetch('/__public_data_bridge/status', { cache: 'no-store' });
  assert.equal(log.filter((l) => l.url.endsWith('/status')).length, 2);
});

test('브리지 캐시: 표준지 실제 전송 3회 상한(캐시 적중 제외) · VWorld 호출 집계(표준지·지적 칸)', async () => {
  const { f, log } = fakeFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/standard_lands')) return { ok: true, rows: [], request_count: { total: 150 + Number(body.pnu) } };
    if (body.tiles) return { ok: true, mode: 'TILES', tiles: [], request_count: 4 };
    return { ok: true };
  });
  const c = createBridgeCache({ fetchImpl: f });
  for (const p of ['1', '2', '1', '3']) await c.fetch('/__public_data_bridge/standard_lands', post({ pnu: p, year: 2026 }));
  assert.equal(c.stats.std_sent, 3); assert.equal(c.stats.vworld_std, 151 + 152 + 153); assert.equal(c.stats.reuse, 1);
  const blocked = await (await c.fetch('/__public_data_bridge/standard_lands', post({ pnu: '4', year: 2026 }))).json();
  assert.equal(blocked.error_code, 'BUNDLE_STD_LIMIT'); assert.equal(c.stats.blocked, 1);
  assert.equal((await (await c.fetch('/__public_data_bridge/standard_lands', post({ pnu: '2', year: 2026 }))).json()).ok, true); // 저장된 결과는 한도 후에도 재사용
  assert.equal(log.filter((l) => l.url.endsWith('/standard_lands')).length, 3);
  await c.fetch('/__public_data_bridge/parcel_map', post({ pnu: '1', tiles: [[1, 2]] }));
  assert.equal(c.stats.vworld_cad, 4);
});

test('브리지 캐시: 응답 없음은 시간 제한 후 CLIENT_TIMEOUT(저장 안 함) · 네트워크 오류는 BRIDGE_UNREACHABLE', async () => {
  let timers = [];
  const setTimer = (fn) => { timers.push(fn); return timers.length; };
  const never = new Promise(() => {});
  const c = createBridgeCache({ fetchImpl: () => never, setTimer, clearTimer: () => {} });
  const p = c.fetch('/__public_data_bridge/vworld_land', post({ pnu: '9' }));
  await new Promise((r) => setImmediate(r)); timers.forEach((fn) => fn());
  assert.equal((await (await p).json()).error_code, 'CLIENT_TIMEOUT');
  assert.equal(c.size(), 0); assert.equal(c.inflight(), 0);
  const d = createBridgeCache({ fetchImpl: async () => { throw new Error('down'); } });
  assert.equal((await (await d.fetch('/__public_data_bridge/vworld_land', post({ pnu: '9' }))).json()).error_code, 'BRIDGE_UNREACHABLE');
});

test('표준지 특성: 속성 명칭 · 토지특성 명칭 채움 · 코드만 · 미확인 구분 · 대상 특성은 공적자료 값 그대로', () => {
  const t = standardTraits({ stdrYear: '2026', ladUseSittnNm: '답', roadSideCodeNm: '세로(가)', tpgrphFrmCode: '06', tpgrphHgCodeNm: '저지', name_filled_from_land_characteristics: ['tpgrphHgCodeNm'] });
  assert.deepEqual(TRAIT_FIELDS.map((f) => [f.key, t[f.key].value, t[f.key].status]),
    [['land_use', '답', 'API_NAME'], ['road_access', '세로(가)', 'API_NAME'], ['shape', null, 'CODE_ONLY'], ['elevation', '저지', 'NAME_FROM_LC']]);
  assert.equal(t.shape.code, '06'); assert.equal(t.road_access.year, '2026');
  assert.equal(standardTraits({}).road_access.status, 'MISSING');
  const tt = targetTraits([{ key: 'road_access', value: '광대세각', base_year: 2026, source: 'VWorld 토지특성' }, { key: 'shape', value: '' }]);
  assert.equal(tt.road_access.value, '광대세각'); assert.equal(tt.road_access.year, 2026);
  assert.equal(tt.shape.status, 'MISSING'); assert.equal(tt.elevation.status, 'MISSING');
});

test('전체 필지 지도: 확인된 경계만 번호 · 위치 미확인 목록 · 너무 멀면 한 화면 표시 안 함 · 영상 1장', () => {
  const sq = (lon, lat) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.0005, lat], [lon + 0.0005, lat + 0.0005], [lon, lat + 0.0005], [lon, lat]]] });
  const html = renderBundleMap({ items: [{ n: 1, pid: 11, label: 'A', geometry: sq(127.31, 36.62), status: 'EXACT_ONE' }, { n: 2, pid: 12, label: 'B', geometry: sq(127.315, 36.623), status: 'EXACT_ONE' }, { n: 3, pid: 13, label: 'C', geometry: null, status: 'NOT_UNIQUE' }], activePid: 12 });
  assert.match(html, /data-f-bundle-map-state="SHOWN"/); assert.equal((html.match(/data-f-bundle-shape=/g) || []).length, 2);
  assert.equal((html.match(/<img /g) || []).length, 1); assert.match(html, /위치 미확인 1필지: ③ C\(NOT_UNIQUE\)/);
  assert.match(html, /class="f-std-pin cand sel"[^>]*data-f-bundle-pick="12"/);
  const far = renderBundleMap({ items: [{ n: 1, pid: 1, label: 'A', geometry: sq(126.5, 34.5), status: 'EXACT_ONE' }, { n: 2, pid: 2, label: 'B', geometry: sq(129.0, 37.9), status: 'EXACT_ONE' }] });
  assert.match(far, /data-f-bundle-map-state="TOO_WIDE"/); assert.doesNotMatch(far, /<img /); assert.match(far, new RegExp(`최소 줌 ${MAP.minZoom}`));
  assert.match(renderBundleMap({ items: [{ n: 1, pid: 1, label: 'A', geometry: null, status: 'NOT_LOADED' }] }), /data-f-bundle-map-state="NONE"/);
});
