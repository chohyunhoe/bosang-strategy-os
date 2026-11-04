'use strict';

const assert = require('node:assert/strict');
const {
  buildSvgMarkup,
  deriveCompanyFromFileName,
  mergeParserResult,
  normalizedLandSignature,
  parseMapPreviewJson,
  sanitizeMapPreview,
  textItemsToRows,
} = require('../browser/release-core');

function sourceRef(line = 1) {
  return {
    appraisal_id: 'APP_PARSED_001',
    file_name: 'anonymous-input.pdf',
    page_no: 2,
    line_start: line,
    line_end: line,
    source_label: '토지가액 산출근거',
    raw_text_excerpt: 'SYNTHETIC REVIEW ROW',
  };
}

function parsedCaseFixture() {
  return {
    meta: {
      input_file_name: '/untrusted/source/path.pdf',
    },
    case: {
      case_name: '익명 사건',
      project_name: '파서 프로젝트',
      base_date: '2026-07-31',
    },
    appraisals: [{
      appraisal_id: 'APP_PARSED_001',
      appraisal_company: '익명감정평가법인',
      review_status_code: 'CONFIRMED',
      auto_confirmed: true,
      source_refs: [sourceRef()],
    }],
    lands: [
      {
        land_id: 'PARSED_LAND_001',
        parcel_address: '익명시 샘플동 1-1',
        land_category: '전',
        area: '480.0',
        review_status_code: 'CONFIRMED',
        auto_confirmed: true,
        source_refs: [sourceRef(10)],
      },
      {
        land_id: 'PARSED_LAND_002',
        parcel_address: '익명시 샘플동 2-2',
        land_category: '답',
        area: '612',
        review_status_code: 'CONFIRMED',
        auto_confirmed: true,
        source_refs: [sourceRef(11)],
      },
    ],
    standard_lands: [{
      standard_land_id: 'PARSED_STD_001',
      symbol: 'A',
      parcel_address: '익명시 비교동 1-1',
      review_status_code: 'CONFIRMED',
      auto_confirmed: true,
      source_refs: [sourceRef(20)],
    }],
    land_appraisal_results: [
      {
        appraisal_result_id: 'PARSED_RESULT_001',
        appraisal_id: 'APP_PARSED_001',
        land_id: 'PARSED_LAND_001',
        official_price: '238000',
        unit_price: '811000',
        amount: '389280000',
        review_status_code: 'CONFIRMED',
        auto_confirmed: true,
        source_refs: [sourceRef(30)],
      },
      {
        appraisal_result_id: 'PARSED_RESULT_002',
        appraisal_id: 'APP_PARSED_001',
        land_id: 'PARSED_LAND_002',
        official_price: '137000',
        unit_price: '420000',
        amount: '257040000',
        review_status_code: 'CONFIRMED',
        auto_confirmed: true,
        source_refs: [sourceRef(31)],
      },
    ],
    appraisal_totals: [{
      appraisal_total_id: 'PARSED_TOTAL_001',
      appraisal_id: 'APP_PARSED_001',
      appraisal_company: '익명감정평가법인',
      total_amount: '646320000',
      review_status_code: 'CONFIRMED',
      auto_confirmed: true,
      source_refs: [sourceRef(40)],
    }],
  };
}

function mergeOptions() {
  return {
    uploadId: 'UPLOAD_BROWSER_001',
    appraisalId: 'APP_BROWSER_001',
    fileName: 'C:\\private\\operator\\unsafe<name>.pdf',
  };
}

