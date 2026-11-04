import { appraisalResultComplete } from './appraisal-coverage.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value == null ? '' : String(value).trim(); }
// Number(null) 과 Number('') 은 0 이다. 미확인값을 0 으로 바꾸면 "개별요인 누계 0.000" 같은
// 허위 고위험 이슈가 생긴다. 원문에서 읽힌 유한 숫자만 숫자로 본다. 명시된 0 은 0 그대로다.
function number(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function normalizedCategory(value) {
  const token = text(value).replace(/\s+/g, '');
  const aliases = { 임야:'임', 대지:'대', 공장용지:'장', 주차장:'차', 주유소용지:'주', 창고용지:'창', 도로:'도', 철도용지:'철', 학교용지:'학', 종교용지:'종', 체육용지:'체', 유원지:'원', 잡종지:'잡' };
  return aliases[token] || token;
}
function normalizedAddress(value) { return text(value).replace(/\s+/g, ' '); }
function appraiserLabel(row) { return text(row?.appraisal_company) || text(row?.appraisal_id) || '평가법인 확인 필요'; }

function candidate(code, severity, title, description, refs = [], related = {}) {
  return {
    issue_id: `ISSUE_${code}_${Object.values(related).filter(Boolean).join('_') || 'CASE'}`,
    issue_code: code,
    severity,
    title,
    description,
    source_refs: arr(refs),
    related,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
    conclusion: null,
  };
}

function publicRowForLand(state, land) {
  const rows = arr(state.publicLandCharacteristics);
  if (!rows.length || !land) return null;
  const landId = text(land.land_id);
  const pnu = text(land.pnu);
  const address = normalizedAddress(land.parcel_address);
  const byLandId = landId ? rows.filter((row) => text(row.land_id) === landId) : [];
  if (byLandId.length === 1) return byLandId[0];
  const byPnu = pnu ? rows.filter((row) => text(row.pnu) === pnu) : [];
  if (byPnu.length === 1) return byPnu[0];
  const byAddress = address ? rows.filter((row) => normalizedAddress(row.parcel_address || row.address) === address) : [];
  return byAddress.length === 1 ? byAddress[0] : null;
}

function groupResultsByLand(rows) {
  const grouped = new Map();
  for (const row of arr(rows)) {
    if (!row?.land_id) continue;
    const values = grouped.get(row.land_id) || [];
    values.push(row);
    grouped.set(row.land_id, values);
  }
  return grouped;
}

export function buildIssueCandidates(state) {
  const out = [];

  for (const conflict of arr(state.caseInfo?.case_info_conflicts)) {
    const values = arr(conflict?.values).map(text).filter(Boolean);
    if (!conflict?.field || values.length < 2) continue;
    out.push(candidate(
      'CASE_INFO_CONFLICT',
      'MEDIUM',
      '사건 기본정보 원문 차이',
      `${text(conflict.field)} 항목이 평가서별로 다르게 기재되어 있습니다: ${values.join(' / ')}. 어느 값을 기준으로 사용할지 원문을 확인하세요.`,
      state.caseInfo?.source_refs,
      { field: conflict.field },
    ));
  }

  const resultsByLand = groupResultsByLand(state.appraisalResults);
  for (const land of arr(state.lands)) {
    const results = resultsByLand.get(land.land_id) || [];
    const completeResults = results.filter(appraisalResultComplete);
    if (!completeResults.length) {
      const missing = results.find((row) => !appraisalResultComplete(row));
      out.push(candidate('APPRAISAL_RESULT_MISSING', 'HIGH', '필지별 평가결과 누락', `${text(land.parcel_address) || land.land_id}의 적용단가·평가금액이 연결되지 않았습니다. 평가검토 화면의 원문·수정에서 기재값을 입력하거나 원본을 다시 추출하세요.`, [...arr(land.source_refs), ...arr(missing?.source_refs)], { land_id: land.land_id, appraisal_id: text(missing?.appraisal_id) }));
    }

    const category = normalizedCategory(land.land_category);
    const use = normalizedCategory(land.appraisal_use_status || land.use_status);
    if (category && use && category !== use) {
      out.push(candidate('LAND_STATUS_DIFFERS_FROM_CATEGORY', 'MEDIUM', '지목·현황 이용상황 차이', `${text(land.parcel_address)}의 지목(${text(land.land_category)})과 평가상 현황(${text(land.appraisal_use_status || land.use_status)})이 다릅니다. 원문·공적자료·현장을 대조하세요.`, land.source_refs, { land_id: land.land_id }));
    }

    for (const result of completeResults) {
      const appraisalId = text(result.appraisal_id);
      const appraiser = appraiserLabel(result);
      const factor = number(result.individual_factor_total);
      if (factor !== null && factor < 0.8) {
        out.push(candidate(
          'LOW_INDIVIDUAL_FACTOR_TOTAL',
          factor < 0.6 ? 'HIGH' : 'MEDIUM',
          '개별요인 감액폭 검토',
          `${appraiser} · ${text(land.parcel_address)}의 개별요인 누계가 ${factor.toFixed(3)}입니다. 세부 조건과 원문 근거를 대조하세요.`,
          result.source_refs,
          { land_id: land.land_id, appraisal_id: appraisalId },
        ));
      }
      const applied = number(result.unit_price);
      const calculated = number(result.calculated_unit_price);
      if (applied !== null && calculated !== null && Math.abs(applied - calculated) > Math.max(1000, calculated * 0.01)) {
        out.push(candidate(
          'APPLIED_CALCULATED_PRICE_GAP',
          'LOW',
          '산출단가·적용단가 차이',
          `${appraiser} · ${text(land.parcel_address)}의 산출단가와 적용단가 차이를 확인하세요.`,
          result.source_refs,
          { land_id: land.land_id, appraisal_id: appraisalId },
        ));
      }
    }

    const publicRow = publicRowForLand(state, land);
    if (publicRow) {
      const publicCategory = normalizedCategory(publicRow.land_category || publicRow.land_category_public || publicRow.jimok);
      if (category && publicCategory && category !== publicCategory) {
        out.push(candidate(
          'PUBLIC_LAND_CATEGORY_MISMATCH',
          'MEDIUM',
          '평가서 지목·공적자료 지목 불일치',
          `${text(land.parcel_address)}의 평가서 지목(${text(land.land_category)})과 공적자료 지목(${text(publicRow.land_category || publicRow.land_category_public || publicRow.jimok)})이 다릅니다. 자료 기준일과 원문을 확인하세요.`,
          [...arr(land.source_refs), ...arr(publicRow.source_refs)],
          { land_id: land.land_id },
        ));
      }
    }
  }

  for (const summary of arr(state.obstacleSummaries)) {
    if (summary.total_crosscheck_status === 'MISMATCH') {
      out.push(candidate('OBSTACLE_TOTAL_MISMATCH', 'HIGH', '지장물 합계 불일치', `${appraiserLabel(summary)} · 원문 기재 지장물 합계와 추출 행 합계가 다릅니다.`, summary.source_refs, { appraisal_id: summary.appraisal_id }));
    }
  }

  for (const row of arr(state.subjectFactorTotals)) {
    if (row.detail_status === 'TOTAL_ONLY') {
      out.push(candidate(
        'FACTOR_DETAIL_AMBIGUOUS',
        'LOW',
        '개별요인 세부열 원문확인',
        `${appraiserLabel(row)} · ${text(row.subject_parcel_address) || row.land_id}은 누계는 읽었으나 세부 빈 셀 위치를 확정하지 않았습니다.`,
        row.source_refs,
        { land_id: row.land_id, appraisal_id: row.appraisal_id },
      ));
    }
  }

  const seen = new Set();
  return out.filter((row) => {
    if (seen.has(row.issue_id)) return false;
    seen.add(row.issue_id);
    return true;
  });
}
