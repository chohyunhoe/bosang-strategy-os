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
const PARCEL_OK = (b) => ({ ok: true, status: 'FOUND_REVIEW_REQUIRED', parcel: { pnu: b.pnu, address: '가상도 연습시 숲내읍 바위리 12-3', jibun: '12-3 답' } });
const fakeBridge = (handlers) => async (url, init) => {
  const op = url.split('/').pop();
  const body = init?.body ? JSON.parse(init.body) : null;
  const h = handlers[op] || (op === 'pnu_parcel' ? PARCEL_OK : null);
  return { json: async () => h(body) };
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

// ── 고시 색인 밖 전국 직접 조회(Issue #34 잔여: 색인 없는 실제 지번) ─────────────────────
const { directLookupTarget } = await import('../../browser/consultation-sim/core/field-direct.js');
const { buildDirectCard } = await import('../../browser/consultation-sim/core/field-card.js');

test('직접 조회 대상: 색인 리면 색인 위치로 주소 완성, 그 밖은 시군구+읍면동리 필수', () => {
  const idx = load();
  assert.deepEqual(
    (({ ok, scope, address }) => ({ ok, scope, address }))(directLookupTarget(idx, '바위리 99')),
    { ok: true, scope: 'INDEX_AREA', address: '가상도 연습시 숲내읍 바위리 99' });
  const nat = directLookupTarget(idx, '서울특별시 강남구 역삼동 12-3');
  assert.equal(nat.scope, 'NATIONWIDE');
  assert.equal(nat.address, '서울특별시 강남구 역삼동 12-3');
  assert.equal(nat.context, '서울특별시 강남구');
  assert.equal(directLookupTarget(idx, '99').ok, false);           // 지번만
  assert.equal(directLookupTarget(idx, '역삼동 12-3').ok, false);   // 상위 행정구역 없음
  assert.equal(directLookupTarget(idx, '동쪽리 12-3').ok, false);   // 색인 밖 리 + 상위 없음
  assert.equal(directLookupTarget(idx, '12-3 외 2필지').ok, false); // 비정형
  const noIndex = directLookupTarget(null, '충청북도 청주시 흥덕구 오송읍 궁평리 320-1');
  assert.equal(noIndex.scope, 'NATIONWIDE');
  assert.equal(noIndex.eupmyeon, '오송읍');
});

test('직접 조회: 입력 주소로 PNU 해석 후 VWorld, 법정동명 반환', async () => {
  const seen = [];
  const fetchImpl = fakeBridge({
    resolve_pnu: (b) => { seen.push([b.parcel_address, b.address_context]); return { ok: true, candidate: { pnu: '9800000000100120003', legal_dong_name: '가상도 연습시 숲내읍 바위리' } }; },
    vworld_land: () => ({ ok: false, error_code: 'VWORLD_API_ERROR', error_message: 'x (resultCode=INCORRECT_KEY)' }),
  });
  const target = directLookupTarget(null, '서울특별시 강남구 역삼동 12-3');
  const r = await queryPublicData({ fetchImpl, location: loop, index: null, target });
  assert.deepEqual(seen, [['서울특별시 강남구 역삼동 12-3', '서울특별시 강남구']]);
  assert.equal(r.legal_dong_name, '가상도 연습시 숲내읍 바위리');
  assert.equal(r.result_code, 'INCORRECT_KEY');
  const none = await queryPublicData({ fetchImpl, location: loop, index: null });
  assert.equal(none.status, PD_STATUS.NOT_QUERIED);
});

test('색인 밖 카드: 편입 여부 미확인 명시 · 고시 값·공적자료 값 없음', () => {
  const target = directLookupTarget(null, '서울특별시 강남구 역삼동 12-3');
  const card = buildDirectCard({ profile: profileForIndex(null), target, selectedIssueIds: ['stage'], memo: '' });
  assert.match(card.text, /고시 색인 밖 필지/);
  assert.match(card.text, /미편입 판정 아님/);
  assert.doesNotMatch(card.text, /PNU|편입면적\(고시 기재\)/);
  assert.equal(buildDirectCard({ target: { ok: false } }), null);
});


// ── GPT QA(PR #35 48ad080) 결함 회귀: PNU 직접입력 · 불완전 주소 · (인쇄는 E2E) ──────────────
test('불완전 주소 차단: 도+리, 특별시·광역시+동은 거부 · 시군구/세종/제주 특수 사례 허용', () => {
  for (const q of ['충청북도 궁평리 320-1', '서울특별시 역삼동 12-3', '부산광역시 우동 1', '경기도 12-3', '청주시 320-1']) {
    assert.equal(directLookupTarget(null, q).ok, false, q);
  }
  for (const [q, ctx] of [['세종특별자치시 어진동 1', '세종특별자치시'], ['부산광역시 해운대구 우동 1', '부산광역시 해운대구'], ['제주특별자치도 제주시 연동 1', '제주특별자치도 제주시'],
    ['충청북도 청주시 흥덕구 오송읍 궁평리 320-1', '충청북도 청주시 흥덕구 오송읍'], ['서울특별시 종로구 종로1가 1', '서울특별시 종로구']]) {
    const t = directLookupTarget(null, q);
    assert.equal(t.ok, true, q); assert.equal(t.scope, 'NATIONWIDE'); assert.equal(t.context, ctx, q);
  }
});

test('PNU 직접입력: 구조 검증 후 검증 전 대상 · 잘못된 구조는 거부', () => {
  const t = directLookupTarget(null, '4311325027103200001');
  assert.deepEqual([t.ok, t.scope, t.pnu, t.pnu_verified, t.address], [true, 'PNU', '4311325027103200001', false, null]);
  assert.equal(directLookupTarget(null, '0011325027103200001').ok, false); // 시도코드 00
  assert.equal(directLookupTarget(null, '4311325027303200001').ok, false); // 대장구분 3
  assert.equal(directLookupTarget(load(), '4311325027103200001').scope, 'PNU'); // 색인이 있어도 PNU는 직접 조회 대상
  assert.equal(searchNoticeIndex(load(), '4311325027103200001').status, SEARCH_STATUS.PNU_NOT_SUPPORTED);
});

test('PNU 조회: 연속지적도에 없으면 토지특성·공시지가를 부르지 않는다', async () => {
  let land = 0;
  const fetchImpl = fakeBridge({ pnu_parcel: () => ({ ok: true, status: 'NOT_FOUND', parcel: null }), vworld_land: () => { land += 1; return {}; } });
  const r = await queryPublicData({ fetchImpl, location: loop, index: null, target: directLookupTarget(null, '9800000000100120003') });
  assert.equal(r.status, PD_STATUS.FAILED); assert.equal(r.code, 'PNU_NOT_FOUND'); assert.equal(land, 0);
  const err = await queryPublicData({ fetchImpl: fakeBridge({ pnu_parcel: () => ({ ok: false, error_code: 'VWORLD_API_ERROR', error_message: 'x (resultCode=INCORRECT_KEY)' }), vworld_land: () => { land += 1; return {}; } }),
    location: loop, index: null, target: directLookupTarget(null, '9800000000100120003') });
  assert.equal(err.step, 'pnu_parcel'); assert.equal(err.result_code, 'INCORRECT_KEY'); assert.equal(land, 0);
});

test('PNU 조회: 지적 확인 후 실데이터 · 법정동은 지적 주소에서 · 단계 LIVE_DATA', async () => {
  const calls = [];
  const fetchImpl = fakeBridge({
    pnu_parcel: (b) => { calls.push('pnu_parcel'); return PARCEL_OK(b); },
    vworld_land: (b) => { calls.push(`vworld_land:${b.pnu}`); return { ok: true, record: { land_category: '답', individual_official_price: 5000, price_year: 2026 } }; },
  });
  const r = await queryPublicData({ fetchImpl, location: loop, index: null, target: directLookupTarget(null, '9800000000100120003') });
  assert.deepEqual(calls, ['pnu_parcel', 'vworld_land:9800000000100120003', 'vworld_land:9800000000100120003']); // 연도별(2026·2025) 용도지역 이력
  assert.equal(r.stage, 'LIVE_DATA'); assert.equal(r.legal_dong_name, '가상도 연습시 숲내읍 바위리'); assert.equal(r.parcel_address, '가상도 연습시 숲내읍 바위리 12-3');
});

test('주소 조회: 해석된 PNU가 지적에 없으면 RESOLUTION_ONLY로 멈춤 · 토지특성 실패도 RESOLUTION_ONLY', async () => {
  let land = 0;
  const notFound = await queryPublicData({ fetchImpl: fakeBridge({ resolve_pnu: () => ({ ok: true, candidate: { pnu: '9800000000100120003' } }), pnu_parcel: () => ({ ok: true, parcel: null }), vworld_land: () => { land += 1; return {}; } }),
    location: loop, index: load(), row: load().rows[0] });
  assert.equal(notFound.stage, 'RESOLUTION_ONLY'); assert.equal(notFound.code, 'PNU_NOT_FOUND'); assert.equal(land, 0);
  const keyFail = await queryPublicData({ fetchImpl: fakeBridge({ resolve_pnu: () => ({ ok: true, candidate: { pnu: '9800000000100120003' } }), vworld_land: () => ({ ok: false, error_code: 'VWORLD_API_ERROR', error_message: 'x (resultCode=INCORRECT_KEY)' }) }),
    location: loop, index: load(), row: load().rows[0] });
  assert.equal(keyFail.stage, 'RESOLUTION_ONLY');
});

test('PNU 카드: 검증 전 표시 · 공적자료 값 없음', () => {
  const card = buildDirectCard({ profile: profileForIndex(null), target: directLookupTarget(null, '4311325027103200001') });
  assert.match(card.text, /입력 PNU: 4311325027103200001 \(상담자 입력 · 검증 전/);
  assert.equal(card.address, null);
});

// ── 지도(항공영상+지적경계) · 기타 자유입력 · 전용 최소 서버 ─────────────────────────────
const fm = await import('../../browser/consultation-sim/core/field-map.js');
const { queryParcelMap } = await import('../../browser/consultation-sim/core/field-public-data.js');
const { issuesFor } = await import('../../browser/consultation-sim/core/field-issues.js');
const SQ = { type: 'MultiPolygon', coordinates: [
  [[[127.0, 36.0], [127.001, 36.0], [127.001, 36.001], [127.0, 36.001], [127.0, 36.0]], [[127.0004, 36.0004], [127.0006, 36.0004], [127.0006, 36.0006], [127.0004, 36.0004]]],
  [[[127.002, 36.0], [127.0025, 36.0], [127.0025, 36.0005], [127.002, 36.0]]],
] };

test('지도 정합: 영상 중심=화면 중심, 줌 상한 18, 다각형·구멍 모두 경로화, 영상 주소에 키 없음', () => {
  const v = fm.fitView(SQ);
  assert.ok(v.zoom <= 18 && v.zoom >= 12);
  const [cx, cy] = fm.project(v, v.centerLonLat);
  assert.ok(Math.abs(cx - 512) < 1e-6 && Math.abs(cy - 384) < 1e-6);
  const d = fm.svgPath(v, SQ);
  assert.equal((d.match(/M/g) || []).length, 3); // 외곽 2 + 구멍 1
  assert.equal(fm.withZoom(v, 25).zoom, 18); assert.equal(fm.withZoom(v, 3).zoom, 12);
  const url = fm.aerialUrl(v);
  assert.match(url, /^\/__field\/aerial\?lon=127\.\d+&lat=36\.\d+&zoom=\d+$/);
  // 동·서 방향: 동쪽 경도가 화면 오른쪽, 북쪽 위도가 화면 위쪽
  const [x1, y1] = fm.project(v, [127.0, 36.0]); const [x2, y2] = fm.project(v, [127.001, 36.001]);
  assert.ok(x2 > x1 && y2 < y1);
});

test('지도 렌더: exact-one만 영상·경계, 그 외는 합성 대체 없이 사유', () => {
  const v = fm.fitView(SQ);
  const html = fm.renderFieldMap({ status: 'EXACT_ONE', pnu: '9800000000100120003', target: { geometry: SQ, jibun: '12-3 답' }, neighbors: [], view: v, showTarget: true, showNeighbors: true, aerial: 'LOADING' });
  assert.match(html, /data-f-map-pnu="9800000000100120003"/); assert.match(html, /<img[^>]+\/__field\/aerial/); assert.match(html, /촬영일 미확인/); assert.match(html, /사업 편입선이 아닙니다/);
  const fail = fm.renderFieldMap({ status: 'NOT_UNIQUE', reason: '같은 PNU 경계가 2개 이상' });
  assert.doesNotMatch(fail, /<img|<svg/); assert.match(fail, /합성·추정 경계로 대체하지 않습니다/);
});

test('지도 조회: 응답 PNU 불일치·복수·없음은 확정하지 않음', async () => {
  const mk = (target) => fakeBridge({ parcel_map: () => ({ ok: true, target, neighbors: [] }) });
  assert.equal((await queryParcelMap({ fetchImpl: mk({ status: 'EXACT_ONE', pnu: '9800000000100129999', geometry: SQ }), location: loop, pnu: '9800000000100120003' })).status, 'MISMATCH');
  assert.equal((await queryParcelMap({ fetchImpl: mk({ status: 'NOT_UNIQUE', pnu: '9800000000100120003' }), location: loop, pnu: '9800000000100120003' })).status, 'NOT_UNIQUE');
  const ok = await queryParcelMap({ fetchImpl: mk({ status: 'EXACT_ONE', pnu: '9800000000100120003', geometry: SQ, jibun: '1 대' }), location: loop, pnu: '9800000000100120003' });
  assert.equal(ok.status, 'EXACT_ONE');
  assert.equal((await queryParcelMap({ fetchImpl: mk({}), location: { protocol: 'file:', hostname: '' }, pnu: '1' })).status, 'OFFLINE');
});

test('전용 서버 표지 페이지만 비루프백 브리지 허용', () => {
  const doc = { querySelector: (s) => (s === 'meta[name="bso-field-bridge"]' ? { getAttribute: () => 'private' } : null) };
  assert.equal(bridgeAllowed({ protocol: 'https:', hostname: 'pc.tailnet.ts.net' }, doc), true);
  assert.equal(bridgeAllowed({ protocol: 'https:', hostname: 'pc.tailnet.ts.net' }, { querySelector: () => null }), false);
  assert.equal(bridgeAllowed({ protocol: 'file:', hostname: '' }, doc), false);
});

test('기타 자유입력: 항상 마지막 쟁점 · 카드에 내용 반영 · 빈 내용 표시', () => {
  for (const profile of [getProfile('osong3'), profileForIndex(null)]) assert.equal(issuesFor(profile).at(-1).id, 'other');
  const idx = load();
  const card = buildFieldCard({ profile: profileForIndex(idx), index: idx, row: idx.rows[0], selectedIssueIds: ['other'], otherText: '진입로 공사 소음(합성)' });
  assert.match(card.text, /- 기타: 진입로 공사 소음\(합성\)/);
  const empty = buildDirectCard({ profile: profileForIndex(null), target: directLookupTarget(null, '9800000000100120003'), selectedIssueIds: ['other'] });
  assert.match(empty.text, /- 기타: \(내용 미입력\)/);
});

test('전용 최소 서버: 허용 연산만 · 영상 좌표 검증 · 보안 헤더 · LAN 토큰', async () => {
  const { spawn } = await import('node:child_process');
  const page = path.join(root, 'dist', 'notice-field-test', 'synthetic-field.html');
  const stateDir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'bso-field-test-'));
  const startServer = (port, extra = []) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'field_server.js'), '--page', page, '--port', String(port), '--env', path.join(root, 'no-such.env'), ...extra],
      { env: { ...process.env, VWORLD_API_KEY: '', VWORLD_DOMAIN: '', BSO_FIELD_STATE_DIR: stateDir }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => { if (String(b).includes('BSO field server')) resolve(child); });
    child.on('error', reject); setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
  const s1 = await startServer(4197);
  try {
    const base = 'http://127.0.0.1:4197';
    const pageRes = await fetch(`${base}/`);
    assert.equal(pageRes.status, 200); assert.match(await pageRes.text(), /bso-field-bridge" content="private"/);
    assert.equal(pageRes.headers.get('cache-control'), 'no-store'); assert.match(pageRes.headers.get('content-security-policy'), /connect-src 'self'/);
    for (const op of ['rtms', 'building', 'field_candidates', 'legal_dong']) assert.equal((await fetch(`${base}/__public_data_bridge/${op}`, { method: 'POST', body: '{}' })).status, 404, op);
    assert.equal((await fetch(`${base}/__field/aerial?lon=0&lat=0&zoom=18`)).status, 400);
    assert.equal((await fetch(`${base}/__field/aerial?lon=127&lat=36&zoom=19`)).status, 400);
    assert.equal((await fetch(`${base}/__field/aerial?lon=127&lat=36&zoom=18`)).status, 503); // 키 없음
    assert.equal((await fetch(`${base}/__public_data_bridge/pnu_parcel`, { method: 'POST', body: 'x'.repeat(9000) })).status, 413);
    assert.equal((await fetch(`${base}/dist/notice-field/field-empty.html`)).status, 404);
  } finally { s1.kill(); }
  // --require-token: 루프백·Serve 뒤에서도 앱 토큰 필수, 토큰 교환은 HTTPS 프록시(Serve) 요청에서만, 쿠키 Secure
  const s2 = await startServer(4198, ['--require-token']);
  try {
    const B = 'http://127.0.0.1:4198';
    const token = fs.readFileSync(path.join(stateDir, 'access-token.txt'), 'utf8').trim();
    assert.equal((await fetch(`${B}/`)).status, 401);
    assert.equal((await fetch(`${B}/__public_data_bridge/status`)).status, 401);
    const plain = await fetch(`${B}/?t=${token}`, { redirect: 'manual' });
    assert.equal(plain.status, 403); assert.equal((await plain.json()).error_code, 'FIELD_TOKEN_EXCHANGE_HTTPS_ONLY');
    assert.equal((await fetch(`${B}/?t=wrong`, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https' } })).status, 401);
    const ok = await fetch(`${B}/?t=${token}`, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(ok.status, 303); assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure/);
    assert.equal((await fetch(`${B}/`, { headers: { cookie: `bso_field=${token}` } })).status, 200);
    // 페어링: HTTPS만, 틀린 코드 401, 맞는 코드 1회 → Secure 쿠키, 재사용 불가
    assert.equal((await fetch(`${B}/pair`)).status, 403);
    assert.equal((await fetch(`${B}/pair`, { headers: { 'x-forwarded-proto': 'https' } })).status, 200);
    const code = /코드: (\d{6})/.exec(fs.readFileSync(path.join(stateDir, 'pair-code.txt'), 'utf8'))[1];
    const pair = (c) => fetch(`${B}/pair`, { method: 'POST', headers: { 'x-forwarded-proto': 'https', 'content-type': 'application/json' }, body: JSON.stringify({ code: c }) });
    assert.equal((await pair(code === '000000' ? '111111' : '000000')).status, 401);
    const good = await pair(code);
    assert.equal(good.status, 200); assert.match(good.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure/);
    assert.equal((await pair(code)).status, 410);
  } finally { s2.kill(); }
  // --allowed-login: Serve가 붙이는 Tailscale-User-Login이 목록에 없으면 403
  const s3 = await startServer(4199, ['--allowed-login', 'allowed@example.test']);
  try {
    const B = 'http://127.0.0.1:4199';
    assert.equal((await fetch(`${B}/`)).status, 403);
    assert.equal((await fetch(`${B}/`, { headers: { 'tailscale-user-login': 'other@example.test' } })).status, 403);
    assert.equal((await fetch(`${B}/`, { headers: { 'tailscale-user-login': 'Allowed@Example.test' } })).status, 200);
  } finally { s3.kill(); }
  // 평문 HTTP LAN 바인딩 제거
  const { spawnSync } = await import('node:child_process');
  const lan = spawnSync(process.execPath, [path.join(root, 'scripts', 'field_server.js'), '--lan'], { encoding: 'utf8' });
  assert.equal(lan.status, 2);
});

// ── 용도지역: 현재값과 보상평가 검토 기준 분리(시행규칙 제23조 제2항 · 실무기준 6.1.2) ──────────────
const zb = await import('../../browser/consultation-sim/core/zoning-basis.js');
const PROJ = { notice_no: '가상 고시 제0000-1호', notice_date: '2025-08-28', source_url: null, zoning_check: '가상 고시 도시관리계획 결정(변경) 원문 대조' };
const HIST = [{ year: 2025, zoning: '농림지역' }, { year: 2026, zoning: '제1종일반주거지역' }];

test('용도지역: 변경 관찰 + 관련성 미확인 → 확인 필요, 기준 후보 없음, 고시일이 변경 구간에 포함됨을 기록', () => {
  const z = zb.evaluateZoningBasis({ history: HIST, project: PROJ });
  assert.equal(z.status, 'CHANGE_UNCONFIRMED'); assert.equal(z.basis_zoning, null);
  assert.equal(z.current_zoning, '제1종일반주거지역'); assert.deepEqual([z.change.before, z.change.after, z.change.window], ['농림지역', '제1종일반주거지역', '2025~2026']);
  assert.match(z.notes.join(), /사업 고시일\(2025-08-28\)이 포함됩니다 — 사업 관련 가능성이 있으나 확정 아님/);
  assert.equal(z.verification, 'UNVERIFIED_BY_EXPERT');
  assert.deepEqual(z.rules.map((r) => r.id), ['ENFORCEMENT_RULE_23_2', 'APPRAISAL_PRACTICE_6_1_2']);
});

test('용도지역: 상담자가 근거와 함께 사업 관련 표시 → 변경 전 용도지역 후보, 근거 없으면 반영 안 함', () => {
  const noDoc = zb.evaluateZoningBasis({ history: HIST, project: PROJ, confirmation: { relation: 'PROJECT_RELATED', basis_doc: ' ' } });
  assert.equal(noDoc.status, 'CHANGE_UNCONFIRMED'); assert.match(noDoc.notes.join(), /근거 문서를 함께/);
  const z = zb.evaluateZoningBasis({ history: HIST, project: PROJ, confirmation: { relation: 'PROJECT_RELATED', basis_doc: '고시 ○쪽 결정조서', by: '상담A' } });
  assert.deepEqual([z.status, z.basis_zoning, z.basis_reason, z.verification], ['PROJECT_RELATED', '농림지역', 'ENFORCEMENT_RULE_23_2', 'COUNSELOR_MARKED_UNVERIFIED_BY_EXPERT']);
  const u = zb.evaluateZoningBasis({ history: HIST, project: PROJ, confirmation: { relation: 'UNRELATED', basis_doc: '시 도시관리계획 결정 고시(별건)' } });
  assert.deepEqual([u.status, u.basis_zoning, u.basis_reason], ['UNRELATED', null, 'VALUATION_DATE_PRINCIPLE']);
  assert.match(u.basis_label, /감정평가 기준시점의 용도지역\(기준시점 미확인\) · 현재 조회값 제1종일반주거지역은 참고/);
});

test('용도지역: 변경 없음·자료 없음·사업 미지정은 확인 필요(자동 기준 없음)', () => {
  const same = zb.evaluateZoningBasis({ history: [{ year: 2025, zoning: '대' === '대' ? '일반상업지역' : '' }, { year: 2026, zoning: '일반상업지역' }], project: null });
  assert.equal(same.status, 'NO_CHANGE_OBSERVED'); assert.equal(same.basis_zoning, null); assert.match(same.notes[0], /그 이전 변경 여부와 사업 관련성은/);
  assert.equal(zb.evaluateZoningBasis({ history: [] }).status, 'NO_DATA');
  const noProj = zb.evaluateZoningBasis({ history: HIST, project: null });
  assert.equal(noProj.status, 'CHANGE_UNCONFIRMED'); assert.match(noProj.notes.join(), /사업 고시가 지정되지 않아/);
  const outside = zb.evaluateZoningBasis({ history: [{ year: 2023, zoning: 'A' }, { year: 2024, zoning: 'B' }], project: PROJ });
  assert.match(outside.notes.join(), /겹치지 않습니다/);
});

test('카드: 용도지역 검토 상태·근거·고시·상담자 표시만, 용도지역 값은 넣지 않음', () => {
  const idx = load();
  const z = zb.evaluateZoningBasis({ history: HIST, project: PROJ, confirmation: { relation: 'PROJECT_RELATED', basis_doc: '고시 ○쪽 결정조서' } });
  const card = buildFieldCard({ profile: profileForIndex(idx), index: idx, row: idx.rows[0], zoning: z });
  assert.match(card.text, /■ 용도지역 · 보상평가 기준 검토\(확정 아님\)/);
  assert.match(card.text, /전문가 검증 전/); assert.match(card.text, /제23조 제2항/); assert.match(card.text, /가상 고시 제0000-1호\(2025-08-28\)/);
  assert.doesNotMatch(card.text, /농림지역|제1종일반주거지역/);
  assert.match(buildFieldCard({ profile: profileForIndex(idx), index: idx, row: idx.rows[0], zoning: null }).text, /공적자료 미조회 — 확인 필요/);
});

test('공적자료: 모든 조회 연도의 용도지역 이력을 모은다', async () => {
  const fetchImpl = fakeBridge({
    resolve_pnu: () => ({ ok: true, candidate: { pnu: '9800000000100120003' } }),
    vworld_land: (b) => ({ ok: true, record: { zoning: b.standard_year === 2026 ? '제1종일반주거지역' : '농림지역', land_category: '답' } }),
  });
  const r = await queryPublicData({ fetchImpl, location: loop, index: load(), row: load().rows[0] });
  assert.deepEqual(r.zoning_history.map((h) => [h.year, h.zoning]), [[2026, '제1종일반주거지역'], [2025, '농림지역']]);
  assert.equal(r.values.find((v) => v.key === 'zoning').value, '제1종일반주거지역');
});


// ── 고시 사유서 근거(오송3 2025-456: 농림지역→제1종일반주거지역 217,424㎡, 사업 관련) · 기준시점 분리 ─────────
const OSONG_DECISIONS = getProfile('osong3').zoning_decisions;
const PROJ_N = { ...PROJ, zoning_decisions: OSONG_DECISIONS };

test('고시 사유서와 같은 변경이면 변경 전 용도지역을 평가 기준 후보로(필지별 도면 대조 전·전문가 검증 전)', () => {
  assert.deepEqual([OSONG_DECISIONS[0].from, OSONG_DECISIONS[0].to, OSONG_DECISIONS[0].area_m2], ['농림지역', '제1종일반주거지역', 217424]);
  const z = zb.evaluateZoningBasis({ history: HIST, project: PROJ_N });
  assert.equal(z.status, 'NOTICE_PROJECT_REASON');
  assert.equal(z.basis_label, '농림지역(평가 기준 후보)');
  assert.equal(z.verification, 'NOTICE_REASON_CONFIRMED_PARCEL_MAP_PENDING_UNVERIFIED_BY_EXPERT');
  assert.match(z.notes.join(), /217,424㎡ · 오송 제3생명과학 국가산업단지 개발사업에 따른 변경.*필지별 변경도면 대조 전/);
  assert.match(z.evidence.source, /도시·군관리계획 용도지역 결정\(변경\) 사유서/);
});

test('고시 결정과 다른 변경·사업 미연결은 근거로 쓰지 않음 · 사업 무관 표시가 고시와 상충하면 반영 안 함', () => {
  const other = zb.evaluateZoningBasis({ history: [{ year: 2025, zoning: '자연녹지지역' }, { year: 2026, zoning: '제1종일반주거지역' }], project: PROJ_N });
  assert.equal(other.status, 'CHANGE_UNCONFIRMED'); assert.equal(other.evidence, null);
  assert.equal(zb.evaluateZoningBasis({ history: HIST, project: null }).status, 'CHANGE_UNCONFIRMED');
  const conflict = zb.evaluateZoningBasis({ history: HIST, project: PROJ_N, confirmation: { relation: 'UNRELATED', basis_doc: '별건 결정' } });
  assert.equal(conflict.status, 'NOTICE_PROJECT_REASON'); assert.match(conflict.notes.join(), /상충합니다 — 반영하지 않고 전문가 확인 필요/);
});

test('조회 기준연도와 감정평가 기준시점 분리', () => {
  const z = zb.evaluateZoningBasis({ history: HIST, project: PROJ_N });
  assert.equal(z.query_basis.label, '조회 기준연도 2026(토지특성 기준일 2026-01-01)');
  assert.equal(z.valuation_date, null); assert.match(z.valuation_date_label, /감정평가 기준시점 미확인 — 조회 기준연도와 별개/);
  const d = zb.evaluateZoningBasis({ history: HIST, project: PROJ_N, valuationDate: '2026-12-15' });
  assert.match(d.valuation_date_label, /감정평가 기준시점 2026-12-15\(상담자 입력 · 문서 확인 필요\)/);
});

test('카드: 고시 근거 후보는 고시 기재값으로 기록, API 용도지역 값은 여전히 미기록', () => {
  const idx = load();
  const z = zb.evaluateZoningBasis({ history: HIST, project: PROJ_N });
  const text = buildFieldCard({ profile: profileForIndex(idx), index: idx, row: idx.rows[0], zoning: z }).text;
  assert.match(text, /평가 기준 후보: 농림지역\(평가 기준 후보\) — 근거: 국토교통부 고시 제2025-456호/);
  assert.match(text, /필지별 변경도면 대조 전 · 전문가 검증 전/);
  assert.match(text, /조회 기준연도 2026\(토지특성 기준일 2026-01-01\) \/ 감정평가 기준시점 미확인/);
  assert.doesNotMatch(text, /제1종일반주거지역/);
});

// ── 사업별 변경 고시 역추적 · 변경 전 용도지역 복원 ────────────────────────────
const zt = await import('../../browser/consultation-sim/core/zoning-trace.js');
const { queryZoningHistory } = await import('../../browser/consultation-sim/core/field-public-data.js');
const OSONG = getProfile('osong3');
const OSONG_PROJ = { ...PROJ, notice_no: OSONG.notice.notice_no, notice_date: OSONG.notice.notice_date, zoning_events: OSONG.zoning_events,
  prior_designations: OSONG.prior_designations, supporting_documents: OSONG.supporting_documents };
const LONG = [{ year: 2019, zoning: '관리지역' }, ...[2020, 2021, 2022, 2023, 2024, 2025].map((year) => ({ year, zoning: '농림지역' })), { year: 2026, zoning: '제1종일반주거지역' }];
const GUNGPYEONG = '4311325027103200001';

test('역추적: 전체 연도 이력에서 사업 고시가 일으킨 변경만 찾아 그 직전 용도지역을 복원(앞선 별건 변경과 섞지 않음)', () => {
  const z = zb.evaluateZoningBasis({ history: LONG, project: OSONG_PROJ });
  assert.equal(z.status, 'NOTICE_PROJECT_REASON');
  assert.equal(z.trace.trigger.event.notice_no, '국토교통부 고시 제2025-456호');
  assert.deepEqual([z.trace.trigger.change.window_start, z.trace.trigger.change.window_end], ['2025-01-01', '2026-01-01']);
  assert.equal(z.basis_label, '농림지역(평가 기준 후보)'); // 2019 관리지역이 아님
  assert.equal(z.change.before, '농림지역');
  assert.deepEqual([z.trace.past_basis.observed_from_year, z.trace.past_basis.as_of], [2020, '2025-01-01']);
  assert.ok(z.trace.unverified.some((u) => /2019~2020년 기준 사이 관리지역 → 농림지역 변경의 원인 고시/.test(u)));
  assert.ok(z.trace.unverified.includes('필지·법률 전문가 검증'));
  assert.equal(zt.EVIDENCE_GRADES.length, 4);
});

test('역추적: 명칭만 있는 고시(용도지역 결정 포함 미확인)·사업 사유 미확인·구간 밖 고시는 변경 유발 고시로 연결하지 않음', () => {
  const base = { id: 'x', notice_no: '가상 고시 제0000-2호', notice_date: '2025-05-01', changes: [{ from: '농림지역', to: '제1종일반주거지역' }] };
  const unverified = zb.evaluateZoningBasis({ history: HIST, project: { ...PROJ, zoning_events: [{ ...base, zoning_decision: 'UNVERIFIED', project_related: true }] } });
  assert.equal(unverified.status, 'CHANGE_UNCONFIRMED'); assert.equal(unverified.basis_zoning, null);
  assert.equal(unverified.trace.candidate_events[0].match, 'DECISION_UNVERIFIED');
  const unproven = zb.evaluateZoningBasis({ history: HIST, project: { ...PROJ, zoning_events: [{ ...base, zoning_decision: 'INCLUDED', project_related: null }] } });
  assert.equal(unproven.status, 'CHANGE_UNCONFIRMED'); assert.equal(unproven.trace.candidate_events[0].match, 'RELATION_UNPROVEN');
  const outside = zb.evaluateZoningBasis({ history: HIST, project: { ...PROJ, zoning_events: [{ ...base, notice_date: '2026-03-01', zoning_decision: 'INCLUDED', project_related: true }] } });
  assert.equal(outside.status, 'CHANGE_UNCONFIRMED'); assert.equal(outside.trace.trigger, null);
  const none = zb.evaluateZoningBasis({ history: HIST, project: { ...PROJ, zoning_events: [{ ...base, zoning_decision: 'NOT_INCLUDED', project_related: true }] } });
  assert.equal(none.trace.changes[0].matches[0].match, 'NO_DECISION');
});

test('역추적: 같은 사업 고시가 여러 번 바꾸면 가장 앞선 사업 유발 변경 직전 용도지역으로 복원', () => {
  const ev = (id, date, from, to) => ({ id, notice_no: id, notice_date: date, zoning_decision: 'INCLUDED', project_related: true, changes: [{ from, to, reason: '가상 사업' }] });
  const z = zb.evaluateZoningBasis({ history: [{ year: 2020, zoning: 'A' }, { year: 2021, zoning: 'B' }, { year: 2022, zoning: 'C' }],
    project: { ...PROJ, zoning_events: [ev('가상-1', '2020-07-01', 'A', 'B'), ev('가상-2', '2021-07-01', 'B', 'C')] } });
  assert.equal(z.status, 'NOTICE_PROJECT_REASON'); assert.equal(z.basis_label, 'A(평가 기준 후보)'); assert.equal(z.trace.trigger.event.id, '가상-1');
});

test('오송3 궁평리 320-1: 첨부 변경도 제4도엽 대조 반영 · 검증 문구 · 증거등급 ①~④ 분리 · 총괄 면적은 필지 근거 아님', () => {
  const ev = OSONG.parcel_zoning_evidence[GUNGPYEONG];
  const z = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: ev });
  assert.equal(z.verification_label, '제2025-456호 첨부 변경도 제4도엽의 변경 후 용도지역 확인 · 2020-236 총괄 기정 근거 확인·개별 필지 기정 지정이력 별도 확인 필요 · 전문가 검증 전');
  assert.equal(z.verification, 'NOTICE_REASON_AND_PARCEL_MAP_CONFIRMED_UNVERIFIED_BY_EXPERT');
  assert.deepEqual(z.trace.evidence.map((e) => [e.grade, e.status]), [[1, 'AGGREGATE_ONLY'], [1, 'CONFIRMED'], [2, 'AGGREGATE_ONLY'], [2, 'PENDING'], [2, 'NOT_OBTAINED'], [3, 'AGGREGATE_ONLY'], [4, 'OBSERVED']]);
  assert.match(z.trace.evidence[0].finding, /217,424㎡\(변경 유형 총량 — 이 필지 면적 아님\)/);
  assert.match(z.trace.evidence[1].caution, /붉은 선을 토지보상 편입선으로 해석하지 않음/);
  assert.match(z.trace.evidence[5].caution, /개별 필지의 기존 용도지역 확정 근거로 쓰지 않음/);
  assert.ok(z.trace.cross_check.some((c) => /① 필지별 도면.*= ④ 조회 변경 후 값/.test(c)));
  assert.ok(z.trace.cross_check.some((c) => /③ 총괄 기존 현황에 농림지역 포함\(사업 범위·작성 시점 다름 — 필지 확정 아님\)/.test(c)));
  assert.ok(z.trace.unverified.some((u) => /청주시 고시 제2020-236호/.test(u)));
  assert.ok(z.trace.unverified.some((u) => /고시 전 PNU별 지정이력·당시 토지이용계획·해당 지역 기정도면\(개별 필지\) — 대조 전/.test(u)));
  assert.ok(z.trace.unverified.some((u) => /효력 기준일/.test(u)));
  assert.ok(!z.trace.unverified.some((u) => /필지별 변경도면 대조/.test(u)));
  const doc = OSONG.supporting_documents[0];
  assert.equal(doc.zoning_composition.reduce((a, b) => a + b.area_m2, 0), doc.project_area_m2); // 6,264,847 + 504,244 = 6,769,091
});