function testParserMergePreservesConfirmedLandAndIsIdempotent() {
  const confirmedLand = {
    land_id: 'LAND_CONFIRMED_001',
    parcel_address: '익명시 샘플동 1-1',
    land_category: '전',
    area: 480,
    review_status_code: 'CONFIRMED',
    auto_confirmed: false,
    confirmed_by: 'manual-reviewer',
    manual_note: '사용자 확인값 보존',
  };
  const existingState = {
    case: {
      project_name: '사용자 프로젝트',
      review_status_code: 'CONFIRMED',
    },
    appraisals: [],
    lands: [confirmedLand],
    standard_lands: [],
    land_appraisal_results: [],
    appraisal_totals: [],
  };
  const before = JSON.stringify(existingState);
  const first = mergeParserResult(existingState, parsedCaseFixture(), mergeOptions());

  assert.equal(JSON.stringify(existingState), before, 'parser merge must not mutate the existing state');
  assert.deepEqual(first.lands.find((land) => land.land_id === confirmedLand.land_id), confirmedLand);
  assert.equal(first.case.project_name, '사용자 프로젝트', 'parser values must not replace existing case values');
  assert.equal(first.case.case_name, '익명 사건', 'empty case fields may be added as review data');
  assert.equal(first.lands.length, 2, 'matching parser land must reuse the existing canonical land');
  assert.equal(first.land_appraisal_results.length, 2);
  assert.equal(first.land_appraisal_results[0].land_id, confirmedLand.land_id);

  const generatedRows = [
    ...first.appraisals,
    ...first.lands.filter((row) => row.input_origin === 'BROWSER_PARSER_LAYER1'),
    ...first.standard_lands,
    ...first.land_appraisal_results,
    ...first.appraisal_totals,
  ];
  assert.ok(generatedRows.length > 0);
  assert.ok(generatedRows.every((row) => row.review_status_code === 'NEEDS_REVIEW'));
  assert.ok(generatedRows.every((row) => row.auto_confirmed === false));
  assert.ok(generatedRows.every((row) => row.source_upload_id === 'UPLOAD_BROWSER_001'));
  assert.ok(generatedRows.every((row) => row.source_file_name === 'unsafe_name_.pdf'));
  assert.ok(generatedRows.every((row) => !row.source_file_name.includes('private')));
  assert.equal(first.summary.review_status_code, 'NEEDS_REVIEW');
  assert.equal(first.summary.auto_confirmed, false);

  const stateAfterFirstRun = {
    ...existingState,
    ...first,
  };
  const second = mergeParserResult(stateAfterFirstRun, parsedCaseFixture(), mergeOptions());
  assert.deepEqual(second, first, 'rerunning the same upload must replace generated rows without duplicates');
  assert.equal(new Set(second.appraisals.map((row) => row.appraisal_id)).size, second.appraisals.length);
  assert.equal(new Set(second.lands.map((row) => row.land_id)).size, second.lands.length);
  assert.equal(new Set(second.standard_lands.map((row) => row.standard_land_id)).size, second.standard_lands.length);
  assert.equal(new Set(second.land_appraisal_results.map((row) => row.appraisal_result_id)).size, second.land_appraisal_results.length);
  assert.equal(new Set(second.appraisal_totals.map((row) => row.appraisal_total_id)).size, second.appraisal_totals.length);

  const confirmedResultId = first.land_appraisal_results[0].appraisal_result_id;
  const reviewedState = {
    ...stateAfterFirstRun,
    land_appraisal_results: first.land_appraisal_results.map((row) => row.appraisal_result_id === confirmedResultId
      ? { ...row, amount: 123456789, review_status_code: 'CONFIRMED', manual_note: '사용자 원문 대조 완료' }
      : row),
  };
  const afterReviewedRerun = mergeParserResult(reviewedState, parsedCaseFixture(), mergeOptions());
  const preservedResult = afterReviewedRerun.land_appraisal_results.find((row) => row.appraisal_result_id === confirmedResultId);
  assert.equal(preservedResult.amount, 123456789, 'rerun must preserve user-reviewed parser values');
  assert.equal(preservedResult.review_status_code, 'CONFIRMED');
  assert.equal(preservedResult.manual_note, '사용자 원문 대조 완료');
  assert.equal(afterReviewedRerun.summary.preserved_reviewed_count, 1);

  const generatedLand = first.lands.find((row) => row.input_origin === 'BROWSER_PARSER_LAYER1');
  const generatedStandard = first.standard_lands[0];
  const manuallyEditedState = {
    ...stateAfterFirstRun,
    lands: first.lands.map((row) => row.land_id === generatedLand.land_id
      ? {
        ...row,
        parcel_address: '사용자 확인 주소',
        land_category: '대',
        area: 777,
        review_status_code: 'MANUAL_EDITED',
        manual_note: '주소·지목·면적 원문 수정',
      }
      : row),
    standard_lands: first.standard_lands.map((row) => row.standard_land_id === generatedStandard.standard_land_id
      ? { ...row, official_price: 999, review_status_code: 'CONFIRMED_BY_USER' }
      : row),
  };
  const afterManualRerun = mergeParserResult(manuallyEditedState, parsedCaseFixture(), mergeOptions());
  assert.equal(afterManualRerun.lands.length, first.lands.length, 'edited land identity fields must not create a duplicate row');
  assert.equal(new Set(afterManualRerun.lands.map((row) => row.land_id)).size, afterManualRerun.lands.length);
  assert.equal(afterManualRerun.lands.find((row) => row.land_id === generatedLand.land_id).parcel_address, '사용자 확인 주소');
  assert.equal(afterManualRerun.lands.find((row) => row.land_id === generatedLand.land_id).land_category, '대');
  assert.equal(afterManualRerun.lands.find((row) => row.land_id === generatedLand.land_id).area, 777);
  assert.equal(afterManualRerun.lands.find((row) => row.land_id === generatedLand.land_id).review_status_code, 'MANUAL_EDITED');
  assert.equal(afterManualRerun.standard_lands.find((row) => row.standard_land_id === generatedStandard.standard_land_id).official_price, 999);
  assert.equal(afterManualRerun.standard_lands.find((row) => row.standard_land_id === generatedStandard.standard_land_id).review_status_code, 'CONFIRMED_BY_USER');

  const legacyOcrState = {
    ...stateAfterFirstRun,
    land_appraisal_results: first.land_appraisal_results.map((row) => row.appraisal_result_id === confirmedResultId
      ? { ...row, amount: 987654321, review_status_code: 'NEEDS_REVIEW', ocr_review_status: 'CONFIRMED_APPLIED' }
      : row),
  };
  const afterLegacyOcrRerun = mergeParserResult(legacyOcrState, parsedCaseFixture(), mergeOptions());
  assert.equal(
    afterLegacyOcrRerun.land_appraisal_results.find((row) => row.appraisal_result_id === confirmedResultId).amount,
    987654321,
    'older OCR-applied values must remain reviewed across parser reruns',
  );
}

