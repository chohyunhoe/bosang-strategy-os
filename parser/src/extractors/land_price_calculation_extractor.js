'use strict';

const { createParserSourceRef } = require('../source_refs');
const { normalizeParcelAddress, looksLikeParcelAddress } = require('./land_appraisal_results_extractor');

// 「2. 토지가격 산출」 / 「마. 토지가액 산출근거」 표는 법인마다 컬럼 수가 다르다.
//
//   A법인: 101 가 200,000 1.10000 1.00 0.700 4.50 693,000 693,000
//   B법인: 101 익명시 샘플동 10-1 대 A 200,000 1.10000 1.00 0.98 … 0.700 4.50 693,000 693,000
//
// 공통 골격은 두 곳뿐이다.
//   (1) 표준지기호 → 공시지가 → 시점수정 이 이 순서로 붙어 있고,
//   (2) 행 끝의 숫자 네 개가 개별요인 누계 → 그 밖의 요인 → 산출단가 → 적용단가 다.
// 가운데 개별요인 세부 컬럼은 법인마다 개수가 다르고 '-' 로 비워지므로 세지 않는다.
const SECTION_LABEL = '토지가액 산출근거';

const SEQUENCE_PATTERN = /^(?:\d{1,5}(?:-\d{1,3})?)$/;
const SYMBOL_PATTERN = /^[A-Za-z가-힣]{1,2}$/;
const GROUPED_INTEGER_PATTERN = /^\d{1,3}(?:,\d{3})+$|^\d{4,12}$/;
const DECIMAL_PATTERN = /^\d+\.\d+$/;

const MAX_ROW_SPAN = 3;