test('오송3 다른 필지(대조 기록 없음)는 필지별 변경도면 대조 전으로 유지 · 카드엔 변경 유발 고시·대조 문서·검증 상태만', () => {
  const z = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: [] });
  assert.equal(z.verification_label, '고시 사유서 확인 · 필지별 변경도면 대조 전 · 2020-236 총괄 기정 근거 확인·개별 필지 기정 지정이력 별도 확인 필요 · 전문가 검증 전');
  const idx = load();
  const withMap = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  const text = buildFieldCard({ profile: profileForIndex(idx), index: idx, row: idx.rows[0], zoning: withMap }).text;
  assert.match(text, /사업 관련 변경 고시\(효력일 확인 필요\): 국토교통부 고시 제2025-456호\(2025-08-28\) — 용도지역 결정\(변경\) 포함 · 사업 관련 사유 명시 · 효력 기준일 원문 확인 전 · 고시일 2025-08-28 기준 달력 구간 적합\(법적 변경일 확정 아님/);
  assert.doesNotMatch(text, /변경 유발 고시:|필지별 변경도면 대조 전/);
  assert.match(text, /대조 문서: ① .*\(필지 대조함\) \/ ② 청주시 고시 제2020-236호/);
  assert.match(text, /검증 상태: 제2025-456호 첨부 변경도 제4도엽의 변경 후 용도지역 확인 · 2020-236 총괄 기정 근거 확인·개별 필지 기정 지정이력 별도 확인 필요 · 전문가 검증 전/);
  assert.doesNotMatch(text, /제1종일반주거지역|6,264,847/);
});

