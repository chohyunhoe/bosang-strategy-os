'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the actual browser module without adding a browser or OCR dependency.
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../browser/product-v2/ocr-source.js'), 'utf8');
  const { recoverStatementMoney } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const crop = { serial: '201', lot: '0015-0002' };
  const candidate = '201 익명시 15-2 답 답 120.000 * 1/2 180,000 10,800,000';
  const original = '201 AEA 15-2 답 답 120.000 * 12 180000 1800000';
  let checks = 0;
  function preserved(input, replacement = candidate, label = 'ambiguous input must remain unchanged') {
    assert.equal(recoverStatementMoney(input, replacement, crop), input, label); checks++;
  }
  assert.equal(recoverStatementMoney(original, candidate, crop), '201 AEA 15-2 답 답 120.000 * 1/2 180,000 10,800,000'); checks++;
  const largeCandidate = candidate.replace('120.000', '2,000').replace('10,800,000', '180,000,000');
  preserved('201 AEA 15-2 답 답 2,000 * 12 180000 OOOOO', largeCandidate, 'P1: unreadable amount must never promote area into a money cell');
  preserved('201 AEA 15-2 답 답 2000 * 12 180000', largeCandidate, 'P1: one numeric money cell is insufficient');
  preserved('201 AEA 15-2 답 답 120.000 * 1/4 180000 5400000', candidate, 'P2: explicit share conflicts are independent of comma formatting');
  preserved('201 AEA 15-2 답 답 120.000 * 1 / 4 180,000 5,400,000');
  preserved('201 AEA 15-2 답 답 120.000 * 1/4 180000 OOOOO');
  preserved('201 AEA 15-2 답 답 120.000 * 1/2 170000 10200000', candidate, 'readable explicit prices must not be overwritten without commas');
  preserved('201 AEA 15-2 답 답 120.000 * 2/4 170000 10200000', candidate, 'equivalent explicit shares and readable prices are preserved verbatim');
  preserved(original + ' 9999', candidate, 'a third trailing numeric cell makes monetary positions ambiguous');
  preserved(original, candidate + ' 9999', 'candidate must also have exactly two monetary cells');
  preserved(original, candidate.replace('10,800,000', '10,700,000'), 'candidate arithmetic must agree');
  preserved(original, candidate.replace('120.000', '121.000'), 'areas must agree');
  preserved(original, candidate.replace('15-2', '15-3'), 'lots must agree');
  preserved(original, candidate.replace('15-2', '산15-2'), 'mountain-lot identity must agree');
  preserved(original, candidate.replace('201', '202'), 'serials must agree');
  preserved(original, candidate.replace('* 1/2', ''), 'candidate share must be explicit');
  preserved(original, candidate.replace('* 1/2', '* 1/0'), 'invalid shares are not usable');
  preserved(original, candidate.replace('* 1/2', '* 3/2'), 'shares cannot exceed one');
  preserved(original, candidate.replace('* 1/2', '* ' + '9'.repeat(400) + '/' + '9'.repeat(400)), 'non-finite shares must fail closed');
  preserved(original, candidate.replace('120.000', '9'.repeat(400)), 'non-finite areas must fail closed');
  preserved(original.replace('* 12', ''), candidate, 'missing share-position marker is ambiguous');
  assert.equal(recoverStatementMoney('머리말\n' + original + '\n표본동', candidate, crop), '머리말\n201 AEA 15-2 답 답 120.000 * 1/2 180,000 10,800,000\n표본동'); checks++;
  assert.equal(recoverStatementMoney(original.replace('120.000', '2,000'), largeCandidate, crop), '201 AEA 15-2 답 답 2,000 * 1/2 180,000 180,000,000'); checks++;
  console.log(`Statement money recovery safety regressions: ${checks} passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
