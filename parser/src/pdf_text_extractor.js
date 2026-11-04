'use strict';

const fs = require('fs');
const path = require('path');
const REVIEW_STATUS = require('./review_status');

// pdf-parse joins pages inside `.text` with a `-- <n> of <total> --` separator and
// never emits form feeds, so splitting `.text` alone collapsed every appraisal into a
// single page and destroyed source_refs.page_no provenance.
const PDF_PARSE_PAGE_MARKER = /^\s*--\s*\d+\s*of\s*\d+\s*--\s*$/;

function stripPageMarkers(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => !PDF_PARSE_PAGE_MARKER.test(line))
    .join('\n');
}

// A scanned appraisal still yields non-empty `.text` built only from page markers.
// Treat "no glyphs outside the markers" as an OCR candidate instead of TEXT_PARSED.
function hasMeaningfulText(pages) {
  return pages.some((page) => stripPageMarkers(page.text).replace(/\s+/g, '').length > 0);
}

function normalizePdfParsePages(rawPages) {
  if (!Array.isArray(rawPages)) return null;
  const pages = rawPages
    .map((page, index) => ({
      page_no: Number.isFinite(Number(page && page.num)) ? Number(page.num) : index + 1,
      text: stripPageMarkers(page && page.text),
    }))
    .filter((page) => page.text.trim().length > 0);
  return pages.length > 0 ? pages : null;
}

function splitPages(text) {
  return stripPageMarkers(text)
    .split(/\f|\n\s*---\s*PAGE\s*---\s*\n/i)
    .map((pageText, index) => ({ page_no: index + 1, text: pageText }))
    .filter((page) => page.text.trim().length > 0);
}

function getPdfParsePackagePath() {
  const localPackage = path.resolve(process.cwd(), 'node_modules', 'pdf-parse', 'package.json');
  return fs.existsSync(localPackage) ? localPackage : null;
}

function loadPdfParsePackage(packagePath) {
  return require(path.dirname(packagePath));
}

async function extractWithPdfParseV1(pdfParsePackage, buffer) {
  const result = await pdfParsePackage(buffer);
  return {
    text: result && result.text ? result.text : '',
    pages: normalizePdfParsePages(result && result.pages),
  };
}

async function extractWithPdfParseV2(pdfParsePackage, buffer) {
  const parser = new pdfParsePackage.PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: result && result.text ? result.text : '',
      pages: normalizePdfParsePages(result && result.pages),
    };
  } finally {
    if (typeof parser.destroy === 'function') {
      await parser.destroy();
    }
  }
}

async function extractPagesWithPdfParse(pdfParsePackage, buffer) {
  if (pdfParsePackage && typeof pdfParsePackage.PDFParse === 'function') {
    return extractWithPdfParseV2(pdfParsePackage, buffer);
  }
  if (typeof pdfParsePackage === 'function') {
    return extractWithPdfParseV1(pdfParsePackage, buffer);
  }
  throw new Error('Unsupported pdf-parse API shape');
}

async function extractTextWithPdfParse(pdfParsePackage, buffer) {
  const extracted = await extractPagesWithPdfParse(pdfParsePackage, buffer);
  return extracted.text;
}

function buildPdfExtractionResult({ inputType, parseStatus, pages = [], parserNotes }) {
  return {
    input_type: inputType,
    parse_status: parseStatus,
    pages,
    parser_notes: parserNotes,
  };
}

async function extractTextFromPdf(filePath) {
  const packagePath = getPdfParsePackagePath();
  if (!packagePath) {
    return buildPdfExtractionResult({
      inputType: 'TEXT_PDF',
      parseStatus: REVIEW_STATUS.PARSE_FAILED,
      parserNotes: 'pdf-parse 의존성이 설치되어 있지 않아 실제 PDF 텍스트 추출을 실행하지 못했습니다. npm install 후 재검증 필요.',
    });
  }

  const pdfParsePackage = loadPdfParsePackage(packagePath);
  const buffer = fs.readFileSync(filePath);

  try {
    const extracted = await extractPagesWithPdfParse(pdfParsePackage, buffer);
    const pages = extracted.pages || splitPages(extracted.text);

    if (pages.length === 0 || !hasMeaningfulText(pages)) {
      return buildPdfExtractionResult({
        inputType: 'OCR_REQUIRED',
        parseStatus: REVIEW_STATUS.OCR_REQUIRED,
        pages: [],
        parserNotes: 'pdf-parse로 텍스트가 추출되지 않아 이미지/스캔본 또는 텍스트 레이어 부재 후보로 분류했습니다. 이번 단계에서 OCR은 수행하지 않습니다.',
      });
    }

    return buildPdfExtractionResult({
      inputType: 'TEXT_PDF',
      parseStatus: REVIEW_STATUS.TEXT_PARSED,
      pages,
      parserNotes: 'pdf-parse로 실제 TEXT_PDF 텍스트를 추출했습니다. 추출값은 확정값이 아니라 수동 검수 대상 후보입니다.',
    });
  } catch (error) {
    return buildPdfExtractionResult({
      inputType: 'PARSE_FAILED',
      parseStatus: REVIEW_STATUS.PARSE_FAILED,
      parserNotes: `pdf-parse 텍스트 추출 실패: ${error.message}. 원문 전체는 저장하거나 로그로 출력하지 않았습니다.`,
    });
  }
}

async function extractTextFromFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  if (extension === '.txt' || extension === '.fixture') {
    const text = fs.readFileSync(filePath, 'utf8');
    const pages = splitPages(text);
    return {
      file_name: fileName,
      input_type: 'TEXT_PDF_FIXTURE',
      parse_status: pages.length > 0 ? REVIEW_STATUS.TEXT_PARSED : REVIEW_STATUS.PARSE_FAILED,
      pages,
      parser_notes: '실제 PDF가 없어 TEXT_PDF 형식의 익명화 fixture를 사용했습니다. 실제 PDF 입력 검증은 후속 단계가 필요합니다.',
    };
  }

  if (extension === '.pdf') {
    return {
      file_name: fileName,
      ...(await extractTextFromPdf(filePath)),
    };
  }

  return {
    file_name: fileName,
    input_type: 'UNSUPPORTED_INPUT',
    parse_status: REVIEW_STATUS.PARSE_FAILED,
    pages: [],
    parser_notes: '지원하지 않는 입력 형식입니다. Parser Layer 1은 TEXT_PDF 1개만 대상으로 합니다.',
  };
}

module.exports = {
  extractTextFromFile,
  extractTextWithPdfParse,
  splitPages,
  stripPageMarkers,
  normalizePdfParsePages,
};
