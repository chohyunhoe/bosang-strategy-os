'use strict';

function normalizeLine(line) {
  return String(line || '')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/(?:^|\s)[|¦。·、]+(?=\s|$)/g, ' ')
    .replace(/토\s*지\s*가\s*(격|액)\s*산\s*출\s*근\s*거/g, '토지가$1 산출근거')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isStaticDisclosureFooter(line) {
  const compact = String(line || '').replace(/\s+/g, '');
  return /공사승인없이무단유출시법적책임/.test(compact);
}

function isLikelyFooter(line) {
  return /^-?\s*\d+\s*-?$/.test(line)
    || /^감정평가서\s+\d+\s*쪽$/.test(line)
    || isStaticDisclosureFooter(line);
}

function restoreWrappedLotLines(text) {
  return String(text || '').replace(/^(\s*\d{1,5})-\s*\r?\n\s*(\d{1,5}\s*)$/gm, '$1-$2');
}

// 표의 소재지 칸이 두 줄로 감기면 지번만 다음 줄로 내려간다.
//
//   라 익명동 대 150.00 단독주택 1 종일주 세로(가) 세장형 1,000,000 구역 내
//   10-32 평지 도로 100%
//
// 앞 줄이 이미 값이 채워진 표 행이고, 그 줄의 소재지 뒤에 지번이 없고, 다음 줄이 지번으로
// 시작하면 그 지번은 앞 줄 소재지의 일부다. 앞 줄이 "라 익명동" 처럼 머리 조각뿐이면
// 두 줄이 하나의 행으로 이어지는 다른 서식이므로 건드리지 않는다.
const ADMIN_DONG_TOKEN = /[가-힣]{1,10}(?:동|리|가|읍|면)(?=\s|$)/;
const LEADING_LOT_TOKEN = /^(?:산)?\d{1,5}(?:-\d{1,5})?(?=\s|$)/;

function looksLikeFilledTableRow(line) {
  const text = String(line || '');
  if (!/\d{1,3}(?:,\d{3})+/.test(text)) return false;
  return text.split(/\s+/).filter(Boolean).length >= 6;
}

function restoreWrappedAddressLots(lines) {
  const rows = [...lines];
  for (let index = 0; index < rows.length - 1; index += 1) {
    const current = String(rows[index] || '');
    if (!looksLikeFilledTableRow(current)) continue;
    const address = ADMIN_DONG_TOKEN.exec(current);
    if (!address) continue;
    const cut = address.index + address[0].length;
    if (LEADING_LOT_TOKEN.test(current.slice(cut).trim())) continue;
    const next = String(rows[index + 1] || '').trim();
    const lot = LEADING_LOT_TOKEN.exec(next);
    if (!lot) continue;
    rows[index] = `${current.slice(0, cut)} ${lot[0]}${current.slice(cut)}`.replace(/\s+/g, ' ').trim();
    rows[index + 1] = next.slice(lot[0].length).trim();
  }
  return rows.filter(Boolean);
}

function shouldKeepNormalizedLine(line, index, lines) {
  if (!line) return false;
  if (isStaticDisclosureFooter(line)) return false;
  if (!isLikelyFooter(line)) return true;
  if (/^감정평가서\s+\d+\s*쪽$/.test(line)) return false;
  const nearPageEdge = index <= 1 || index >= lines.length - 2;
  return !nearPageEdge;
}

function normalizePages(pages = []) {
  return pages.map((page) => {
    const normalizedLines = restoreWrappedAddressLots(
      restoreWrappedLotLines(page.text)
        .split(/\r?\n/)
        .map(normalizeLine)
        .filter((line) => line.length > 0),
    );
    const lines = normalizedLines.filter((line, index) => shouldKeepNormalizedLine(line, index, normalizedLines));

    return {
      page_no: page.page_no,
      lines,
    };
  });
}

module.exports = {
  normalizeLine,
  normalizePages,
  restoreWrappedLotLines,
  restoreWrappedAddressLots,
};
