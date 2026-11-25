// 현장 상담 4단계 출처 표시 · 대상↔표준지 비교표 · 편입>공부 경고 · 화면 원본 안전 검사(합성 값만)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as pv from '../../browser/consultation-sim/core/field-provenance.js';
import { buildStdMatrix, MATRIX_ROWS, standardTraits } from '../../browser/consultation-sim/core/field-standard.js';
import { noticeFacts } from '../../browser/consultation-sim/core/notice-index.js';
import { buildFieldCard } from '../../browser/consultation-sim/core/field-card.js';
import { buildBundleSummary } from '../../browser/consultation-sim/core/field-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { PROV } = pv;

test('출처 등급: 원천별 매핑 — 받은 값은 기재·수신(검증 완료 아님) · 계산·판정은 추정 · 상담자 입력은 진술 · 없음은 미확인', () => {
  assert.equal(pv.provNoticeValue('답'), PROV.RECEIVED);
  assert.equal(pv.provNoticeValue(0), PROV.RECEIVED); // 0㎡도 기재값
  assert.equal(pv.provNoticeValue(null), PROV.UNVERIFIED);
  assert.equal(pv.provNoticeValue('  '), PROV.UNVERIFIED);
  assert.equal(pv.provRi({ ri: '바위리', ri_source: 'CELL' }), PROV.RECEIVED);
  assert.equal(pv.provRi({ ri: '바위리', ri_source: 'CARRIED' }), PROV.ESTIMATED);
  assert.equal(pv.provArithmetic({ inconsistent: false }), PROV.ESTIMATED);
  assert.equal(pv.provArithmetic({ inconsistent: true }), PROV.UNVERIFIED);
  assert.equal(pv.provArithmetic(null), PROV.UNVERIFIED);
  assert.equal(pv.provPdValue({ value: '계획관리지역', status: 'OK' }), PROV.RECEIVED);
  assert.equal(pv.provPdValue({ value: null, status: 'NO_DATA' }), PROV.UNVERIFIED);
  assert.equal(pv.provTrait('API_NAME'), PROV.RECEIVED);
  assert.equal(pv.provTrait('NAME_SAME_PNU'), PROV.ESTIMATED);
  for (const x of ['NAME_FROM_LC', 'NAME_OTHER', 'CONFLICT']) assert.equal(pv.provTrait(x), PROV.UNVERIFIED);
  assert.equal(pv.provPdValue({ value: '답', status: 'OK', mismatch: '고시와 다름' }), PROV.UNVERIFIED);
  assert.doesNotMatch(Object.values(pv.PROV_LABEL).join(), /공적확인|검증 완료|확정/);
  assert.equal(pv.provTrait('CODE_ONLY'), PROV.UNVERIFIED);
  assert.equal(pv.provTrait('MISSING'), PROV.UNVERIFIED);
  assert.equal(pv.provTrait('???'), PROV.UNVERIFIED);
  assert.deepEqual(pv.provOwnership({ basis: 'UNCONFIRMED' }), { tier: PROV.UNVERIFIED, label: '소유 미확인' });
  assert.equal(pv.provOwnership({ basis: 'STATEMENT' }).tier, PROV.STATEMENT);
  assert.deepEqual(pv.provOwnership({ basis: 'DOCUMENT' }), { tier: PROV.STATEMENT, label: '상담자 서류 확인 표시' }); // 시스템이 등기부 대조 안 함
  assert.equal(pv.provZoningBasis(null), PROV.UNVERIFIED);
  assert.equal(pv.provZoningBasis({ basis_zoning: null }), PROV.UNVERIFIED);
  assert.equal(pv.provZoningBasis({ basis_zoning: '농림지역', verification: 'NOTICE_REASON_CONFIRMED_PARCEL_MAP_PENDING_UNVERIFIED_BY_EXPERT' }), PROV.ESTIMATED);
  assert.equal(pv.provZoningBasis({ basis_zoning: '농림지역', verification: 'COUNSELOR_MARKED_UNVERIFIED_BY_EXPERT' }), PROV.STATEMENT);
  assert.equal(pv.provMap({ status: 'EXACT_ONE' }), PROV.RECEIVED);
  for (const s of ['LOADING', 'MULTIPLE', 'NOT_FOUND', 'PNU_MISMATCH']) assert.equal(pv.provMap({ status: s }), PROV.UNVERIFIED);
  assert.equal(pv.provMap(null), PROV.UNVERIFIED);
  assert.equal(pv.provDistance(180), PROV.ESTIMATED);
  assert.equal(pv.provDistance(null), PROV.UNVERIFIED);
});

