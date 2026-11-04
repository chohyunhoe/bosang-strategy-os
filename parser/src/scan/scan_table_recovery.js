'use strict';

// 스캔 평가서에서 "표 4종"만 좌표로 되살린다. 문서 전체 레이아웃 엔진이 아니다.
//   LAND_PRICE_CALC  토지가격 산출근거
//   LAND_REGISTER    토지조서
//   INDIVIDUAL_FACTOR 개별요인표
//   STANDARD_LAND    비교표준지
//
// 헤더 글자는 괘선과 섞여 심하게 깨지므로("Cx 적용공시지가 Ln 지역 )") 헤더 텍스트만으로
// 컬럼 역할을 정할 수 없다. 대신
//   (1) 표 종류는 섹션 제목으로 확정하고,
//   (2) 컬럼 역할은 그 표의 고정 컬럼 순서를 좌우 끝에서부터 값 도메인으로 맞춰 채운다.
// 도메인에 맞지 않으면 그 칸은 채우지 않고 닫는다.

const { assignRowToColumns, bandText, buildBands, buildColumns, estimateRowPitch, mergeExclusiveColumns, seedRowsFromAnchorBands } = require('./ocr_layout');
const { readNumber, readLot, readStandardSymbol } = require('./scan_value');

const TABLE_TYPES = Object.freeze({
  LAND_PRICE_CALC: 'LAND_PRICE_CALC',
  LAND_REGISTER: 'LAND_REGISTER',
  INDIVIDUAL_FACTOR: 'INDIVIDUAL_FACTOR',
  STANDARD_LAND: 'STANDARD_LAND',
});

// 섹션 제목. 괘선 글자가 섞여도 잡히도록 공백을 허용한다.
const SECTION_PATTERNS = Object.freeze([
  { type: TABLE_TYPES.LAND_PRICE_CALC, pattern: /토\s*지\s*가\s*격\s*산\s*출\s*근\s*거|토\s*지\s*가\s*액\s*산\s*출\s*근\s*거/ },
  { type: TABLE_TYPES.LAND_REGISTER, pattern: /토\s*지\s*조\s*서/ },
  { type: TABLE_TYPES.INDIVIDUAL_FACTOR, pattern: /개\s*별\s*요\s*인\s*(?:비\s*교|상\s*세\s*내\s*역|표)/ },
  { type: TABLE_TYPES.STANDARD_LAND, pattern: /비\s*교\s*표\s*준\s*지/ },
]);

// 표별 고정 컬럼 순서와 각 칸의 값 도메인.
// tail 은 오른쪽 끝에서부터 반드시 이 순서로 나타나야 하는 칸이다.
const TABLE_SCHEMA = Object.freeze({
  [TABLE_TYPES.LAND_PRICE_CALC]: {
    anchor_domain: 'price',
    tail: ['applied_unit_price', 'calculated_unit_price', 'other_factor', 'individual_factor_total'],
    head: ['official_price', 'time_correction', 'regional_factor'],
    middle: ['street', 'access', 'environment', 'parcel_shape', 'administrative', 'etc'],
    domains: {
      official_price: 'price',
      time_correction: 'time_correction',
      regional_factor: 'factor',
      street: 'factor',
      access: 'factor',
      environment: 'factor',
      parcel_shape: 'factor',
      administrative: 'factor',
      etc: 'factor',
      individual_factor_total: 'factor',
      other_factor: 'other_factor',
      calculated_unit_price: 'price',
      applied_unit_price: 'price',
    },
  },
  [TABLE_TYPES.LAND_REGISTER]: {
    anchor_domain: 'amount',
    tail: ['amount', 'unit_price', 'area'],
    head: [],
    middle: [],
    domains: { area: 'area', unit_price: 'price', amount: 'amount' },
  },
});

