'use strict';

// 스캔 평가서 표 구조 복원 회귀.
// 실제 사건 PDF 는 쓰지 않는다. 실제 스캔본에서 관찰한 좌표 배치와 OCR 손상 양상만
// 합성 bbox fixture 로 재현한다(지명·지번·금액 전부 합성값).

const assert = require('assert');
const { buildScanCaseCandidates } = require('../src/scan/scan_case_adapter');
const { reconstructTable, sliceTables, assignColumnRoles } = require('../src/scan/scan_table_recovery');
const { readCellNumber, readNumber } = require('../src/scan/scan_value');

let nextId = 0;
function word(text, x, y, options = {}) {
  nextId += 1;
  const width = options.width !== undefined ? options.width : Math.max(12, String(text).length * 13);
  return { text: String(text), confidence: options.confidence !== undefined ? options.confidence : 90, bbox: { x0: x, x1: x + width, y0: y, y1: y + 20 } };
}

// 실제 산출표 컬럼 x (관찰값): 기호 253 / 공시지가 290 / 시점 379 / 지역 463 /
// 가로 523 / 접근 587 / 자연 654 / 획지 710 / 행정 772 / 기타 836 /
// 누계 895 / 그밖 964 / 산출단가 1026 / 적용단가 1127
const CALC_X = { symbol: 253, official: 290, time: 379, region: 463, street: 523, access: 587, env: 654, shape: 710, admin: 772, etc: 836, total: 895, other: 964, calc: 1026, applied: 1127 };
// 토지조서 컬럼 x: 지번 268 / 지목 403 / 면적 545 / 단가 729 / 금액 895 / 비고 1110
const REG_X = { lot: 268, category: 403, area: 545, unit: 729, amount: 895, note: 1110 };

function calcRow(y, spec) {
  const words = [];
  if (spec.dong) spec.dong.split('').forEach((ch, i) => words.push(word(ch, 118 + i * 18, y)));
  if (spec.city) words.push(word(spec.city, 118, y - 13));
  if (spec.lot) words.push(word(spec.lot, 121, y + 26));
  if (spec.category) words.push(word(spec.category, 205, y));
  if (spec.symbol) words.push(word(spec.symbol, CALC_X.symbol, y));
  [['official', spec.official], ['time', spec.time], ['region', spec.region], ['street', spec.street],
    ['access', spec.access], ['env', spec.env], ['shape', spec.shape], ['admin', spec.admin],
    ['etc', spec.etc], ['total', spec.total], ['other', spec.other], ['calc', spec.calc], ['applied', spec.applied]]
    .forEach(([key, value]) => { if (value !== undefined && value !== null) words.push(word(value, CALC_X[key], y)); });
  // 괘선이 세로줄 글자로 잡히는 실제 양상
  words.push(word('i', CALC_X.time - 20, y, { confidence: 12 }));
  words.push(word('|', CALC_X.other - 22, y, { confidence: 8 }));
  return words;
}

function registerRow(y, spec) {
  const words = [];
  if (spec.city) words.push(word(spec.city, 133, y));
  if (spec.dong) spec.dong.split('').forEach((ch, i) => words.push(word(ch, 134 + i * 20, y + 18)));
  if (spec.lot) words.push(word(spec.lot, REG_X.lot, y + 18));
  if (spec.category) words.push(word(spec.category, REG_X.category, y + 18));
  if (spec.area) words.push(word(spec.area, REG_X.area, y + 18));
  if (spec.unit) words.push(word(spec.unit, REG_X.unit, y + 18));
  if (spec.amount) words.push(word(spec.amount, REG_X.amount, y + 18));
  words.push(word('익명', REG_X.note, y + 18));
  if (spec.use) String(`(현황${spec.use})`).split('').forEach((ch, i) => words.push(word(ch, REG_X.note + i * 16, y + 40)));
  return words;
}

function syntheticPages() {
  const calcPage = { page_no: 1, words: [] };
  calcPage.words.push(word('@', 70, 100), word('토지가격', 92, 100), word('산출근거', 160, 100));
  calcPage.words.push(word('공시지가)', 277, 140), word('지역', 463, 140), word('산출단가', 1035, 140), word('토지단가', 1131, 140));
  // 정상 행 3개 (실제와 같은 83px 간격)
  calcPage.words.push(...calcRow(200, { city: '익명시', dong: '샘플동', lot: '10-1', category: '대', symbol: 'C', official: '200,000', time: '1.10000', region: '1.00', street: '0.98', access: '0.90', env: '0.85', shape: '0.97', admin: '0.99', etc: '1.00', total: '0.700', other: '4.10', calc: '641,900', applied: '642,000' }));
  // OCR 손상: 소수점 소실(073 → 0.73), 산출단가 자릿수 소실
  calcPage.words.push(...calcRow(283, { city: '익명시', dong: '샘플동', lot: '10-4', category: '전', symbol: 'B', official: '100,000', time: '110000', region: '100,', access: '073', env: '090', shape: '0.80', admin: '1.00', etc: '1.00', total: '0526', other: '505', calc: '29131', applied: '291,000' }));
  calcPage.words.push(...calcRow(366, { city: '익명시', dong: '샘플동', lot: '산7-1', category: '임', symbol: 'J', official: '30,000', time: '1.10000', region: '1.00', access: '1.00', env: '1.00', admin: '1.00', etc: '1.00', total: '1.000', other: '5.19', calc: '171,270', applied: '171,000' }));

  const regPage = { page_no: 2, words: [] };
  regPage.words.push(word('@', 70, 100), word('토지조서', 92, 100));
  regPage.words.push(...registerRow(200, { city: '익명시', dong: '샘플동', lot: '10-1', category: '대', area: '400', unit: '642,000', amount: '256,800,000' }));
  regPage.words.push(...registerRow(297, { city: '익명시', dong: '샘플동', lot: '10-4', category: '전', area: '600', unit: '291,000', amount: '174,600,000' }));
  regPage.words.push(...registerRow(394, { city: '익명시', dong: '샘플동', lot: '산7-1', category: '임', area: '20,000', unit: '171,000', amount: '3,420,000,000' }));
  return { calcPage, regPage };
}

