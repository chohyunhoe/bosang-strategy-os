'use strict';

const { normalizeGeneratedCase } = require('./schema_adapter');
const REVIEW_STATUS = require('./review_status');
const { extractTextFromFile } = require('./pdf_text_extractor');
const {
  DEFAULT_APPRAISAL_ID,
  extractAppraisalTotals,
  parseAppraisalPages,
} = require('./appraisal_pages_parser');

const APPRAISAL_ID = DEFAULT_APPRAISAL_ID;

function buildFailureCase(extraction, fileName) {
  return normalizeGeneratedCase({
    meta: {
      parser_stage: 'parser_layer_1_text_pdf',
      input_file_name: fileName,
      input_type: extraction.input_type,
      parse_status: extraction.parse_status,
      parser_notes: extraction.parser_notes,
    },
    case: {
      review_status_code: extraction.parse_status === REVIEW_STATUS.OCR_REQUIRED ? REVIEW_STATUS.OCR_REQUIRED : REVIEW_STATUS.PARSE_FAILED,
      auto_confirmed: false,
      confidence_level: 'LOW',
      parser_notes: extraction.parser_notes,
    },
    appraisals: [{
      appraisal_id: APPRAISAL_ID,
      appraisal_company: '',
      file_name: fileName,
      file_type: 'TEXT_PDF',
      parse_status: extraction.parse_status,
      review_status_code: extraction.parse_status,
      confidence_level: 'LOW',
      auto_confirmed: false,
      source_refs: [],
      parser_notes: extraction.parser_notes,
    }],
  });
}

async function parseAppraisalTextPdf(inputPath, options = {}) {
  const extraction = await extractTextFromFile(inputPath);
  const fileName = extraction.file_name || options.fileName || 'input.pdf';

  if (extraction.parse_status !== REVIEW_STATUS.TEXT_PARSED) {
    return buildFailureCase(extraction, fileName);
  }

  const generatedCase = parseAppraisalPages(extraction.pages, {
    fileName,
    appraisalId: APPRAISAL_ID,
    inputType: 'TEXT_PDF',
  });
  generatedCase.meta.parser_stage = 'parser_layer_1_text_pdf';
  generatedCase.meta.parser_notes = `${extraction.parser_notes} ${generatedCase.meta.parser_notes}`;
  return generatedCase;
}

module.exports = {
  parseAppraisalTextPdf,
  parseAppraisalPages,
  extractAppraisalTotals,
};