test('이력 역추적 조회: 확인된 PNU만, 연도별 용도지역만 모음 · 자료 없는 연도는 실패와 구분 · 속도 제한이면 중단', async () => {
  const noCall = async () => { throw new Error('no call'); };
  assert.equal((await queryZoningHistory({ fetchImpl: noCall, location: loop, pnu: '123' })).status, 'FAILED');
  assert.equal((await queryZoningHistory({ fetchImpl: noCall, location: { protocol: 'file:', hostname: '' }, pnu: GUNGPYEONG })).status, 'OFFLINE');
  const seen = [];
  const r = await queryZoningHistory({ location: loop, pnu: GUNGPYEONG, years: [2024, 2023, 2022], fetchImpl: fakeBridge({
    vworld_land: (b) => { seen.push(b.standard_year); return b.standard_year === 2022 ? { ok: true, record: null } : { ok: true, record: { zoning: '농림지역', individual_official_price: 999 } }; } }) });
  assert.deepEqual(seen, [2024, 2023, 2022]); assert.equal(r.status, 'OK');
  assert.deepEqual(r.rows.map((x) => [x.year, x.zoning]), [[2024, '농림지역'], [2023, '농림지역']]); assert.equal(r.rows[0].individual_official_price, undefined);
  assert.equal(r.reason, null);
  const seen2 = [];
  const lim = await queryZoningHistory({ location: loop, pnu: GUNGPYEONG, years: [2024, 2023, 2022], fetchImpl: fakeBridge({
    vworld_land: (b) => { seen2.push(b.standard_year); return { ok: false, error_code: 'RATE_LIMITED' }; } }) });
  assert.deepEqual(seen2, [2024]); assert.equal(lim.status, 'FAILED'); assert.match(lim.reason, /2024년 조회 실패/);
});

