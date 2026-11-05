'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the actual browser module without adding a browser or OCR dependency.
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../browser/product-v2/ocr-source.js'), 'utf8');
  const { recoverStatementMoney, mergeTableOcrWords, ocrWordLines } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
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
  preserved('201 AEA 15-2 답 답 120.000 * 1 180000 21600000', candidate, 'P1: an arithmetically consistent whole-share row must not be replaced with a half share');
  preserved('201 AEA 15-2 답 답 120.000 × 1 180,000 21,600,000', candidate, 'readable integer multipliers are protected independently of comma and multiplication formatting');
  preserved('201 AEA 15-2 답 답 120.000 * 2 180000 43200000', candidate, 'other arithmetically consistent integer multipliers must also be preserved');
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
  const ownerOriginal='201 AEA 15-2 전 전 1500.000 * 11 2.40000 95000000 합성신탁 (1/1)';
  const ownerCandidate='201 익명시 15-2 전 전 1500.000 * 1/1 240,000 360,000,000 합성신탁 (1/1)';
  assert.equal(recoverStatementMoney(ownerOriginal,ownerCandidate,crop),'201 AEA 15-2 전 전 1500.000 * 1/1 240,000 360,000,000 합성신탁 (1/1)'); checks++;
  preserved(ownerOriginal+' 9999',ownerCandidate,'extra numeric owner cells remain ambiguous');
  preserved(ownerOriginal,ownerCandidate+' 9999','candidate third numeric cell remains rejected');
  preserved(ownerOriginal.replace('(1/1)','(1/2)'),ownerCandidate,'independent owner-share conflict must remain unchanged');
  preserved(ownerOriginal,ownerCandidate.replace('(1/1)','(1/2)'),'candidate owner-share conflict must fail closed');
  const word=(str,x,y,width=40,height=12)=>({str,x,y,width,height,confidence:90});
  const tableCrop={x:0,y:80,width:600,height:160};
  const firstPass=[word('원본',0,20),word('1',10,100),word('15-2',100,100),word('180,000',400,100),word('2',10,160),word('16-3',100,160),word('200,000',400,160),word('바닥글',0,260)];
  const detailPass=[word('1',10,100),word('15-2',100,100),word('190,000',400,100)];
  const merged=mergeTableOcrWords(firstPass,detailPass,tableCrop);
  assert.equal(ocrWordLines(merged),'원본\n1 15-2 190,000\n2 16-3 200,000\n바닥글','an omitted OCR row must survive a partial detail pass');checks++;
  assert.ok(!merged.some(item=>item.str==='180,000'),'a reread row must not mix conflicting old and new money');checks++;
  assert.equal(merged.filter(item=>item.str==='2').length,1,'an omitted row is retained exactly once');checks++;
  assert.equal(merged.find(item=>item.str==='200,000'),firstPass[6],'retained evidence keeps original coordinates and confidence');checks++;
  const shifted=mergeTableOcrWords(firstPass,[...detailPass,word('2',10,164),word('16-3',100,164),word('210,000',400,164)],tableCrop);
  assert.ok(!shifted.some(item=>item.str==='200,000'),'small baseline shifts must not preserve superseded row values');checks++;
  assert.equal(ocrWordLines(mergeTableOcrWords(firstPass,[],tableCrop)),ocrWordLines(firstPass),'an empty detail pass must not erase page evidence');checks++;
  const dongPass=[...firstPass,word('표본동',60,160)];
  const withDong=mergeTableOcrWords(dongPass,detailPass,tableCrop);
  assert.equal(withDong.filter(item=>item.str==='표본동').length,1,'preserved administrative text must not be duplicated');checks++;
  console.log(`Statement money recovery safety regressions: ${checks} passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });

