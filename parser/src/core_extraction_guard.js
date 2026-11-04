'use strict';

const RISKY_KEYS = new Set([
  'subject_address',
  'parcel_number',
  'land_category',
  'area',
  'standard_land_ref',
  'standard_land_price',
  'time_correction',
  'regional_factor',
  'individual_factor',
  'other_factor',
  'unit_price',
  'appraisal_amount',
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function firstSourceRef(row) {
  const refs = row && Array.isArray(row.source_refs) ? row.source_refs : [];
  return refs[0] || null;
}

function snippetFrom(row) {
  const ref = firstSourceRef(row);
  return ref && ref.raw_text_excerpt ? String(ref.raw_text_excerpt) : '';
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter((value) => value !== undefined && value !== null && value !== '').map(String)));
}

function parcelNumber(address) {
  const match = String(address || '').trim().match(/(산?\s*\d+(?:-\d+)?)$/);
  return match ? match[1].replace(/\s+/g, '') : '';
}

function summarize(values, unitLabel) {
  const unique = uniqueValues(values);
  if (unique.length === 0) return { value: '', confidence: 'MISSING', needsReview: true, conflicts: [] };
  if (unique.length === 1) return { value: unique[0], confidence: 'HIGH', needsReview: false, conflicts: unique };
  return {
    value: `${unique[0]} 외 ${unique.length - 1}${unitLabel || '건'}`,
    confidence: 'MEDIUM',
    needsReview: true,
    conflicts: unique,
  };
}

function structuredField(legacy, key, summary, reason, snippet) {
  const base = clone(legacy.find((field) => field.key === key) || { key, label: key, required: true, type: 'text' });
  return {
    ...base,
    value: summary.value,
    snippet: snippet || '',
    conflicts: summary.conflicts || [],
    conflict: (summary.conflicts || []).length > 1,
    numericBroken: false,
    confidence: summary.confidence,
    needsReview: Boolean(summary.needsReview),
    reason,
  };
}

function failClosedField(field) {
  const copy = clone(field);
  if (!RISKY_KEYS.has(copy.key)) return copy;
  return {
    ...copy,
    value: '',
    conflicts: [],
    conflict: false,
    numericBroken: false,
    confidence: 'MISSING',
    needsReview: true,
    reason: '구조화 Parser 결과로 확인되지 않아 자동값을 표시하지 않습니다.',
  };
}

