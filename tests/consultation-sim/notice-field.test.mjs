// 고시 세목 색인·현장 상담카드 단위 테스트 (합성 색인만 사용 — 실제 고시 행은 저장소에 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateNoticeIndex, searchNoticeIndex, noticeFacts, SEARCH_STATUS } from '../../browser/consultation-sim/core/notice-index.js';
import { buildFieldCard } from '../../browser/consultation-sim/core/field-card.js';
import { bridgeAllowed, bridgeStatus, queryPublicData, PD_STATUS, resultCodeOf } from '../../browser/consultation-sim/core/field-public-data.js';
import { profileForIndex, getProfile } from '../../browser/consultation-sim/profiles/index.js';
import { parseTablePage, carryLocation, findHeader } from '../../scripts/notice_index/import_notice_pdf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = path.join(root, 'tests', 'consultation-sim', 'fixtures', 'synthetic-notice-index.json');
const load = () => JSON.parse(fs.readFileSync(fixture, 'utf8'));

test('색인 검증: 합성 색인 통과 · 기대 행수/면적 불일치는 실패', () => {
  const idx = load();
  const ok = validateNoticeIndex(idx, { expected: { rows: 6, incorporated_area_m2: 4700 } });
  assert.equal(ok.ok, true, ok.errors.join());
  assert.equal(ok.stats.incorporated_area_m2_total, 4700);
  assert.equal(ok.stats.ri_carried, 1);
  assert.equal(ok.stats.duplicate_keys, 1); // 냇가리 40-1 두 행
  const bad = validateNoticeIndex(idx, { expected: { rows: 7, incorporated_area_m2: 4701 } });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
});

test('색인 검증: 개인정보 키·일련번호 공백은 거부', () => {
  const withOwner = load(); withOwner.rows[0].owner_name = '가상';
  const r1 = validateNoticeIndex(withOwner);
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join(), /개인정보/);
  const withAddr = load(); withAddr.notice.address = 'x';
  assert.equal(validateNoticeIndex(withAddr).ok, false);
  const gap = load(); gap.rows = gap.rows.filter((r) => r.serial !== 3);
  assert.match(validateNoticeIndex(gap).errors.join(), /불연속/);
});

test('한 칸 검색: 지번만 → 여러 리 후보, 자동 선택 안 함', () => {
  const s = searchNoticeIndex(load(), '12-3');
  assert.equal(s.status, SEARCH_STATUS.CHOOSE);
  assert.deepEqual(s.matches.map((r) => r.ri), ['바위리', '새솔리']);
});

test('한 칸 검색: 리+지번 · 리 생략형 · 전체 주소 · 번지 표기', () => {
  const idx = load();
  for (const q of ['바위리 12-3', '바위 12-3', '가상도 연습시 숲내읍 바위리 12-3', '바위리 12-3번지', '바위리 １２－３']) {
    const s = searchNoticeIndex(idx, q);
    assert.equal(s.status, SEARCH_STATUS.UNIQUE, q);
    assert.equal(s.matches[0].serial, 1, q);
  }
});

test('한 칸 검색: 같은 리·같은 지번이 여러 행이면 선택하게 한다', () => {
  const s = searchNoticeIndex(load(), '냇가리 40-1');
  assert.equal(s.status, SEARCH_STATUS.CHOOSE);
  assert.equal(s.matches.length, 2);
  assert.match(s.message, /일련번호가 다름/);
});

test('산번지: 산 7 일치 · 7(일반)은 미발견+산번지 힌트 · 미편입 판정 금지', () => {
  const idx = load();
  assert.equal(searchNoticeIndex(idx, '산 7').status, SEARCH_STATUS.UNIQUE);
  const plain = searchNoticeIndex(idx, '7');
  assert.equal(plain.status, SEARCH_STATUS.NOT_IN_INDEX);
  assert.equal(plain.hints.mountain_variant_count, 1);
  assert.match(plain.message, /미편입으로 판정하지 않습니다/);
  assert.match(plain.message, /산번지 1건/);
});

test('색인 밖 행정구역·리·PNU·비정형 입력', () => {
  const idx = load();
  assert.equal(searchNoticeIndex(idx, '강남구 12-3').status, SEARCH_STATUS.OUTSIDE_NOTICE_AREA);
  const otherRi = searchNoticeIndex(idx, '동쪽리 12-3');
  assert.equal(otherRi.status, SEARCH_STATUS.OUTSIDE_NOTICE_AREA);
  assert.match(otherRi.message, /편입 여부를 판정하지 않습니다/);
  assert.equal(searchNoticeIndex(idx, '9800000000100120003').status, SEARCH_STATUS.PNU_NOT_SUPPORTED);
  assert.equal(searchNoticeIndex(idx, '12-3 외 2필지').status, SEARCH_STATUS.INPUT_INVALID);
  assert.equal(searchNoticeIndex(idx, '  ').status, SEARCH_STATUS.EMPTY);
});