function testDistinctRowsNeverMerge() {
  const { calcPage } = syntheticPages();
  const slice = sliceTables(calcPage).find((entry) => entry.table_type === 'LAND_PRICE_CALC');
  const table = reconstructTable(slice, { tableType: 'LAND_PRICE_CALC' });
  assert.strictEqual(table.rows.length, 3, '데이터 행 3개가 각각 유지되어야 한다');
  const applied = table.rows.map((row) => row.words.map((w) => w.text).filter((t) => /^\d{1,3},\d{3}$/.test(t)));
  // 각 행에 적용단가가 하나씩만 들어가야 한다. 두 행이 합쳐지면 한 행에 두 개가 잡힌다.
  table.rows.forEach((row) => {
    const appliedInRow = row.words.filter((w) => Math.abs(w.x0 - CALC_X.applied) < 10);
    assert.strictEqual(appliedInRow.length, 1, '한 행에 적용단가는 하나뿐이어야 한다');
  });
  assert.ok(applied.length === 3);
}

function testColumnRolesDoNotShift() {
  const { calcPage } = syntheticPages();
  const slice = sliceTables(calcPage).find((entry) => entry.table_type === 'LAND_PRICE_CALC');
  const table = reconstructTable(slice, { tableType: 'LAND_PRICE_CALC' });
  const { roles } = assignColumnRoles('LAND_PRICE_CALC', table.value_columns, { rows: table.rows, columns: table.columns });
  const xOf = (role) => table.columns[roles[role]].x;
  // 지번 칸에도 숫자가 있으므로 왼쪽부터 순서대로 밀어 넣으면 공시지가가 지번으로 밀린다.
  assert.ok(Math.abs(xOf('official_price') - CALC_X.official) <= 12, '공시지가 열이 지번 쪽으로 밀리면 안 된다');
  assert.ok(Math.abs(xOf('applied_unit_price') - CALC_X.applied) <= 12);
  assert.ok(Math.abs(xOf('calculated_unit_price') - CALC_X.calc) <= 12);
  assert.ok(xOf('calculated_unit_price') < xOf('applied_unit_price'), '산출단가와 적용단가는 별개 열이다');
}

function testValueDomainsFailClosed() {
  // 천단위 구분자가 점으로 찍힌 단가를 소수로 읽으면 386,000 이 386 이 된다.
  assert.strictEqual(readNumber('386.000', 'price').value, 386000);
  // 요인 칸의 소수점 소실은 도메인 안에서 해석이 유일할 때만 복원한다.
  assert.deepStrictEqual(
    { v: readNumber('073', 'factor').value, s: readNumber('073', 'factor').status },
    { v: 0.73, s: 'SEPARATOR_RECOVERED' },
  );
  // 면적과 평가액을 서로 오인하지 않는다. 도메인이 서로를 거른다.
  assert.strictEqual(readNumber('400', 'amount').value, null, '400 은 평가액 도메인 밖이다');
  assert.strictEqual(readNumber('256,800,000', 'area').value, null, '평가액 크기의 수는 면적이 될 수 없다');
  assert.strictEqual(readNumber('20,000', 'area').value, 20000);
  // 공백으로 갈라진 두 숫자를 붙여 읽지 않는다.
  assert.strictEqual(readNumber('1 40239', 'price').value, null);
  assert.strictEqual(readCellNumber('1 40239', 'price').value, 40239);
  assert.strictEqual(readCellNumber('0.90 1.00', 'factor').value, null, '해석이 둘이면 값을 만들지 않는다');
  // 글자가 섞인 칸은 값이 아니다.
  assert.strictEqual(readNumber('Wo', 'factor').value, null);
}