function testStandardLinkingAndUploadPlaceholderCanonicalization() {
  const patch = mergeParserResult({
    appraisals: [{
      appraisal_id: 'APP_UPLOAD_PLACEHOLDER',
      upload_id: 'UPLOAD_LINKING',
      file_type: 'PDF_UPLOADED',
      appraisal_company: '',
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
    }],
    lands: [],
    standard_lands: [],
    land_appraisal_results: [],
    appraisal_totals: [],
  }, {
    case: {},
    appraisals: [{ appraisal_company: '익명감정평가법인' }],
    lands: [
      { land_id: 'LAND_LINK_1', parcel_address: '익명시 샘플동 1-1', land_category: '답', area: 900 },
      { land_id: 'LAND_LINK_2', parcel_address: '익명시 샘플동 2-2', land_category: '답', area: 500 },
    ],
    standard_lands: [{ standard_land_symbol: '라', parcel_address: '익명시 비교동 10-1', land_category: '답', area: 1200, official_price: 350000 }],
    land_appraisal_results: [
      { land_id: 'LAND_LINK_1', parcel_address: '익명시 샘플동 1-1', standard_land_symbol: '' },
      { land_id: 'LAND_LINK_2', parcel_address: '익명시 샘플동 2-2', standard_land_symbol: '' },
    ],
    appraisal_totals: [],
  }, { uploadId: 'UPLOAD_LINKING', appraisalId: 'APP_LINKING', fileName: 'anonymous.pdf' });

  assert.equal(patch.appraisals.length, 1, 'the parser appraisal must replace its unreviewed upload placeholder');
  assert.equal(patch.appraisals[0].input_origin, 'BROWSER_PARSER_LAYER1');
  assert.equal(patch.summary.linked_standard_result_count, 2);
  assert.ok(patch.land_appraisal_results.every(row => row.standard_land_link_method === 'ONLY_PARSED_STANDARD'));
  assert.ok(patch.land_appraisal_results.every(row => row.standard_land_id === patch.standard_lands[0].standard_land_id));

  const ambiguous = mergeParserResult({
    appraisals: [], lands: [], standard_lands: [], land_appraisal_results: [], appraisal_totals: [],
  }, {
    case: {},
    appraisals: [{ appraisal_company: '익명감정평가법인' }],
    lands: [{ land_id: 'LAND_AMBIGUOUS', parcel_address: '익명시 샘플동 1-1', land_category: '답', area: 900 }],
    standard_lands: [
      { standard_land_symbol: 'A', parcel_address: '익명시 비교동 10-1', land_category: '답', area: 1200, official_price: 350000 },
      { standard_land_symbol: 'B', parcel_address: '익명시 비교동 10-2', land_category: '답', area: 1300, official_price: 350000 },
    ],
    land_appraisal_results: [{ land_id: 'LAND_AMBIGUOUS', parcel_address: '익명시 샘플동 1-1', standard_land_symbol: '' }],
    appraisal_totals: [],
  }, { uploadId: 'UPLOAD_AMBIGUOUS', appraisalId: 'APP_AMBIGUOUS', fileName: 'anonymous.pdf' });

  assert.equal(ambiguous.summary.linked_standard_result_count, 0, 'multiple standards must not be guessed');
  assert.equal(ambiguous.land_appraisal_results[0].standard_land_link_method, 'UNRESOLVED');
}

