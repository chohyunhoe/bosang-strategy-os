'use strict';

// 스캔 평가서 표 구조 복원의 기하 primitive.
//
// Tesseract 는 괘선을 인식하지 못하고 라인 텍스트만 돌려주므로, 평문만 보면
// "익명시 / 샘플동 / 10-1" 이 세 줄로 흩어지고 숫자 열이 서로 밀려 붙는다.
// 대신 word bbox 를 그대로 들고 와서
//   같은 y-band  → 같은 행 후보
//   비슷한 x0    → 같은 열 후보
// 로 표를 되살린다. 여기서는 표의 "의미"를 모른다. 순수 기하만 다룬다.

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function wordMidY(word) {
  return (num(word.bbox.y0) + num(word.bbox.y1)) / 2;
}

// 괘선을 글자로 오인한 토큰(|, ㅣ, i, :, ., ;, ...)은 좌표만 어지럽히고 값이 없다.
// 숫자도 한글도 라틴 글자도 없는 토큰은 구조 노이즈로 본다.
const CONTENT_PATTERN = /[0-9A-Za-z가-힣]/;

function isStructuralNoise(text) {
  const token = String(text || '').trim();
  if (!token) return true;
  if (!CONTENT_PATTERN.test(token)) return true;
  // 'ㅣ' 는 한글 자모라 위 검사를 통과한다. 괘선으로만 쓰이므로 따로 막는다.
  if (/^[ㅣㅏㅡ|]+$/.test(token)) return true;
  // 세로 괘선이 소문자 i·l 이나 1 로 잡히는 일이 잦다. 한 글자짜리 이 글자들은
  // 값도 기호도 아니므로 버린다(표준지 기호는 대문자나 한글이라 살아남는다).
  if (/^[ilj1!:;,.]$/.test(token)) return true;
  return false;
}

