'use strict';

const REVIEW_STATUS = require('./review_status');

function buildSubjectFactorTotals(lands, appraisalResults, context = {}) {
  const resultByLandId = new Map(
    (Array.isArray(appraisalResults) ? appraisalResults : [])
      .filter((row) => row && row.land_id)
      .map((row) => [row.land_id, row]),
  );
  const explicitDetailsByLandId = new Map(
    (Array.isArray(context.subjectFactorComparisons) ? context.subjectFactorComparisons : [])
      .filter((row) => row && row.land_id)
      .map((row) => [row.land_id, row]),
  );
  const rows = [];

  for (const land of Array.isArray(lands) ? lands : []) {
    if (!land || !land.land_id) continue;
    const result = resultByLandId.get(land.land_id);
    if (!result || result.individual_factor_total === null || result.individual_factor_total === undefined || result.individual_factor_total === '') continue;
    const explicitDetail = explicitDetailsByLandId.get(land.land_id) || null;
    const sourceRefs = [
      ...(Array.isArray(result.source_refs) ? result.source_refs : []),
      ...(Array.isArray(explicitDetail?.source_refs) ? explicitDetail.source_refs : []),
    ].filter((ref, index, values) => values.findIndex((candidate) => (
      candidate?.page_no === ref?.page_no
      && candidate?.line_start === ref?.line_start
      && candidate?.line_end === ref?.line_end
      && candidate?.source_label === ref?.source_label
    )) === index);
    const hasExplicitDetail = Boolean(explicitDetail)
      || (Array.isArray(result.individual_factor_details) && result.individual_factor_details.length > 0);
    rows.push({
      factor_total_id: `SFT_${context.appraisalId || 'APP_001'}_${land.land_id}`,
      appraisal_id: context.appraisalId || 'APP_001',
      appraisal_company: result.appraisal_company || '',
      land_id: land.land_id,
      subject_parcel_address: land.parcel_address || '',
      standard_land_id: result.standard_land_id || explicitDetail?.standard_land_id || '',
      standard_land_symbol: result.standard_land_symbol || explicitDetail?.standard_land_symbol || '',
      total_factor: Number(result.individual_factor_total),
      detail_status: hasExplicitDetail ? 'DETAIL_AVAILABLE' : 'TOTAL_ONLY',
      source_refs: sourceRefs,
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      confidence_level: sourceRefs.length ? 'MEDIUM' : 'LOW',
      parser_notes: hasExplicitDetail
        ? '토지가격 산출표의 개별요인 누계와 개별요인 상세내역의 명시 세부계수를 함께 연결했습니다. 자동확정하지 않으며 원문 대조가 필요합니다.'
        : '토지가격 산출표에 명시된 개별요인 누계만 보존합니다. 세부 빈 셀의 위치가 불명확한 경우 세부조건을 추정하지 않습니다.',
    });
  }
  return rows;
}

module.exports = { buildSubjectFactorTotals };