function testParserSummaryCountsCanonicalPersistedRowsAndDroppedInputs() {
  const emptyState = {
    appraisals: [], lands: [], standard_lands: [], land_appraisal_results: [], appraisal_totals: [],
  };
  const duplicatePatch = mergeParserResult(emptyState, {
    case: {},
    appraisals: [{ appraisal_company: '익명감정평가법인' }],
    lands: [
      { land_id: 'RAW_LAND_A', parcel_address: '익명시 중복동 1-1', land_category: '답', area: 480 },
      { land_id: 'RAW_LAND_B', parcel_address: '익명시 중복동 1-1', land_category: '답', area: 480 },
    ],
    standard_lands: [{ standard_land_symbol: 'A', parcel_address: '익명시 비교동 3-1', land_category: '답', area: 900 }],
    land_appraisal_results: [
      { land_id: 'RAW_LAND_A', parcel_address: '익명시 중복동 1-1', standard_land_symbol: 'A' },
      { land_id: 'RAW_LAND_B', parcel_address: '익명시 중복동 1-1', standard_land_symbol: 'A' },
    ],
    appraisal_totals: [],
  }, { uploadId: 'UPLOAD_DUPLICATE', appraisalId: 'APP_DUPLICATE', fileName: 'duplicate.pdf' });

  assert.equal(duplicatePatch.summary.raw_land_count, 2);
  assert.equal(duplicatePatch.summary.raw_appraisal_result_count, 2);
  assert.equal(duplicatePatch.summary.land_count, 1, 'summary must count one canonical persisted land');
  assert.equal(duplicatePatch.summary.appraisal_result_count, 1, 'summary must count one canonical persisted result');
  assert.equal(duplicatePatch.summary.dropped_land_count, 1);
  assert.equal(duplicatePatch.summary.dropped_appraisal_result_count, 1);
  assert.equal(duplicatePatch.summary.dropped_parser_row_count, 2);
  assert.equal(duplicatePatch.lands.length, 1);
  assert.equal(duplicatePatch.land_appraisal_results.length, 1);

  const unmatchedPatch = mergeParserResult(emptyState, {
    case: {},
    appraisals: [{ appraisal_company: '익명감정평가법인' }],
    lands: [
      { land_id: 'LAND_MATCH_A', parcel_address: '익명시 샘플동 1-1', land_category: '답', area: 480 },
      { land_id: 'LAND_MATCH_B', parcel_address: '익명시 샘플동 2-2', land_category: '답', area: 612 },
    ],
    standard_lands: [{ standard_land_symbol: 'A', parcel_address: '익명시 비교동 3-1', land_category: '답', area: 900 }],
    land_appraisal_results: [
      { land_id: 'LAND_MATCH_A', parcel_address: '익명시 샘플동 1-1', standard_land_symbol: 'A' },
      { land_id: 'LAND_MATCH_B', parcel_address: '익명시 샘플동 2-2', standard_land_symbol: 'A' },
      { land_id: 'LAND_NOT_PRESENT', parcel_address: '익명시 샘플동 9-9', standard_land_symbol: 'A' },
    ],
    appraisal_totals: [],
  }, { uploadId: 'UPLOAD_UNMATCHED', appraisalId: 'APP_UNMATCHED', fileName: 'unmatched.pdf' });

  assert.equal(unmatchedPatch.summary.raw_appraisal_result_count, 3);
  assert.equal(unmatchedPatch.summary.appraisal_result_count, 2);
  assert.equal(unmatchedPatch.summary.dropped_appraisal_result_count, 1);
  assert.equal(unmatchedPatch.summary.unmatched_appraisal_result_count, 1);
  assert.equal(unmatchedPatch.land_appraisal_results.length, 2, 'an unmatched parser result must not be persisted under a guessed land');
}

function polygonFeature(role, coordinates, overrides = {}) {
  return {
    type: 'Feature',
    id: `${role.toLowerCase()}_001`,
    properties: {
      role,
      feature_ref: `${role.toLowerCase()}_001`,
      display_label: `${role} 예시`,
      ...overrides,
    },
    geometry: {
      type: 'Polygon',
      coordinates,
    },
  };
}

function validFeatureCollection() {
  return {
    type: 'FeatureCollection',
    crs: {
      type: 'name',
      properties: { name: 'urn:ogc:def:crs:EPSG::4326' },
    },
    features: [
      polygonFeature('SUBJECT', [[
        [127.0, 36.0],
        [127.01, 36.0],
        [127.01, 36.01],
        [127.0, 36.0],
      ]]),
      {
        type: 'Feature',
        id: 'standard_001',
        properties: {
          role: 'STANDARD',
          feature_ref: 'standard_001',
          display_label: '비교표준지',
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[[
            [127.02, 36.0],
            [127.03, 36.0],
            [127.03, 36.01],
            [127.02, 36.0],
          ]]],
        },
      },
    ],
  };
}

function validLkPreview5186() {
  return {
    schema_version: '0.1',
    artifact_type: 'LK_MAP_PREVIEW',
    preview_id: 'preview_epsg5186_001',
    coordinate_space: {
      crs: 'EPSG:5186',
      axis_order: 'XY',
      dimensions: 2,
    },
    style_profile: 'LK_ROLE_STYLE_V1',
    layers: [{
      role: 'SUBJECT',
      feature_collection: {
        type: 'FeatureCollection',
        features: [polygonFeature('SUBJECT', [[
          [200000, 450000],
          [200100, 450000],
          [200100, 450100],
          [200000, 450000],
        ]])],
      },
    }],
    warnings: [{ code: 'PARTIAL_GEOMETRY', role: 'SUBJECT', count: 1 }],
    omissions: [{
      reason_code: 'GEOMETRY_MISSING',
      role: 'CASE',
      feature_ref: 'case_omitted_001',
      reason: '검토용 형상 없음',
      count: 1,
    }],
  };
}

