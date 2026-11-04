'use strict';

// 복원된 표 → canonical 케이스 구조로 바꾸는 최소 어댑터.
// 경일·가람 TEXT_PDF 파서를 스캔본에 맞춰 고치지 않는다. 스캔 경로만 여기서 흡수한다.

const REVIEW_STATUS = require('../review_status');
const { assignRowToColumns } = require('./ocr_layout');
const { readCellNumber, readLot, readStandardSymbol } = require('./scan_value');
const {
  TABLE_SCHEMA,
  TABLE_TYPES,
  assignColumnRoles,
  reconstructTable,
  sliceTables,
} = require('./scan_table_recovery');

const HANGUL = /^[가-힣]+$/;
const USE_STATUS_PATTERN = /현황([가-힣]{1,4})/;
// 산출단가는 적용단가를 반올림하기 직전 값이다. 2% 넘게 벌어지면 둘 중 하나를 잘못 읽은 것이다.
const UNIT_PRICE_TOLERANCE = 0.02;

function firstValueX(row, columns, roles) {
  const indexes = Object.values(roles).filter((index) => Number.isInteger(index));
  if (indexes.length === 0) return Infinity;
  const min = Math.min(...indexes);
  return columns[min] ? columns[min].x : Infinity;
}

// "익명시, 샘 플 동 산 7-1" 처럼 흩어진 한글을 붙여 소재지를 만든다.
// 여러 글자 낱말(익명시)과 한 글자씩 끊긴 낱말(샘/플/동)을 따로 모아 합친다.
// 지번은 소재지 아래 줄에 오기도 해서 지번 x 를 경계로 쓰면 동 이름이 잘려 나간다.
function assembleAddress(row, boundaryX, options = {}) {
  const excludeX = Number.isFinite(options.excludeX) ? options.excludeX : null;
  const multi = [];
  let singles = '';
  row.words
    .filter((word) => word.x0 < boundaryX)
    .slice()
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    .forEach((word) => {
      const token = word.text.replace(/[,.\s]/g, '');
      if (!HANGUL.test(token)) return;
      if (token === '산') return;
      if (excludeX !== null && Math.abs(word.x0 - excludeX) < 1) return;
      if (token.length === 1) { singles += token; return; }
      multi.push(token);
    });
  return [...multi, singles].filter(Boolean).join(' ').trim();
}

const LOT_IN_ADDRESS = /(?:^|\s)((?:산)?\d{1,5}(?:-\d{1,5})?)(?:번지)?(?=\s|$)/;

/**
 * 스캔본의 소재지는 한 글자씩 끊겨 들어와 "샘플동"이 "플샘동"·"임동샘플"처럼 뒤엉킨다.
 * 그 글자를 재배열해 동 이름을 지어내는 것은 추정이다. 대신 이미 사람이 확인한 케이스
 * 안의 필지 중 "지번과 면적이 똑같은 것"이 하나뿐이면 그 필지의 소재지·지목을 그대로
 * 가져다 쓰고 출처를 남긴다. 값을 만들지 않고 기존 행에 잇기만 한다.
 */
function reconcileWithKnownLands(lot, area, knownLands) {
  if (!lot || area === null || !Array.isArray(knownLands) || knownLands.length === 0) return null;
  const matches = knownLands.filter((land) => {
    if (!land) return false;
    const landArea = Number(land.area);
    if (!Number.isFinite(landArea) || Math.abs(landArea - area) > 0.5) return false;
    const found = String(land.parcel_address || '').match(LOT_IN_ADDRESS);
    return Boolean(found) && found[1] === lot;
  });
  return matches.length === 1 ? matches[0] : null;
}

// 동·리 이름이 살아 있는 쪽을 쓴다. 둘 다 없으면 더 긴 쪽.
function preferAddress(a, b) {
  const hasDong = (value) => /(동|리|읍|면)$/.test(String(value || '').split(/\s+/).pop() || '');
  if (hasDong(a) && !hasDong(b)) return a;
  if (hasDong(b) && !hasDong(a)) return b;
  return (String(a || '').length >= String(b || '').length) ? a : b;
}

