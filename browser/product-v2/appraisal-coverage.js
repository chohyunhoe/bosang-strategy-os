const arr = (value) => Array.isArray(value) ? value : [];
const text = (value) => value == null ? '' : String(value).trim();
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

export const REQUIRED_APPRAISAL_RESULT_FIELDS = Object.freeze(['unit_price', 'amount']);

// 원문이 이 토지에 별도 가액을 매기지 않는다고 밝힌 행(다른 물건에 포함해 평가)은
// '아직 못 읽은 누락' 이 아니라 '그렇게 적힌 사실' 이다. 사람이 원문에서 채워 넣을 값이
// 없으므로 누락 이슈로 올리거나 검수완료를 막아서는 안 된다. 검토 대상으로는 그대로 남는다.
export function appraisalResultValueStatedAsAbsent(row) {
  return Boolean(row && text(row.evaluation_status));
}

export function appraisalResultComplete(row) {
  if (!row || !text(row.land_id)) return false;
  if (text(row.subject_link_status).toUpperCase().startsWith('MISSING')) return false;
  if (text(row.review_status_code).toUpperCase() === 'MISSING') return false;
  if (appraisalResultValueStatedAsAbsent(row)) return true;
  return REQUIRED_APPRAISAL_RESULT_FIELDS.every((field) => finite(row[field]));
}

function expectedAppraisalIds(state, land) {
  const scoped = [...new Set(arr(land?.source_appraisal_ids).map(text).filter(Boolean))];
  if (scoped.length) return scoped;
  const all = [...new Set(arr(state?.appraisals).map((row) => text(row?.appraisal_id)).filter(Boolean))];
  return all.length ? all : [''];
}

export function computeAppraisalCoverage(state) {
  const results = arr(state?.appraisalResults);
  const byPair = new Map();
  for (const row of results) {
    const key = `${text(row?.appraisal_id)}|${text(row?.land_id)}`;
    const current = byPair.get(key) || [];
    current.push(row);
    byPair.set(key, current);
  }

  const expected = [];
  for (const land of arr(state?.lands)) {
    for (const appraisalId of expectedAppraisalIds(state, land)) {
      const pairKey = `${appraisalId}|${text(land?.land_id)}`;
      const pairRows = byPair.get(pairKey) || [];
      expected.push({
        appraisal_id: appraisalId,
        land_id: text(land?.land_id),
        parcel_address: text(land?.parcel_address),
        rows: pairRows,
        complete: pairRows.some(appraisalResultComplete),
      });
    }
  }
  const missing = expected.filter((row) => !row.complete);
  return {
    expected_count: expected.length,
    complete_count: expected.length - missing.length,
    missing_count: missing.length,
    complete: expected.length > 0 && missing.length === 0,
    expected,
    missing,
  };
}