function testCalculatedUnitPriceDriftIsFailClosed() {
  const { calcPage, regPage } = syntheticPages();
  const out = buildScanCaseCandidates([calcPage, regPage], { appraisalId: 'APP_SCAN' });
  const drifted = out.land_appraisal_results[1];
  // 29131 은 291,000 의 자릿수가 깨진 값이다. 그대로 두면 산출단가가 10배 틀린다.
  assert.strictEqual(drifted.calculated_unit_price, null);
  assert.ok(drifted.scan_flags.some((flag) => flag.startsWith('CALCULATED_UNIT_PRICE_DRIFT')));
  assert.strictEqual(drifted.unit_price, 291000, '적용단가는 살아 있어야 한다');
}

function testUnreadableCategoryStaysEmpty() {
  const { calcPage, regPage } = syntheticPages();
  // 지목이 OCR 로 깨진 상황을 만든다.
  regPage.words = regPage.words.map((w) => (w.text === '대' && Math.abs(w.bbox.x0 - REG_X.category) < 5 ? { ...w, text: 'Wo' } : w));
  const out = buildScanCaseCandidates([calcPage, regPage], { appraisalId: 'APP_SCAN' });
  const first = out.lands[0];
  assert.strictEqual(first.land_category, '', '지목을 못 읽으면 추정하지 않는다');
  assert.ok(first.scan_flags.includes('LAND_CATEGORY_UNREADABLE'));
}

function testSplitStatusRowsStayIndependent() {
  const { calcPage, regPage } = syntheticPages();
  // 같은 지번의 현황분리행 2개를 덧붙인다(면적만 다르다).
  calcPage.words.push(...calcRow(449, { city: '익명시', dong: '샘플동', lot: '산7-1', category: '임', symbol: 'B', official: '100,000', time: '1.10000', region: '1.00', access: '0.70', env: '0.90', shape: '0.80', admin: '1.00', etc: '1.00', total: '0.504', other: '5.05', calc: '279,972', applied: '280,000' }));
  calcPage.words.push(...calcRow(532, { city: '익명시', dong: '샘플동', lot: '산7-1', category: '임', symbol: 'J', official: '30,000', time: '1.10000', region: '1.00', access: '1.00', env: '1.00', admin: '1.00', etc: '0.33', total: '0.330', other: '5.19', calc: '56,519', applied: '57,000' }));
  regPage.words.push(...registerRow(491, { city: '익명시', dong: '샘플동', lot: '산7-1', category: '임', area: '100', unit: '280,000', amount: '28,000,000', use: '전' }));
  regPage.words.push(...registerRow(588, { city: '익명시', dong: '샘플동', lot: '산7-1', category: '임', area: '200', unit: '57,000', amount: '11,400,000', use: '도로' }));

  const out = buildScanCaseCandidates([calcPage, regPage], { appraisalId: 'APP_SCAN' });
  assert.strictEqual(out.lands.length, 5, '현황분리행을 합치면 안 된다');
  const san = out.lands.filter((land) => String(land.parcel_address).includes('산7-1'));
  assert.strictEqual(san.length, 3);
  assert.deepStrictEqual(san.map((land) => land.area), [20000, 100, 200]);
  assert.deepStrictEqual(san.map((land) => land.appraisal_use_status), ['', '전', '도로']);
  // 면적이 다르면 절대 같은 행이 아니다.
  assert.strictEqual(new Set(san.map((land) => land.land_id)).size, 3);

  const results = out.land_appraisal_results;
  assert.strictEqual(results.length, 5);
  assert.deepStrictEqual(results.map((row) => row.unit_price), [642000, 291000, 171000, 280000, 57000]);
  assert.deepStrictEqual(results.map((row) => row.amount), [256800000, 174600000, 3420000000, 28000000, 11400000]);
  assert.ok(results.every((row) => row.auto_confirmed === false));
  assert.ok(results.every((row) => row.review_status_code === 'NEEDS_REVIEW'));
}

function testReconciliationLinksInsteadOfInventing() {
  const { calcPage, regPage } = syntheticPages();
  const known = [{ parcel_address: '익명시 샘플동 10-1', land_category: '대', area: 400 }];
  const out = buildScanCaseCandidates([calcPage, regPage], { appraisalId: 'APP_SCAN', knownLands: known });
  const first = out.lands[0];
  assert.strictEqual(first.parcel_address, '익명시 샘플동 10-1');
  assert.ok(first.scan_flags.includes('RECONCILED_FROM_EXISTING_LAND'));
  // 대조 전 OCR 원문 주소는 감사를 위해 남긴다.
  assert.ok(typeof first.scan_ocr_address === 'string');

  const unmatched = buildScanCaseCandidates([calcPage, regPage], { appraisalId: 'APP_SCAN', knownLands: [] });
  assert.ok(unmatched.lands[0].scan_flags.includes('ADDRESS_DONG_UNRESOLVED'), '대조할 필지가 없으면 동 이름을 지어내지 않는다');
}

testDistinctRowsNeverMerge();
testColumnRolesDoNotShift();
testValueDomainsFailClosed();
testCalculatedUnitPriceDriftIsFailClosed();
testUnreadableCategoryStaysEmpty();
testSplitStatusRowsStayIndependent();
testReconciliationLinksInsteadOfInventing();

console.log('scan_table_recovery.test.js passed');