function findRowLot(row, boundaryX) {
  const candidates = row.words
    .filter((word) => word.x0 < boundaryX)
    .map((word) => ({ word, read: readLot(word.text) }))
    .filter((entry) => entry.read.value);
  if (candidates.length === 0) return null;
  // '산' 과 '3-1' 이 따로 잡히면 붙여 준다.
  const mountain = row.words.find((word) => word.text.replace(/[\s,.]/g, '') === '산' && word.x0 < boundaryX);
  const withHyphen = candidates.find((entry) => entry.read.value.includes('-')) || candidates[candidates.length - 1];
  const lot = withHyphen.read.value;
  const value = (mountain && !lot.startsWith('산') && mountain.x0 < withHyphen.word.x0) ? `산${lot}` : lot;
  return { value, x: withHyphen.word.x0 };
}

function readRoleValues(cells, roles, schema) {
  const values = {};
  const statuses = {};
  Object.entries(roles).forEach(([role, index]) => {
    const domain = schema.domains[role];
    if (!domain) return;
    const cell = cells[index];
    const result = readCellNumber(cell ? cell.text : '', domain);
    values[role] = result.value;
    statuses[role] = result.status;
  });
  return { values, statuses };
}

function collectTables(pages) {
  const tables = [];
  let lastType = null;
  (Array.isArray(pages) ? pages : []).forEach((page) => {
    sliceTables(page).forEach((slice) => {
      const type = slice.continuation ? lastType : slice.table_type;
      if (!slice.continuation) lastType = slice.table_type;
      if (!type || !TABLE_SCHEMA[type]) return;
      const table = reconstructTable(slice, { tableType: type });
      if (table.rows.length === 0) return;
      const { roles, warnings } = assignColumnRoles(type, table.value_columns, {
        rows: table.rows,
        columns: table.columns,
      });
      tables.push({ ...table, roles, role_warnings: warnings });
    });
  });
  return tables;
}

function extractRegisterRows(tables) {
  const schema = TABLE_SCHEMA[TABLE_TYPES.LAND_REGISTER];
  const out = [];
  tables.filter((table) => table.table_type === TABLE_TYPES.LAND_REGISTER).forEach((table) => {
    table.rows.forEach((row) => {
      const { cells } = assignRowToColumns(row, table.columns);
      const boundary = firstValueX(row, table.columns, table.roles);
      const lot = findRowLot(row, boundary);
      const { values, statuses } = readRoleValues(cells, table.roles, schema);
      // 현황 꼬리표는 행 아래쪽 보조 band 에 있고 그 사이에 소유자명이 끼어든다.
      // band 별로 한글만 이어 붙여 '현황' 이 붙어 있는 곳에서만 읽는다.
      let useStatus = null;
      (row.bands || []).forEach((band) => {
        if (useStatus) return;
        const korean = band.words.map((word) => word.text.replace(/[^가-힣]/g, '')).join('');
        const found = korean.match(USE_STATUS_PATTERN);
        if (found) useStatus = found;
      });
      const categoryWord = row.words.find((word) => /^[가-힣]$/.test(word.text)
        && word.x0 > (lot ? lot.x : 0) && word.x0 < (table.columns[table.roles.area] || { x: Infinity }).x);
      out.push({
        source: 'LAND_REGISTER',
        page_no: table.page_no,
        lot: lot ? lot.value : null,
        address: assembleAddress(row, (table.columns[table.roles.area] || { x: boundary }).x, { excludeX: lot ? lot.x : null }),
        land_category: categoryWord ? categoryWord.text : '',
        area: values.area,
        unit_price: values.unit_price,
        amount: values.amount,
        use_status: useStatus ? useStatus[1] : '',
        statuses,
      });
    });
  });
  return out;
}

