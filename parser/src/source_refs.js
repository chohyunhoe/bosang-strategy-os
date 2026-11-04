'use strict';

const DEFAULT_EXCERPT_LIMIT = 140;

function trimExcerpt(rawText, limit = DEFAULT_EXCERPT_LIMIT) {
  const normalized = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function createSourceRef({ sourceFile = null, page = null, textRange = null, note = null } = {}) {
  return {
    source_file: sourceFile,
    page,
    text_range: textRange,
    note,
  };
}

function createParserSourceRef({
  appraisalId = 'APP_001',
  fileName = null,
  pageNo = null,
  lineStart = null,
  lineEnd = null,
  sourceLabel = null,
  rawTextExcerpt = '',
} = {}) {
  return {
    appraisal_id: appraisalId,
    file_name: fileName,
    page_no: pageNo,
    line_start: lineStart,
    line_end: lineEnd || lineStart,
    source_label: sourceLabel,
    raw_text_excerpt: trimExcerpt(rawTextExcerpt),
  };
}

function sourceRefFromLine(line, { appraisalId = 'APP_001', fileName = null, sourceLabel = null } = {}) {
  if (!line) return null;
  return createParserSourceRef({
    appraisalId,
    fileName,
    pageNo: line.page_no,
    lineStart: line.line_no,
    lineEnd: line.line_no,
    sourceLabel: sourceLabel || line.section_label,
    rawTextExcerpt: line.raw_text,
  });
}

module.exports = {
  createSourceRef,
  createParserSourceRef,
  sourceRefFromLine,
  trimExcerpt,
};