test('고시 기재값과 산술값 구분: 일부 편입', () => {
  const row = load().rows[1];
  const f = noticeFacts(row);
  assert.equal(f.ledger_area_m2, 500);
  assert.equal(f.incorporated_area_m2, 200);
  assert.deepEqual(f.arithmetic, { remainder_area_m2: 300, incorporated_ratio_pct: 40, partial: true, inconsistent: false });
});

test('상담카드: 확인/미확인/쟁점/문서/후속 · 산술 표지 · 반복 셀 경고 · 공적자료 값 미포함', () => {
  const idx = load(); const profile = profileForIndex(idx);
  assert.equal(profile.id, 'generic');
  const card = buildFieldCard({ profile, index: idx, row: idx.rows[1], selectedIssueIds: ['obstacle', 'remainder', 'obstacle'], memo: '현장 메모', now: new Date('2000-01-02T03:04:00Z') });
  assert.match(card.text, /일련번호 2 — 원본 PDF 1쪽/);
  assert.match(card.text, /\[산술\] 편입률 40%/);
  assert.match(card.text, /제73조·제74조 구별/);
  assert.deepEqual(card.chosen.map((c) => c.id), ['obstacle', 'remainder']);
  assert.ok(card.documents.includes('지장물 조서(통지 시)'));
  assert.equal(new Set(card.documents).size, card.documents.length);
  assert.match(card.text, /현장 메모/);
  assert.doesNotMatch(card.text, /PNU|공시지가\s*\d/);
  const carried = buildFieldCard({ profile, index: idx, row: idx.rows[3] });
  assert.match(carried.unverified[0], /반복 셀/);
  assert.equal(buildFieldCard({ profile, index: idx, row: null }), null);
});

test('오송3 프로필: 고시 서지·대상 법정리·지역 쟁점', () => {
  const p = getProfile('osong3');
  assert.equal(p.notice.notice_no, '국토교통부 고시 제2025-456호');
  assert.equal(p.ris.length, 6);
  assert.deepEqual(p.import.expected, { rows: 2933, incorporated_area_m2: 4119584.0 });
  assert.ok(p.extra_issues.some((i) => i.id === 'flood'));
  assert.equal(profileForIndex({ notice: { id: 'molit-2025-456' }, rows: [] }).id, 'osong3');
});

test('공적자료: 오프라인·비루프백에서는 브리지를 부르지 않는다', async () => {
  assert.equal(bridgeAllowed({ protocol: 'file:', hostname: '' }), false);
  assert.equal(bridgeAllowed({ protocol: 'https:', hostname: 'example.github.io' }), false);
  assert.equal(bridgeAllowed({ protocol: 'http:', hostname: '127.0.0.1' }), true);
  let called = 0;
  const fetchImpl = async () => { called += 1; return { json: async () => ({}) }; };
  const st = await bridgeStatus({ fetchImpl, location: { protocol: 'file:', hostname: '' } });
  assert.equal(st.status, PD_STATUS.OFFLINE);
  const q = await queryPublicData({ fetchImpl, location: { protocol: 'file:', hostname: '' }, index: load(), row: load().rows[0] });
  assert.equal(q.status, PD_STATUS.OFFLINE);
  assert.equal(called, 0);
});

const loop = { protocol: 'http:', hostname: '127.0.0.1' };
const fakeBridge = (handlers) => async (url, init) => {
  const op = url.split('/').pop();
  const body = init?.body ? JSON.parse(init.body) : null;
  return { json: async () => handlers[op](body) };
};

test('공적자료: VWorld INCORRECT_KEY는 결과코드와 함께 실패로 표시, 값 채우지 않음', async () => {
  const seen = [];
  const fetchImpl = fakeBridge({
    resolve_pnu: (b) => { seen.push(b.parcel_address); return { ok: true, candidate: { pnu: '9800000000100120003' } }; },
    vworld_land: () => ({ ok: false, error_code: 'VWORLD_API_ERROR', error_message: 'VWorld returned a non-success result code (resultCode=INCORRECT_KEY)' }),
  });
  const r = await queryPublicData({ fetchImpl, location: loop, index: load(), row: load().rows[0], now: () => new Date('2000-01-01T00:00:00Z') });
  assert.deepEqual(seen, ['가상도 연습시 숲내읍 바위리 12-3']);
  assert.equal(r.status, PD_STATUS.FAILED);
  assert.equal(r.result_code, 'INCORRECT_KEY');
  assert.equal(r.values.length, 0);
  assert.equal(r.attempts.length, 2);
  assert.match(r.reason, /INCORRECT_KEY — 인증키가 이 서비스/);
  assert.equal(resultCodeOf('x (resultCode=UNREGISTERED_DOMAIN)'), 'UNREGISTERED_DOMAIN');
});