// 개별요인 "사유" 문장 안에도 '비교표준지' 같은 말이 계속 나온다. 문장 속 한 마디를
// 표 제목으로 오인하면 페이지가 가짜 섹션으로 잘게 쪼개진다. 그래서 제목은
// (1) 짧은 머리글이고 (2) 서술 문장이 아닐 때만 인정한다.
const HEADING_MAX_WORDS = 8;
const NARRATIVE_PATTERN = /(대상물건|열등|우세|참작|하였음|기준으로|등에서|비교하여|산정함)/;

function sectionTypeFor(text, options = {}) {
  const value = String(text || '').trim();
  if (!value) return null;
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  if (options.headingOnly !== false) {
    if (wordCount > HEADING_MAX_WORDS) return null;
    if (NARRATIVE_PATTERN.test(value)) return null;
  }
  const found = SECTION_PATTERNS.find((entry) => entry.pattern.test(value));
  return found ? found.type : null;
}

// 같은 지번 칸에 값이 둘 다 있으면 다른 행이다. 지번/면적 칸을 anchor 로 쓴다.
function makeAnchorAt(columns, anchorColumns) {
  const set = new Set(anchorColumns);
  return (word) => {
    let best = -1;
    let bestDistance = Infinity;
    columns.forEach((column, index) => {
      const distance = Math.abs(column.x - word.x0);
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });
    if (best < 0 || bestDistance > 24 || !set.has(best)) return null;
    if (!/\d/.test(word.text)) return null;
    return `col_${best}`;
  };
}

// 숫자가 하나라도 있으면 값 칸으로 보면 "샘 익명시, 10-1 플" 같은 소재지 칸까지
// 값 칸이 되어 공시지가 자리가 통째로 밀린다. 글자 대비 숫자가 우세한 칸만 값 칸으로 본다.
function isNumericDominant(text) {
  const compact = String(text || '').replace(/\s/g, '');
  if (!compact) return false;
  const digits = (compact.match(/[\d.,]/g) || []).length;
  return digits * 2 >= compact.length;
}

function numericColumnIndexes(rows, columns) {
  const counts = columns.map(() => 0);
  rows.forEach((row) => {
    const { cells } = assignRowToColumns(row, columns);
    cells.forEach((cell, index) => {
      if (cell && /\d/.test(cell.text) && isNumericDominant(cell.text)) counts[index] += 1;
    });
  });
  // 데이터 행의 3분의 1 이상에서 숫자가 나오면 값 칸으로 본다.
  // 스캔본은 행마다 인식 실패가 섞이므로 과반을 요구하면 표 전체가 통째로 날아간다.
  const threshold = Math.max(1, Math.ceil(rows.length / 2));
  return counts.reduce((acc, count, index) => {
    if (count >= threshold) acc.push(index);
    return acc;
  }, []);
}

// 한 열의 값들이 그 도메인으로 읽히는지 데이터 행 전체에서 확인한다.
function columnFitsDomain(rows, columns, columnIndex, domain, minHits) {
  let hits = 0;
  let misses = 0;
  rows.forEach((row) => {
    const { cells } = assignRowToColumns(row, columns);
    const cell = cells[columnIndex];
    if (!cell || !/\d/.test(cell.text)) return;
    if (readNumber(cell.text, domain).value !== null) hits += 1;
    else misses += 1;
  });
  return hits >= (minHits === undefined ? 1 : minHits) && hits > misses;
}

/**
 * 컬럼 역할을 오른쪽 끝에서부터 확정하고, 공시지가는 "왼쪽에서 처음으로 단가 도메인에
 * 맞는 칸"으로 잡는다. 지번 칸에도 숫자가 있어서 왼쪽부터 순서대로 밀어 넣으면
 * 지번이 공시지가로 둔갑한다.
 */