function extractCalcRows(tables) {
  const schema = TABLE_SCHEMA[TABLE_TYPES.LAND_PRICE_CALC];
  const out = [];
  tables.filter((table) => table.table_type === TABLE_TYPES.LAND_PRICE_CALC).forEach((table) => {
    const officialColumn = table.columns[table.roles.official_price];
    table.rows.forEach((row) => {
      const { cells } = assignRowToColumns(row, table.columns);
      const boundary = officialColumn ? officialColumn.x : firstValueX(row, table.columns, table.roles);
      const lot = findRowLot(row, boundary);
      const { values, statuses } = readRoleValues(cells, table.roles, schema);
      const symbolWord = row.words
        .filter((word) => officialColumn && word.x1 <= officialColumn.x && word.x0 > officialColumn.x - 70)
        .map((word) => readStandardSymbol(word.text))
        .filter((result) => result.value);
      out.push({
        source: 'LAND_PRICE_CALC',
        page_no: table.page_no,
        lot: lot ? lot.value : null,
        address: assembleAddress(row, boundary, { excludeX: lot ? lot.x : null }),
        standard_land_symbol: symbolWord.length === 1 ? symbolWord[0].value : '',
        ...values,
        statuses,
        role_warnings: table.role_warnings,
      });
    });
  });
  return out;
}

// 토지조서와 산출표는 같은 5행이다. 적용단가로 짝을 맞춘다. 값이 유일할 때만 붙인다.
// 토지조서와 산출표는 같은 표의 같은 행이다. 행 수가 같으면 문서 순서가 곧 짝이다.
// 행 수가 다르면 순서를 믿을 수 없으므로 적용단가가 유일하게 일치할 때만 붙인다.
function pairRegisterAndCalc(registerRows, calcRows) {
  if (registerRows.length && registerRows.length === calcRows.length) {
    return registerRows.map((register, index) => ({ register, calc: calcRows[index], paired_by: 'DOCUMENT_ORDER' }));
  }
  const used = new Set();
  return registerRows.map((register) => {
    if (register.unit_price === null) return { register, calc: null, paired_by: null };
    const hits = calcRows
      .map((calc, index) => ({ calc, index }))
      .filter((entry) => !used.has(entry.index) && entry.calc.applied_unit_price === register.unit_price);
    if (hits.length !== 1) return { register, calc: null, paired_by: null };
    used.add(hits[0].index);
    return { register, calc: hits[0].calc, paired_by: 'APPLIED_UNIT_PRICE' };
  });
}

function crossCheckUnitPrices(calc, flags) {
  if (!calc) return null;
  const applied = calc.applied_unit_price;
  const calculated = calc.calculated_unit_price;
  if (applied === null || calculated === null) return calculated;
  const drift = Math.abs(calculated - applied) / applied;
  if (drift <= UNIT_PRICE_TOLERANCE) return calculated;
  flags.push(`CALCULATED_UNIT_PRICE_DRIFT_${Math.round(drift * 100)}PCT`);
  return null;
}

function crossCheckAmount(area, unitPrice, amount, flags) {
  if (area === null || unitPrice === null || amount === null) return;
  const expected = area * unitPrice;
  if (expected === 0) return;
  const drift = Math.abs(expected - amount) / amount;
  if (drift > 0.01) flags.push(`AMOUNT_DOES_NOT_MATCH_AREA_TIMES_UNIT_PRICE_${Math.round(drift * 100)}PCT`);
}

/**
 * 스캔 페이지(word bbox 포함) → canonical lands / land_appraisal_results 후보.
 * 값이 확정되지 않은 칸은 null 로 두고 flag 를 남긴다. 자동확정은 어디서도 하지 않는다.
 */