test('역추적: 중간 연도 응답이 없으면(예: 수정본 충돌) 연속 관찰로 표시하지 않고 미확인으로 남김', () => {
  const hist = [2018, 2019, 2020, 2021, 2022, 2023, 2025].map((year) => ({ year, zoning: '농림지역' })).concat([{ year: 2026, zoning: '제1종일반주거지역' }]);
  const z = zb.evaluateZoningBasis({ history: hist, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  assert.equal(z.basis_label, '농림지역(평가 기준 후보)');
  assert.equal(z.trace.past_basis.label, '2025-01-01 기준(조회 2018~2025년 관찰 · 2024년 미확인 · 조회 시작연도 이전은 미확인)');
  assert.ok(z.trace.unverified.includes('2024년 용도지역(조회 응답 없음·실패)'));
});

test('GPT QA(7673767) 1: 궁평리 320-1 대조 도면 축척은 1/1,500', () => {
  const doc = OSONG.parcel_zoning_evidence[GUNGPYEONG][0].document;
  assert.match(doc, /결정\(변경\)도」\(1\/1,500\) 제4도엽/);
  assert.doesNotMatch(doc, /1\/500\)/);
});

test('GPT QA(7673767) 2: 필지 변경도면 대조 상태 문구가 근거·안내문·상태칩·카드에서 일치', () => {
  const ok = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  assert.match(ok.evidence.parcel_level, /필지별 변경도면 대조함/);
  assert.ok(ok.notes.some((n) => /이 필지의 변경 구역 포함 여부: 필지별 변경도면 대조함/.test(n)));
  assert.ok(!ok.notes.some((n) => /대조 전/.test(n) && /필지별 변경도면/.test(n)));
  assert.doesNotMatch(zb.ZONING_STATUS_LABEL[ok.status], /대조 전|대조함/);
  assert.doesNotMatch(zb.zoningCardLines(ok).join(' / '), /필지별 변경도면 대조 전/);
  const pend = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: [] });
  assert.equal(pend.evidence.parcel_level, '필지별 변경도면 대조 전');
  assert.ok(pend.notes.some((n) => /필지별 변경도면 대조 전 — 대조 필요/.test(n)));
  assert.doesNotMatch(zb.zoningCardLines(pend).join(' / '), /필지별 변경도면 대조함/);
});