function parseNumber(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function isFactor(value) {
  return value !== null && value > 0 && value <= 3;
}

// 표준지기호 → 공시지가 → 시점수정 삼각 앵커. 개별요인 상세내역 표도 "기호 공시지가 계수…"
// 로 시작하지만 행 끝 숫자가 단가가 아니라 요인값이므로 뒤쪽 검증에서 걸러진다.
function findAnchorIndex(tokens) {
  for (let index = 2; index < tokens.length; index += 1) {
    if (!DECIMAL_PATTERN.test(tokens[index])) continue;
    if (!GROUPED_INTEGER_PATTERN.test(tokens[index - 1])) continue;
    if (!SYMBOL_PATTERN.test(tokens[index - 2])) continue;
    const timeCorrection = parseNumber(tokens[index]);
    const officialPrice = parseNumber(tokens[index - 1]);
    if (timeCorrection === null || timeCorrection < 0.5 || timeCorrection > 5) continue;
    if (officialPrice === null || officialPrice < 100) continue;
    return index;
  }
  return -1;
}

function parseCalculationRowText(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  if (tokens.length < 6) return null;
  if (!SEQUENCE_PATTERN.test(tokens[0])) return null;
  if (/(합\s*계|평가총액|일련번호|산출단가|적용단가|산정단가)/.test(text)) return null;

  const anchorIndex = findAnchorIndex(tokens);
  if (anchorIndex < 2) return null;

  const tailTokens=tokens.slice(anchorIndex+1),firstText=tailTokens.findIndex(token=>parseNumber(token)===null);
  const prefix=firstText<0?tailTokens:tailTokens.slice(0,firstText);
  // A complete numeric column run followed by a remarks cell keeps its order.
  // Text interleaved among factors remains ambiguous under the old fallback.
  const contiguous=prefix.length===11&&prefix.slice(0,8).map(parseNumber).every(isFactor)
    &&parseNumber(prefix[8])>=.5&&parseNumber(prefix[8])<=30&&parseNumber(prefix[9])>=100&&parseNumber(prefix[10])>=100
    &&(firstText<0||!tailTokens.slice(firstText).some(token=>parseNumber(token)!==null));
  const trailing = (contiguous?prefix:tailTokens).map(parseNumber).filter((value) => value !== null);
  if (trailing.length < 5) return null;

  const appliedUnitPrice = trailing[trailing.length - 1];
  const calculatedUnitPrice = trailing[trailing.length - 2];
  const otherFactor = trailing[trailing.length - 3];
  const individualFactorTotal = trailing[trailing.length - 4];
  const regionalFactor = trailing[0];
  // Long explanatory cells interleaved by OCR destroy the positional meaning
  // of the two factor columns. Preserve the directly read price pair only.
  const factorColumnsAmbiguous = !contiguous&&(tokens.slice(anchorIndex+1,-2).join(' ').match(/[가-힣]/g)||[]).length>=20;

  if (!(appliedUnitPrice >= 100 && calculatedUnitPrice >= 100)) return null;
  if (!isFactor(individualFactorTotal)) return null;
  if (!(otherFactor >= 0.5 && otherFactor <= 30)) return null;
  if (!isFactor(regionalFactor)) return null;

  let identity={};
  for(let i=2;i<anchorIndex-2;i++){
    if(!/^(?:산)?\d{1,5}(?:-\d{1,5})?$/.test(tokens[i]))continue;
    const address=normalizeParcelAddress(tokens.slice(1,i+1).join(' ')),area=parseNumber(tokens[i+1]);
    if(looksLikeParcelAddress(address)&&area>0){identity={parcel_address:address,area};break;}
  }
  return {
    ...identity,
    land_no: tokens[0],
    standard_land_symbol: tokens[anchorIndex - 2],
    official_price: parseNumber(tokens[anchorIndex - 1]),
    time_correction: parseNumber(tokens[anchorIndex]),
    regional_factor: regionalFactor,
    ...(trailing.length === 11 && (contiguous||tokens.slice(anchorIndex + 1).every(token => parseNumber(token) !== null))
      && trailing.slice(1, 7).every(isFactor) ? { explicit_six_factors: trailing.slice(1, 7) } : {}),
    individual_factor_total: factorColumnsAmbiguous ? null : individualFactorTotal,
    other_factor: factorColumnsAmbiguous ? null : otherFactor,
    ...(factorColumnsAmbiguous ? {factor_columns_ambiguous:true} : {}),
    calculated_unit_price: calculatedUnitPrice,
    unit_price: appliedUnitPrice,
  };
}

function extractCalculationRows(lines) {
  const rows = new Map();
  lines.forEach((line, index) => {
    if (!SEQUENCE_PATTERN.test(String(line.normalized_text || '').trim().split(/\s+/)[0] || '')) return;
    for (let span = 1; span <= MAX_ROW_SPAN && index + span <= lines.length; span += 1) {
      const groupLines = lines.slice(index, index + span);
      if (groupLines.some((groupLine) => groupLine.page_no !== line.page_no)) break;
      // 다음 행의 연번을 넘어서 묶으면, 파싱되지 않은 행이 뒤 행의 수치와 비교표준지 기호를
      // 자기 것으로 가져간다. 연번이 새로 시작하면 거기서 끊는다.
      if (span > 1 && SEQUENCE_PATTERN.test(String(groupLines[span - 1].normalized_text || '').trim().split(/\s+/)[0] || '')) break;
      const parsed = parseCalculationRowText(groupLines.map((groupLine) => groupLine.normalized_text).join(' '));
      if (parsed) {
        // 같은 일련번호가 여러 표에 나오면 첫 후보만 유지하고 중복은 버린다.
        if (!rows.has(parsed.land_no)) rows.set(parsed.land_no, { parsed, lines: groupLines });
        break;
      }
    }
  });
  return rows;
}

function sourceRefFor(groupLines, context) {
  const first = groupLines[0];
  const last = groupLines[groupLines.length - 1];
  return createParserSourceRef({
    appraisalId: context.appraisalId || 'APP_001',
    fileName: context.fileName || null,
    pageNo: first.page_no,
    lineStart: first.line_no,
    lineEnd: last.line_no,
    sourceLabel: SECTION_LABEL,
    rawTextExcerpt: groupLines.map((line) => line.raw_text).join(' / '),
  });
}

const ENRICHED_FIELDS = Object.freeze([
  'standard_land_symbol',
  'official_price',
  'time_correction',
  'individual_factor_total',
  'other_factor',
  'calculated_unit_price',
  'unit_price',
]);

// 일련번호로 연결하며, 번호 체계가 다르면 완전하고 동일한 지분 그룹의
// 공통 기재값만 아래 조건에 따라 연결한다.
function attachLandPriceCalculations(lines, appraisalResults, context = {}) {
  const results = Array.isArray(appraisalResults) ? appraisalResults : [];
  const lands = Array.isArray(context.lands) ? context.lands : [];
  if (results.length === 0 || lands.length === 0) return results;

  const rows = extractCalculationRows(lines);
  if (rows.size === 0) return results;

  return results.map((result) => {
    const land=lands.find(land=>land.land_id===result.land_id);
    if(!land)return result;
    // land_no is the row's first token, which may be a member number. Only an
    // explicitly identified serial column may join a member-bearing statement.
    const landNo = String((land.ownership_identity_status || land.member_no
      ? land.statement_serial_no : land.land_no) || '');
    let row = landNo ? rows.get(landNo) : null;
    if(row && ((row.parsed.parcel_address && row.parsed.parcel_address!==normalizeParcelAddress(land.parcel_address))
      || (row.parsed.area && row.parsed.area!==Number(land.area))
      || (result.unit_price!=null && row.parsed.unit_price!==result.unit_price))) row=null;
    let groupRows=null;
    if(!row){
      const address=normalizeParcelAddress(land.parcel_address),area=Number(land.area);
      const matching=[...rows.values()].filter(candidate=>candidate.parsed.parcel_address===address&&candidate.parsed.area===area);
      const subjects=lands.filter(candidate=>normalizeParcelAddress(candidate.parcel_address)===address&&Number(candidate.area)===area);
      const vector=candidate=>JSON.stringify([...ENRICHED_FIELDS,'regional_factor','explicit_six_factors'].map(field=>candidate.parsed[field]));
      const complete=candidate=>ENRICHED_FIELDS.concat('regional_factor').every(field=>candidate.parsed[field]!==null&&candidate.parsed[field]!==undefined&&candidate.parsed[field]!=='');
      // No owner/order correspondence is inferred: every source row in this
      // location/area group must have the same complete vector, and group sizes
      // and all directly stated unit prices must agree.
      if(matching.length&&matching.length===subjects.length&&matching.every(complete)
        &&matching.every(candidate=>vector(candidate)===vector(matching[0]))
        &&subjects.every(subject=>results.some(r=>r.land_id===subject.land_id&&r.unit_price===matching[0].parsed.unit_price))){
        row=matching[0];groupRows=matching;
      }
    }
    if (!row) return result;

    // 산출표는 산출단가와 적용단가를 따로 적는 유일한 표다. 토지조서만 있을 때는
    // 단가 한 칸을 두 필드에 함께 넣어 두므로, 산출표가 있으면 그 기재값으로 덮어쓴다.
    const enriched = { ...result, regional_factor: row.parsed.regional_factor };
    for (const field of ENRICHED_FIELDS) {
      const value = row.parsed[field];
      if (value === null || value === undefined || value === '') continue;
      enriched[field] = value;
    }

    const calculationRefs=(groupRows||[row]).map(candidate=>sourceRefFor(candidate.lines,context)).filter(Boolean);
    const headers = lines.filter(line => line.page_no === row.lines[0].page_no && line.line_no < row.lines[0].line_no);
    const orderedHeader=headers.find(line=>(line.normalized_text.match(/가로|접근|환경|획지|행정|기타|(?<![가-힣])계(?![가-힣])/g)||[]).join(' ')==='가로 접근 환경 획지 행정 기타 계');
    if (row.parsed.explicit_six_factors && orderedHeader) {
      const detailRefs = [...calculationRefs, sourceRefFor([orderedHeader],context)].filter(Boolean);
      enriched.individual_factor_details = ['가로조건', '접근조건', '환경조건', '획지조건', '행정적조건', '기타조건']
        .map((category, index) => ({ category, item: category, factor_value: row.parsed.explicit_six_factors[index],
          source_refs: detailRefs, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }));
    }
    const sourceRefs = [...(enriched.source_refs || []), ...calculationRefs, ...(land.member_no_source_refs || [])];
    const missingFields = ENRICHED_FIELDS
      .concat(['amount'])
      .filter((field) => enriched[field] === null || enriched[field] === undefined || enriched[field] === '');

    return {
      ...enriched,
      calculation_link_method:groupRows?'IDENTICAL_OWNERSHIP_GROUP_VALUES':'EXPLICIT_ROW_NUMBER',
      source_refs: sourceRefs,
      missing_fields: missingFields,
      confidence_level: sourceRefs.length === 0 ? 'LOW' : (missingFields.length === 0 ? 'HIGH' : 'MEDIUM'),
      parser_notes: `${enriched.parser_notes || ''}${row.parsed.factor_columns_ambiguous ? ' OCR 설명 셀이 섞여 개별요인·그 밖의 요인 열은 연결하지 않았습니다. 원문 검수 필요.' : ''} ${groupRows?'같은 소재지·지분면적의 모든 산출행에서 계수·단가가 동일하고 행 수와 조서 단가가 일치하여 공통 기재값을 연결했습니다. 소유자별 연번 대응을 추정하지 않았습니다.':'토지가격 산출표의 일련번호로 기재값을 연결했습니다.'} 단가를 새로 계산하지 않았으며 수동 검수 필요.`.trim(),
    };
  });
}

module.exports = {
  SECTION_LABEL,
  attachLandPriceCalculations,
  extractCalculationRows,
  parseCalculationRowText,
};