function buildScanCaseCandidates(pages, context = {}) {
  const appraisalId = context.appraisalId || 'APP_SCAN_001';
  const tables = collectTables(pages);
  const registerRows = extractRegisterRows(tables);
  const calcRows = extractCalcRows(tables);
  const paired = pairRegisterAndCalc(registerRows, calcRows);

  const lands = [];
  const results = [];
  paired.forEach(({ register, calc, paired_by: pairedBy }, index) => {
    const flags = [];
    if (!register.lot) flags.push('LOT_UNREADABLE');
    if (!register.land_category) flags.push('LAND_CATEGORY_UNREADABLE');
    if (register.area === null) flags.push('AREA_UNREADABLE');
    if (!calc) flags.push('CALC_ROW_NOT_PAIRED');
    else if (pairedBy === 'DOCUMENT_ORDER') flags.push('CALC_ROW_PAIRED_BY_DOCUMENT_ORDER');
    if (calc && calc.lot && register.lot && calc.lot !== register.lot) {
      flags.push(`LOT_MISMATCH_${calc.lot}_VS_${register.lot}`);
    }

    // 지번은 산출표 쪽이 붙임표까지 살아 있는 경우가 많다. 두 값이 다르면 붙임표가 있는 쪽을 쓰되
    // 반드시 flag 를 남긴다.
    const lot = (calc && calc.lot && calc.lot.includes('-')) ? calc.lot : register.lot;
    const reconciled = reconcileWithKnownLands(lot, register.area, context.knownLands);
    if (reconciled) flags.push('RECONCILED_FROM_EXISTING_LAND');
    const scanAddress = [preferAddress(register.address, calc ? calc.address : ''), lot].filter(Boolean).join(' ').trim();
    // 대조된 필지가 있으면 그 소재지·지목을 쓴다. 없으면 지번만 남기고 동 이름은 비운다.
    const address = reconciled ? String(reconciled.parcel_address || '') : (lot || '');
    if (!reconciled) flags.push('ADDRESS_DONG_UNRESOLVED');
    const category = reconciled
      ? String(reconciled.land_category || register.land_category || '')
      : (register.land_category || '');
    const landId = `SCAN_LAND_${String(index + 1).padStart(3, '0')}`;

    const calculatedUnitPrice = crossCheckUnitPrices(calc, flags);
    const unitPrice = register.unit_price !== null
      ? register.unit_price
      : (calc ? calc.applied_unit_price : null);
    if (register.unit_price !== null && calc && calc.applied_unit_price !== null
      && register.unit_price !== calc.applied_unit_price) {
      flags.push('UNIT_PRICE_DISAGREES_BETWEEN_TABLES');
    }
    crossCheckAmount(register.area, unitPrice, register.amount, flags);

    lands.push({
      land_id: landId,
      land_no: null,
      serial_no: null,
      parcel_address: address,
      land_category: category,
      area: register.area,
      appraisal_use_status: register.use_status || '',
      use_note: register.use_status ? `(현황 ${register.use_status})` : '',
      scan_ocr_address: scanAddress,
      input_origin: 'SCAN_TABLE_RECOVERY',
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      scan_flags: flags.filter((flag) => /LOT|CATEGORY|AREA|ADDRESS|RECONCILED/.test(flag)),
      parser_notes: '이미지 스캔 평가서의 표를 좌표로 복원한 후보입니다. 확정값이 아니며 원문 대조가 필요합니다.',
    });

    results.push({
      appraisal_result_id: `SCAN_LAR_${String(index + 1).padStart(3, '0')}`,
      appraisal_id: appraisalId,
      land_id: landId,
      parcel_address: address,
      land_category: category,
      area: register.area,
      standard_land_symbol: calc ? calc.standard_land_symbol : '',
      official_price: calc ? calc.official_price : null,
      time_correction: calc ? calc.time_correction : null,
      regional_factor: calc ? calc.regional_factor : null,
      individual_factor_total: calc ? calc.individual_factor_total : null,
      other_factor: calc ? calc.other_factor : null,
      calculated_unit_price: calculatedUnitPrice,
      unit_price: unitPrice,
      amount: register.amount,
      input_origin: 'SCAN_TABLE_RECOVERY',
      scan_flags: flags,
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      confidence_level: 'LOW',
      parser_notes: '이미지 스캔 평가서의 토지조서·토지가격 산출근거를 좌표로 복원해 연결한 후보입니다. 값을 새로 계산하지 않았으며 수동 검수 필요.',
    });
  });

  return {
    lands,
    land_appraisal_results: results,
    tables: tables.map((table) => ({
      table_type: table.table_type,
      page_no: table.page_no,
      row_count: table.rows.length,
      roles: table.roles,
      role_warnings: table.role_warnings,
    })),
  };
}

module.exports = {
  assembleAddress,
  buildScanCaseCandidates,
  collectTables,
  extractCalcRows,
  extractRegisterRows,
  pairRegisterAndCalc,
};
