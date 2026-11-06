import { ocrPdfDocument } from './ocr-source.js';

let pdfModulePromise = null;
function pdfModule() {
  if (!pdfModulePromise) {
    pdfModulePromise = import('./vendor/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfModulePromise;
}

function positionalItems(content) {
  return (content.items || [])
    .filter((item) => item && typeof item.str === 'string' && item.str.trim())
    .map((item) => ({
      str: item.str,
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0,
      width: Number(item.width) || 0,
      height: Math.abs(Number(item.height) || Number(item.transform?.[0]) || 0),
    }));
}

// PDF.js 는 좌표만 준다. 표 셀이 세로 가운데정렬이면 한 논리 행이 여러 y밴드로 흩어진다.
//
//   밴드1        익명동                가장형   구역 내
//   밴드2   처         대 378.10 …            9,851,000
//   밴드3        10-2               평지     도로 22%
//
// 밴드를 그대로 줄로 만들면 소재지가 다른 열 조각과 붙어 한 행이 세 조각으로 깨진다.
// 인접한 두 밴드의 항목들이 x 구간에서 전혀 겹치지 않으면 같은 행의 다른 칸이다.
// 겹치면 서로 다른 행이다(본문 문단은 항상 겹친다). 이 규칙으로만 이어 붙인다.

const MAX_ROW_CONTINUATION_BANDS = 2;

// 표지 등에서 같은 문구를 0.2pt 남짓 어긋난 위치에 여러 번 찍어 굵게 보이게 하는 서식이 있다.
// PDF 는 그 겹침을 각각의 text item 으로 내보내므로, 그대로 줄로 만들면 사업명이
// "명명명 갑1갑갑갑1구역 …" 처럼 오염된다. 이 값은 지도·보고서 제목까지 전파된다.
//
// 겹침의 마지막 사본에는 뒤 글자가 붙어 나오기도 해서(갑 / 갑 / 갑 / 갑1구역) 글자만으로는
// 판별할 수 없다. 사실상 같은 자리에서 시작하는 항목은 겹쳐 찍힌 것으로 보고 첫 번째만 남긴다.
// 서로 다른 글자가 같은 자리에 보이는 일은 없으므로 글자 비교는 하지 않는다.
function dropOverprintDuplicates(items) {
  const kept = [];
  for (const item of items) {
    const tolerance = Math.max(0.8, (item.height || 8) * 0.15);
    const overprinted = kept.some((other) => Math.abs(other.x - item.x) <= tolerance
      && Math.abs(other.y - item.y) <= tolerance);
    if (!overprinted) kept.push(item);
  }
  return kept;
}

function medianHeight(items) {
  const heights = items.map((item) => item.height || 0).filter((height) => height > 0).sort((a, b) => a - b);
  return heights.length ? heights[Math.floor(heights.length / 2)] : 8;
}

function xIntervals(items) {
  return items.map((item) => [item.x, item.x + Math.max(item.width || 0, 1)]);
}

function bandsOverlapInX(a, b) {
  const left = xIntervals(a);
  const right = xIntervals(b);
  return left.some(([aStart, aEnd]) => right.some(([bStart, bEnd]) => aStart < bEnd && bStart < aEnd));
}

function renderBand(items) {
  const row = [...items].sort((a, b) => a.x - b.x);
  let value = '';
  let previous = null;
  for (const item of row) {
    if (previous) {
      const gap = item.x - (previous.x + previous.width);
      const size = Math.max(previous.height || 8, item.height || 8);
      if (gap > size * 0.18) value += ' ';
    }
    value += item.str;
    previous = item;
  }
  return value.replace(/\s+/g, ' ').trim();
}

export function groupIntoLines(rawItems) {
  const items = dropOverprintDuplicates(rawItems);
  if (!items.length) return [];
  const lineHeight = medianHeight(items);
  const bandTolerance = Math.max(1.5, lineHeight * 0.5);
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));

  // 1) y 밴드로 묶는다. 정렬된 입력이므로 직전 밴드하고만 비교해 밴드가 연쇄로 번지지 않게 한다.
  const bands = [];
  for (const item of sorted) {
    const current = bands[bands.length - 1];
    if (current && Math.abs(current.y - item.y) <= bandTolerance) current.items.push(item);
    else bands.push({ y: item.y, items: [item], continuations: 0 });
  }

  // 2) x 가 겹치지 않는 인접 밴드는 같은 행의 다른 칸이므로 이어 붙인다.
  const rows = [];
  for (const band of bands) {
    const previous = rows[rows.length - 1];
    const adjacent = previous && Math.abs(previous.y - band.y) <= lineHeight * 2.2;
    // 홀로 놓인 토큰은 쪽번호·문서번호·표제 같은 쪽 장식이다. 표 칸이 아니므로 잇지 않는다.
    const bothLookLikeCells = previous && previous.items.length >= 2 && band.items.length >= 2;
    if (previous && adjacent && bothLookLikeCells && previous.continuations < MAX_ROW_CONTINUATION_BANDS
        && !bandsOverlapInX(previous.items, band.items)) {
      previous.items.push(...band.items);
      previous.continuations += 1;
      continue;
    }
    rows.push(band);
  }

  return rows.map((row) => renderBand(row.items)).filter(Boolean);
}

function textQuality(pages) {
  const totalChars = pages.reduce((sum, page) => sum + String(page.text || '').replace(/\s/g, '').length, 0);
  const usefulPages = pages.filter((page) => String(page.text || '').replace(/\s/g, '').length >= 40).length;
  return { totalChars, usefulPages, pageCount: pages.length };
}

// Text-rich reports can still have raster-only land and standard tables.
// Inspect sparse pages separately instead of treating document-level text volume as table coverage.
const SPARSE_IMAGE_PAGE_CHARS = 160;
// getTextContent also returns text underneath opaque annotations. Never parse
// those bytes merely because they exist in the PDF; inspect the rendered page.
export async function visiblePdfItems(page, content, pdfjs) {
  const items = positionalItems(content);
  let annotations;
  try { annotations = await page.getAnnotations({ intent: 'display' }); }
  catch (_) { return { items: [], hidden_text_items: items.length, requires_visual_ocr: true }; }
  const covers = annotations.filter(a => ['Square','Redact'].includes(a.subtype) && a.hasAppearance && !(a.annotationFlags & 35) && Array.isArray(a.rect));
  const overlaps = item => covers.some(a => item.x < a.rect[2] && item.x + item.width > a.rect[0] && item.y < a.rect[3] && item.y + item.height > a.rect[1]);
  if (!items.some(overlaps)) return { items, hidden_text_items: 0, requires_visual_ocr: false };
  const viewport = page.getViewport({ scale: 1.5 }), canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  let uncertain = false, removed = 0;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    const visible = items.filter(item => {
      if (!overlaps(item)) return true;
      const box = viewport.convertToViewportRectangle([item.x, item.y - item.height * 0.2, item.x + item.width, item.y + item.height]);
      const left = Math.max(0, Math.floor(Math.min(box[0], box[2]))), top = Math.max(0, Math.floor(Math.min(box[1], box[3])));
      const width = Math.min(canvas.width - left, Math.ceil(Math.abs(box[2] - box[0]))), height = Math.min(canvas.height - top, Math.ceil(Math.abs(box[3] - box[1])));
      if (width < 1 || height < 1) { uncertain = true; removed++; return false; }
      const pixels = context.getImageData(left, top, width, height).data;
      let white = true;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 245 || pixels[i+1] < 245 || pixels[i+2] < 245) { white = false; break; }
      // Non-white/partly covered/outlined annotations are resolved by visual OCR,
      // never by guessing whether their underlying text is still visible.
      if (!white) uncertain = true;
      removed++; return false;
    });
    return { items: visible, hidden_text_items: removed, requires_visual_ocr: uncertain };
  } catch (_) { return { items: items.filter(item => !overlaps(item)), hidden_text_items: items.filter(overlaps).length, requires_visual_ocr: true }; }
  finally { canvas.width = 0; canvas.height = 0; }
}
async function containsRasterImage(page, pdfjs) {
  try {
    const operators = await page.getOperatorList();
    const imageOps = new Set(['paintImageXObject','paintInlineImageXObject','paintImageXObjectRepeat'].map((key) => pdfjs.OPS?.[key]).filter((value) => value !== undefined));
    return operators.fnArray.some((operation) => imageOps.has(operation));
  } catch (_) {
    // A page whose image operators cannot be inspected must not silently skip recovery.
    return true;
  }
}

export function selectOcrPageNumbers(pages) {
  const quality = textQuality(pages);
  const documentNeedsOcr = quality.totalChars < Math.max(160, quality.pageCount * 35)
    || quality.usefulPages < Math.ceil(quality.pageCount * 0.5);
  const weak = pages.filter((page) => String(page.text || '').replace(/\s/g, '').length < 40);
  const sparseImages = pages.filter((page) => page.has_raster_image === true && String(page.text || '').replace(/\s/g, '').length < SPARSE_IMAGE_PAGE_CHARS);
  const selected = documentNeedsOcr ? (weak.length ? [...weak, ...sparseImages] : pages) : sparseImages;
  return [...new Set([...selected, ...pages.filter(page => page.requires_visual_ocr)].map((page) => page.page_no))].sort((a,b) => a-b);
}

