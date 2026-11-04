'use strict';

const reviewStatus = require('./review_status');
const schemaAdapter = require('./schema_adapter');
const sourceRefs = require('./source_refs');
const pdfTextExtractor = require('./pdf_text_extractor');
const textNormalizer = require('./text_normalizer');
const lineTableSegmenter = require('./line_table_segmenter');
const appraisalTextParser = require('./appraisal_text_parser');
const statusBridge = require('./status_bridge');
const extractionBundle = require('./extraction_bundle');
const appraisalFactorCandidates = require('./appraisal_factor_candidates');
const appraisalPackagePairing = require('./appraisal_package_pairing');
const appraisalBasisFactorCandidates = require('./appraisal_basis_factor_candidates');

module.exports = {
  reviewStatus,
  ...schemaAdapter,
  ...sourceRefs,
  ...pdfTextExtractor,
  ...textNormalizer,
  ...lineTableSegmenter,
  ...appraisalTextParser,
  ...statusBridge,
  ...extractionBundle,
  ...appraisalFactorCandidates,
  ...appraisalPackagePairing,
  ...appraisalBasisFactorCandidates,
};