test('공적자료: 성공 시 값별 출처·기준연도·조회시각, 고시 지목과 다르면 불일치 표시', async () => {
  const fetchImpl = fakeBridge({
    resolve_pnu: () => ({ ok: true, candidate: { pnu: '9800000000100120003' } }),
    vworld_land: (b) => (b.standard_year === 2026 ? { ok: true, record: null } : { ok: true, record: { land_category: '대', zoning: '가상지역', individual_official_price: '12345', price_year: '2025' } }),
  });
  const r = await queryPublicData({ fetchImpl, location: loop, index: load(), row: load().rows[0], now: () => new Date('2000-01-01T00:00:00Z') });
  assert.equal(r.status, PD_STATUS.OK);
  const cat = r.values.find((v) => v.key === 'land_category');
  assert.equal(cat.base_year, 2025);
  assert.match(cat.mismatch, /고시 기재 지목\(답\)과 다름/);
  assert.equal(r.values.find((v) => v.key === 'price').value, 12345);
  assert.equal(r.values.find((v) => v.key === 'road_access').status, PD_STATUS.NO_DATA);
  assert.ok(r.values.every((v) => v.source && v.fetched_at));
});

test('공적자료: PNU 해석 실패는 VWorld를 부르지 않는다', async () => {
  let vw = 0;
  const fetchImpl = fakeBridge({ resolve_pnu: () => ({ ok: false, error_code: 'PUBLIC_DATA_KEY_MISSING' }), vworld_land: () => { vw += 1; return {}; } });
  const r = await queryPublicData({ fetchImpl, location: loop, index: load(), row: load().rows[0] });
  assert.equal(r.status, PD_STATUS.FAILED);
  assert.equal(r.step, 'resolve_pnu');
  assert.equal(vw, 0);
});

// ── 고시 PDF 표 해석(합성 좌표) ────────────────────────────────────────────────
const it = (str, x, y) => ({ str, x, y });
test('세목표 해석: 소유자 열은 읽지 않고, 접힌 공부면적을 잇고, 리 생략 행은 이어받는다', () => {
  const items = [
    it('소재지', 71, 750), it('지번', 106, 750), it('지목', 132, 750), it('성명', 246, 750),
    // 행 1: 정상 + 소유자 열(지분 오른쪽) 토큰
    it('숲내읍', 71, 733), it('1', 52, 729), it('12-3', 99, 729), it('답', 136, 729), it('1,000.0', 152, 729), it('1,000.0', 182, 729), it('1/1', 214, 729),
    it('가상인', 254, 729), it('가상도 연습시 1', 300, 724), it('바위리', 71, 724),
    // 행 2: 공부면적이 위아래로 접힘
    it('숲내읍', 71, 704), it('10,367.', 152, 704), it('2', 52, 699), it('40', 106, 699), it('구', 136, 699), it('10,367.0', 180, 699), it('1/1', 214, 699), it('0', 163, 695),
    // 행 3: 리 셀 없음(반복 셀)
    it('3', 52, 670), it('산', 92, 670), it('7', 101, 670), it('임', 136, 670), it('3,000.0', 152, 670), it('2,000.0', 182, 670), it('1/2', 214, 670), it('가상인2', 254, 670),
  ];
  const header = findHeader(items);
  assert.ok(header);
  const { rows, anomalies } = parseTablePage(items, header, { page: 9, eupmyeons: ['숲내읍'] });
  assert.equal(anomalies.length, 0);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.serial, r.ri, r.lot_label, r.jimok, r.ledger_area_m2, r.incorporated_area_m2]), [
    [1, '바위리', '12-3', '답', 1000, 1000], [2, null, '40', '구거', 10367, 10367], [3, null, '산7', '임야', 3000, 2000]]);
  const json = JSON.stringify(rows);
  assert.doesNotMatch(json, /가상인|가상도 연습시 1|1\/1|1\/2/);
  const carried = carryLocation(rows, '숲내읍');
  assert.deepEqual(carried.map((r) => [r.ri, r.ri_source]), [['바위리', 'CELL'], ['바위리', 'CARRIED'], ['바위리', 'CARRIED']]);
});

test('단일 HTML 빌드: 합성 색인 내장 · 안전 검사 통과 · 개인정보 키 없음', () => {
  const out = path.join(root, 'dist', 'notice-field-test', 'synthetic-field.html');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build_notice_field.js'), '--index', fixture, '--out', out], { stdio: 'pipe' });
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /id="bso-notice-index"/);
  assert.doesNotMatch(html, /<script type="module"/);
  assert.doesNotMatch(html, /localStorage\.setItem|sessionStorage\.setItem/);
  const manifest = JSON.parse(fs.readFileSync(out.replace(/\.html$/, '.manifest.json'), 'utf8'));
  assert.equal(manifest.index.rows, 6);
  assert.equal(manifest.index.incorporated_area_m2_total, 4700);
  // 개인정보 키가 섞인 색인은 빌드 거부
  const bad = load(); bad.rows[0].owner = 'x';
  const badPath = path.join(root, 'dist', 'notice-field-test', 'bad-index.json');
  fs.writeFileSync(badPath, JSON.stringify(bad));
  assert.throws(() => execFileSync(process.execPath, [path.join(root, 'scripts', 'build_notice_field.js'), '--index', badPath, '--out', out], { stdio: 'pipe' }));
});