function normalizeWords(words) {
  return (Array.isArray(words) ? words : [])
    .filter((word) => word && word.bbox && String(word.text || '').trim())
    .filter((word) => !isStructuralNoise(word.text))
    .map((word) => ({
      text: String(word.text).trim(),
      confidence: num(word.confidence !== undefined ? word.confidence : word.conf, 0),
      x0: num(word.bbox.x0),
      x1: num(word.bbox.x1),
      y0: num(word.bbox.y0),
      y1: num(word.bbox.y1),
      mid_y: wordMidY(word),
    }))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

// 글자 높이의 절반 정도를 같은 줄로 본다. 고정 픽셀을 쓰면 렌더 배율이 바뀔 때 깨진다.
function estimateBandTolerance(words) {
  const heights = words.map((word) => word.y1 - word.y0).filter((height) => height > 0).sort((a, b) => a - b);
  if (heights.length === 0) return 10;
  const median = heights[Math.floor(heights.length / 2)];
  return Math.max(6, Math.round(median * 0.6));
}

function groupIntoBands(words, tolerance) {
  const bands = [];
  words.forEach((word) => {
    const band = bands.find((candidate) => Math.abs(candidate.mid_y - word.mid_y) <= tolerance);
    if (band) {
      band.words.push(word);
      band.mid_y = band.words.reduce((sum, item) => sum + item.mid_y, 0) / band.words.length;
      band.y0 = Math.min(band.y0, word.y0);
      band.y1 = Math.max(band.y1, word.y1);
      return;
    }
    bands.push({ mid_y: word.mid_y, y0: word.y0, y1: word.y1, words: [word] });
  });
  bands.forEach((band) => band.words.sort((a, b) => a.x0 - b.x0));
  return bands.sort((a, b) => a.mid_y - b.mid_y);
}

function bandText(band) {
  return band.words.map((word) => word.text).join(' ');
}

/**
 * 한 페이지의 word bbox 를 y-band 로 묶는다.
 */
function buildBands(words) {
  const normalized = normalizeWords(words);
  if (normalized.length === 0) return { tolerance: 0, bands: [] };
  const tolerance = estimateBandTolerance(normalized);
  return { tolerance, bands: groupIntoBands(normalized, tolerance) };
}

// 표의 한 행이 소재지 줄바꿈 때문에 두세 개의 y-band 로 쪼개지는 서식이 있다.
// 그렇다고 무턱대고 이어 붙이면 서로 다른 행이 한 행으로 뭉개진다. 그래서
//   (1) 행 간격(pitch)의 절반보다 가까운 band 끼리만,
//   (2) 같은 anchor 열에 둘 다 값이 있으면 절대,
// 이어 붙이지 않는다.
function mergeBandsIntoRows(bands, options = {}) {
  const anchorAt = typeof options.anchorAt === 'function' ? options.anchorAt : () => null;
  const pitch = num(options.rowPitch, 0);
  const maxGap = pitch > 0 ? pitch * 0.45 : num(options.maxGap, 26);

  const rows = [];
  bands.forEach((band) => {
    const previous = rows[rows.length - 1];
    if (!previous) {
      rows.push({ bands: [band], words: [...band.words], y0: band.y0, y1: band.y1 });
      return;
    }
    const gap = band.mid_y - previous.bands[previous.bands.length - 1].mid_y;
    const anchors = new Set(previous.words.map(anchorAt).filter(Boolean));
    const collides = band.words.some((word) => {
      const anchor = anchorAt(word);
      return Boolean(anchor) && anchors.has(anchor);
    });
    if (gap <= maxGap && !collides) {
      previous.bands.push(band);
      previous.words.push(...band.words);
      previous.y1 = Math.max(previous.y1, band.y1);
      previous.words.sort((a, b) => a.x0 - b.x0);
      return;
    }
    rows.push({ bands: [band], words: [...band.words], y0: band.y0, y1: band.y1 });
  });
  return rows;
}

// 행 병합의 안전한 형태: "값이 실린 band 가 행을 연다".
// 값 band 하나당 행 하나가 보장되므로 서로 다른 행이 합쳐질 수 없다. 소재지처럼 값이 없는
// 보조 band 만 가장 가까운 값 band 에 붙인다. 너무 멀면 붙이지 않고 버린다.
function seedRowsFromAnchorBands(bands, anchorBands, options = {}) {
  const pitch = num(options.rowPitch, 0);
  const reach = pitch > 0 ? pitch * num(options.reachRatio, 0.6) : num(options.maxGap, 30);
  const anchors = new Set(anchorBands);
  const rows = anchorBands
    .slice()
    .sort((a, b) => a.mid_y - b.mid_y)
    .map((band) => ({ bands: [band], words: [...band.words], y0: band.y0, y1: band.y1, anchor: band }));
  if (rows.length === 0) return [];

  bands.forEach((band) => {
    if (anchors.has(band)) return;
    let best = null;
    let bestDistance = Infinity;
    rows.forEach((row) => {
      const distance = Math.abs(band.mid_y - row.anchor.mid_y);
      if (distance < bestDistance) { bestDistance = distance; best = row; }
    });
    if (!best || bestDistance > reach) return;
    best.bands.push(band);
    best.words.push(...band.words);
    best.y0 = Math.min(best.y0, band.y0);
    best.y1 = Math.max(best.y1, band.y1);
  });
  rows.forEach((row) => {
    row.bands.sort((a, b) => a.mid_y - b.mid_y);
    row.words.sort((a, b) => a.x0 - b.x0);
  });
  return rows;
}

// 값이 실린 band 들의 간격 중앙값을 행 간격으로 본다.
function estimateRowPitch(bands) {
  const mids = bands.map((band) => band.mid_y);
  const gaps = [];
  for (let index = 1; index < mids.length; index += 1) gaps.push(mids[index] - mids[index - 1]);
  const positive = gaps.filter((gap) => gap > 0).sort((a, b) => a - b);
  if (positive.length === 0) return 0;
  return positive[Math.floor(positive.length / 2)];
}

/**
 * 여러 행에 걸쳐 x0 가 반복적으로 나타나는 위치를 열로 본다.
 * 한 행에만 있는 x0 는 열로 승격하지 않는다(노이즈 방지).
 */
function buildColumns(rows, options = {}) {
  const tolerance = num(options.tolerance, 18);
  const minRows = Math.max(1, num(options.minRows, 2));
  const clusters = [];
  rows.forEach((row, rowIndex) => {
    row.words.forEach((word) => {
      const cluster = clusters.find((candidate) => Math.abs(candidate.x - word.x0) <= tolerance);
      if (cluster) {
        cluster.samples.push(word.x0);
        cluster.x = cluster.samples.reduce((sum, value) => sum + value, 0) / cluster.samples.length;
        cluster.rows.add(rowIndex);
        return;
      }
      clusters.push({ x: word.x0, samples: [word.x0], rows: new Set([rowIndex]) });
    });
  });
  return clusters
    .filter((cluster) => cluster.rows.size >= minRows)
    .map((cluster) => ({ x: Math.round(cluster.x), row_count: cluster.rows.size }))
    .sort((a, b) => a.x - b.x);
}

// OCR 좌표가 조금씩 흔들려 한 논리 열이 두 개의 x 군집으로 갈리는 일이 있다
// (금액이 어떤 행에서는 x=895, 다른 행에서는 x=915). 두 군집이 "같은 행에 동시에
// 나타난 적이 한 번도 없고" 충분히 가까우면 원래 한 열이었다고 보고 합친다.
// 동시에 나타난 적이 있으면 서로 다른 열이므로 절대 합치지 않는다.
function mergeExclusiveColumns(rows, columns, options = {}) {
  const maxGap = num(options.maxGap, 34);
  const occupancy = columns.map(() => new Set());
  rows.forEach((row, rowIndex) => {
    row.words.forEach((word) => {
      const index = nearestColumnIndex(columns, word.x0, 24);
      if (index >= 0) occupancy[index].add(rowIndex);
    });
  });
  const merged = [];
  columns.forEach((column, index) => {
    const previous = merged[merged.length - 1];
    if (!previous) { merged.push({ ...column, _rows: new Set(occupancy[index]) }); return; }
    const gap = column.x - previous.x;
    const overlaps = [...occupancy[index]].some((rowIndex) => previous._rows.has(rowIndex));
    if (gap <= maxGap && !overlaps) {
      const total = previous.row_count + column.row_count;
      previous.x = Math.round((previous.x * previous.row_count + column.x * column.row_count) / total);
      previous.row_count = total;
      occupancy[index].forEach((rowIndex) => previous._rows.add(rowIndex));
      return;
    }
    merged.push({ ...column, _rows: new Set(occupancy[index]) });
  });
  return merged.map(({ _rows, ...column }) => column);
}

function nearestColumnIndex(columns, x, tolerance) {
  let best = -1;
  let bestDistance = Infinity;
  columns.forEach((column, index) => {
    const distance = Math.abs(column.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  if (tolerance !== undefined && bestDistance > tolerance) return -1;
  return best;
}

/**
 * 행의 단어들을 열 인덱스별로 모은다. 한 칸에 두 단어가 들어가면 x 순서로 이어 붙인다.
 */
function assignRowToColumns(row, columns, options = {}) {
  const tolerance = num(options.tolerance, 24);
  const cells = columns.map(() => null);
  const unassigned = [];
  row.words.forEach((word) => {
    const index = nearestColumnIndex(columns, word.x0, tolerance);
    if (index < 0) {
      unassigned.push(word);
      return;
    }
    if (!cells[index]) cells[index] = { words: [], text: '', confidence: 0 };
    cells[index].words.push(word);
  });
  cells.forEach((cell) => {
    if (!cell) return;
    cell.words.sort((a, b) => a.x0 - b.x0);
    cell.text = cell.words.map((word) => word.text).join(' ').trim();
    cell.confidence = Math.min(...cell.words.map((word) => word.confidence));
  });
  return { cells, unassigned };
}

module.exports = {
  isStructuralNoise,
  mergeExclusiveColumns,
  assignRowToColumns,
  bandText,
  buildBands,
  buildColumns,
  estimateBandTolerance,
  estimateRowPitch,
  mergeBandsIntoRows,
  seedRowsFromAnchorBands,
  nearestColumnIndex,
  normalizeWords,
};