export async function loadPdfPageModel(file, onProgress = () => {}) {
  const extractionStarted=performance.now();
  const pdfjs = await pdfModule();
  const data = new Uint8Array(await file.arrayBuffer());
  onProgress({ phase: 'pdf-bytes-ready', byte_length: data.byteLength });
  const pdfDocument = await pdfjs.getDocument({ data }).promise;
  onProgress({ phase: 'pdf-loaded', total: pdfDocument.numPages });
  const textPages = [];
  for (let pageNo = 1; pageNo <= pdfDocument.numPages; pageNo += 1) {
    const page = await pdfDocument.getPage(pageNo);
    onProgress({ phase: 'page-loaded', page: pageNo, total: pdfDocument.numPages });
    const content = await page.getTextContent();
    onProgress({ phase: 'text-content-loaded', page: pageNo, total: pdfDocument.numPages, item_count: content.items?.length || 0 });
    const visibility = await visiblePdfItems(page, content, pdfjs);
    const items = visibility.items;
    const lines = groupIntoLines(items);
    const sparse = lines.join('').replace(/\s/g, '').length < SPARSE_IMAGE_PAGE_CHARS;
    const hasRaster = sparse ? await containsRasterImage(page, pdfjs) : false;
    textPages.push({
      page_no: pageNo,
      text: lines.join('\n'),
      items,
      line_count: lines.length,
      has_raster_image: hasRaster,
      hidden_text_items: visibility.hidden_text_items,
      requires_visual_ocr: visibility.requires_visual_ocr,
      source_type: 'PDFJS_TEXT',
      extraction_method: 'PDF.js textContent + positional PageModel',
      auto_confirmed: false,
      review_status_code: 'NEEDS_REVIEW',
    });
    onProgress({ phase: 'text', page: pageNo, total: pdfDocument.numPages });
  }

  const quality = textQuality(textPages);
  const selectedPageNumbers = selectOcrPageNumbers(textPages);
  const needsOcr = selectedPageNumbers.length > 0;
  onProgress({phase:'text-completed',page_count:quality.pageCount,total_chars:quality.totalChars,useful_page_count:quality.usefulPages,ocr_required:needsOcr,selected_count:selectedPageNumbers.length,elapsed_ms:Math.round(performance.now()-extractionStarted)});
  if (!needsOcr) {
    try { await pdfDocument.destroy(); } catch (error) {}
    return textPages;
  }

  onProgress({ phase: 'ocr-required', page: 0, total: pdfDocument.numPages,selected_count:selectedPageNumbers.length });
  const ocrStarted=performance.now();
  try {
    const parallelCount=selectedPageNumbers.length>=6?2:1;
    let actualParallelCount=parallelCount;const ocrProgress=(event)=>{if(event?.phase==='ocr-workers-ready'||event?.phase==='ocr-worker-fallback')actualParallelCount=Number(event.parallel_count)||1;onProgress(event);};
    const ocrPages=await ocrPdfDocument(pdfDocument,ocrProgress,{pageNumbers:selectedPageNumbers,workerCount:parallelCount});
    const ocrByPage=new Map(ocrPages.map((page)=>[page.page_no,page]));
    for (const page of textPages.filter(p => p.requires_visual_ocr)) {
      const recovered = ocrByPage.get(page.page_no);
      if (!recovered || (!String(recovered.text || '').trim() && !recovered.ruled_tables?.length)) throw Error('PDF_VISIBLE_CONTENT_OCR_REQUIRED');
    }
    const merged=textPages.map((page)=>{const ocrPage=ocrByPage.get(page.page_no);return ocrPage&&(String(ocrPage.text||'').trim()||ocrPage.ruled_tables?.length)?ocrPage:page;});
    onProgress({phase:'ocr-completed',page_count:pdfDocument.numPages,selected_count:selectedPageNumbers.length,parallel_count:actualParallelCount,elapsed_ms:Math.round(performance.now()-ocrStarted)});
    return merged;
  } finally {
    try { await pdfDocument.destroy(); } catch (error) {}
  }
}

export function parserPagesFromPageModel(pageModel) {
  return pageModel.map((page) => ({ page_no: page.page_no, text: page.text, ...(page.source_type==='LOCAL_BROWSER_OCR'&&Array.isArray(page.ruled_tables)?{ruled_tables:page.ruled_tables,image_width:page.image_width,image_height:page.image_height}:{}) }));
}