test('배지 HTML: 문구·속성 이스케이프 · 알 수 없는 등급은 미확인 · 범례 4단계', () => {
  const h = pv.provBadge('RECEIVED', { label: '<b>"x"</b>', note: '"><img onerror=1>' });
  assert.match(h, /data-f-prov="RECEIVED"/);
  assert.ok(!h.includes('<b>') && !h.includes('<img'));
  assert.ok(h.includes('&lt;b&gt;&quot;x&quot;&lt;/b&gt;'));
  assert.match(pv.provBadge('NOPE'), /data-f-prov="UNVERIFIED"/);
  const legend = pv.provLegend();
  for (const t of pv.PROV_ORDER) assert.ok(legend.includes(`data-f-prov="${t}"`));
});

test('동일/상이: 괄호는 등급의 일부 · 공백·전각만 무시 · 미확인·연도 불일치·연도 미상은 판정하지 않음', () => {
  const c = (value, x = {}) => ({ value, tier: PROV.RECEIVED, year: 2026, ...x }); const cmp = (a, b) => pv.compareValues(a, b);
  assert.equal(cmp(c('세로(가)'), c('세로(불)')), 'DIFF');
  assert.equal(cmp(c('세로(가)'), c('세로 (가)')), 'SAME'); assert.equal(cmp(c('세로（가）'), c('세로(가)')), 'SAME');
  assert.equal(cmp(c('광대로한면'), c('광대로한면(불)')), 'DIFF'); assert.equal(cmp(c('세로(가)'), c('소로한면')), 'DIFF');
  assert.equal(cmp(c('세로(가)'), c('코드 03(명칭 미확인)', { tier: PROV.UNVERIFIED })), 'UNKNOWN');
  assert.equal(cmp(c(null, { tier: PROV.UNVERIFIED }), c('맹지')), 'UNKNOWN');
  for (const y of [2025, null, undefined, '', '미상']) for (const v of ['세로(가)', '맹지']) assert.equal(cmp(c('세로(가)'), c(v, { year: y })), 'HOLD', `${y}`);
  assert.equal(cmp(c('맹지', { year: null }), c('맹지', { year: null })), 'HOLD'); // 미확인 연도끼리 같다고 보지 않음
  assert.equal(cmp(c('맹지', { year: '2026' }), c('맹지')), 'SAME');
  assert.match(pv.compareDetail(c('맹지'), c('맹지', { year: 2025 })).reason, /2026↔2025/);
  assert.equal(cmp(c('농림지역', { hold: '기준 다름' }), c('농림지역')), 'HOLD');
  assert.match(pv.diffTag('DIFF'), /data-f-diff="DIFF">상이</); assert.match(pv.diffTag('HOLD', '<x>'), /판정 보류 · &lt;x&gt;/);
  assert.match(pv.diffTag('??'), /data-f-diff="UNKNOWN">미확인</);
});

const PD = [
  { key: 'land_category', value: '답', status: 'OK', base_year: 2026 }, { key: 'zoning', value: '제1종일반주거지역', status: 'OK', base_year: 2026 },
  { key: 'land_use', value: '답', status: 'OK', base_year: 2026 }, { key: 'road_access', value: '세로(가)', status: 'OK', base_year: 2026 },
  { key: 'shape', value: null, status: 'NO_DATA', base_year: 2026 }, { key: 'elevation', value: '평지', status: 'OK', base_year: 2026 },
  { key: 'price', value: 50000, status: 'OK', base_year: 2026 },
];
const col = (pnu, rank, raw, extra = {}) => ({ pnu, rank, kind: 'CANDIDATE', label: `표준리 ${rank}`, price: 100000 + rank, year: 2026, zoning: '농림지역', land_category: '답', land_use: '답', distance_m: 100 * rank,
  traits: standardTraits(raw), ...extra });