function testMapSanitizerAcceptsOnlySafe4326Polygons() {
  const preview = sanitizeMapPreview(validFeatureCollection());
  assert.equal(preview.crs, 'EPSG:4326');
  assert.equal(preview.features.length, 2);
  assert.deepEqual(preview.features.map((feature) => feature.geometry.type), ['Polygon', 'MultiPolygon']);
  assert.deepEqual(preview.features.map((feature) => feature.properties.role), ['SUBJECT', 'STANDARD']);

  const missingSubject = validFeatureCollection();
  missingSubject.features = missingSubject.features.slice(1);
  assert.throws(
    () => sanitizeMapPreview(missingSubject),
    /at least one SUBJECT polygon is required/,
  );

  const wrongCrs = validFeatureCollection();
  wrongCrs.crs.properties.name = 'EPSG:3857';
  assert.throws(
    () => sanitizeMapPreview(wrongCrs),
    /GeoJSON must use EPSG:4326/,
  );

  const openRing = validFeatureCollection();
  openRing.features[0].geometry.coordinates[0][3] = [127.0, 36.005];
  assert.throws(
    () => sanitizeMapPreview(openRing),
    /polygon ring must be closed/,
  );

  const nonFinite = validFeatureCollection();
  nonFinite.features[0].geometry.coordinates[0][1] = [Infinity, 36.0];
  assert.throws(
    () => sanitizeMapPreview(nonFinite),
    /coordinate values must be finite/,
  );

  assert.throws(
    () => parseMapPreviewJson('{"type":"FeatureCollection","features":[],"__proto__":{"polluted":true}}'),
    /unsafe map JSON key/,
  );
  assert.throws(
    () => parseMapPreviewJson('{"type":"FeatureCollection","features":[],"constructor":{"polluted":true}}'),
    /unsafe map JSON key/,
  );
  assert.throws(
    () => parseMapPreviewJson('{"type":"FeatureCollection","type":"FeatureCollection","features":[]}'),
    /duplicate JSON key: type/,
  );
  const outOfBounds = validFeatureCollection();
  outOfBounds.features[0].geometry.coordinates[0][1] = [200, 36];
  assert.throws(
    () => sanitizeMapPreview(outOfBounds),
    /outside longitude\/latitude bounds/,
  );
}

function testProjectedPreviewRendersWithoutLosingCrs() {
  const preview = sanitizeMapPreview(validLkPreview5186());
  assert.equal(preview.crs, 'EPSG:5186');
  assert.deepEqual(preview.warnings[0], { code: 'PARTIAL_GEOMETRY', role: 'SUBJECT', count: 1 });
  assert.ok(preview.warnings.some((warning) => warning.code === 'STANDARD_LAYER_UNAVAILABLE'));
  assert.ok(preview.warnings.some((warning) => warning.code === 'CASE_LAYER_UNAVAILABLE'));
  assert.ok(preview.warnings.some((warning) => warning.code === 'BIZ_ZONE_LAYER_UNAVAILABLE'));
  assert.equal(preview.layers.length, 4);
  assert.equal(preview.layers.find((layer) => layer.role === 'STANDARD').availability, 'UNAVAILABLE');
  assert.equal(preview.layers.find((layer) => layer.role === 'CASE').expected_count, 1);
  assert.equal(preview.layers.find((layer) => layer.role === 'CASE').missing_geometry_count, 1);
  assert.deepEqual(preview.omissions, [{
    code: 'GEOMETRY_MISSING',
    role: 'CASE',
    feature_ref: 'case_omitted_001',
    reason: '검토용 형상 없음',
    count: 1,
  }]);

  const svg = buildSvgMarkup(preview, { width: 800, height: 480 });
  assert.match(svg, /^<svg\b/);
  assert.equal((svg.match(/<path\b/g) || []).length, 1);
  assert.ok(!/NaN|Infinity/.test(svg), 'projected preview markup must contain only finite coordinates');
}