test('GPT QA(7673767) 3: 효력일 미확인이면 고시일 기준 잠정 연결 — 효력일이 확인되면 그때 변경 유발 고시', () => {
  const prov = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  assert.equal(prov.trace.trigger.date_basis, zt.DATE_BASIS.NOTICE_DATE_PROVISIONAL);
  assert.equal(prov.trace.effective_date_confirmed, false);
  assert.equal(prov.trace.trigger_heading, '사업 관련 변경 고시(효력일 확인 필요)');
  assert.match(prov.trace.trigger_window_note, /고시일 2025-08-28 기준 달력 구간 적합\(법적 변경일 확정 아님/);
  assert.ok(prov.trace.unverified.some((u) => /효력 기준일/.test(u)));
  const events = OSONG.zoning_events.map((e) => ({ ...e, effective_date: '2025-08-28' }));
  const eff = zb.evaluateZoningBasis({ history: HIST, project: { ...OSONG_PROJ, zoning_events: events }, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  assert.equal(eff.trace.trigger.date_basis, zt.DATE_BASIS.EFFECTIVE_DATE);
  assert.equal(eff.trace.trigger_heading, '변경 유발 고시');
  assert.ok(!eff.trace.unverified.some((u) => /효력 기준일/.test(u)));
  assert.match(zb.zoningCardLines(eff).join(' / '), /변경 유발 고시: 국토교통부 고시 제2025-456호\(2025-08-28\) .* · 효력 2025-08-28 · 효력일 2025-08-28 기준 변경 구간 안/);
  // 효력일이 구간 밖이면(고시일은 안이어도) 연결하지 않음
  const late = OSONG.zoning_events.map((e) => ({ ...e, effective_date: '2026-03-01' }));
  const out = zb.evaluateZoningBasis({ history: HIST, project: { ...OSONG_PROJ, zoning_events: late } });
  assert.equal(out.trace.trigger, null); assert.equal(out.status, 'CHANGE_UNCONFIRMED');
});

test('GPT 후속 A: 2020-236은 청주시 전체 기정 총량 근거 — 개별 필지 기정도면으로 취급하지 않음', () => {
  const z = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  const g2 = z.trace.evidence.filter((e) => e.grade === 2);
  assert.equal(g2[0].status, 'AGGREGATE_ONLY');
  assert.match(g2[0].finding, /월오동 산1-1·산10 일원 자연녹지→보전녹지 86,448㎡/);
  assert.match(g2[0].finding, /제2016-360호\(2016-12-30\) 기준 누계 총량/);
  assert.match(g2[0].caution, /원문을 읽은 사실과 이 필지의 기존 용도지역 확인은 다름/);
  assert.equal(g2[1].status, 'PENDING'); assert.match(g2[1].title, /고시 전 PNU별 지정이력/);
  assert.doesNotMatch(z.verification_label, /기정도면 대조 전/);
  assert.match(z.verification_label, /2020-236 총괄 기정 근거 확인·개별 필지 기정 지정이력 별도 확인 필요/);
});

test('GPT 후속 B: 효력일 법령 근거 후보는 표시하되 자동 확정하지 않음', () => {
  const z = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  const lb = z.trace.trigger.event.effective_legal_basis;
  assert.equal(lb.status, 'LEGAL_REVIEW_REQUIRED'); assert.equal(lb.candidate_date, '2025-08-28');
  assert.ok(lb.provisions.some((p) => /국토의 계획 및 이용에 관한 법률」 제31조 제1항/.test(p)));
  assert.equal(z.trace.trigger.event.effective_date, null);
  assert.equal(z.trace.trigger_heading, '사업 관련 변경 고시(효력일 확인 필요)');
  assert.ok(z.trace.unverified.some((u) => /법령 근거 검토 필요\(후보 2025-08-28 · 변호사 확인 전 확정 안 함\)/.test(u)));
  assert.match(zb.zoningCardLines(z).join(' / '), /효력일: 법령 근거 검토 필요\(후보 2025-08-28/);
});

// ── 주변 표준지 · 비교표준지 후보 지도(합성 응답) ──────────────────────────────────────
const fs_ = await import('../../browser/consultation-sim/core/field-standard.js');
const fmap = await import('../../browser/consultation-sim/core/field-map.js');
const { queryStandardLands } = await import('../../browser/consultation-sim/core/field-public-data.js');
const STD = (pnu, zoning, use, price, extra = {}) => ({ pnu, stdrYear: '2026', pblntfPclnd: String(price), prposAreaNm1: zoning, ladUseSittnNm: use, lndcgrCodeNm: '답',
  ldCode: pnu.slice(0, 10), ldCodeNm: pnu.startsWith('9999910102') ? '가상도 가상시 숲내읍 냇가리' : '가상도 가상시 숲내읍 바위리', mnnmSlno: pnu.slice(11, 15).replace(/^0+/, ''),
  name_filled_from_land_characteristics: ['prposAreaNm1'], ...extra });
const SA = '9999910101100020000'; const SB = '9999910101100030000'; const SC = '9999910102100040000'; const SD = '9999910102100050000'; const SE = '9999910101100060000';
const STD_RESPONSE = {
  ok: true, status: 'OK', target: { pnu: '9999910101100010000', centroid: [127.0, 36.0] },
  search: { year: 2026, radius_m: 1000, legal_dongs: [{ ld_code: '9999910101', name: '가상도 가상시 숲내읍 바위리', status: 'OK', count: 3 }, { ld_code: '9999910102', name: '가상도 가상시 숲내읍 냇가리', status: 'OK', count: 2 }], legal_dongs_not_queried: [] },
  rows: [STD(SA, '농림지역', '전', 100000), STD(SB, '제1종일반주거지역', '전', 150000), STD(SC, '농림지역', '전', 90000), STD(SD, '농림지역', '전', 95000), STD(SE, '농림지역', '전', 99000)],
  locations: {
    [SA]: { status: 'EXACT_ONE', centroid: [127.002, 36.0], distance_m: 180 }, [SB]: { status: 'EXACT_ONE', centroid: [127.0, 36.001], distance_m: 111 },
    [SC]: { status: 'NOT_FOUND' }, [SD]: { status: 'EXACT_ONE', centroid: [127.02, 36.0], distance_m: 1800 }, [SE]: { status: 'NOT_ATTEMPTED' },
  },
  limits: { not_located_by_limit: 1 }, name_resolution: { unresolved: [] },
};
const TGT = { zoning: '제1종일반주거지역', land_use: '전', land_category: '답' };

test('표준지 후보: 사업 영향 배제 기준 용도지역(농림지역)으로 판정 — 현재 제1종일반주거지역을 필터로 쓰지 않음', () => {
  const z = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  const r = fs_.buildStandardReview({ response: STD_RESPONSE, target: TGT, zoning: z });
  assert.equal(r.review.basis, 'PROJECT_EXCLUDED'); assert.equal(r.review.zoning, '농림지역');
  assert.match(r.review.label, /사업 영향 배제 기준 용도지역 후보 농림지역\(현재 제1종일반주거지역 아님\)/);
  assert.equal(r.status, 'FOUND');
  assert.deepEqual(r.analysis.candidates.map((c) => c.row.pnu), [SA]); // 112m 제1종일반주거 표준지는 후보 아님
  assert.ok(r.list.find((x) => x.pnu === SB).reasons.some((x) => /용도지역 상이\(제1종일반주거지역\)/.test(x)));
  assert.match(r.scope.label, /반경 1,000m에 걸친 법정동 2곳\(바위리·냇가리\) · 2026년 공시/);
});

test('표준지 후보: 사업 관련 변경이 없으면 현재 용도지역 · 변경 관찰만 있으면 경고와 함께 현재값', () => {
  const plain = fs_.buildStandardReview({ response: STD_RESPONSE, target: TGT, zoning: null });
  assert.equal(plain.review.basis, 'CURRENT'); assert.deepEqual(plain.analysis.candidates.map((c) => c.row.pnu), [SB]);
  const unconfirmed = fs_.reviewZoningFor({ status: 'CHANGE_UNCONFIRMED', change: { before: '농림지역' } }, '제1종일반주거지역');
  assert.equal(unconfirmed.basis, 'CURRENT_CHANGE_UNCONFIRMED'); assert.match(unconfirmed.note, /변경 전 용도지역으로 후보를 다시 검토/);
});

test('표준지 지도: 공식 위치(exact-one)만 표식 · 위치 미확인·한도 초과는 목록에만 · 반경 밖은 후보 판정 제외', () => {
  const z = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  const r = fs_.buildStandardReview({ response: STD_RESPONSE, target: TGT, zoning: z });
  assert.deepEqual(r.markers.map((m) => [m.pnu, m.kind, m.rank]).sort(), [[SA, 'CANDIDATE', 1], [SB, 'STANDARD', null], [SD, 'STANDARD', null]].sort());
  assert.ok(!r.markers.some((m) => [SC, SE].includes(m.pnu)));
  const held = Object.fromEntries(r.list.filter((x) => x.kind === 'HELD').map((x) => [x.pnu, x]));
  assert.match(held[SC].reasons[0], /위치 미확인 — 연속지적도 exact-one 아님\(NOT_FOUND\) · 지도 미표시/); assert.equal(held[SC].located, false);
  assert.match(held[SE].reasons[0], /위치 조회 한도 초과/);
  assert.match(held[SD].reasons[0], /검색 반경 1,000m 밖\(1\.80km\)/);
  const cand = r.list.find((x) => x.kind === 'CANDIDATE');
  assert.equal(cand.status_label, '비교표준지 후보'); assert.equal(cand.price, 100000); assert.equal(cand.year, 2026); assert.equal(cand.distance_m, 180);
  assert.equal(cand.label, '가상도 가상시 숲내읍 바위리 2');
  assert.ok(cand.reasons.some((x) => /용도지역 동일\(농림지역\)/.test(x)));
  assert.ok(r.notes.some((n) => /가장 가까운 표준지를 적정 비교표준지로 확정하지 않음/.test(n)));
  assert.ok(r.notes.some((n) => /1건은 위치 조회 한도로 미확인/.test(n)));
  assert.equal(fs_.STD_LABEL.NOT_SELECTED, '감정평가사가 선정한 비교표준지 아님 — 자동 확정 안 함');
});

test('표준지 지도: 조회 실패·대상 경계 불확정이면 표식·후보 없음(가상 후보 생성 안 함)', () => {
  const fail = fs_.buildStandardReview({ response: { ok: false, error_code: 'VWORLD_API_ERROR' }, target: TGT });
  assert.equal(fail.status, 'FAILED'); assert.deepEqual(fail.markers, []); assert.deepEqual(fail.list, []);
  const notExact = fs_.buildStandardReview({ response: { ok: true, status: 'TARGET_NOT_EXACT', rows: [] }, target: TGT });
  assert.equal(notExact.status, 'TARGET_NOT_EXACT'); assert.deepEqual(notExact.markers, []);
});

test('표준지 지도 표식: 후보는 번호 버튼 · 일반 표준지는 회색 · 화면 밖은 개수만 · 맞춤 줌은 후보를 포함', () => {
  const z = zb.evaluateZoningBasis({ history: HIST, project: OSONG_PROJ, parcelEvidence: OSONG.parcel_zoning_evidence[GUNGPYEONG] });
  const r = fs_.buildStandardReview({ response: STD_RESPONSE, target: TGT, zoning: z });
  const geom = { type: 'MultiPolygon', coordinates: [[[[127.0, 36.0], [127.0002, 36.0], [127.0002, 36.0002], [127.0, 36.0002], [127.0, 36.0]]]] };
  const tight = fmap.fitView(geom);
  const out = fmap.renderStandardPins(tight, { markers: r.markers, selected: SA, showStandards: true, showCandidates: true });
  assert.ok(out.offscreen >= 1);
  const fit = fmap.fitView(geom, r.markers.filter((m) => m.kind === 'CANDIDATE').map((m) => m.centroid));
  assert.ok(fit.zoom <= tight.zoom);
  const far = fmap.fitView(geom, [[127.02, 36.0]]); assert.ok(far.zoom < tight.zoom); // 멀리 있는 지점을 넣으면 축소
  const pins = fmap.renderStandardPins(fit, { markers: r.markers, selected: SA, showStandards: true, showCandidates: true }).pins;
  assert.match(pins, new RegExp(`data-f-std-pin="${SA}" data-f-std-kind="CANDIDATE" data-f-std-rank="1"[^>]*>1</button>`));
  assert.match(pins, /class="f-std-pin cand sel"/);
  const hidden = fmap.renderStandardPins(fit, { markers: r.markers, selected: null, showStandards: false, showCandidates: true }).pins;
  assert.doesNotMatch(hidden, /data-f-std-kind="STANDARD"/);
  const html = fmap.renderFieldMap({ status: 'EXACT_ONE', pnu: '9999910101100010000', target: { geometry: geom }, neighbors: [], view: fit, showTarget: true, showNeighbors: true, aerial: 'OK',
    std: { markers: r.markers, selected: SA, showStandards: true, showCandidates: true } });
  assert.match(html, /data-f-map-toggle="standards" checked/); assert.match(html, /data-f-map-toggle="candidates" checked/); assert.match(html, /data-f-map-fit="std"/);
  assert.match(html, /비교표준지 후보\(감정평가사 선정 아님\)/);
});

test('표준지 조회 요청: 확인된 PNU·기준연도만 · 오프라인·PNU 미확인이면 호출 안 함', async () => {
  const noCall = async () => { throw new Error('no call'); };
  assert.equal((await queryStandardLands({ fetchImpl: noCall, location: { protocol: 'file:', hostname: '' }, pnu: GUNGPYEONG, year: 2026 })).error_code, 'OFFLINE');
  assert.equal((await queryStandardLands({ fetchImpl: noCall, location: loop, pnu: '1', year: 2026 })).error_code, 'PNU_INVALID');
  assert.equal((await queryStandardLands({ fetchImpl: noCall, location: loop, pnu: GUNGPYEONG, year: null })).error_code, 'YEAR_INVALID');
  let sent = null;
  const r = await queryStandardLands({ location: loop, pnu: GUNGPYEONG, year: 2026, reviewZoning: '농림지역', fetchImpl: fakeBridge({ standard_lands: (b) => { sent = b; return { ok: true, status: 'OK', rows: [] }; } }) });
  assert.deepEqual(sent, { pnu: GUNGPYEONG, year: 2026, radius_m: 1000, review_zoning: '농림지역' }); assert.equal(r.ok, true);
  const f = await queryStandardLands({ location: loop, pnu: GUNGPYEONG, year: 2026, fetchImpl: fakeBridge({ standard_lands: () => ({ ok: false, error_code: 'FIELD_ROUTE_NOT_ALLOWED' }) }) });
  assert.equal(f.ok, false); assert.ok(f.reason);
});
