(function releaseCoreFactory(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BosangReleaseCore = api;
}(typeof window !== 'undefined' ? window : globalThis, function createReleaseCore() {
  'use strict';

  const CONTRACT_VERSION = 'release-core/0.1';
  const ALLOWED_ROLES = Object.freeze(['SUBJECT', 'STANDARD', 'CASE', 'BIZ_ZONE']);
  const ROLE_STYLE = Object.freeze({
    SUBJECT: Object.freeze({ fill: '#FFD400', fillOpacity: 0.45, stroke: '#8A6D00', strokeWidth: 2.65, dash: '' }),
    STANDARD: Object.freeze({ fill: '#E03131', fillOpacity: 0.35, stroke: '#9C1C1C', strokeWidth: 3.4, dash: '' }),
    CASE: Object.freeze({ fill: '#2F6FDE', fillOpacity: 0.35, stroke: '#1C4CA0', strokeWidth: 3.4, dash: '' }),
    BIZ_ZONE: Object.freeze({ fill: '#8E44AD', fillOpacity: 0.29, stroke: '#6C3483', strokeWidth: 2.65, dash: '9 6' }),
  });
  const MAX_FEATURES = 250;
  const MAX_OMISSIONS = 1000;
  const MAX_VERTICES = 200000;
  const MAX_JSON_BYTES = 15 * 1024 * 1024;
  const SAFE_TOP_LEVEL_PREVIEW_KEYS = new Set([
    'schema_version', 'artifact_type', 'preview_id', 'coordinate_space', 'style_profile',
    'view', 'layers', 'omissions', 'warnings', 'provenance',
  ]);
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`);
    }
  }

  function rejectDangerousKeys(value, path) {
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach((key) => {
      if (DANGEROUS_KEYS.has(key)) throw new TypeError(`unsafe key at ${path}.${key}`);
      rejectDangerousKeys(value[key], `${path}.${key}`);
    });
  }

  function safeText(value, maxLength) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength || 160);
  }

  function escapeXml(value) {
    return safeText(value, 240)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeIdentifier(value, fallback) {
    const cleaned = String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 72);
    return cleaned.length >= 3 ? cleaned : fallback;
  }

  function safeFileName(value) {
    const name = String(value || '').split(/[\\/]/).pop() || 'browser-input.pdf';
    return safeText(name, 180).replace(/[<>:"|?*]/g, '_');
  }

  function fnv1a(value) {
    let hash = 0x811c9dc5;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  // 지목부호(측량·수로조사 및 지적에 관한 법률 시행령 제63조). 토지조서는 "임", 산출근거
  // 원문은 "임야"로 적는 법인이 섞여 있어 같은 필지가 갈라지는 것을 막는다.
  const LAND_CATEGORY_ABBREVIATIONS = Object.freeze({
    전: '전', 답: '답', 과: '과수원', 목: '목장용지', 임: '임야', 광: '광천지', 염: '염전',
    대: '대', 장: '공장용지', 학: '학교용지', 차: '주차장', 주: '주유소용지', 창: '창고용지',
    도: '도로', 철: '철도용지', 제: '제방', 천: '하천', 구: '구거', 유: '유지', 양: '양어장',
    수: '수도용지', 공: '공원', 체: '체육용지', 원: '유원지', 종: '종교용지', 사: '사적지',
    묘: '묘지', 잡: '잡종지',
  });
  const LOT_TOKEN_PATTERN = /(?:^|\s)((?:산)?\d{1,5}(?:-\d{1,5})?)(?:번지)?(?=\s|$)/g;

  function canonicalLandCategory(value) {
    const token = safeText(value, 20).replace(/\s+/g, '');
    return LAND_CATEGORY_ABBREVIATIONS[token] || token;
  }

  // 같은 필지를 법인마다 "샘플동 산7-1" / "익명시 샘플동 산7-1" 처럼 상위 행정구역을
  // 넣고 빼서 적는다. 지번과 최하위 행정동만 남겨야 두 평가서가 한 줄로 붙는다.
  function landAddressCore(address) {
    const text = safeText(address, 240).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const matches = [...text.matchAll(LOT_TOKEN_PATTERN)];
    if (matches.length !== 1) return text.replace(/\s+/g, '').toLowerCase();
    const match = matches[0];
    const lot = match[1];
    const prefixTokens = text.slice(0, match.index).trim().split(/\s+/).filter(Boolean);
    const lowest = prefixTokens.filter((token) => /(?:동|리|읍|면|가)$/.test(token)).pop()
      || prefixTokens[prefixTokens.length - 1]
      || '';
    return `${lowest}${lot}`.toLowerCase();
  }

  function normalizedLandSignature(land) {
    const address = landAddressCore(land && land.parcel_address);
    const category = canonicalLandCategory(land && land.land_category);
    const areaValue = Number(land && (land.area ?? land.area_sqm));
    const area = Number.isFinite(areaValue) ? String(Math.round(areaValue * 1000) / 1000) : '';
    return `${address}|${category}|${area}`;
  }

  function normalizedSourceRefs(refs, appraisalId, fileName) {
    return (Array.isArray(refs) ? refs : []).slice(0, 24).map((ref) => ({
      appraisal_id: appraisalId,
      file_name: fileName,
      page_no: Number.isInteger(Number(ref && ref.page_no)) ? Number(ref.page_no) : null,
      line_start: Number.isInteger(Number(ref && ref.line_start)) ? Number(ref.line_start) : null,
      line_end: Number.isInteger(Number(ref && ref.line_end)) ? Number(ref.line_end) : null,
      source_label: safeText(ref && ref.source_label, 80),
      raw_text_excerpt: safeText(ref && ref.raw_text_excerpt, 500),
    }));
  }

  // 협의 감정평가서의 "감정평가 세부내역" 붙임 발췌본에는 표지가 없어 법인명이 본문에
  // 한 번도 나오지 않는다. 그럴 때만 파일명 괄호에서 법인명 후보를 얻고, 출처를
  // FILE_NAME 으로 표시해 원문 추출값과 절대 같은 등급으로 취급하지 않는다.
  const FILE_NAME_COMPANY_STOPWORDS = new Set([
    '감정평가서', '평가서', '감정평가', '세부내역', '산출근거', '토지', '지장물', '영업',
    '협의', '보상', '수용재결', '이의재결', '재결', '수용', '이의', '초안', '최종', '사본',
    '요약', '검토용', '작성중', '원본', '스캔', '주', '주식회사',
  ]);

  function deriveCompanyFromFileName(fileName) {
    const base = safeFileName(fileName).replace(/\.[A-Za-z0-9]{1,6}$/, '');
    const candidates = [...base.matchAll(/[(（]([^()（）]{1,20})[)）]/g)]
      .map((match) => match[1].replace(/\s+/g, ''))
      .filter((value) => /^[가-힣A-Za-z0-9]{2,12}$/.test(value))
      .filter((value) => !/^\d+$/.test(value))
      .filter((value) => !/^\d+차$/.test(value))
      .filter((value) => !FILE_NAME_COMPANY_STOPWORDS.has(value));
    return candidates.length ? candidates[candidates.length - 1] : '';
  }

  // 파일명 후보는 확정값이 아니다. 검토자가 승격하기 전까지 출처와 검수상태를 함께 들고 다닌다.
  function withCompanyProvenance(appraisal, fileName) {
    const parsedCompany = safeText(appraisal && appraisal.appraisal_company, 160);
    if (parsedCompany) {
      return { appraisal_company: parsedCompany, appraisal_company_origin: 'PARSED_TEXT' };
    }
    const derived = deriveCompanyFromFileName(fileName);
    if (!derived) {
      return { appraisal_company: '', appraisal_company_origin: 'MISSING' };
    }
    return {
      appraisal_company: derived,
      appraisal_company_origin: 'FILE_NAME',
      appraisal_company_review_status: 'NEEDS_REVIEW',
      appraisal_company_note: '원문에 평가법인명이 없어 파일명에서 얻은 후보입니다. 확정값이 아니며 수동 확인이 필요합니다.',
    };
  }

  function reviewRecord(record, context, extra) {
    const copy = { ...(record || {}), ...(extra || {}) };
    copy.input_origin = 'BROWSER_PARSER_LAYER1';
    copy.source_upload_id = context.uploadId;
    copy.source_file_name = context.fileName;
    copy.review_status_code = 'NEEDS_REVIEW';
    copy.auto_confirmed = false;
    copy.source_refs = normalizedSourceRefs(copy.source_refs, context.appraisalId, context.fileName);
    return copy;
  }

  function isUserReviewedRecord(record) {
    const status = safeText(record && record.review_status_code, 60).toUpperCase();
    const ocrStatus = safeText(record && record.ocr_review_status, 60).toUpperCase();
    return status === 'CONFIRMED'
      || status === 'CONFIRMED_BY_USER'
      || status === 'MANUAL_EDITED'
      || ocrStatus === 'CONFIRMED_APPLIED';
  }

  function removePriorUpload(records, uploadId) {
    return (Array.isArray(records) ? records : []).filter((record) => !(
      record && record.input_origin === 'BROWSER_PARSER_LAYER1' && record.source_upload_id === uploadId && !isUserReviewedRecord(record)
    ));
  }

  function pushUnlessReviewed(records, record, idKey) {
    const existing = records.find((candidate) => candidate && candidate[idKey] === record[idKey]);
    if (existing && isUserReviewedRecord(existing)) return false;
    if (existing) records.splice(records.indexOf(existing), 1);
    records.push(record);
    return true;
  }

  function mergeParserResult(existingState, parsedCase, options) {
    assertPlainObject(existingState || {}, 'existingState');
    assertPlainObject(parsedCase, 'parsedCase');
    assertPlainObject(options, 'options');
    rejectDangerousKeys(parsedCase, 'parsedCase');
    const uploadId = safeIdentifier(options.uploadId, 'UPLOAD_BROWSER');
    const appraisalId = safeIdentifier(options.appraisalId || `APP_${uploadId}`, `APP_${fnv1a(uploadId)}`);
    const fileName = safeFileName(options.fileName || (parsedCase.meta && parsedCase.meta.input_file_name));
    const context = { uploadId, appraisalId, fileName };
    const patch = {
      appraisals: removePriorUpload(existingState.appraisals, uploadId),
      lands: (Array.isArray(existingState.lands) ? existingState.lands : []).map(clone),
      standard_lands: removePriorUpload(existingState.standard_lands, uploadId),
      land_appraisal_results: removePriorUpload(existingState.land_appraisal_results, uploadId),
      subject_to_standard_factor_comparisons: removePriorUpload(existingState.subject_to_standard_factor_comparisons, uploadId),
      appraisal_totals: removePriorUpload(existingState.appraisal_totals, uploadId),
    };

    patch.lands = patch.lands.filter((land) => {
      if (!land || land.input_origin !== 'BROWSER_PARSER_LAYER1') return true;
      const sources = (Array.isArray(land.source_upload_ids) ? land.source_upload_ids : [land.source_upload_id]).filter(Boolean);
      const remaining = sources.filter((id) => id !== uploadId);
      land.source_upload_ids = remaining;
      land.source_upload_id = remaining[0] || '';
      return remaining.length > 0 || isUserReviewedRecord(land);
    });

    // A reviewed parser land can legitimately have its identity fields edited.
    // Repair duplicates created by older reruns and retain the reviewed row.
    const dedupedLands = [];
    const landIndexById = new Map();
    patch.lands.forEach((land) => {
      const landId = safeText(land && land.land_id, 120);
      if (!landId || !landIndexById.has(landId)) {
        if (landId) landIndexById.set(landId, dedupedLands.length);
        dedupedLands.push(land);
        return;
      }
      const existingIndex = landIndexById.get(landId);
      if (isUserReviewedRecord(land) && !isUserReviewedRecord(dedupedLands[existingIndex])) {
        dedupedLands[existingIndex] = land;
      }
    });
    patch.lands = dedupedLands;

    const parsedAppraisals = Array.isArray(parsedCase.appraisals) ? parsedCase.appraisals : [];
    const parsedLands = Array.isArray(parsedCase.lands) ? parsedCase.lands : [];
    const parsedStandards = Array.isArray(parsedCase.standard_lands) ? parsedCase.standard_lands : [];
    const parsedResults = Array.isArray(parsedCase.land_appraisal_results) ? parsedCase.land_appraisal_results : [];
    const parsedAppraisal = parsedAppraisals[0] || null;
    if (parsedAppraisal) {
      patch.appraisals = patch.appraisals.filter((record) => !(
        record
        && record.upload_id === uploadId
        && record.input_origin !== 'BROWSER_PARSER_LAYER1'
        && !isUserReviewedRecord(record)
        && (record.file_type === 'PDF_UPLOADED' || /^UPLOAD_/.test(safeText(record.extraction_method, 80)))
      ));
      pushUnlessReviewed(patch.appraisals, reviewRecord(parsedAppraisal, context, {
        appraisal_id: appraisalId,
        upload_id: uploadId,
        file_name: fileName,
        ...withCompanyProvenance(parsedAppraisal, fileName),
      }), 'appraisal_id');
    }

    const landIdMap = new Map();
    const signatureToLand = new Map();
    const canonicalLandById = new Map();
    const currentCanonicalLandIds = new Set();
    patch.lands.forEach((land) => {
      const signature = normalizedLandSignature(land);
      if (signature !== '||' && !signatureToLand.has(signature)) signatureToLand.set(signature, land);
      if (land && land.land_id && !canonicalLandById.has(land.land_id)) canonicalLandById.set(land.land_id, land);
    });
    parsedLands.forEach((land, index) => {
      const signature = normalizedLandSignature(land);
      const generatedLandId = `RC_LAND_${fnv1a(signature || `${uploadId}|${index}`)}`;
      let canonical = signatureToLand.get(signature) || canonicalLandById.get(generatedLandId);
      if (!canonical) {
        canonical = reviewRecord(land, context, {
          land_id: generatedLandId,
          source_upload_ids: [uploadId],
        });
        patch.lands.push(canonical);
        canonicalLandById.set(generatedLandId, canonical);
      } else if (canonical.input_origin === 'BROWSER_PARSER_LAYER1') {
        canonical.source_upload_ids = Array.from(new Set([
          ...(Array.isArray(canonical.source_upload_ids) ? canonical.source_upload_ids : []),
          uploadId,
        ]));
        canonical.source_upload_id = canonical.source_upload_ids[0];
      }
      signatureToLand.set(signature, canonical);
      currentCanonicalLandIds.add(canonical.land_id);
      const parsedLandId = safeText(land && land.land_id, 120);
      if (parsedLandId) landIdMap.set(parsedLandId, canonical.land_id);
    });

    const resolvedCompany = parsedAppraisal
      ? withCompanyProvenance(parsedAppraisal, fileName).appraisal_company
      : '';
    const standardIdBySymbol = new Map();
    const currentStandardLandIds = new Set();
    parsedStandards.forEach((standard, index) => {
      const standardKey = [standard.standard_land_symbol, standard.parcel_address, standard.land_category, standard.area].join('|');
      const standardLandId = `${appraisalId}_STD_${fnv1a(standardKey || index)}`;
      pushUnlessReviewed(patch.standard_lands, reviewRecord(standard, context, {
        appraisal_id: appraisalId,
        standard_land_id: standardLandId,
        appraisal_company: parsedAppraisal ? resolvedCompany : standard.appraisal_company,
      }), 'standard_land_id');
      currentStandardLandIds.add(standardLandId);
      const symbol = safeText(standard && standard.standard_land_symbol, 80);
      if (symbol) {
        if (!standardIdBySymbol.has(symbol)) standardIdBySymbol.set(symbol, standardLandId);
        else if (standardIdBySymbol.get(symbol) !== standardLandId) standardIdBySymbol.set(symbol, null);
      }
    });
    const currentAppraisalResultIds = new Set();
    let unmatchedAppraisalResultCount = 0;
    parsedResults.forEach((result) => {
      const landId = landIdMap.get(safeText(result && result.land_id, 120));
      if (!landId) {
        unmatchedAppraisalResultCount += 1;
        return;
      }
      const explicitStandardId = safeText(result.standard_land_id, 120);
      const standardSymbol = safeText(result.standard_land_symbol, 80);
      const standardLandId = currentStandardLandIds.has(explicitStandardId)
        ? explicitStandardId
        : (standardIdBySymbol.get(standardSymbol)
          || (!standardSymbol && currentStandardLandIds.size === 1 ? [...currentStandardLandIds][0] : ''));
      const appraisalResultId = `${appraisalId}_LAR_${fnv1a(`${landId}|${result.parcel_address || ''}`)}`;
      pushUnlessReviewed(patch.land_appraisal_results, reviewRecord(result, context, {
        appraisal_result_id: appraisalResultId,
        appraisal_id: appraisalId,
        land_id: landId,
        standard_land_id: standardLandId,
        standard_land_link_method: explicitStandardId && standardLandId === explicitStandardId
          ? 'EXPLICIT_STANDARD_ID'
          : (standardSymbol && standardLandId ? 'UNIQUE_STANDARD_SYMBOL' : (standardLandId ? 'ONLY_PARSED_STANDARD' : 'UNRESOLVED')),
        appraisal_company: parsedAppraisal ? resolvedCompany : result.appraisal_company,
      }), 'appraisal_result_id');
      currentAppraisalResultIds.add(appraisalResultId);
    });
    // 개별요인 세부계수는 평가서에 명시된 행만 넘어온다. 여기서도 값을 만들지 않고
    // land_id / standard_land_id 만 통합 케이스 기준으로 다시 걸어 준다.
    let currentSubjectFactorCount = 0;
    (Array.isArray(parsedCase.subject_to_standard_factor_comparisons) ? parsedCase.subject_to_standard_factor_comparisons : []).forEach((comparison) => {
      const landId = landIdMap.get(safeText(comparison && comparison.land_id, 120));
      if (!landId) return;
      const standardSymbol = safeText(comparison.standard_land_symbol, 80);
      const explicitStandardId = safeText(comparison.standard_land_id, 120);
      const standardLandId = currentStandardLandIds.has(explicitStandardId)
        ? explicitStandardId
        : (standardIdBySymbol.get(standardSymbol) || '');
      pushUnlessReviewed(patch.subject_to_standard_factor_comparisons, reviewRecord(comparison, context, {
        comparison_id: `${appraisalId}_SSF_${fnv1a(landId)}`,
        appraisal_id: appraisalId,
        land_id: landId,
        standard_land_id: standardLandId,
        appraisal_company: resolvedCompany || comparison.appraisal_company,
      }), 'comparison_id');
      currentSubjectFactorCount += 1;
    });

    (Array.isArray(parsedCase.appraisal_totals) ? parsedCase.appraisal_totals : []).forEach((total, index) => {
      pushUnlessReviewed(patch.appraisal_totals, reviewRecord(total, context, {
        appraisal_total_id: `${appraisalId}_TOTAL_${String(index + 1).padStart(3, '0')}`,
        appraisal_id: appraisalId,
        appraisal_company: parsedAppraisal ? resolvedCompany : total.appraisal_company,
      }), 'appraisal_total_id');
    });

    const currentAppraisalResultCount = currentAppraisalResultIds.size;
    const currentLinkedStandardResultCount = [...currentAppraisalResultIds].filter((resultId) => {
      const row = patch.land_appraisal_results.find((candidate) => candidate && candidate.appraisal_result_id === resultId);
      return Boolean(row && currentStandardLandIds.has(safeText(row.standard_land_id, 120)));
    }).length;
    const droppedAppraisalCount = Math.max(0, parsedAppraisals.length - (parsedAppraisal ? 1 : 0));
    const droppedLandCount = Math.max(0, parsedLands.length - currentCanonicalLandIds.size);
    const droppedStandardLandCount = Math.max(0, parsedStandards.length - currentStandardLandIds.size);
    const droppedAppraisalResultCount = Math.max(0, parsedResults.length - currentAppraisalResultCount);
    const droppedParserRowCount = droppedAppraisalCount
      + droppedLandCount
      + droppedStandardLandCount
      + droppedAppraisalResultCount;

    const parsedCaseInfo = parsedCase.case && typeof parsedCase.case === 'object' ? parsedCase.case : {};
    const existingCase = existingState.case && typeof existingState.case === 'object' ? clone(existingState.case) : {};
    const mergedCase = { ...existingCase };
    ['case_name', 'project_name', 'base_date', 'price_date'].forEach((key) => {
      if ((mergedCase[key] === undefined || mergedCase[key] === null || mergedCase[key] === '') && parsedCaseInfo[key]) {
        mergedCase[key] = parsedCaseInfo[key];
      }
    });
    if (Object.keys(parsedCaseInfo).length) {
      mergedCase.review_status_code = mergedCase.review_status_code || 'NEEDS_REVIEW';
      mergedCase.auto_confirmed = mergedCase.auto_confirmed === true;
    }
    patch.case = mergedCase;
    patch.summary = {
      contract_version: CONTRACT_VERSION,
      upload_id: uploadId,
      appraisal_id: appraisalId,
      appraisal_count: parsedAppraisal ? 1 : 0,
      appraisal_company_count: resolvedCompany ? 1 : 0,
      appraisal_company_origin: parsedAppraisal ? withCompanyProvenance(parsedAppraisal, fileName).appraisal_company_origin : 'MISSING',
      land_count: currentCanonicalLandIds.size,
      standard_land_count: currentStandardLandIds.size,
      appraisal_result_count: currentAppraisalResultCount,
      subject_factor_comparison_count: currentSubjectFactorCount,
      linked_standard_result_count: currentLinkedStandardResultCount,
      raw_appraisal_count: parsedAppraisals.length,
      raw_land_count: parsedLands.length,
      raw_standard_land_count: parsedStandards.length,
      raw_appraisal_result_count: parsedResults.length,
      dropped_appraisal_count: droppedAppraisalCount,
      dropped_land_count: droppedLandCount,
      dropped_standard_land_count: droppedStandardLandCount,
      dropped_appraisal_result_count: droppedAppraisalResultCount,
      dropped_parser_row_count: droppedParserRowCount,
      unmatched_appraisal_result_count: unmatchedAppraisalResultCount,
      total_count: Array.isArray(parsedCase.appraisal_totals) ? parsedCase.appraisal_totals.length : 0,
      preserved_reviewed_count: [patch.appraisals, patch.lands, patch.standard_lands, patch.land_appraisal_results, patch.appraisal_totals]
        .flat().filter((row) => row && row.source_upload_id === uploadId && isUserReviewedRecord(row)).length,
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
    };
    // P0-PARSER-SUBJECT-LAND-ROWS 1단계: 파서 내부 편입토지 행 손실을 사유별로 요약에 올린다.
    // dropped_parser_row_count 는 병합 단계 축약만 재므로 추출 손실을 전혀 표현하지 못한다.
    const subjectLandExtraction = parsedCase.meta && typeof parsedCase.meta === 'object'
      ? parsedCase.meta.subject_land_extraction
      : null;
    if (subjectLandExtraction && typeof subjectLandExtraction === 'object') {
      const drops = subjectLandExtraction.drops && typeof subjectLandExtraction.drops === 'object'
        ? subjectLandExtraction.drops
        : {};
      const safeCount = (value) => Math.max(0, Math.trunc(Number(value) || 0));
      patch.summary.subject_land_section_line_count = safeCount(subjectLandExtraction.section_lines);
      patch.summary.subject_land_table_heading_line_count = safeCount(subjectLandExtraction.table_heading_lines);
      patch.summary.subject_land_non_numeric_line_count = safeCount(subjectLandExtraction.non_numeric_lines);
      patch.summary.subject_land_data_row_candidate_count = safeCount(subjectLandExtraction.data_row_candidates);
      patch.summary.subject_land_parsed_row_count = safeCount(subjectLandExtraction.parsed_rows);
      patch.summary.subject_land_lost_row_count = safeCount(subjectLandExtraction.lost_rows);
      patch.summary.subject_land_drop_missing_table_header = safeCount(drops.MISSING_TABLE_HEADER);
      patch.summary.subject_land_drop_missing_sequence_prefix = safeCount(drops.MISSING_SEQUENCE_PREFIX);
      patch.summary.subject_land_drop_unparsed_row = safeCount(drops.UNPARSED_ROW);
      patch.summary.subject_land_drop_duplicate_row = safeCount(drops.DUPLICATE_ROW);
    }
    const appraisalRowExtraction = parsedCase.meta && typeof parsedCase.meta === 'object'
      ? parsedCase.meta.appraisal_row_extraction
      : null;
    if (appraisalRowExtraction && typeof appraisalRowExtraction === 'object') {
      const safeCount = (value) => Math.max(0, Math.trunc(Number(value) || 0));
      patch.summary.appraisal_row_candidate_count = safeCount(appraisalRowExtraction.row_candidates);
      patch.summary.appraisal_row_parsed_count = safeCount(appraisalRowExtraction.parsed_rows);
      patch.summary.appraisal_row_continuation_count = safeCount(appraisalRowExtraction.continuation_lines);
      patch.summary.appraisal_row_unparsed_count = safeCount(appraisalRowExtraction.unparsed_rows);
      patch.summary.appraisal_row_matched_count = safeCount(appraisalRowExtraction.matched_rows);
      patch.summary.appraisal_row_duplicate_count = safeCount(appraisalRowExtraction.duplicate_rows);
      patch.summary.appraisal_row_unmatched_identity_count = safeCount(appraisalRowExtraction.unmatched_row_identity);
      patch.summary.appraisal_row_ambiguous_identity_count = safeCount(appraisalRowExtraction.ambiguous_row_identity);
      patch.summary.appraisal_row_unindexable_land_count = safeCount(appraisalRowExtraction.unindexable_lands);
      patch.summary.appraisal_row_unlinked_land_count = safeCount(appraisalRowExtraction.unlinked_lands);
      const reject = appraisalRowExtraction.reject && typeof appraisalRowExtraction.reject === 'object' ? appraisalRowExtraction.reject : null;
      if (reject) {
        const reasons = reject.reasons && typeof reject.reasons === 'object' ? reject.reasons : {};
        patch.summary.appraisal_row_reject_token_count_lt_6 = safeCount(reasons.TOKEN_COUNT_LT_6);
        patch.summary.appraisal_row_reject_section_vocab_match = safeCount(reasons.SECTION_VOCAB_MATCH);
        patch.summary.appraisal_row_reject_land_category_position_invalid = safeCount(reasons.LAND_CATEGORY_POSITION_INVALID);
        patch.summary.appraisal_row_reject_numeric_tokens_after_category_lt_3 = safeCount(reasons.NUMERIC_TOKENS_AFTER_CATEGORY_LT_3);
        patch.summary.appraisal_row_reject_appraisal_numeric_values_lt_2 = safeCount(reasons.APPRAISAL_NUMERIC_VALUES_LT_2);
        patch.summary.appraisal_row_reject_land_no_missing = safeCount(reasons.LAND_NO_MISSING);
        patch.summary.appraisal_row_reject_address_format_mismatch = safeCount(reasons.ADDRESS_FORMAT_MISMATCH);
        patch.summary.appraisal_row_reject_area_or_amount_null = safeCount(reasons.AREA_OR_AMOUNT_NULL);
        patch.summary.appraisal_row_reject_token_count_min = Number.isFinite(Number(reject.token_count_min)) ? Math.trunc(Number(reject.token_count_min)) : null;
        patch.summary.appraisal_row_reject_token_count_max = Number.isFinite(Number(reject.token_count_max)) ? Math.trunc(Number(reject.token_count_max)) : null;
        patch.summary.appraisal_row_reject_numeric_after_category_max = Number.isFinite(Number(reject.numeric_after_category_max)) ? Math.trunc(Number(reject.numeric_after_category_max)) : null;
        patch.summary.appraisal_row_reject_category_index_min = Number.isFinite(Number(reject.category_index_min)) ? Math.trunc(Number(reject.category_index_min)) : null;
        patch.summary.appraisal_row_reject_category_index_max = Number.isFinite(Number(reject.category_index_max)) ? Math.trunc(Number(reject.category_index_max)) : null;
        patch.summary.appraisal_row_reject_starts_with_address_count = safeCount(reject.starts_with_address_count);
      }
    }
    return patch;
  }

  function normalizeCrs(payload, isPreviewContract) {
    if (isPreviewContract) {
      const coordinateSpace = payload.coordinate_space || {};
      const crs = safeText(coordinateSpace.crs, 40).toUpperCase();
      if (!/^EPSG:\d{3,6}$/.test(crs)) throw new TypeError('preview coordinate_space.crs must be explicit EPSG code');
      if (coordinateSpace.axis_order !== 'XY' || Number(coordinateSpace.dimensions) !== 2) {
        throw new TypeError('preview coordinate space must use 2D XY axis order');
      }
      return crs;
    }
    let crs = 'EPSG:4326';
    if (payload.crs && payload.crs.properties && payload.crs.properties.name) {
      const match = String(payload.crs.properties.name).toUpperCase().match(/EPSG(?::|::)(\d{3,6})/);
      if (!match) throw new TypeError('GeoJSON CRS must be EPSG:4326');
      crs = `EPSG:${match[1]}`;
    }
    if (crs !== 'EPSG:4326') throw new TypeError('RFC 7946 GeoJSON must use EPSG:4326');
    return crs;
  }

  function sanitizeRole(value, fallback) {
    const role = safeText(value || fallback, 20).toUpperCase();
    if (!ALLOWED_ROLES.includes(role)) throw new TypeError(`unsupported feature role: ${role || 'missing'}`);
    return role;
  }

  function sanitizeRing(ring, counters) {
    if (!Array.isArray(ring) || ring.length < 4) throw new TypeError('polygon ring must contain at least four coordinates');
    const clean = ring.map((point) => {
      if (!Array.isArray(point) || point.length !== 2) throw new TypeError('coordinate must be an exact 2D array');
      const x = point[0];
      const y = point[1];
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError('coordinate values must be finite primitive numbers');
      }
      if (counters.geographic && (x < -180 || x > 180 || y < -90 || y > 90)) {
        throw new TypeError('EPSG:4326 coordinate is outside longitude/latitude bounds');
      }
      counters.vertices += 1;
      if (counters.vertices > MAX_VERTICES) throw new RangeError('PAYLOAD_LIMIT_EXCEEDED: vertex limit');
      return [x, y];
    });
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) throw new TypeError('polygon ring must be closed');
    return clean;
  }

  function ringHasPositiveArea(ring) {
    let xmin = Infinity;
    let ymin = Infinity;
    let xmax = -Infinity;
    let ymax = -Infinity;
    ring.forEach(([x, y]) => {
      xmin = Math.min(xmin, x);
      ymin = Math.min(ymin, y);
      xmax = Math.max(xmax, x);
      ymax = Math.max(ymax, y);
    });
    const spanX = xmax - xmin;
    const spanY = ymax - ymin;
    if (!Number.isFinite(spanX) || !Number.isFinite(spanY)) {
      throw new RangeError('map coordinates exceed the finite rendering range');
    }
    const normalizationScale = Math.max(spanX, spanY);
    if (!(normalizationScale > 0)) return false;
    let twiceArea = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const current = ring[index];
      const next = ring[index + 1];
      const currentX = (current[0] - xmin) / normalizationScale;
      const currentY = (current[1] - ymin) / normalizationScale;
      const nextX = (next[0] - xmin) / normalizationScale;
      const nextY = (next[1] - ymin) / normalizationScale;
      twiceArea += currentX * nextY - nextX * currentY;
    }
    return Number.isFinite(twiceArea) && Math.abs(twiceArea) > 1e-12 * ring.length;
  }

  function geometryHasPositiveExteriorArea(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.length > 0 && polygons.every((polygon) => polygon.length > 0 && ringHasPositiveArea(polygon[0]));
  }

  function sanitizeGeometry(geometry, counters) {
    assertPlainObject(geometry, 'feature.geometry');
    if (geometry.type === 'Polygon') {
      if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw new TypeError('Polygon coordinates are required');
      return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => sanitizeRing(ring, counters)) };
    }
    if (geometry.type === 'MultiPolygon') {
      if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw new TypeError('MultiPolygon coordinates are required');
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) => {
          if (!Array.isArray(polygon) || !polygon.length) throw new TypeError('MultiPolygon polygon is empty');
          return polygon.map((ring) => sanitizeRing(ring, counters));
        }),
      };
    }
    throw new TypeError(`unsupported geometry type: ${safeText(geometry.type, 40)}`);
  }

  function sanitizeFeature(feature, roleFallback, counters, index) {
    assertPlainObject(feature, 'feature');
    if (feature.type !== 'Feature') throw new TypeError('map entries must be GeoJSON Features');
    const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
    const fallbackRole = roleFallback ? sanitizeRole(roleFallback) : '';
    let role;
    if (fallbackRole) {
      if (properties.role !== undefined && properties.role !== null && properties.role !== '') {
        const declaredRole = sanitizeRole(properties.role);
        if (declaredRole !== fallbackRole) {
          throw new TypeError(`feature role ${declaredRole} does not match layer role ${fallbackRole}`);
        }
      }
      role = fallbackRole;
    } else {
      role = sanitizeRole(properties.role);
    }
    const geometry = sanitizeGeometry(feature.geometry, counters);
    if (role === 'SUBJECT' && !geometryHasPositiveExteriorArea(geometry)) {
      throw new TypeError('SUBJECT polygon must have non-zero area');
    }
    const featureRef = safeIdentifier(properties.feature_ref || feature.id, `feature_${String(index + 1).padStart(3, '0')}`);
    return {
      type: 'Feature',
      id: featureRef,
      geometry,
      properties: {
        feature_ref: featureRef,
        role,
        display_label: safeText(properties.display_label || `${role} ${index + 1}`, 80),
        recon_status: safeText(properties.recon_status, 40),
        mismatch_count: Number.isInteger(Number(properties.mismatch_count)) ? Math.max(0, Number(properties.mismatch_count)) : 0,
        source_refs: (Array.isArray(properties.source_refs) ? properties.source_refs : []).slice(0, 12).map((ref) => safeIdentifier(ref, 'source_ref')),
      },
    };
  }

  function optionalCount(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new TypeError(`${label} must be a non-negative integer`);
    return number;
  }

  function normalizedAvailability(value, renderableCount, missingCount) {
    const declared = safeText(value, 24).toUpperCase();
    const aliases = { COMPLETE: 'AVAILABLE', FULL: 'AVAILABLE' };
    const normalized = aliases[declared] || declared;
    if (normalized && !['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'].includes(normalized)) {
      throw new TypeError(`unsupported layer availability: ${normalized}`);
    }
    const derived = renderableCount > 0 ? (missingCount > 0 ? 'PARTIAL' : 'AVAILABLE') : 'UNAVAILABLE';
    if (normalized && normalized !== derived) {
      throw new TypeError(`layer availability ${normalized} conflicts with renderable/missing counts`);
    }
    return derived;
  }

  function sanitizeMapPreview(payload, options) {
    assertPlainObject(payload, 'map payload');
    rejectDangerousKeys(payload, 'map');
    const serializedLength = options && Number(options.byteLength);
    if (Number.isFinite(serializedLength) && serializedLength > MAX_JSON_BYTES) {
      throw new RangeError('PAYLOAD_LIMIT_EXCEEDED: JSON size');
    }
    const isPreviewContract = payload.artifact_type === 'LK_MAP_PREVIEW';
    if (isPreviewContract) {
      Object.keys(payload).forEach((key) => {
        if (!SAFE_TOP_LEVEL_PREVIEW_KEYS.has(key)) throw new TypeError(`unsupported preview field: ${key}`);
      });
      if (payload.schema_version !== '0.1') throw new TypeError('unsupported preview schema_version');
      if (!Array.isArray(payload.layers)) throw new TypeError('preview layers are required');
    } else if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
      throw new TypeError('expected LK_MAP_PREVIEW or GeoJSON FeatureCollection');
    }
    const crs = normalizeCrs(payload, isPreviewContract);
    const counters = { vertices: 0, geographic: crs === 'EPSG:4326' };
    const features = [];
    const rawLayerSummaries = [];
    if (isPreviewContract) {
      const seenRoles = new Set();
      payload.layers.forEach((layer) => {
        assertPlainObject(layer, 'preview layer');
        const role = sanitizeRole(layer.role);
        if (seenRoles.has(role)) throw new TypeError(`duplicate preview layer role: ${role}`);
        seenRoles.add(role);
        const collection = layer.feature_collection || {};
        if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
          throw new TypeError('preview layer feature_collection is invalid');
        }
        const startIndex = features.length;
        collection.features.forEach((feature) => features.push(sanitizeFeature(feature, role, counters, features.length)));
        rawLayerSummaries.push({
          role,
          source_layer: safeIdentifier(layer.source_layer, `${role.toLowerCase()}_parcels`),
          required: layer.required === undefined ? role === 'SUBJECT' : layer.required === true,
          availability: layer.availability,
          actual_renderable_count: features.length - startIndex,
          expected_count: optionalCount(layer.expected_count, `${role}.expected_count`),
          renderable_count: optionalCount(layer.renderable_count, `${role}.renderable_count`),
          missing_geometry_count: optionalCount(layer.missing_geometry_count, `${role}.missing_geometry_count`),
        });
      });
    } else {
      payload.features.forEach((feature) => features.push(sanitizeFeature(feature, '', counters, features.length)));
    }
    if (features.length > MAX_FEATURES) throw new RangeError('PAYLOAD_LIMIT_EXCEEDED: feature limit');
    if (!features.some((feature) => feature.properties.role === 'SUBJECT')) {
      throw new TypeError('at least one SUBJECT polygon is required');
    }
    const warnings = isPreviewContract && Array.isArray(payload.warnings)
      ? payload.warnings.slice(0, 24).map((warning) => ({
        code: safeIdentifier(warning && warning.code, 'MAP_WARNING'),
        role: warning && warning.role ? sanitizeRole(warning.role) : '',
        count: Number.isInteger(Number(warning && warning.count)) ? Math.max(0, Number(warning.count)) : 0,
      }))
      : [];
    const rawOmissions = isPreviewContract && Array.isArray(payload.omissions) ? payload.omissions : [];
    if (rawOmissions.length > MAX_OMISSIONS) {
      throw new RangeError('PAYLOAD_LIMIT_EXCEEDED: omission limit');
    }
    const omissions = isPreviewContract
      ? rawOmissions.map((omission) => ({
        code: safeIdentifier(omission && (omission.code || omission.reason_code), 'MAP_OMISSION'),
        role: omission && omission.role ? sanitizeRole(omission.role) : '',
        feature_ref: omission && omission.feature_ref ? safeIdentifier(omission.feature_ref, 'omitted_feature') : '',
        reason: safeText(omission && (omission.reason || omission.message), 120),
        count: omission && omission.count !== undefined
          ? optionalCount(omission.count, 'omission.count')
          : 1,
      }))
      : [];
    const omissionCounts = new Map();
    omissions.forEach((omission) => {
      if (!omission.role) return;
      omissionCounts.set(omission.role, (omissionCounts.get(omission.role) || 0) + omission.count);
    });
    const layers = isPreviewContract ? rawLayerSummaries.map((layer) => {
      const actualRenderable = layer.actual_renderable_count;
      if (layer.renderable_count !== null && layer.renderable_count !== actualRenderable) {
        throw new TypeError(`${layer.role}.renderable_count conflicts with feature count`);
      }
      const omitted = omissionCounts.get(layer.role) || 0;
      if (layer.missing_geometry_count !== null && layer.missing_geometry_count !== omitted) {
        throw new TypeError(`${layer.role}.missing_geometry_count conflicts with omissions`);
      }
      const missing = layer.missing_geometry_count === null ? omitted : layer.missing_geometry_count;
      const expected = layer.expected_count === null ? actualRenderable + missing : layer.expected_count;
      if (expected !== actualRenderable + missing) {
        throw new TypeError(`${layer.role}.expected_count conflicts with renderable/missing counts`);
      }
      return {
        role: layer.role,
        source_layer: layer.source_layer,
        required: layer.required,
        availability: normalizedAvailability(layer.availability, actualRenderable, missing),
        expected_count: expected,
        renderable_count: actualRenderable,
        missing_geometry_count: missing,
      };
    }) : ALLOWED_ROLES.map((role) => {
      const renderable = features.filter((feature) => feature.properties.role === role).length;
      return renderable ? {
        role,
        source_layer: '',
        required: role === 'SUBJECT',
        availability: 'AVAILABLE',
        expected_count: renderable,
        renderable_count: renderable,
        missing_geometry_count: 0,
      } : null;
    }).filter(Boolean);
    if (isPreviewContract) {
      const defaultSourceLayer = {
        SUBJECT: 'subject_parcels',
        STANDARD: 'standard_parcels',
        CASE: 'case_parcels',
        BIZ_ZONE: 'biz_zone',
      };
      const presentRoles = new Set(layers.map((layer) => layer.role));
      ALLOWED_ROLES.forEach((role) => {
        if (presentRoles.has(role)) return;
        const missing = omissionCounts.get(role) || 0;
        layers.push({
          role,
          source_layer: defaultSourceLayer[role],
          required: role === 'SUBJECT',
          availability: 'UNAVAILABLE',
          expected_count: missing,
          renderable_count: 0,
          missing_geometry_count: missing,
        });
        if (role !== 'SUBJECT' && !warnings.some((warning) => warning.role === role && /UNAVAILABLE/.test(warning.code))) {
          warnings.push({ code: `${role}_LAYER_UNAVAILABLE`, role, count: missing });
        }
      });
    }
    const provenance = isPreviewContract && payload.provenance && typeof payload.provenance === 'object'
      ? {
        input_sha256: safeText(payload.provenance.input && payload.provenance.input.sha256, 64).toLowerCase(),
        geometry_sha256: safeText(payload.provenance.geometry_sha256, 64).toLowerCase(),
        privacy_profile: safeText(payload.provenance.privacy_profile, 40),
      }
      : {};
    ['input_sha256', 'geometry_sha256'].forEach((key) => {
      if (provenance[key] && !/^[a-f0-9]{64}$/.test(provenance[key])) throw new TypeError(`invalid ${key}`);
    });
    return {
      contract_version: CONTRACT_VERSION,
      schema_version: isPreviewContract ? payload.schema_version : 'RFC7946',
      artifact_type: isPreviewContract ? 'LK_MAP_PREVIEW' : 'GEOJSON_PREVIEW',
      preview_id: safeIdentifier(payload.preview_id, `preview_${fnv1a(`${crs}|${features.length}|${counters.vertices}`)}`),
      crs,
      style_profile: isPreviewContract ? safeText(payload.style_profile, 40) || 'LK_ROLE_STYLE_V1' : 'LK_ROLE_STYLE_V1',
      features,
      layers,
      warnings,
      omissions,
      provenance,
      vertex_count: counters.vertices,
    };
  }

  function parseMapPreviewJson(text) {
    const source = String(text || '');
    if (!source.trim()) throw new TypeError('map JSON is empty');
    if (typeof TextEncoder !== 'undefined' && new TextEncoder().encode(source).byteLength > MAX_JSON_BYTES) {
      throw new RangeError('PAYLOAD_LIMIT_EXCEEDED: JSON size');
    }
    if (/(?:"__proto__"|"constructor"|"prototype")\s*:/.test(source)) {
      throw new TypeError('unsafe map JSON key');
    }
    assertNoDuplicateJsonKeys(source);
    const payload = JSON.parse(source);
    return sanitizeMapPreview(payload, { byteLength: source.length });
  }

  function assertNoDuplicateJsonKeys(source) {
    let index = 0;
    const text = String(source || '');
    function skipWhitespace() { while (/\s/.test(text[index] || '')) index += 1; }
    function parseString() {
      const start = index;
      if (text[index] !== '"') throw new SyntaxError(`expected JSON string at ${index}`);
      index += 1;
      let escaped = false;
      while (index < text.length) {
        const char = text[index];
        index += 1;
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (char === '"') return JSON.parse(text.slice(start, index));
      }
      throw new SyntaxError('unterminated JSON string');
    }
    function parseValue(depth) {
      if (depth > 64) throw new RangeError('map JSON nesting limit exceeded');
      skipWhitespace();
      if (text[index] === '{') { parseObject(depth + 1); return; }
      if (text[index] === '[') { parseArray(depth + 1); return; }
      if (text[index] === '"') { parseString(); return; }
      const start = index;
      while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
      if (start === index) throw new SyntaxError(`invalid JSON value at ${index}`);
    }
    function parseObject(depth) {
      index += 1;
      const keys = new Set();
      skipWhitespace();
      if (text[index] === '}') { index += 1; return; }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new TypeError(`duplicate JSON key: ${safeText(key, 80)}`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') throw new SyntaxError(`expected colon at ${index}`);
        index += 1;
        parseValue(depth);
        skipWhitespace();
        if (text[index] === '}') { index += 1; return; }
        if (text[index] !== ',') throw new SyntaxError(`expected object separator at ${index}`);
        index += 1;
      }
      throw new SyntaxError('unterminated JSON object');
    }
    function parseArray(depth) {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') { index += 1; return; }
      while (index < text.length) {
        parseValue(depth);
        skipWhitespace();
        if (text[index] === ']') { index += 1; return; }
        if (text[index] !== ',') throw new SyntaxError(`expected array separator at ${index}`);
        index += 1;
      }
      throw new SyntaxError('unterminated JSON array');
    }
    parseValue(0);
    skipWhitespace();
    if (index !== text.length) throw new SyntaxError(`unexpected JSON content at ${index}`);
  }

  function eachPoint(geometry, callback) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach((point) => callback(point))));
  }

  function previewBounds(preview) {
    let xmin = Infinity;
    let ymin = Infinity;
    let xmax = -Infinity;
    let ymax = -Infinity;
    preview.features.forEach((feature) => eachPoint(feature.geometry, ([x, y]) => {
      xmin = Math.min(xmin, x);
      ymin = Math.min(ymin, y);
      xmax = Math.max(xmax, x);
      ymax = Math.max(ymax, y);
    }));
    if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) throw new TypeError('map extent is empty');
    return { xmin, ymin, xmax, ymax };
  }

  function pathForGeometry(geometry, project) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map((polygon) => polygon.map((ring) => ring.map((point, index) => {
      const projected = project(point);
      return `${index === 0 ? 'M' : 'L'}${projected[0].toFixed(2)} ${projected[1].toFixed(2)}`;
    }).join(' ') + ' Z').join(' ')).join(' ');
  }

  function buildSvgMarkup(preview, options) {
    assertPlainObject(preview, 'sanitized map preview');
    const previewCrs = safeText(preview.crs || 'EPSG:4326', 40).toUpperCase();
    if (!/^EPSG:\d{3,6}$/.test(previewCrs)) throw new TypeError('render preview CRS must be an explicit EPSG code');
    const renderFeatures = Array.isArray(preview.features) ? preview.features : [];
    const groupedFeatures = new Map();
    renderFeatures.forEach((feature) => {
      const role = feature && feature.properties && feature.properties.role;
      if (!groupedFeatures.has(role)) groupedFeatures.set(role, []);
      groupedFeatures.get(role).push(feature);
    });
    const safePreview = sanitizeMapPreview({
      schema_version: '0.1',
      artifact_type: 'LK_MAP_PREVIEW',
      preview_id: preview.preview_id,
      coordinate_space: { crs: previewCrs, axis_order: 'XY', dimensions: 2 },
      style_profile: preview.style_profile,
      layers: Array.from(groupedFeatures.entries()).map(([role, features]) => ({
        role,
        feature_collection: { type: 'FeatureCollection', features },
      })),
      warnings: preview.warnings,
      omissions: preview.omissions,
    });
    const requestedWidth = Number(options && options.width);
    const requestedHeight = Number(options && options.height);
    const width = Number.isFinite(requestedWidth) && requestedWidth >= 64 && requestedWidth <= 10000 ? requestedWidth : 1000;
    const height = Number.isFinite(requestedHeight) && requestedHeight >= 64 && requestedHeight <= 10000 ? requestedHeight : 620;
    const requestedPadding = Number(options && options.padding);
    const basePadding = Number.isFinite(requestedPadding) ? requestedPadding : 38;
    const padding = Math.min(
      Math.max(0, Math.min(100, basePadding)),
      Math.max(0, Math.min(width, height) / 2 - 1),
    );
    const bounds = previewBounds(safePreview);
    const rawSpanX = bounds.xmax - bounds.xmin;
    const rawSpanY = bounds.ymax - bounds.ymin;
    if (!Number.isFinite(rawSpanX) || !Number.isFinite(rawSpanY)) {
      throw new RangeError('map extent exceeds the finite rendering range');
    }
    const spanX = rawSpanX > 0 ? rawSpanX : 1;
    const spanY = rawSpanY > 0 ? rawSpanY : 1;
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
    if (!Number.isFinite(scale) || !(scale > 0)) throw new RangeError('map scale is not finite and positive');
    const usedWidth = spanX * scale;
    const usedHeight = spanY * scale;
    const offsetX = (width - usedWidth) / 2;
    const offsetY = (height - usedHeight) / 2;
    if (![usedWidth, usedHeight, offsetX, offsetY].every(Number.isFinite)) {
      throw new RangeError('map viewport calculation is not finite');
    }
    const project = ([x, y]) => {
      const projected = [offsetX + (x - bounds.xmin) * scale, height - offsetY - (y - bounds.ymin) * scale];
      if (!projected.every(Number.isFinite)) throw new RangeError('projected map coordinate is not finite');
      return projected;
    };
    const drawOrder = { BIZ_ZONE: 0, CASE: 1, STANDARD: 2, SUBJECT: 3 };
    const ordered = safePreview.features.map((feature, index) => ({ feature, index }))
      .sort((a, b) => drawOrder[a.feature.properties.role] - drawOrder[b.feature.properties.role]);
    const paths = ordered.map(({ feature, index }) => {
      const role = feature.properties.role;
      const style = ROLE_STYLE[role];
      const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : '';
      return `<path d="${pathForGeometry(feature.geometry, project)}" fill="${style.fill}" fill-opacity="${style.fillOpacity}" fill-rule="evenodd" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" vector-effect="non-scaling-stroke"${dash} data-feature-index="${index}" tabindex="0" role="button" aria-label="${escapeXml(feature.properties.display_label)}"/>`;
    }).join('');
    return `<svg class="release-map-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="검토도 개략 미리보기"><rect width="${width}" height="${height}" fill="#eef2f7"/>${paths}</svg>`;
  }

  function textItemsToRows(items) {
    const source = Array.isArray(items) ? items : [];
    const positioned = [];
    const fallback = [];
    source.forEach((item, index) => {
      const text = String(item && item.str || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const transform = item && item.transform;
      if (Array.isArray(transform) && Number.isFinite(Number(transform[4])) && Number.isFinite(Number(transform[5]))) {
        positioned.push({ text, x: Number(transform[4]), y: Number(transform[5]), width: Number(item.width) || 0, index });
      } else {
        fallback.push({ text, index });
      }
    });
    if (!positioned.length) return fallback.map((item) => item.text).join(' ').trim();
    positioned.sort((a, b) => Math.abs(a.y - b.y) > 2.4 ? b.y - a.y : a.x - b.x);
    const rows = [];
    positioned.forEach((item) => {
      let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2.4);
      if (!row) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    });
    rows.sort((a, b) => b.y - a.y);
    const lines = rows.map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ').trim()).filter(Boolean);
    if (fallback.length) lines.push(fallback.sort((a, b) => a.index - b.index).map((item) => item.text).join(' '));
    return lines.join('\n').trim();
  }

  return Object.freeze({
    CONTRACT_VERSION,
    ALLOWED_ROLES,
    ROLE_STYLE,
    MAX_FEATURES,
    MAX_VERTICES,
    MAX_JSON_BYTES,
    buildSvgMarkup,
    canonicalLandCategory,
    deriveCompanyFromFileName,
    landAddressCore,
    mergeParserResult,
    normalizedLandSignature,
    parseMapPreviewJson,
    assertNoDuplicateJsonKeys,
    sanitizeMapPreview,
    textItemsToRows,
  });
}));
