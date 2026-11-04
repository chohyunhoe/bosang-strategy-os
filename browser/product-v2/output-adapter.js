const PREFIX = '/__output_bridge';

function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value == null ? '' : String(value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function maskedFileName(appraisalId) { return `${text(appraisalId) || 'APP'}.pdf`; }

const OUTPUT_COLLECTION_GROUPS = Object.freeze({
  appraisals: 'appraisals',
  lands: 'lands',
  standard_lands: 'standardLands',
  comp_cases: 'transactionCases',
  land_appraisal_results: 'appraisalResults',
  // The canonical '개별요인 누계' review covers the explicit detail rows and their total together.
  subject_to_standard_factor_comparisons: 'subjectFactorTotals',
  subject_factor_total_candidates: 'subjectFactorTotals',
  other_factor_reviews: 'otherFactors',
  // The canonical obstacle review explicitly requires row + stated-total crosscheck together.
  obstacle_summary_by_appraisal: 'obstacleRows',
  obstacle_appraisal_results_sample: 'obstacleRows',
  issue_candidates: 'issueCandidates',
});

function manualDecision(state, collection) {
  const decision = state?.reviewDecisions?.[`GROUP:${collection}`] || null;
  return decision && decision.status === 'CONFIRMED' ? decision : null;
}

function reviewedRows(state, collection, rows) {
  const decision = manualDecision(state, collection);
  return asArray(rows).map((source) => {
    const row = clone(source);
    if (!decision) return row;
    row.review_status_code = 'CONFIRMED';
    row.reviewed_at = decision.reviewed_at || row.reviewed_at || null;
    row.review_origin = 'USER_GROUP_CONFIRMATION';
    return row;
  });
}

function reviewedCase(state) {
  const source = clone(state?.caseInfo || {});
  const decision = manualDecision(state, 'caseInfo');
  if (!decision) return source;
  source.review_status_code = 'CONFIRMED';
  source.reviewed_at = decision.reviewed_at || source.reviewed_at || null;
  source.review_origin = 'USER_GROUP_CONFIRMATION';
  return source;
}

function issueForOutput(row) {
  const relatedLandIds = asArray(row?.related_land_ids).filter(Boolean);
  if (!relatedLandIds.length && row?.related?.land_id) relatedLandIds.push(row.related.land_id);
  const sourceLabels = asArray(row?.source_refs).map((ref) => text(ref?.source_label)).filter(Boolean);
  const grade = row?.issue_grade || ({ HIGH:'A', MEDIUM:'B', LOW:'C' }[text(row?.severity).toUpperCase()] || 'REVIEW');
  return {
    ...clone(row),
    related_land_ids: relatedLandIds,
    confirmed_fact: row?.confirmed_fact || row?.description || row?.title || null,
    interpretation_note: row?.interpretation_note || null,
    required_evidence: row?.required_evidence || (sourceLabels.length ? [...new Set(sourceLabels)].join(', ') : null),
    issue_grade: grade,
    reflection_status: row?.reflection_status || 'PENDING_REVIEW',
    review_status_code: row?.review_status_code || 'NEEDS_REVIEW',
  };
}

function reviewedIssues(state) {
  return reviewedRows(state, OUTPUT_COLLECTION_GROUPS.issue_candidates, state?.issueCandidates).map(issueForOutput);
}

export function caseSnapshotForOutput(state) {
  const queue = asArray(state?.reviewQueue);
  const fullyReviewed = state?.batchHasHold !== true && !['PARSE_HOLD','PROCESSING','ERROR'].includes(state?.status) && queue.length > 0 && queue.every((item) => item.status === 'CONFIRMED');
  return {
    meta: {
      product_runtime: 'product_v2.1',
      review_status: fullyReviewed ? 'REVIEWED' : 'REVIEW_REQUIRED',
      auto_confirmed: false,
    },
    case: reviewedCase(state),
    appraisals: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.appraisals, state?.appraisals)
      .map((row) => ({ ...row, file_name: maskedFileName(row.appraisal_id) })),
    document_uploads: asArray(state?.sourceDocuments).map((row) => ({
      document_id: row.document_id || '', appraisal_id: row.appraisal_id || '',
      file_name: maskedFileName(row.appraisal_id), page_count: row.page_count || null,
      parse_status: row.parse_status || '', auto_confirmed: false,
    })),
    lands: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.lands, state?.lands),
    standard_lands: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.standard_lands, state?.standardLands),
    comp_cases: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.comp_cases, state?.transactionCases),
    land_appraisal_results: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.land_appraisal_results, state?.appraisalResults),
    appraisal_totals: asArray(state?.appraisalTotals).map(clone),
    subject_to_standard_factor_comparisons: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.subject_to_standard_factor_comparisons, state?.subjectFactorDetails),
    subject_factor_total_candidates: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.subject_factor_total_candidates, state?.subjectFactorTotals),
    standard_to_comp_case_factor_comparisons: asArray(state?.standardToCompCaseFactors).map(clone),
    other_factor_reviews: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.other_factor_reviews, state?.otherFactors),
    comparison_summary_by_land: asArray(state?.comparisonSummaryByLand).map(clone),
    obstacle_summary_by_appraisal: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.obstacle_summary_by_appraisal, state?.obstacleSummaries),
    obstacle_appraisal_results_sample: reviewedRows(state, OUTPUT_COLLECTION_GROUPS.obstacle_appraisal_results_sample, state?.obstacleRows),
    land_characteristics: asArray(state?.landCharacteristics).map(clone),
    public_land_characteristics: asArray(state?.publicLandCharacteristics).map(clone),
    land_characteristic_crosscheck: asArray(state?.landCharacteristicCrosscheck).map(clone),
    public_land_data_enrichment: clone(state?.publicLandDataEnrichment || {}),
    public_enrichment: asArray(state?.publicEnrichment).map(clone),
    issue_candidates: reviewedIssues(state),
    draft_sentences: asArray(state?.draftSentences).map(clone),
    risk_warnings: asArray(state?.riskWarnings).map(clone),
  };
}

