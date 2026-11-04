'use strict';

const assert = require('node:assert/strict');
const { extractStandardLands, parseStandardLandText, isSplitStandardPrefix } = require('../src/extractors/standard_lands_extractor');

function line(no, text) {
  return { page_no:4, line_no:no, raw_text:text, normalized_text:text, section_label:'비교표준지 목록' };
}

assert.equal(isSplitStandardPrefix('B 가상동'), true);
assert.equal(isSplitStandardPrefix('완경사 지구내'), false);

const one = parseStandardLandText('B 가상동 151 전 전 계획관리 1,894.0 137,000 세로(가) 가장형 완경사 지구내');
assert.ok(one);
assert.equal(one.standard_land_symbol,'B');
assert.equal(one.parcel_address,'가상동 151');
assert.equal(one.land_category,'전');
assert.equal(one.area,1894);
assert.equal(one.official_price,137000);

const rows = extractStandardLands([
  line(1,'다. 선정 비교표준지'),
  line(2,'기호 소재지 지목 이용상황 용도지역 면적 공시지가 도로교통 형상 지세 비고'),
  line(3,'B 가상동'),
  line(4,'151 전 전 계획관리 1,894.0 137,000 세로(가) 가장형'),
  line(5,'완경사 지구내'),
  line(6,'C 가상동'),
  line(7,'176-1 대 단독주택 계획관리 303.0 238,000 세각(가) 사다리'),
  line(8,'평지 지구내'),
  line(9,'J 가상동'),
  line(10,'산3-1 임야 자연림 계획관리 29,752.0 38,500 세로(불) 부정형'),
  line(11,'완경사 지구내'),
], {appraisalId:'APP_ALT_STD',fileName:'anonymous.pdf'});

assert.equal(rows.length,3);
assert.deepEqual(rows.map((row)=>row.standard_land_symbol),['B','C','J']);
assert.deepEqual(rows.map((row)=>row.parcel_address),['가상동 151','가상동 176-1','가상동 산3-1']);
assert.deepEqual(rows.map((row)=>row.land_category),['전','대','임야']);
assert.deepEqual(rows.map((row)=>row.area),[1894,303,29752]);
assert.deepEqual(rows.map((row)=>row.official_price),[137000,238000,38500]);
assert.ok(rows.every((row)=>row.review_status_code==='NEEDS_REVIEW'));
assert.ok(rows.every((row)=>row.auto_confirmed===false));
assert.ok(rows.every((row)=>row.source_refs?.length===1));

console.log('standard_land_category_before_area.test.js passed');