test('비교표: 후보 수만큼 열 · 행 고정 · 사업 영향 배제 기준 용도지역은 추정 · 대상 결측은 미확인(채우지 않음) · 가격·거리는 비교 표시 없음', () => {
  const cols = [col('P1', 1, { roadSideCodeNm: '세로(가)', tpgrphFrmCodeNm: '부정형', tpgrphHgCodeNm: '평지', stdrYear: '2026' }),
    col('P2', 2, { roadSideCode: '03', tpgrphHgCodeNm: '저지', name_filled_from_land_characteristics: ['tpgrphHgCodeNm'], name_sources: { tpgrphHgCodeNm: 'SAME_PNU_LC' }, stdrYear: '2026' })];
  const m = buildStdMatrix({ pdValues: PD, columns: cols, review: { basis: 'PROJECT_EXCLUDED', zoning: '농림지역' } });
  assert.deepEqual(m.columns.map((c) => c.pnu), ['P1', 'P2']);
  assert.deepEqual(m.rows.map((r) => r.key), MATRIX_ROWS.map((r) => r.key));
  const row = (k) => m.rows.find((r) => r.key === k);
  assert.equal(row('zoning').target.value, '농림지역'); assert.equal(row('zoning').target.tier, PROV.ESTIMATED);
  assert.deepEqual(row('zoning').cells.map((c) => c.diff), ['HOLD', 'HOLD']); // 배제 기준 후보 ↔ 공시연도 값
  assert.equal(row('shape').target.value, null); assert.equal(row('shape').target.tier, PROV.UNVERIFIED);
  assert.deepEqual(row('shape').cells.map((c) => c.diff), ['UNKNOWN', 'UNKNOWN']);
  assert.equal(row('road_access').cells[0].diff, 'SAME');
  assert.equal(row('road_access').cells[1].value, '코드 03(명칭 미확인)'); assert.equal(row('road_access').cells[1].tier, PROV.UNVERIFIED);
  assert.equal(row('road_access').cells[1].diff, 'UNKNOWN');
  assert.equal(row('elevation').cells[1].tier, PROV.ESTIMATED); assert.equal(row('elevation').cells[1].diff, 'DIFF');
  assert.equal(row('price').target.value, '50,000원/㎡(2026)');
  assert.ok(row('price').cells.every((c) => c.diff === null) && row('distance').cells.every((c) => c.diff === null));
  assert.equal(row('distance').cells[0].tier, PROV.ESTIMATED);
  assert.ok(m.notes.some((n) => n.includes('가격 우열을 판정하지 않음')));
  // 현재 용도지역 기준이면 기재·수신
  const cur = buildStdMatrix({ pdValues: PD, columns: cols, review: { basis: 'CURRENT', zoning: '제1종일반주거지역' } });
  assert.equal(cur.rows[0].target.tier, PROV.RECEIVED); assert.deepEqual(cur.rows[0].cells.map((c) => c.diff), ['DIFF', 'DIFF']);
  // 표준지 공시연도가 다르면 같은 값이어도 보류 · 값 충돌은 값을 고르지 않음
  const y25 = buildStdMatrix({ pdValues: PD, columns: [col('P3', 1, { roadSideCodeNm: '세로(가)', stdrYear: '2025' }, { year: 2025 })], review: { basis: 'CURRENT' } });
  assert.equal(y25.rows.find((r) => r.key === 'road_access').cells[0].diff, 'HOLD'); assert.equal(y25.rows.find((r) => r.key === 'land_category').cells[0].diff, 'HOLD'); assert.equal(y25.columns[0].year, 2025);
  const cf = buildStdMatrix({ pdValues: PD, columns: [col('P4', 1, {}, { conflict: { zoning: true, price: true } })], review: { basis: 'CURRENT' } });
  for (const k of ['zoning', 'price']) { const x = cf.rows.find((r) => r.key === k).cells[0]; assert.equal(x.value, null); assert.match(x.text, /값 충돌/); }
  const mm = buildStdMatrix({ pdValues: PD.map((v) => (v.key === 'land_category' ? { ...v, mismatch: '고시와 다름' } : v)), columns: cols, review: null });
  assert.equal(mm.rows.find((r) => r.key === 'land_category').cells[0].diff, 'UNKNOWN');
  // 후보가 없으면 열 없음(지어내지 않음)
  assert.deepEqual(buildStdMatrix({ pdValues: PD, columns: [], review: null }).columns, []);
  // 대상 공적자료가 없으면 대상 칸 전부 미확인
  const none = buildStdMatrix({ pdValues: [], columns: cols, review: null });
  assert.ok(none.rows.filter((r) => r.key !== 'distance').every((r) => r.target.value === null && r.target.tier === PROV.UNVERIFIED));
});