export async function probeOutputBridge() {
  try {
    const response = await fetch(`${PREFIX}/status`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) return { available: false, status: 'LOCAL_ONLY', formats: [] };
    const data = await response.json();
    return { available: Boolean(data.available), status: data.available ? 'AVAILABLE' : 'LOCAL_ONLY', formats: asArray(data.formats), detail: data };
  } catch (error) {
    return { available: false, status: 'LOCAL_ONLY', formats: [], error: String(error?.message || error) };
  }
}

async function post(route, payload) {
  const response = await fetch(`${PREFIX}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({ ok: false, error_code: 'INVALID_BRIDGE_RESPONSE' }));
  if (!response.ok || !data.ok) throw new Error(data.message || data.error_code || `OUTPUT_BRIDGE_${response.status}`);
  return data;
}

function base64Bytes(value) {
  const binary = atob(String(value || '').replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function downloadBase64(fileName, contentType, base64) {
  const blob = new Blob([base64Bytes(base64)], { type: contentType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'bso-output';
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function generateAnalysisReport(state) {
  const result = await post('analysis_report', { case: caseSnapshotForOutput(state) });
  downloadBase64(result.file_name, result.content_type, result.docx_base64);
  return result;
}

export async function generateNumericTable(state, formats = ['xlsx', 'csv']) {
  const result = await post('numeric_table', { case: caseSnapshotForOutput(state), formats });
  for (const file of asArray(result.files)) downloadBase64(file.file_name, file.content_type, file.base64);
  return result;
}

export async function generateOpinionPackage(state, mapPngBase64 = '') {
  const bridgeMap = globalThis.BSOProductV2?.mapBridge?.state?.result?.preview_png_base64 || '';
  let mapItems=[];
  if(!mapPngBase64&&typeof globalThis.BSOProductV2?.mapBridge?.reportPngItems==='function')mapItems=await globalThis.BSOProductV2.mapBridge.reportPngItems();
  const result = await post('opinion_package', { case: caseSnapshotForOutput(state), map_png_base64: mapPngBase64 || bridgeMap, map_png_items:mapItems });
  downloadBase64(result.file_name, result.content_type, result.docx_base64);
  return result;
}
