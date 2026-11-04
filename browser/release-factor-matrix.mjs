const INSTALL_FLAG = '__bsoFactorMatrixInstalled';
const STYLE_ID = 'bso-factor-matrix-v01';
const CONTRACT = 'release-factor-matrix/0.1';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value) {
  const number = numeric(value);
  return number === null ? '—' : `${Math.round(number).toLocaleString('ko-KR')}원`;
}

function factor(value, digits = 5) {
  const number = numeric(value);
  if (number === null) return '—';
  return number.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizedAddress(value) {
  return text(value).replace(/\s+/g, '');
}

function getReviewData() {
  try {
    // stable16 keeps the review store as a global lexical `let data` binding.
    // The constant-string eval is a compatibility bridge only; no user input is evaluated.
    const value = globalThis.eval('typeof data !== "undefined" ? data : null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function stagingFileName(staging) {
  return text(staging && (staging.file_name || staging.source_file_name));
}

function stagingUploadId(staging) {
  return text(staging && (staging.upload_id || staging.source_upload_id));
}

function stagingPages(staging) {
  return list(staging && staging.page_texts)
    .map((page, index) => ({
      page_no: Number.isFinite(Number(page && page.page_no)) ? Number(page.page_no) : index + 1,
      text: String((page && page.text) || ''),
    }))
    .filter((page) => page.text.trim());
}

function reviewedCandidate(candidate) {
  const status = text(candidate && candidate.review_status_code).toUpperCase();
  return ['CONFIRMED', 'CONFIRMED_BY_USER', 'MANUAL_EDITED', 'REJECTED', 'HOLD'].includes(status);
}

function mergeBasisCandidates(existingValue, nextValue, pairKey) {
  const existing = list(existingValue);
  const next = list(nextValue);
  const retained = existing.filter((candidate) => {
    if (!candidate) return false;
    if (reviewedCandidate(candidate)) return true;
    return text(candidate.pair_key) !== text(pairKey);
  });
  next.forEach((candidate) => {
    if (!candidate) return;
    if (!retained.some((item) => item && item.candidate_id === candidate.candidate_id)) retained.push(candidate);
  });
  return retained;
}

function statementRowsForUpload(store, uploadId, fileName) {
  const results = list(store && store.land_appraisal_results);
  const direct = results.filter((row) => row && (
    text(row.source_upload_id) === uploadId
    || list(row.source_upload_ids).some((id) => text(id) === uploadId)
  ));
  if (direct.length) return direct;
  return results.filter((row) => row && text(row.source_file_name) === fileName);
}

function activeStagingDocuments(store) {
  return list(store && store['00_extract_staging'])
    .map((staging) => ({
      staging,
      upload_id: stagingUploadId(staging),
      file_name: stagingFileName(staging),
      pages: stagingPages(staging),
    }))
    .filter((document) => document.upload_id && document.file_name);
}

function refreshPairedBasisFactorCandidates() {
  const parser = globalThis.BosangParser;
  const store = getReviewData();
  const summary = {
    contract_version: CONTRACT,
    package_ready_count: 0,
    candidate_count: 0,
    rejection_count: 0,
    linked_result_count: 0,
    auto_confirmed: false,
  };
  if (!store || !parser || typeof parser.pairAppraisalDocuments !== 'function' || typeof parser.attachPairedBasisFactorCandidates !== 'function') {
    return summary;
  }

  const documents = activeStagingDocuments(store);
  if (!documents.length) return summary;
  let paired;
  try {
    paired = parser.pairAppraisalDocuments(documents.map((document) => ({ file_name: document.file_name })));
  } catch (error) {
    return summary;
  }

  list(paired && paired.packages).forEach((pkg) => {
    if (!pkg || pkg.pairing_status !== 'PAIR_READY') return;
    const statementRef = list(pkg.documents).find((item) => item && item.role === 'STATEMENT');
    const basisRef = list(pkg.documents).find((item) => item && item.role === 'BASIS');
    const statementDocument = statementRef ? documents[statementRef.input_index] : null;
    const basisDocument = basisRef ? documents[basisRef.input_index] : null;
    if (!statementDocument || !basisDocument || !basisDocument.pages.length) return;
    const statementRows = statementRowsForUpload(store, statementDocument.upload_id, statementDocument.file_name);
    if (!statementRows.length) return;

    let linked;
    try {
      linked = parser.attachPairedBasisFactorCandidates({
        pair: pkg,
        statementDocument: { file_name: statementDocument.file_name },
        basisDocument: { file_name: basisDocument.file_name },
        statementCase: { land_appraisal_results: statementRows },
        basisPages: basisDocument.pages,
      });
    } catch (error) {
      return;
    }

    summary.package_ready_count += 1;
    summary.candidate_count += list(linked && linked.factor_bundle && linked.factor_bundle.candidates).length;
    summary.rejection_count += list(linked && linked.factor_bundle && linked.factor_bundle.rejections).length;
    list(linked && linked.structured_case && linked.structured_case.land_appraisal_results).forEach((enrichedRow) => {
      const target = list(store.land_appraisal_results).find((row) => row && enrichedRow && row.appraisal_result_id === enrichedRow.appraisal_result_id);
      if (!target) return;
      const nextCandidates = list(enrichedRow.basis_factor_candidates);
      if (!nextCandidates.length) return;
      target.basis_factor_candidates = mergeBasisCandidates(target.basis_factor_candidates, nextCandidates, pkg.pair_key);
      summary.linked_result_count += 1;
    });
  });

  store.basis_factor_link_runs = [
    {
      ...summary,
      refreshed_at: new Date().toISOString(),
      review_status_code: 'NEEDS_REVIEW',
      merge_policy: 'DO_NOT_OVERWRITE_STATEMENT',
    },
  ];
  return summary;
}

function uniqueBasisCandidate(resultRow) {
  const candidates = list(resultRow && resultRow.basis_factor_candidates)
    .filter((candidate) => candidate && candidate.contract_version === 'basis-factor-candidate/0.1' && candidate.auto_confirmed !== true);
  return candidates.length === 1 ? candidates[0] : null;
}

function canonicalResultIndex(store) {
  const byResultId = new Map();
  const byIdentity = new Map();
  list(store && store.land_appraisal_results).forEach((row) => {
    if (!row) return;
    if (row.appraisal_result_id) byResultId.set(text(row.appraisal_result_id), row);
    const company = text(row.appraisal_company);
    const key = `${company}|${normalizedAddress(row.parcel_address)}|${numeric(row.area)}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
  });
  return { byResultId, byIdentity };
}

function findCanonicalResult(index, draftRow) {
  const candidateIds = list(draftRow && draftRow.source_candidate_ids).map(text);
  for (const candidateId of candidateIds) {
    const direct = index.byResultId.get(candidateId);
    if (direct) return direct;
  }
  const key = `${text(draftRow && draftRow.appraisal_company)}|${normalizedAddress(draftRow && draftRow.parcel_address)}|${numeric(draftRow && draftRow.area_value)}`;
  const matches = index.byIdentity.get(key) || [];
  return matches.length === 1 ? matches[0] : null;
}

function attachBasisPresentationFields(rows) {
  const store = getReviewData();
  if (!store) return rows;
  const index = canonicalResultIndex(store);
  list(rows).forEach((row) => {
    const result = findCanonicalResult(index, row);
    const candidate = uniqueBasisCandidate(result);
    if (!candidate) {
      row.basis_factor_candidate_id = '';
      row.basis_factor_review_flags = [];
      return;
    }
    const chain = candidate.factor_chain || {};
    const auxiliary = candidate.auxiliary || {};
    row.basis_factor_candidate_id = candidate.candidate_id || '';
    row.basis_pair_key = candidate.pair_key || '';
    row.basis_official_price_value = numeric(chain.official_price);
    row.basis_time_correction_value = numeric(chain.time_correction);
    row.basis_regional_factor_value = numeric(chain.regional_factor);
    row.basis_individual_factor_value = numeric(chain.individual_factor);
    row.basis_other_factor_value = numeric(chain.other_factor);
    row.basis_calculated_unit_price_value = numeric(auxiliary.calculated_unit_price);
    row.basis_unit_price_value = numeric(chain.unit_price);
    row.basis_road_adjustment_value = numeric(auxiliary.road_adjustment);
    row.basis_auxiliary_factors = list(auxiliary.auxiliary_factors).map((value) => value === null ? null : numeric(value));
    row.basis_auxiliary_role_resolution = text(auxiliary.auxiliary_role_resolution);
    row.basis_factor_review_flags = list(candidate.review_flags).map(text).filter(Boolean);
    row.basis_source_file_name = text(list(candidate.source_refs)[0] && list(candidate.source_refs)[0].file_name);
    row.basis_source_excerpt = text(list(candidate.source_refs)[0] && list(candidate.source_refs)[0].raw_text_excerpt).slice(0, 160);
    row.basis_review_status_code = text(candidate.review_status_code || 'NEEDS_REVIEW');
  });
  return rows;
}

function candidateReviewLabel(row) {
  const flags = list(row && row.basis_factor_review_flags);
  if (!row || !row.basis_factor_candidate_id) return { label: '조서값만', cls: 'gray' };
  if (flags.includes('AUXILIARY_FACTOR_ROLE_AMBIGUOUS')) return { label: '열 역할 검수', cls: 'yellow' };
  if (flags.length) return { label: '원문 검수', cls: 'yellow' };
  return { label: '산출근거 후보', cls: 'blue' };
}

function badge(label, cls) {
  return `<span class="badge ${escapeHtml(cls || 'blue')}">${escapeHtml(label)}</span>`;
}

function otherFactorCell(row) {
  if (row.basis_other_factor_value !== null && row.basis_other_factor_value !== undefined) {
    const road = row.basis_road_adjustment_value === null || row.basis_road_adjustment_value === undefined
      ? ''
      : `<span class="factor-sub">보조 ${factor(row.basis_road_adjustment_value, 3)}</span>`;
    return `<b>${factor(row.basis_other_factor_value, 3)}</b>${road}`;
  }
  const auxiliary = list(row.basis_auxiliary_factors).filter((value) => value !== null && value !== undefined);
  if (auxiliary.length) {
    return `<span class="factor-review">후보 ${auxiliary.map((value) => factor(value, 3)).join(' / ')}</span><span class="factor-sub">역할 수동검수</span>`;
  }
  if (row.other_factor_value !== null && row.other_factor_value !== undefined) return factor(row.other_factor_value, 3);
  return '—';
}

function sourceCell(row) {
  const id = row.basis_factor_candidate_id || list(row.source_candidate_ids)[0] || '';
  const file = row.basis_source_file_name || row.source_file_name || '';
  return `<code>${escapeHtml(id || '후보 없음')}</code>${file ? `<span class="factor-sub">${escapeHtml(file)}</span>` : ''}`;
}

function groupedRows(rows) {
  const groups = new Map();
  list(rows).forEach((row) => {
    const key = text(row.difference_group_key || row.land_id || row.parcel_address || 'UNKNOWN');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()];
}

function renderFactorMatrixCard() {
  const build = globalThis.buildAppraisalCompanyComparisonDraft;
  if (typeof build !== 'function') return '';
  const rows = attachBasisPresentationFields(build());
  if (!rows.length) {
    return `<div class="card review-card span-12 factor-matrix-card"><h3>법인별 평가요인 비교</h3><div class="muted">평가수치 후보가 없습니다. 평가서 분석을 먼저 실행하세요.</div></div>`;
  }
  const linked = rows.filter((row) => row.basis_factor_candidate_id).length;
  const ambiguous = rows.filter((row) => list(row.basis_factor_review_flags).includes('AUXILIARY_FACTOR_ROLE_AMBIGUOUS')).length;
  const companies = new Set(rows.map((row) => text(row.appraisal_company)).filter(Boolean));
  const groups = groupedRows(rows);
  const desktopRows = groups.map(([key, group]) => {
    const header = `<tr class="factor-group-row"><td colspan="12"><b>${escapeHtml(group[0].parcel_address || key)}</b> · ${group.length}개 평가행</td></tr>`;
    return header + group.map((row) => {
      const review = candidateReviewLabel(row);
      const official = row.basis_official_price_value ?? row.official_land_price_value;
      const time = row.basis_time_correction_value ?? row.time_correction_value;
      const regional = row.basis_regional_factor_value ?? row.regional_factor_value;
      const individual = row.basis_individual_factor_value ?? row.individual_factor_total_value;
      const calculated = row.basis_calculated_unit_price_value;
      const applied = row.basis_unit_price_value ?? row.unit_price_value;
      return `<tr>`
        + `<td>${escapeHtml(row.parcel_address || row.land_id)}</td>`
        + `<td><b>${escapeHtml(row.appraisal_company || '후보 없음')}</b></td>`
        + `<td>${money(official)}</td>`
        + `<td>${factor(time)}</td>`
        + `<td>${factor(regional, 3)}</td>`
        + `<td>${factor(individual, 3)}</td>`
        + `<td>${otherFactorCell(row)}</td>`
        + `<td>${money(calculated)}</td>`
        + `<td><b>${money(applied)}</b></td>`
        + `<td>${money(row.appraisal_amount_value)}</td>`
        + `<td>${badge(review.label, review.cls)}</td>`
        + `<td>${sourceCell(row)}</td>`
        + `</tr>`;
    }).join('');
  }).join('');

  const mobileCards = rows.map((row) => {
    const review = candidateReviewLabel(row);
    const official = row.basis_official_price_value ?? row.official_land_price_value;
    const time = row.basis_time_correction_value ?? row.time_correction_value;
    const regional = row.basis_regional_factor_value ?? row.regional_factor_value;
    const individual = row.basis_individual_factor_value ?? row.individual_factor_total_value;
    const calculated = row.basis_calculated_unit_price_value;
    const applied = row.basis_unit_price_value ?? row.unit_price_value;
    return `<article class="factor-mobile-card">`
      + `<header><div><small>${escapeHtml(row.parcel_address || row.land_id)}</small><b>${escapeHtml(row.appraisal_company || '후보 없음')}</b></div>${badge(review.label, review.cls)}</header>`
      + `<div class="factor-mobile-grid">`
      + `<span>공시지가<b>${money(official)}</b></span>`
      + `<span>시점수정<b>${factor(time)}</b></span>`
      + `<span>지역요인<b>${factor(regional, 3)}</b></span>`
      + `<span>개별누계<b>${factor(individual, 3)}</b></span>`
      + `<span>그 밖의 요인<b>${otherFactorCell(row)}</b></span>`
      + `<span>산정단가<b>${money(calculated)}</b></span>`
      + `<span>적용단가<b>${money(applied)}</b></span>`
      + `<span>평가액<b>${money(row.appraisal_amount_value)}</b></span>`
      + `</div><footer>${sourceCell(row)}</footer></article>`;
  }).join('');

  return `<div class="card review-card span-12 factor-matrix-card" data-bso-factor-matrix="1">`
    + `<div class="factor-matrix-head"><div><span class="factor-eyebrow">APPRAISAL FACTOR REVIEW</span><h3>법인별 평가요인 비교</h3><p>평가조서 값과 PAIR_READY 산출근거 후보를 한 화면에 병기합니다. 산출근거 후보는 canonical 평가행을 덮어쓰지 않습니다.</p></div>`
    + `<div class="factor-kpis"><span><b>${companies.size}</b>법인</span><span><b>${groups.length}</b>필지</span><span><b>${linked}</b>산출근거 연결</span><span class="${ambiguous ? 'review' : ''}"><b>${ambiguous}</b>열 역할 검수</span></div></div>`
    + `<div class="factor-safety-note"><b>검토 경계</b> · 값 차이는 보상금 증액 가능성이나 평가 오류를 의미하지 않습니다. 역할이 불명확한 보조계수는 자동 배정하지 않습니다.</div>`
    + `<div class="table-wrap factor-matrix-desktop"><table class="compact"><thead><tr><th>필지</th><th>평가법인</th><th>공시지가</th><th>시점수정</th><th>지역</th><th>개별누계</th><th>그 밖의 요인</th><th>산정단가</th><th>적용단가</th><th>평가액</th><th>검토</th><th>근거</th></tr></thead><tbody>${desktopRows}</tbody></table></div>`
    + `<div class="factor-matrix-mobile">${mobileCards}</div>`
    + `</div>`;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .factor-matrix-card{overflow:hidden}.factor-matrix-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:12px}.factor-matrix-head h3{margin:2px 0 5px}.factor-matrix-head p{margin:0;max-width:760px;color:#686e75;font-size:11.5px;line-height:1.5}.factor-eyebrow{color:var(--lk-burgundy,#7a243f);font-size:9px;font-weight:850;letter-spacing:.12em}.factor-kpis{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.factor-kpis span{display:inline-flex;align-items:baseline;gap:3px;padding:6px 8px;border:1px solid #dde0e4;border-radius:5px;background:#fafafb;color:#666c73;font-size:10px;white-space:nowrap}.factor-kpis b{color:#30343a;font-size:13px}.factor-kpis .review{border-color:#e2cd9b;background:#fff9e8}.factor-safety-note{margin:0 0 12px;padding:9px 10px;border-left:3px solid var(--lk-burgundy,#7a243f);background:#fcf7f9;color:#5f6368;font-size:10.5px;line-height:1.5}.factor-matrix-desktop table{min-width:1320px}.factor-matrix-desktop th{white-space:nowrap}.factor-matrix-desktop td{vertical-align:top}.factor-group-row td{background:#faf6f8!important;color:#5b2638}.factor-sub{display:block;margin-top:3px;color:#7a7f85;font-size:9.5px;line-height:1.3}.factor-review{color:#8a6415;font-weight:780}.factor-matrix-mobile{display:none}.factor-mobile-card{padding:12px;border:1px solid #e1e3e6;border-radius:7px;background:#fff}.factor-mobile-card+ .factor-mobile-card{margin-top:9px}.factor-mobile-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px}.factor-mobile-card header small{display:block;color:#73787e;font-size:10px}.factor-mobile-card header b{display:block;margin-top:2px;font-size:13px}.factor-mobile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid #eceef0;border-left:1px solid #eceef0}.factor-mobile-grid>span{min-width:0;padding:8px;border-right:1px solid #eceef0;border-bottom:1px solid #eceef0;color:#777c82;font-size:9.5px}.factor-mobile-grid>span>b{display:block;margin-top:3px;color:#25292e;font-size:11px;overflow-wrap:anywhere}.factor-mobile-card footer{margin-top:8px;color:#7a7f85;font-size:9px;overflow-wrap:anywhere}
    @media(max-width:767px){.factor-matrix-head{display:block}.factor-kpis{justify-content:flex-start;margin-top:9px;overflow-x:auto;flex-wrap:nowrap;padding-bottom:2px}.factor-matrix-desktop{display:none!important}.factor-matrix-mobile{display:block}.factor-matrix-card{padding:14px!important}.factor-safety-note{font-size:10px}.factor-mobile-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
}

function installBuildDraftWrapper() {
  const original = globalThis.buildAppraisalCompanyComparisonDraft;
  if (typeof original !== 'function' || original.__bsoFactorWrapped) return;
  const wrapped = function wrappedBuildAppraisalCompanyComparisonDraft(...args) {
    return attachBasisPresentationFields(original.apply(this, args));
  };
  wrapped.__bsoFactorWrapped = true;
  wrapped.__bsoOriginal = original;
  globalThis.buildAppraisalCompanyComparisonDraft = wrapped;
}

function installMatrixRenderer() {
  const original = globalThis.renderAppraisalCompanyComparisonMatrix;
  if (typeof original !== 'function' || original.__bsoFactorWrapped) return;
  const wrapped = function wrappedRenderAppraisalCompanyComparisonMatrix() {
    return renderFactorMatrixCard() || original.apply(this, arguments);
  };
  wrapped.__bsoFactorWrapped = true;
  wrapped.__bsoOriginal = original;
  globalThis.renderAppraisalCompanyComparisonMatrix = wrapped;
}

function installWorkflowValueWrapper() {
  const original = globalThis.renderWorkflowValue;
  if (typeof original !== 'function' || original.__bsoFactorWrapped) return;
  const wrapped = function wrappedRenderWorkflowValue(...args) {
    const result = original.apply(this, args);
    const grid = document.getElementById('workflowValueGrid');
    if (grid && !grid.querySelector('[data-bso-factor-matrix="1"]')) {
      const markup = renderFactorMatrixCard();
      if (markup) grid.insertAdjacentHTML('beforeend', markup);
    }
    return result;
  };
  wrapped.__bsoFactorWrapped = true;
  wrapped.__bsoOriginal = original;
  globalThis.renderWorkflowValue = wrapped;
}

function installExtractionWrapper() {
  const original = globalThis.extractEssentialInfoCandidates;
  if (typeof original !== 'function' || original.__bsoFactorWrapped) return;
  const wrapped = function wrappedExtractEssentialInfoCandidates(...args) {
    const result = original.apply(this, args);
    try {
      refreshPairedBasisFactorCandidates();
      if (typeof globalThis.renderAll === 'function') globalThis.renderAll();
    } catch (error) {
      console.warn('BSO factor candidate refresh skipped:', error && error.message ? error.message : error);
    }
    return result;
  };
  wrapped.__bsoFactorWrapped = true;
  wrapped.__bsoOriginal = original;
  globalThis.extractEssentialInfoCandidates = wrapped;
}

export function installReleaseFactorMatrix() {
  if (globalThis[INSTALL_FLAG]) return globalThis[INSTALL_FLAG];
  injectStyles();
  installBuildDraftWrapper();
  installMatrixRenderer();
  installWorkflowValueWrapper();
  installExtractionWrapper();
  const installed = {
    contractVersion: CONTRACT,
    refresh: refreshPairedBasisFactorCandidates,
    render: renderFactorMatrixCard,
    getData: getReviewData,
  };
  globalThis[INSTALL_FLAG] = installed;
  globalThis.refreshPairedBasisFactorCandidates = refreshPairedBasisFactorCandidates;
  globalThis.renderBsoFactorMatrixCard = renderFactorMatrixCard;
  try { refreshPairedBasisFactorCandidates(); } catch (error) {}
  return installed;
}

installReleaseFactorMatrix();