function testLayerCompletenessCountsFailClosed() {
  const partial = validLkPreview5186();
  partial.layers[0] = {
    ...partial.layers[0],
    availability: 'PARTIAL',
    expected_count: 2,
    renderable_count: 1,
    missing_geometry_count: 1,
  };
  partial.omissions = [{
    reason: 'MISSING_GEOMETRY',
    role: 'SUBJECT',
    feature_ref: 'subject_omitted_002',
  }];
  const preview = sanitizeMapPreview(partial);
  assert.deepEqual(preview.layers[0], {
    role: 'SUBJECT',
    source_layer: 'subject_parcels',
    required: true,
    availability: 'PARTIAL',
    expected_count: 2,
    renderable_count: 1,
    missing_geometry_count: 1,
  });
  assert.equal(preview.omissions[0].count, 1);

  const contradictory = validLkPreview5186();
  contradictory.layers[0].renderable_count = 2;
  assert.throws(
    () => sanitizeMapPreview(contradictory),
    /renderable_count conflicts with feature count/,
  );

  const missingContradiction = validLkPreview5186();
  missingContradiction.layers[0].availability = 'PARTIAL';
  missingContradiction.layers[0].expected_count = 2;
  missingContradiction.layers[0].renderable_count = 1;
  missingContradiction.layers[0].missing_geometry_count = 1;
  assert.throws(
    () => sanitizeMapPreview(missingContradiction),
    /missing_geometry_count conflicts with omissions/,
  );

  const manyLegitimateOmissions = validLkPreview5186();
  manyLegitimateOmissions.omissions = Array.from({ length: 101 }, (_, index) => ({
    reason_code: 'GEOMETRY_MISSING',
    role: 'CASE',
    feature_ref: `case_omitted_${String(index + 1).padStart(3, '0')}`,
  }));
  const manyPreview = sanitizeMapPreview(manyLegitimateOmissions);
  assert.equal(manyPreview.omissions.length, 101, 'valid omission records must not be silently truncated');
  assert.equal(manyPreview.layers.find((layer) => layer.role === 'CASE').missing_geometry_count, 101);

  const excessiveOmissions = validLkPreview5186();
  excessiveOmissions.omissions = Array.from({ length: 1001 }, (_, index) => ({
    reason_code: 'GEOMETRY_MISSING',
    role: 'CASE',
    feature_ref: `case_omitted_${index + 1}`,
  }));
  assert.throws(() => sanitizeMapPreview(excessiveOmissions), /PAYLOAD_LIMIT_EXCEEDED: omission limit/);
}

function testLayerRoleIsAuthoritativeAndMismatchFailsClosed() {
  const fallbackPayload = validLkPreview5186();
  delete fallbackPayload.layers[0].feature_collection.features[0].properties.role;
  const fallbackPreview = sanitizeMapPreview(fallbackPayload);
  assert.equal(fallbackPreview.features[0].properties.role, 'SUBJECT');

  const mismatchPayload = validLkPreview5186();
  mismatchPayload.layers[0].feature_collection.features[0].properties.role = 'STANDARD';
  assert.throws(
    () => sanitizeMapPreview(mismatchPayload),
    /feature role STANDARD does not match layer role SUBJECT/,
  );
}

function testCoordinatesAreExactPrimitiveFinite2dValues() {
  const invalidCoordinates = [
    { point: ['127.01', 36], message: /finite primitive numbers/ },
    { point: [null, 36], message: /finite primitive numbers/ },
    { point: [127.01, 36, 5], message: /exact 2D array/ },
  ];
  invalidCoordinates.forEach(({ point, message }) => {
    const payload = validFeatureCollection();
    payload.features[0].geometry.coordinates[0][1] = point;
    assert.throws(() => sanitizeMapPreview(payload), message);
  });
}

function testSubjectMustHaveAreaAndExtremeExtentCannotReachSvg() {
  const zeroArea = validFeatureCollection();
  zeroArea.features[0].geometry.coordinates = [[
    [127, 36],
    [127.01, 36.01],
    [127.02, 36.02],
    [127, 36],
  ]];
  assert.throws(
    () => sanitizeMapPreview(zeroArea),
    /SUBJECT polygon must have non-zero area/,
  );

  const partlyDegenerateMultiPolygon = validFeatureCollection();
  partlyDegenerateMultiPolygon.features[0].geometry = {
    type: 'MultiPolygon',
    coordinates: [
      partlyDegenerateMultiPolygon.features[0].geometry.coordinates,
      [[
        [127.03, 36],
        [127.04, 36.01],
        [127.05, 36.02],
        [127.03, 36],
      ]],
    ],
  };
  assert.throws(
    () => sanitizeMapPreview(partlyDegenerateMultiPolygon),
    /SUBJECT polygon must have non-zero area/,
  );

  const extremePayload = validLkPreview5186();
  extremePayload.layers.push({
    role: 'CASE',
    feature_collection: {
      type: 'FeatureCollection',
      features: [-1e308, 1e308].map((coordinate, index) => polygonFeature('CASE', [[
          [coordinate, coordinate],
          [coordinate, coordinate],
          [coordinate, coordinate],
          [coordinate, coordinate],
      ]], { feature_ref: `extreme_${index}` })),
    },
  });
  const extremePreview = sanitizeMapPreview(extremePayload);
  assert.throws(
    () => buildSvgMarkup(extremePreview, { width: 800, height: 480 }),
    /map extent exceeds the finite rendering range/,
  );
}

