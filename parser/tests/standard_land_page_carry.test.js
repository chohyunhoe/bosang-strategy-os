'use strict';

const assert = require('node:assert/strict');
const { normalizePages } = require('../src/text_normalizer');
const { segmentLines, shouldCarryStandardSection } = require('../src/line_table_segmenter');
const { extractStandardLands } = require('../src/extractors/standard_lands_extractor');

const pages = [
  {
    page_no: 1,
    text: `1. 적용 공시지가 표준지 선정\n(3) 비교표준지 (2021.01.01.)\n기호 소재지 지번 면적 (㎡) 지목 이용상황 용도지역 도로교통 형상지세 공시지가 (원/㎡)\n차 샘플동 산3-1 29,752 임야 자연림 계획관리 세로(불) 부정형\n완경사 38,500`,
  },
  {
    page_no: 2,
    text: `기호 소재지 지번 면적\n(㎡) 지목 이용상황 용도지역 도로교통 형상지세 공시지가 (원/㎡)\n카 샘플동 산35-1 7,817 임야 자연림 계획관리 세로(불) 부정형\n완경사 26,500\n* 표준지는 용도지역, 이용상황 등을 고려하여 선정하였음.\n2. 시점수정\n2021.01.01 ~ 2025.11.01 10.575 1.10575`,
  },
];

assert.equal(
  shouldCarryStandardSection('비교표준지 목록', pages[1].text.split(/\n/)),
  true,
  'a wrapped standard-land row at the top of the next page must carry the section',
);

const lines = segmentLines(normalizePages(pages));
const secondPageRow = lines.find((line) => line.page_no === 2 && /^카\s/.test(line.normalized_text));
assert.ok(secondPageRow, 'second-page standard row must exist');
assert.equal(secondPageRow.section_label, '비교표준지 목록');
const secondPagePrice = lines.find((line) => line.page_no === 2 && /완경사\s+26,500/.test(line.normalized_text));
assert.equal(secondPagePrice.section_label, '비교표준지 목록');

const standards = extractStandardLands(lines, { appraisalId: 'APP_CARRY_001', fileName: 'anonymous.pdf' });
assert.deepEqual(standards.map((row) => row.standard_land_symbol), ['차', '카']);
assert.equal(standards[1].parcel_address, '샘플동 산35-1');
assert.equal(standards[1].official_price, 26500);
assert.ok(standards[1].source_refs.some((ref) => ref.page_no === 2));
assert.ok(standards.every((row) => row.auto_confirmed === false));

// ── 쪽 꼬리말이 표를 끊지 않는다 ─────────────────────────────────────────────
// "○○감정평가법인㈜ -43-" 같은 꼬리말은 표제가 아니라 쪽 장식이다. 이 줄에서 구역이
// 바뀌면 표가 다음 장으로 넘어갈 때마다 나머지 행이 통째로 사라진다.
const footerPages = [
  {
    page_no: 1,
    text: `다. 비교 표준지 선정\n<선정된 표준지 공시지가>\n기호 소재지 지목 면적\n(㎡) 이용상황 용도지역 도로교통 형상지세 공시지가 (원/㎡) 비고\n차 샘플동\n359-60 대 109.00 단독주택 2 종일주 세로(가) 세장형\n평지 4,406,000 구역 내`,
  },
  {
    page_no: 2,
    text: `0000-0-0000\n감정평가액의 산출근거 및 그 결정의견\n가람감정평가법인㈜ -43-\n기호 소재지 지목 면적\n(㎡) 이용상황 용도지역 도로교통 형상지세 공시지가 (원/㎡) 비고\n터 샘플동\n820-11 대 260.00 상업용 2 종일주 중로각지 사다리\n평지 5,120,000 구역 외\n3. 시점수정`,
  },
];

const footerLines = segmentLines(normalizePages(footerPages));
const footerRow = footerLines.find((row) => row.page_no === 2 && /^터\s/.test(row.normalized_text));
assert.ok(footerRow, 'second-page standard row must exist');
assert.equal(
  footerRow.section_label,
  '비교표준지 목록',
  '쪽 꼬리말이 표 구역을 끊으면 안 된다',
);

const footerStandards = extractStandardLands(footerLines, { appraisalId: 'APP_FOOTER_001', fileName: 'anonymous.pdf' });
assert.deepEqual(footerStandards.map((row) => row.standard_land_symbol), ['차', '터']);
assert.equal(footerStandards[1].official_price, 5120000);

// 다음 장이 번호 붙은 새 표제로 시작하면 다른 표다. 이어붙이지 않는다.
const newTablePages = [
  footerPages[0],
  {
    page_no: 2,
    text: `0000-0-0000\n가람감정평가법인㈜ -43-\n나. 인근 표준지 공시지가 현황\n기호 소재지 지목 면적\n(㎡) 이용상황 용도지역 도로교통 형상지세 공시지가 (원/㎡) 비고\n터 샘플동\n820-11 대 260.00 상업용 2 종일주 중로각지 사다리\n평지 5,120,000 구역 외`,
  },
];
const newTableStandards = extractStandardLands(
  segmentLines(normalizePages(newTablePages)),
  { appraisalId: 'APP_NEWTABLE_001', fileName: 'anonymous.pdf' },
);
assert.deepEqual(
  newTableStandards.map((row) => row.standard_land_symbol),
  ['차'],
  '새 표제로 시작하는 다음 장은 같은 표로 이어붙이지 않는다',
);

console.log('standard_land_page_carry.test.js passed');

const repeatedReportPages = [
 {page_no:1,text:'감정평가액 산출근거 및 그 결정에 관한 의견\nAB2401-01-1001 감정평가서\nⅤ. 토지가액 산출 내역\n1. 비교표준지 선정\n기호 소재지 지목 이용상황 용도지역 접면 형상 공시지가\nA 표본동 10-1 대 상업용 준주거 중로각지 가장형 200,000'},
 {page_no:2,text:'감정평가액 산출근거 및 그 결정에 관한 의견\nAB2401-01-1001 감정평가서\nⅤ. 토지가액 산출 내역\n기호 소재지 지목 이용상황 용도지역 접면 형상 공시지가\n도로 지세\nB 표본동 20-1 대 상업용 준주거 중로각지 가장형 300,000'},
];
const repeatedStandards=extractStandardLands(segmentLines(normalizePages(repeatedReportPages)),{appraisalId:'APP_REPEATED',fileName:'synthetic.pdf'});
assert.deepEqual(repeatedStandards.map(r=>r.standard_land_symbol),['A','B']);
const breakPages=structuredClone(repeatedReportPages);
breakPages[1].text=breakPages[1].text.replace('기호 소재지','2. 시점수정\n기호 소재지');
assert.deepEqual(extractStandardLands(segmentLines(normalizePages(breakPages)),{appraisalId:'APP_BREAK',fileName:'synthetic.pdf'}).map(r=>r.standard_land_symbol),['A']);
