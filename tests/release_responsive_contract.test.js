'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const activePdfSearchStart = html.lastIndexOf('async function findBestPdfMatchForOcrItem(id)');
const activePdfSearchEnd = html.indexOf('\nasync function ', activePdfSearchStart + 1);
const activePdfSearch = html.slice(activePdfSearchStart, activePdfSearchEnd > activePdfSearchStart ? activePdfSearchEnd : undefined);
assert.ok(activePdfSearchStart >= 0, 'active PDF row-search function must exist');
assert.match(activePdfSearch, /const sessionEpoch = releaseSessionEpoch;/, 'PDF row search must capture its session epoch');
const releaseStyle = html.match(/<style id="release-candidate-five-stage">([\s\S]*?)<\/style>/);
assert.ok(releaseStyle, 'five-stage release CSS must exist');
const css = releaseStyle[1].replace(/\s+/g, ' ');

for (const selector of [
  '.release-stage-strip', '.release-map-viewport', '.release-table-wrap',
  '.release-table-desktop', '.release-numeric-mobile', '.release-layout-preview',
]) assert.ok(css.includes(selector), `missing responsive selector ${selector}`);

assert.match(css, /@media\(max-width:900px\)/);
assert.match(css, /@media\(max-width:767px\)/);
assert.match(css, /\.release-analysis-grid,\.release-layout-preview\{grid-template-columns:1fr\}/);
assert.match(css, /\.release-table-desktop\{display:none\}/);
assert.match(css, /\.release-numeric-mobile\{display:block\}/);
assert.match(css, /\.release-map-toolbar button,\.release-map-file\{min-height:44px/);
assert.match(css, /\.release-table-wrap\{width:100%;overflow-x:auto/);
assert.match(css, /@media print/);

for (const stage of ['평가서 등록', '분석', '지도 생성', '수치표 생성', '결과 정렬']) {
  assert.ok(html.includes(stage), `missing five-stage label ${stage}`);
}

console.log('release responsive contract checks passed');