function testSvgEscapesLabelsAndRendersGeometryPaths() {
  const payload = validFeatureCollection();
  payload.features[0].properties.display_label = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const preview = sanitizeMapPreview(payload);
  const svg = buildSvgMarkup(preview, { width: 800, height: 480 });

  assert.match(svg, /^<svg\b/);
  assert.equal((svg.match(/<path\b/g) || []).length, 2);
  assert.match(svg, /\bd="M[0-9.]+ [0-9.]+/);
  assert.ok(!svg.includes('<img'));
  assert.ok(!svg.includes('<script'));
  assert.ok(!svg.includes('<foreignObject'));
  assert.match(svg, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(svg, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
}

function testTextItemsToRowsPreservesPdfTableRows() {
  const items = [
    { str: '480', transform: [1, 0, 0, 1, 210, 680], width: 25 },
    { str: '면적', transform: [1, 0, 0, 1, 210, 700], width: 25 },
    { str: '익명시 샘플동 2-2', transform: [1, 0, 0, 1, 10, 660], width: 150 },
    { str: '소재지', transform: [1, 0, 0, 1, 10, 700], width: 40 },
    { str: '612', transform: [1, 0, 0, 1, 210, 660], width: 25 },
    { str: '익명시 샘플동 1-1', transform: [1, 0, 0, 1, 10, 680], width: 150 },
  ];

  assert.equal(
    textItemsToRows(items),
    '소재지 면적\n익명시 샘플동 1-1 480\n익명시 샘플동 2-2 612',
  );
  assert.equal(textItemsToRows([{ str: 'A' }, { str: 'B' }]), 'A B');
}

// 법인마다 같은 필지를 "샘플동 산7-1" / "익명시 샘플동 산7-1" 로 적고, 지목도 부호("임")와
// 정식 지목("임야")을 섞어 쓴다. 이게 갈라지면 법인별 비교표가 한 필지를 두 줄로 쪼갠다.
function testCanonicalLandSignatureSurvivesFirmAddressAndCategoryStyles() {
  const base = { parcel_address: '익명시 샘플동 산7-1', land_category: '임야', area: 110 };
  assert.equal(
    normalizedLandSignature(base),
    normalizedLandSignature({ parcel_address: '샘플동 산7-1', land_category: '임', area: 110 }),
  );
  // 면적이 다르면 같은 지번이라도 다른 현황분리행이므로 절대 합치면 안 된다.
  assert.notEqual(
    normalizedLandSignature(base),
    normalizedLandSignature({ ...base, area: 254 }),
  );
  // 동이 다르면 같은 지번이라도 다른 필지다.
  assert.notEqual(
    normalizedLandSignature(base),
    normalizedLandSignature({ ...base, parcel_address: '익명시 다른동 산7-1' }),
  );
}

function testFileNameCompanyCandidateIsMarkedAsUnconfirmed() {
  assert.equal(deriveCompanyFromFileName('홍길동(에이)-익명지구.pdf'), '에이');
  assert.equal(deriveCompanyFromFileName('홍길동(감정평가서(제이))-익명지구.pdf'), '제이');
  assert.equal(deriveCompanyFromFileName('감정평가서(토지).pdf'), '', '일반 명사는 법인명 후보가 아니다');
  assert.equal(deriveCompanyFromFileName('감정평가서.pdf'), '');

  const parsed = {
    meta: { input_file_name: 'x.pdf' },
    case: {},
    appraisals: [{ appraisal_id: 'APP_P', appraisal_company: '', source_refs: [] }],
    lands: [{ land_id: 'L1', land_no: '101', parcel_address: '익명시 샘플동 10-1', land_category: '대', area: 400, source_refs: [] }],
    standard_lands: [],
    land_appraisal_results: [{ land_id: 'L1', parcel_address: '익명시 샘플동 10-1', unit_price: 1000, amount: 400000, source_refs: [] }],
    appraisal_totals: [],
  };
  const patch = mergeParserResult({}, parsed, {
    uploadId: 'UPLOAD_A',
    appraisalId: 'APP_A',
    fileName: '홍길동(에이).pdf',
  });
  const appraisal = patch.appraisals[0];
  assert.equal(appraisal.appraisal_company, '에이');
  assert.equal(appraisal.appraisal_company_origin, 'FILE_NAME');
  assert.equal(appraisal.review_status_code, 'NEEDS_REVIEW');
  assert.equal(appraisal.auto_confirmed, false);
  assert.equal(patch.land_appraisal_results[0].appraisal_company, '에이');
  assert.equal(patch.summary.appraisal_company_origin, 'FILE_NAME');
}

// 두 법인 평가서를 차례로 올리면 같은 필지 5행 위에 법인 열이 하나씩 늘어야 한다.
function testTwoFirmMergeKeepsOneRowPerParcelAndSplitStatusRow() {
  const firmCase = (symbol, unitPrice, addressPrefix, category) => ({
    meta: { input_file_name: 'x.pdf' },
    case: {},
    appraisals: [{ appraisal_id: 'APP_P', appraisal_company: '', source_refs: [] }],
    lands: [
      { land_id: 'L1', land_no: '900', parcel_address: `${addressPrefix}산7-1`, land_category: category, area: 20000, source_refs: [] },
      { land_id: 'L2', land_no: '900-1', parcel_address: `${addressPrefix}산7-1`, land_category: category, area: 100, appraisal_use_status: '전', source_refs: [] },
      { land_id: 'L3', land_no: '900-2', parcel_address: `${addressPrefix}산7-1`, land_category: category, area: 200, appraisal_use_status: '도로', source_refs: [] },
    ],
    standard_lands: [{ standard_land_symbol: symbol, parcel_address: `${addressPrefix}100-1`, land_category: category, area: 900, source_refs: [] }],
    land_appraisal_results: [
      { land_id: 'L1', parcel_address: `${addressPrefix}산7-1`, standard_land_symbol: symbol, unit_price: unitPrice, amount: unitPrice * 20000, source_refs: [] },
      { land_id: 'L2', parcel_address: `${addressPrefix}산7-1`, standard_land_symbol: symbol, unit_price: unitPrice, amount: unitPrice * 100, source_refs: [] },
      { land_id: 'L3', parcel_address: `${addressPrefix}산7-1`, standard_land_symbol: symbol, unit_price: unitPrice, amount: unitPrice * 200, source_refs: [] },
    ],
    subject_to_standard_factor_comparisons: [
      { land_id: 'L2', standard_land_symbol: symbol, street_condition: 1, access_condition: 0.9, environment_or_natural_condition: 0.9, parcel_condition: 0.9, administrative_condition: 1, other_condition: 1, total_factor: 0.729, source_refs: [] },
    ],
    appraisal_totals: [],
  });

  const first = mergeParserResult({}, firmCase('가', 1000, '샘플동 ', '임'), {
    uploadId: 'UPLOAD_A', appraisalId: 'APP_A', fileName: '홍길동(에이).pdf',
  });
  const second = mergeParserResult({ ...first }, firmCase('A', 1100, '익명시 샘플동 ', '임야'), {
    uploadId: 'UPLOAD_B', appraisalId: 'APP_B', fileName: '홍길동(제이).pdf',
  });

  assert.equal(second.lands.length, 3, '같은 지번의 현황분리행 3개가 법인 수와 무관하게 3행으로 유지되어야 한다');
  assert.equal(new Set(second.lands.map((row) => row.area)).size, 3, '현황분리행은 면적이 달라 절대 합쳐지면 안 된다');
  assert.equal(second.land_appraisal_results.length, 6, '필지 3행 x 법인 2곳');
  assert.equal(second.appraisals.length, 2);

  const splitLand = second.lands.find((row) => row.area === 100);
  const splitResults = second.land_appraisal_results.filter((row) => row.land_id === splitLand.land_id);
  assert.equal(splitResults.length, 2);
  assert.deepEqual(splitResults.map((row) => row.appraisal_company).sort(), ['에이', '제이']);

  const comparisons = second.subject_to_standard_factor_comparisons;
  assert.equal(comparisons.length, 2);
  assert.ok(comparisons.every((row) => row.land_id === splitLand.land_id));
  assert.ok(comparisons.every((row) => row.review_status_code === 'NEEDS_REVIEW'));
  assert.ok(comparisons.every((row) => row.auto_confirmed === false));
  assert.equal(second.summary.subject_factor_comparison_count, 1);
}

testParserMergePreservesConfirmedLandAndIsIdempotent();
testCanonicalLandSignatureSurvivesFirmAddressAndCategoryStyles();
testFileNameCompanyCandidateIsMarkedAsUnconfirmed();
testTwoFirmMergeKeepsOneRowPerParcelAndSplitStatusRow();
testStandardLinkingAndUploadPlaceholderCanonicalization();
testParserSummaryCountsCanonicalPersistedRowsAndDroppedInputs();
testMapSanitizerAcceptsOnlySafe4326Polygons();
testProjectedPreviewRendersWithoutLosingCrs();
testLayerCompletenessCountsFailClosed();
testLayerRoleIsAuthoritativeAndMismatchFailsClosed();
testCoordinatesAreExactPrimitiveFinite2dValues();
testSubjectMustHaveAreaAndExtremeExtentCannotReachSvg();
testSvgEscapesLabelsAndRendersGeometryPaths();
testTextItemsToRowsPreservesPdfTableRows();

console.log('release_core.test.js passed');
