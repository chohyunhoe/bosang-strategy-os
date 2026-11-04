'use strict';

const { parseAppraisalPages: parsePages } = require('./appraisal_pages_parser');
const { installIndividualFactorUi, renderIntoWorkflow } = require('./individual_factor_ui');
const { buildStructuredCoreFields, installCoreExtractionGuard } = require('./core_extraction_guard');
const { pairAppraisalDocuments } = require('./appraisal_package_pairing');
const {
  extractBasisFactorRows,
  attachPairedBasisFactorCandidates,
} = require('./appraisal_basis_factor_candidates');
const {
  installReviewExecutionBridge,
  startFullReviewExecution,
} = require('./review_execution_bridge');
const {
  installReviewProgressUi,
  startCandidateReviewProgress,
} = require('./review_progress_ui');
const {
  refreshStructuredReviewRuntime,
  installStructuredReviewPreProgressBridge,
  installStructuredReviewProgressWrapper,
} = require('./structured_review_runtime_bridge');
const {
  applyRuntimeTargetLandDedupe,
  installTargetLandDedupeBridge,
} = require('./structured_review_target_dedupe');
const {
  runAutomaticScanOcr,
  runAutomaticScanOcrSweep,
  installAutomaticScanOcrBridge,
  retryAutomaticScanOcr,
} = require('./auto_scan_ocr_bridge');
const {
  installFailedExtractionOcrFallback,
} = require('./auto_scan_ocr_failed_fallback');
const { buildScanCaseCandidates } = require('./scan/scan_case_adapter');
const { evaluateParseSanity, PARSE_HOLD, READY } = require('./parse_sanity_gate');

function parseAppraisalPages(pages, options) {
  return parsePages(pages, options);
}

installIndividualFactorUi();
installReviewExecutionBridge();
installStructuredReviewPreProgressBridge();
installReviewProgressUi();
installStructuredReviewProgressWrapper();
installTargetLandDedupeBridge();
installCoreExtractionGuard(parsePages);
installAutomaticScanOcrBridge();
installFailedExtractionOcrFallback();

module.exports = Object.freeze({
  contractVersion: 'browser-parser/0.4',
  parseAppraisalPages,
  evaluateParseSanity,
  PARSE_HOLD,
  READY,
  buildScanCaseCandidates,
  buildStructuredCoreFields,
  renderIndividualFactorDetails: renderIntoWorkflow,
  pairAppraisalDocuments,
  extractBasisFactorRows,
  attachPairedBasisFactorCandidates,
  startFullReviewExecution,
  startCandidateReviewProgress,
  refreshStructuredReviewRuntime,
  applyRuntimeTargetLandDedupe,
  runAutomaticScanOcr,
  runAutomaticScanOcrSweep,
  retryAutomaticScanOcr,
});