function buildStructuredCoreFields(parsed, legacyFields) {
  const legacy = Array.isArray(legacyFields) ? legacyFields : [];
  if (!parsed || typeof parsed !== 'object') return legacy.map(failClosedField);

  const caseInfo = parsed.case && typeof parsed.case === 'object' ? parsed.case : {};
  const appraisals = Array.isArray(parsed.appraisals) ? parsed.appraisals : [];
  const lands = Array.isArray(parsed.lands) ? parsed.lands : [];
  const standards = Array.isArray(parsed.standard_lands) ? parsed.standard_lands : [];
  const results = Array.isArray(parsed.land_appraisal_results) ? parsed.land_appraisal_results : [];
  const totals = Array.isArray(parsed.appraisal_totals) ? parsed.appraisal_totals : [];

  const mapping = new Map();
  const put = (key, summary, reason, row) => mapping.set(key, structuredField(legacy, key, summary, reason, snippetFrom(row)));

  const caseName = caseInfo.case_name || caseInfo.project_name || '';
  put('case_name', summarize([caseName]), '구조화 Parser의 사건·사업명 후보', caseInfo);

  const appraisal = appraisals[0] || {};
  put('appraisal_company', summarize([appraisal.appraisal_company]), '구조화 Parser의 평가법인 후보', appraisal);
  put(
    'base_date',
    summarize([caseInfo.base_date || caseInfo.price_date || appraisal.valuation_date]),
    '구조화 Parser의 기준시점·가격시점 후보',
    appraisal,
  );

  const landAddresses = lands.map((land) => land.parcel_address);
  const addressSummary = summarize(landAddresses, '필지');
  put('subject_address', addressSummary, lands.length > 1 ? '복수 필지는 필지별 상세에서 확인' : '구조화 Parser의 편입토지 소재지 후보', lands[0]);

  const parcelSummary = summarize(lands.map((land) => parcelNumber(land.parcel_address)), '필지');
  put('parcel_number', parcelSummary, lands.length > 1 ? '복수 지번은 필지별 상세에서 확인' : '편입토지 소재지에서 확인된 지번', lands[0]);

  const categorySummary = summarize(lands.map((land) => land.land_category), '종');
  put('land_category', categorySummary, categorySummary.needsReview ? '복수 지목은 필지별 상세에서 확인' : '구조화 Parser의 지목 후보', lands[0]);

  const areaValues = lands.map((land) => land.area).filter((value) => Number.isFinite(Number(value)));
  const areaSummary = areaValues.length === 1
    ? summarize(areaValues)
    : { value: areaValues.length ? '필지별 상세 참조' : '', confidence: areaValues.length ? 'MEDIUM' : 'MISSING', needsReview: true, conflicts: areaValues.map(String) };
  put('area', areaSummary, areaValues.length > 1 ? '면적은 필지별로 구조화되어 상세 확인 필요' : '구조화 Parser의 면적 후보', lands[0]);

  const standardSummary = summarize(standards.map((row) => row.standard_land_symbol || row.parcel_address), '건');
  put('standard_land_ref', standardSummary, '구조화 Parser의 비교표준지 기호·소재지 후보', standards[0]);

  const officialPriceSummary = summarize(standards.map((row) => row.official_price));
  put('standard_land_price', officialPriceSummary, officialPriceSummary.needsReview ? '복수 공시지가는 표준지별 상세에서 확인' : '구조화 Parser의 비교표준지 공시지가 후보', standards[0]);

  const factorSpecs = [
    ['time_correction', 'time_correction', '시점수정'],
    ['regional_factor', 'regional_factor', '지역요인'],
    ['individual_factor', 'individual_factor_total', '개별요인'],
    ['other_factor', 'other_factor', '그 밖의 요인'],
    ['unit_price', 'unit_price', '적용단가'],
  ];
  factorSpecs.forEach(([key, sourceKey, label]) => {
    const summary = summarize(results.map((row) => row[sourceKey]));
    put(key, summary, summary.needsReview ? `${label}은 평가행별 상세에서 확인` : `구조화 Parser의 ${label} 후보`, results[0]);
  });

  const totalValues = totals.map((row) => row.total_amount).filter((value) => Number.isFinite(Number(value)));
  const amountValues = totalValues.length ? totalValues : results.map((row) => row.amount).filter((value) => Number.isFinite(Number(value)));
  const amountSummary = summarize(amountValues);
  put('appraisal_amount', amountSummary, totalValues.length ? '평가총액 표의 기재 금액' : '구조화 Parser의 평가액 후보', totals[0] || results[0]);

  return legacy.map((field) => mapping.get(field.key) || clone(field));
}

function installCoreExtractionGuard(parsePages) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof parsePages !== 'function') return;
  if (window.__bosangCoreExtractionGuardScheduled) return;
  window.__bosangCoreExtractionGuardScheduled = true;

  const install = () => {
    if (window.__bosangCoreExtractionGuardInstalled) return;
    if (typeof window.buildCoreExtractionResults !== 'function') return;
    const legacyBuilder = window.buildCoreExtractionResults;
    window.buildCoreExtractionResults = function guardedBuildCoreExtractionResults(text) {
      const legacy = legacyBuilder.apply(this, arguments);
      try {
        const parsed = parsePages([{ page_no: 1, text: String(text || '') }], {
          fileName: 'browser-core-review.txt',
          appraisalId: 'APP_CORE_REVIEW',
          inputType: 'TEXT_PDF',
        });
        return buildStructuredCoreFields(parsed, legacy);
      } catch (error) {
        return (Array.isArray(legacy) ? legacy : []).map(failClosedField);
      }
    };
    window.__bosangCoreExtractionGuardInstalled = true;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}

module.exports = {
  buildStructuredCoreFields,
  failClosedField,
  installCoreExtractionGuard,
};
