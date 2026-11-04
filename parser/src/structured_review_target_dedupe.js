'use strict';

const CONTRACT_VERSION = 'structured-review-target-dedupe/0.2';
const STRUCTURED_ORIGIN = 'STRUCTURED_PARSER';
const REVIEWED_STATUSES = new Set(['CONFIRMED', 'CONFIRMED_BY_USER', 'MANUAL_EDITED', 'REJECTED', 'HOLD', 'KEEP_EXISTING']);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function getStore() {
  try {
    const value = window.eval('typeof data !== "undefined" ? data : null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function normalizedAddress(value) {
  return text(value).replace(/\s+/g, '');
}

// 법정동(읍·면·동·리·가) 바로 뒤에 오는 지번만 필지 식별자로 삼습니다.
// 문자열 끝을 기준으로 잡으면 "샘플동 101-1 대 350"처럼 지목·면적이 붙은 표기에서
// 면적(350)을 지번으로 오인해 서로 다른 필지가 하나로 병합됩니다.
const LOCALITY_PARCEL = /([가-힣A-Za-z0-9·]+(?:동|읍|면|리|가))\s*(산\s*)?(\d+)(?:\s*-\s*(\d+))?/;

function parcelIdentity(value) {
  const address = text(value);
  const match = address.match(LOCALITY_PARCEL);
  if (!match) return normalizedAddress(address);
  const locality = match[1];
  const mountain = match[2] ? '산' : '';
  const mainLot = match[3];
  const subLot = match[4] ? `-${match[4]}` : '';
  return `${locality}|${mountain}${mainLot}${subLot}`;
}

function parsedOf(candidate) {
  return candidate && candidate.parsed_value && typeof candidate.parsed_value === 'object'
    ? candidate.parsed_value
    : {};
}

function targetLandIdentity(candidate) {
  const parsed = parsedOf(candidate);
  const address = text(parsed.parcel_address || candidate && candidate.parcel_address);
  return parcelIdentity(address);
}

function isReviewed(candidate) {
  return REVIEWED_STATUSES.has(text(candidate && candidate.review_status_code).toUpperCase())
    || Boolean(candidate && (candidate.reviewed_at || candidate.manual_edited_value || candidate.promoted_to_draft_store));
}

function addressLength(candidate) {
  const parsed = parsedOf(candidate);
  return text(parsed.parcel_address || candidate && candidate.parcel_address).length;
}

function candidateArea(candidate) {
  const parsed = parsedOf(candidate);
  return numeric(parsed.area !== undefined ? parsed.area : candidate && candidate.area);
}

function candidateCategory(candidate) {
  const parsed = parsedOf(candidate);
  return text(parsed.land_category || candidate && candidate.land_category);
}

function distinctNonBlank(values) {
  return Array.from(new Set(values.filter((value) => value !== null && value !== undefined && value !== '').map(String)));
}

function mergeTargetGroup(group, identity) {
  if (group.length <= 1) return group;
  const reviewed = group.filter(isReviewed);
  if (reviewed.length > 1) return group;

  const primary = reviewed[0] || group.slice().sort((left, right) => addressLength(right) - addressLength(left))[0];
  const areaConflicts = distinctNonBlank(group.map(candidateArea));
  const categoryConflicts = distinctNonBlank(group.map(candidateCategory));
  const conflictFlags = [];
  if (areaConflicts.length > 1) conflictFlags.push('TARGET_LAND_AREA_CONFLICT');
  if (categoryConflicts.length > 1) conflictFlags.push('TARGET_LAND_CATEGORY_CONFLICT');

  const merged = {
    ...primary,
    source_upload_ids: unique(group.flatMap((candidate) => [candidate && candidate.source_upload_id, candidate && candidate.upload_id].concat(list(candidate && candidate.source_upload_ids)))),
    source_file_names: unique(group.flatMap((candidate) => [candidate && candidate.source_file_name].concat(list(candidate && candidate.source_file_names)))),
    duplicate_source_candidate_ids: unique(group.map((candidate) => candidate && candidate.candidate_id)),
    duplicate_source_count: group.length,
    target_land_identity: identity,
    target_land_area_candidates: areaConflicts.map((value) => Number(value)),
    target_land_category_candidates: categoryConflicts,
    review_flags: unique(list(primary.review_flags).concat(['DUPLICATE_TARGET_LAND_SOURCES_MERGED'], conflictFlags)),
    review_status_code: primary.review_status_code || 'NEEDS_REVIEW',
    confidence_level: conflictFlags.length ? 'LOW' : (primary.confidence_level || 'HIGH'),
    next_action: conflictFlags.length
      ? '동일 필지의 면적·지목 후보가 서로 달라 원문 대조 필요'
      : (primary.next_action || '편입토지 원문 대조 후 구조화 초안 반영 검토'),
    auto_confirmed: false,
  };
  return [merged];
}

function dedupeTargetLandCandidates(candidates) {
  const input = list(candidates);
  const groups = new Map();
  const passthrough = [];
  input.forEach((candidate, index) => {
    if (!candidate || candidate.candidate_type !== 'TARGET_LAND') {
      passthrough.push({ index, candidates: [candidate] });
      return;
    }
    const identity = targetLandIdentity(candidate);
    if (!identity) {
      passthrough.push({ index, candidates: [candidate] });
      return;
    }
    if (!groups.has(identity)) groups.set(identity, { index, group: [] });
    groups.get(identity).group.push(candidate);
  });

  groups.forEach((entry, identity) => {
    passthrough.push({ index: entry.index, candidates: mergeTargetGroup(entry.group, identity) });
  });

  return passthrough
    .sort((left, right) => left.index - right.index)
    .flatMap((entry) => entry.candidates)
    .filter(Boolean);
}

function diagnosticCount(store) {
  return list(store && store['00_extraction_review_notes']).length
    || list(store && store['00_extract_staging']).reduce((sum, staging) => sum + list(staging && staging.extraction_candidates).filter((candidate) => candidate && candidate.candidate_type === 'REVIEW_NOTE').length, 0);
}

function dedupeStoreTargetLands(store) {
  if (!store || typeof store !== 'object') return null;
  const before = list(store.structured_review_candidates);
  const after = dedupeTargetLandCandidates(before);
  store.structured_review_candidates = after;

  const global = list(store['00_extraction_candidates']);
  const retained = global.filter((candidate) => !(candidate
    && candidate.candidate_origin === STRUCTURED_ORIGIN
    && candidate.candidate_type === 'TARGET_LAND'));
  const targets = after.filter((candidate) => candidate && candidate.candidate_type === 'TARGET_LAND');
  store['00_extraction_candidates'] = [...retained, ...targets];

  if (!store.meta || typeof store.meta !== 'object' || Array.isArray(store.meta)) store.meta = {};
  const prior = store.meta.structured_review_runtime && typeof store.meta.structured_review_runtime === 'object'
    ? store.meta.structured_review_runtime
    : {};
  store.meta.structured_review_runtime = {
    ...prior,
    structured_count: after.length,
    diagnostic_count: diagnosticCount(store),
    target_land_before_dedupe: before.filter((candidate) => candidate && candidate.candidate_type === 'TARGET_LAND').length,
    target_land_after_dedupe: targets.length,
    target_land_dedupe_contract: CONTRACT_VERSION,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
  };

  return {
    contract_version: CONTRACT_VERSION,
    structured_before: before.length,
    structured_after: after.length,
    target_land_before: store.meta.structured_review_runtime.target_land_before_dedupe,
    target_land_after: targets.length,
    diagnostic_count: diagnosticCount(store),
    auto_confirmed: false,
  };
}

function updateWorkspaceCopy(store) {
  if (typeof document === 'undefined' || !store) return;
  const summary = document.querySelector('#candidateReviewWorkspace > summary');
  if (summary) {
    const structured = list(store.structured_review_candidates).length;
    const diagnostics = diagnosticCount(store);
    const desired = `검수 작업대 열기 · 구조화 후보 ${structured}건 · 진단메모 ${diagnostics}건`;
    if (summary.textContent !== desired) summary.textContent = desired;
  }
  document.querySelectorAll('#candidateReviewWorkspace .summary-grid .kv .k').forEach((label) => {
    const current = text(label.textContent);
    if (current.endsWith('초안 수')) label.textContent = current.replace(/초안 수$/, '초안 반영 수');
  });
}

function applyRuntimeTargetLandDedupe(options = {}) {
  const store = getStore();
  if (!store) return null;
  const result = dedupeStoreTargetLands(store);
  if (options.render !== false && typeof window.renderAll === 'function') {
    try { window.renderAll(); } catch (error) {}
  }
  updateWorkspaceCopy(store);
  return result;
}

function isFullReviewButton(event) {
  const button = event && event.target && event.target.closest ? event.target.closest('button') : null;
  return button && /전체\s*검수\s*시작/.test(button.textContent || '') ? button : null;
}

function installWorkspaceCopyObserver() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.__bsoWorkspaceCopyObserverInstalled) return;
  window.__bsoWorkspaceCopyObserverInstalled = true;
  const observer = new MutationObserver(() => {
    const store = getStore();
    if (store) updateWorkspaceCopy(store);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}

function installTargetLandDedupeBridge() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__bsoTargetLandDedupeInstalled) return;
  window.__bsoTargetLandDedupeInstalled = true;
  installWorkspaceCopyObserver();
  window.addEventListener('click', (event) => {
    if (!isFullReviewButton(event)) return;
    applyRuntimeTargetLandDedupe();
  }, true);
}

module.exports = {
  CONTRACT_VERSION,
  parcelIdentity,
  targetLandIdentity,
  dedupeTargetLandCandidates,
  dedupeStoreTargetLands,
  applyRuntimeTargetLandDedupe,
  installTargetLandDedupeBridge,
};