test('편입면적 > 공부면적: 값은 그대로(보정 없음) · 상세본·요약·통합요약에 확인 필요 표시', () => {
  const row = { serial: 9, ri: '바위리', lot_label: '1', jimok: '답', ledger_area_m2: 500, incorporated_area_m2: 600, pdf_page: 3, ri_source: 'CELL' };
  const f = noticeFacts(row);
  assert.equal(f.ledger_area_m2, 500); assert.equal(f.incorporated_area_m2, 600);
  assert.equal(f.arithmetic.inconsistent, true); assert.equal(f.arithmetic.incorporated_ratio_pct, 120); assert.equal(f.arithmetic.remainder_area_m2, -100);
  const index = { notice: { notice_no: '가상 고시', notice_date: '2000-01-01' }, location: { sido: '가상도' }, rows: [row] };
  const card = buildFieldCard({ profile: null, index, row, selectedIssueIds: [] });
  assert.match(card.text, /편입면적\(고시 기재\): 600㎡/);
  assert.match(card.text, /\[확인 필요\] 편입면적이 공부면적보다 큼 — 고시 기재값 그대로 둠\(자동 보정 안 함\) · PDF 3쪽/);
  assert.match(card.summary, /편입>공부 · 원문 대조 필요/);
  const s = buildBundleSummary({ parcels: [{ n: 1, label: '바위리 1', kind: 'ROW', notice: index.notice, facts: f, ownership: { basis: 'UNCONFIRMED', coown: 'UNKNOWN' }, card }] });
  assert.match(s, /편입 600㎡/);
  assert.match(s, /⚠ 편입면적이 공부면적보다 큰 필지 ① — 고시 기재값 그대로\(보정 안 함\)/);
  // 정상 필지에는 경고 없음
  const ok = noticeFacts({ ...row, incorporated_area_m2: 200 });
  assert.equal(ok.arithmetic.inconsistent, false);
  assert.doesNotMatch(buildFieldCard({ profile: null, index, row: { ...row, incorporated_area_m2: 200 }, selectedIssueIds: [] }).text, /확인 필요\] 편입면적/);
});

test('현장 화면 원본 안전: 인라인 이벤트 속성·외부 CDN·영구저장 없음 · 버튼은 data 속성+addEventListener', () => {
  const dir = path.join(root, 'browser', 'consultation-sim');
  const files = ['field.html', 'field.css', 'field.js', ...fs.readdirSync(path.join(dir, 'core')).filter((f) => f.startsWith('field-')).map((f) => `core/${f}`)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\son(click|change|input|submit|load|error|keydown|keyup|mouse\w+|touch\w+)\s*=\s*["'`$]/i, `${f}: 인라인 이벤트 속성`);
    assert.doesNotMatch(src, /<script[^>]+src=["']https?:|<link[^>]+href=["']https?:|cdn\.|@import\s+url\(["']?https?:/i, `${f}: 외부 CDN`);
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/, `${f}: 영구저장`);
  }
  // 내려받기 요청과 저장 완료를 구분 — '저장했습니다'를 쓰지 않는다
  const js = fs.readFileSync(path.join(dir, 'field.js'), 'utf8');
  assert.doesNotMatch(js, /저장했습니다|저장 완료했|'saved'/); assert.match(js, /다운로드를 요청했습니다/);
});

test('단일 HTML 빌드: 묶인 스크립트가 문법 오류 없이 해석됨(모듈 실행만으로는 안 드러나는 오류)', () => {
  const dir = path.join(root, 'dist', `notice-field-unit-${process.pid}`); const out = path.join(dir, 'field.html');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build_notice_field.js'), '--index', path.join(root, 'tests', 'consultation-sim', 'fixtures', 'synthetic-notice-index.json'), '--out', out], { cwd: root, stdio: 'pipe' });
  const html = fs.readFileSync(out, 'utf8'); const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(js.length, 1); assert.doesNotThrow(() => new Function(js[0]));
  fs.rmSync(dir, { recursive: true, force: true });
});