function assignColumnRoles(tableType, valueColumns, context = {}) {
  const schema = TABLE_SCHEMA[tableType];
  if (!schema) return { roles: {}, warnings: ['NO_SCHEMA'] };
  const rows = context.rows || [];
  const columns = context.columns || [];
  const fits = (index, domain) => (rows.length && columns.length
    ? columnFitsDomain(rows, columns, index, domain)
    : true);

  const roles = {};
  const warnings = [];
  const available = [...valueColumns];

  schema.tail.forEach((role) => {
    const domain = schema.domains[role];
    let index;
    while (available.length) {
      const candidate = available.pop();
      if (fits(candidate, domain)) { index = candidate; break; }
      warnings.push(`SKIPPED_COLUMN_${candidate}_FOR_${role.toUpperCase()}`);
    }
    if (index === undefined) { warnings.push(`MISSING_${role.toUpperCase()}`); return; }
    roles[role] = index;
  });

  if (schema.head.length) {
    const [firstRole, ...restHead] = schema.head;
    let anchor;
    while (available.length) {
      const candidate = available.shift();
      if (fits(candidate, schema.domains[firstRole])) { anchor = candidate; break; }
    }
    if (anchor === undefined) {
      warnings.push(`MISSING_${firstRole.toUpperCase()}`);
    } else {
      roles[firstRole] = anchor;
      restHead.forEach((role) => {
        const index = available.shift();
        if (index === undefined) { warnings.push(`MISSING_${role.toUpperCase()}`); return; }
        if (!fits(index, schema.domains[role])) {
          warnings.push(`DOMAIN_MISMATCH_${role.toUpperCase()}`);
          return;
        }
        roles[role] = index;
      });
    }
  }

  if (schema.middle.length) {
    if (available.length === schema.middle.length) {
      schema.middle.forEach((role, offset) => { roles[role] = available[offset]; });
    } else if (available.length > 0) {
      // 개별요인 세부 칸 수가 스키마와 다르면 어떤 조건이 비었는지 확정할 수 없다.
      warnings.push(`INDIVIDUAL_FACTOR_COLUMN_COUNT_${available.length}_EXPECTED_${schema.middle.length}`);
    }
  }
  return { roles, warnings };
}

function readCell(cells, index, domain) {
  if (index === undefined || index < 0) return { value: null, status: 'MISSING', raw: '' };
  const cell = cells[index];
  if (!cell) return { value: null, status: 'MISSING', raw: '' };
  return readNumber(cell.text, domain);
}

function cellText(cells, index) {
  if (index === undefined || index < 0) return '';
  const cell = cells[index];
  return cell ? cell.text : '';
}

// 지번은 값 칸 왼쪽의 텍스트 칸들에 흩어져 들어온다. 행 전체에서 지번 꼴을 찾는다.
function findLot(row, firstValueX) {
  const candidates = row.words
    .filter((word) => word.x0 < firstValueX)
    .map((word) => readLot(word.text))
    .filter((result) => result.value);
  if (candidates.length === 0) return { value: null, status: 'UNREADABLE', reason: 'NO_LOT_TOKEN' };
  const withHyphen = candidates.find((result) => result.value.includes('-'));
  return withHyphen || candidates[candidates.length - 1];
}

function findStandardSymbol(row, officialPriceX) {
  if (!Number.isFinite(officialPriceX)) return { value: null, status: 'MISSING' };
  const left = row.words
    .filter((word) => word.x1 <= officialPriceX && word.x0 > officialPriceX - 90)
    .map((word) => readStandardSymbol(word.text))
    .filter((result) => result.value);
  return left.length === 1 ? left[0] : { value: null, status: left.length ? 'AMBIGUOUS' : 'MISSING' };
}

/**
 * 한 페이지에서 표 구간들을 잘라낸다.
 */
function sliceTables(page, options = {}) {
  const { bands } = buildBands(page.words);
  const marks = [];
  bands.forEach((band, index) => {
    const type = sectionTypeFor(bandText(band));
    if (type) marks.push({ type, index, mid_y: band.mid_y });
  });
  const slices = [];
  // 표가 페이지를 넘어가면 다음 장 맨 위에는 제목 없이 나머지 행만 이어진다.
  // 그 구간은 표 종류를 스스로 말하지 못하므로 앞 페이지 표의 계속으로 넘긴다.
  const firstIndex = marks.length ? marks[0].index : bands.length;
  if (firstIndex > 0) {
    slices.push({
      table_type: null,
      continuation: true,
      page_no: page.page_no,
      heading_y: null,
      bands: bands.slice(0, firstIndex),
    });
  }
  marks.forEach((mark, order) => {
    const end = order + 1 < marks.length ? marks[order + 1].index : bands.length;
    slices.push({
      table_type: mark.type,
      continuation: false,
      page_no: page.page_no,
      heading_y: mark.mid_y,
      bands: bands.slice(mark.index + 1, end),
    });
  });
  return slices;
}

