'use strict';

const PARSER_TO_EXTRACTION_STATUS = Object.freeze({
  TEXT_PARSED: 'TEXT_EXTRACTED',
  OCR_REQUIRED: 'OCR_REQUIRED',
  PARSE_FAILED: 'EXTRACTION_FAILED',
});

const EXTRACTION_STATUS = Object.freeze({
  TEXT_EXTRACTED: 'TEXT_EXTRACTED',
  OCR_REQUIRED: 'OCR_REQUIRED',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
});

class ExtractionStatusBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExtractionStatusBridgeError';
    this.code = code;
  }
}

function bridgeParserStatus(parserStatus) {
  if (
    typeof parserStatus !== 'string'
    || !Object.prototype.hasOwnProperty.call(PARSER_TO_EXTRACTION_STATUS, parserStatus)
  ) {
    throw new ExtractionStatusBridgeError(
      'PARSER_STATUS_UNSUPPORTED',
      '파서 상태를 추출 작업 상태로 안전하게 변환할 수 없습니다.',
    );
  }

  return PARSER_TO_EXTRACTION_STATUS[parserStatus];
}

module.exports = {
  EXTRACTION_STATUS,
  PARSER_TO_EXTRACTION_STATUS,
  ExtractionStatusBridgeError,
  bridgeParserStatus,
};