/**
 * 잘라낸 표 구간을 행·열로 복원한다. 값 해석은 하지 않고 셀 텍스트까지만 만든다.
 */
function reconstructTable(slice, options = {}) {
  const tableType = options.tableType || slice.table_type;
  const schema = TABLE_SCHEMA[tableType];
  const valueBands = slice.bands.filter((band) => band.words.some((word) => /\d/.test(word.text)));
  if (valueBands.length === 0) {
    return { ...slice, table_type: tableType, rows: [], columns: [], value_columns: [], warnings: ['NO_VALUE_BANDS'] };
  }

  // 1차: 표의 오른쪽 끝 값(적용단가/평가액)이 실린 band 만 데이터 행으로 본다.
  // 페이지 폭으로 오른쪽 구역을 정하면 푸터 문구가 폭을 늘려 기준이 밀린다. 대신
  // "도메인에 맞는 값 중 각 band 의 가장 오른쪽 것"들의 x 를 모아 군집을 만들고,
  // band 를 가장 많이 포함한 군집을 그 표의 앵커 열로 본다.
  const anchorDomain = schema ? schema.anchor_domain : null;
  const rightmostAnchor = (band) => {
    let found = null;
    band.words.forEach((word) => {
      if (readNumber(word.text, anchorDomain).value === null) return;
      if (!found || word.x0 > found.x0) found = word;
    });
    return found;
  };
  let anchorX = null;
  if (anchorDomain) {
    const marksX = valueBands.map(rightmostAnchor).filter(Boolean).map((word) => word.x0);
    const clusters = [];
    marksX.forEach((x) => {
      const cluster = clusters.find((candidate) => Math.abs(candidate.x - x) <= 40);
      if (cluster) { cluster.xs.push(x); cluster.x = cluster.xs.reduce((a, b) => a + b, 0) / cluster.xs.length; return; }
      clusters.push({ x, xs: [x] });
    });
    clusters.sort((a, b) => b.xs.length - a.xs.length || b.x - a.x);
    anchorX = clusters.length ? clusters[0].x : null;
  }
  const isDataBand = (band) => {
    if (anchorX === null) return true;
    const found = rightmostAnchor(band);
    return Boolean(found) && Math.abs(found.x0 - anchorX) <= 40;
  };
  const dataBands = valueBands.filter(isDataBand);

  // 2차: 진짜 데이터 행 사이의 간격으로 행 pitch 를 잡는다. 노이즈 band 까지 넣어 중앙값을
  // 내면 pitch 가 실제의 절반 이하로 작아지고, 소재지·지번이 실린 보조 band 가 본 행에
  // 붙지 못한 채 잘려 나간다.
  const pitch = estimateRowPitch(dataBands.length >= 2 ? dataBands : valueBands);
  const anchors = dataBands.length ? dataBands : valueBands;
  const rows = seedRowsFromAnchorBands(slice.bands, anchors, { rowPitch: pitch });
  const columns = mergeExclusiveColumns(rows, buildColumns(rows, { minRows: 2 }));
  const allRows = rows;
  const valueColumns = numericColumnIndexes(rows, columns);
  return {
    ...slice,
    table_type: tableType,
    rows,
    all_rows: allRows,
    columns,
    value_columns: valueColumns,
    row_pitch: pitch,
    warnings: [],
  };
}

module.exports = {
  SECTION_PATTERNS,
  TABLE_SCHEMA,
  TABLE_TYPES,
  assignColumnRoles,
  cellText,
  findLot,
  findStandardSymbol,
  numericColumnIndexes,
  readCell,
  reconstructTable,
  sectionTypeFor,
  sliceTables,
};
