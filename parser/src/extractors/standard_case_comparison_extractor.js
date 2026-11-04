'use strict';

const REVIEW_STATUS = require('../review_status');
const { createParserSourceRef } = require('../source_refs');

const CASE_ROW = /^\s*사례\s+([A-Za-z가-힣]{1,3})(?:\s|$)/;
const STANDARD_ROW = /^\s*공시지가\s+([A-Za-z가-힣]{1,3})(?:\s|$)/;

function sourceRef(lines, context) {
  const first=lines[0],last=lines[lines.length-1];
  return createParserSourceRef({
    appraisalId:context.appraisalId||'APP_001',fileName:context.fileName||null,
    pageNo:first.page_no,lineStart:first.line_no,lineEnd:last.line_no,
    sourceLabel:'그 밖의 요인 격차율 산정',rawTextExcerpt:lines.map((line)=>line.raw_text).join(' / '),
  });
}

// 일부 평가서는 격차율 산정표 대신 "표준지 기호 사례 기호" 머리글 아래에
// "A o", "B f" 처럼 두 기호만 적은 매핑표로 대응을 명시한다.
// 머리글이 실제로 있을 때만 읽고, 두 기호가 모두 실재하는 행만 관계로 만든다.
const MAPPING_HEADER = /표\s*준\s*지\s*기\s*호\s*사\s*례\s*기\s*호|사\s*례\s*기\s*호\s*표\s*준\s*지\s*기\s*호/;
const MAPPING_PAIR = /^([A-Za-z가-힣]{1,3}|\d{1,3})\s+([A-Za-z가-힣]{1,3}|\d{1,3})$/;

function mappingPairsFrom(lines) {
  const pairs = [];
  lines.forEach((line, index) => {
    const compact = String(line?.normalized_text || '').replace(/\s+/g, '');
    if (!MAPPING_HEADER.test(compact)) return;
    for (let offset = 1; offset <= 30 && index + offset < lines.length; offset += 1) {
      const row = lines[index + offset];
      if (!row || row.page_no !== line.page_no) break;
      const match = String(row.normalized_text || '').trim().match(MAPPING_PAIR);
      if (!match) break;
      pairs.push({ standardSymbol: match[1], caseSymbol: match[2], line: row, headerLine: line });
    }
  });
  return pairs;
}

// 세 번째 배치: 비교표준지마다 "(4) 비교표준지 '차'" 표제로 블록을 열고, 그 안의
// 「적용사례」 열에 "거래#1 1,000,000 …" 처럼 적용한 사례를 한 행으로 적는다.
// 표준지 기호와 사례 기호가 서로 다른 줄에 있으므로 문장 regex 로 이으면 위험하다.
// 표제 → 적용사례 머리글 → 사례 행 → 표제 기호를 되짚는 "(차)" 줄이 모두 있는
// 블록에서만 관계를 만든다.
const APPLIED_BLOCK_HEADING = /^[(\uff08]\s*\d{1,2}\s*[)\uff09]\s*비\s*교\s*표\s*준\s*지\s*[‘'"\u201c\u2018]?\s*([A-Za-z가-힣]{1,3})\s*[’'"\u201d\u2019]?\s*$/;
const APPLIED_CASE_HEADER = /적\s*용\s*사\s*례/;
// "거래#1", "평가#2", "사례#3" 처럼 종류 + 번호로 적힌 사례 기호.
// 행 앞에 "표준지평가" 같은 구분 라벨이 붙기도 한다. 기호 바로 뒤에 수치가 이어질 때만 행으로 본다.
const APPLIED_CASE_ROW = /(?:^|\s)((?:거\s*래|평\s*가|사\s*례)\s*#\s*\d{1,3})\s+\d/;

function appliedCasePairsFrom(lines) {
  const pairs = [];
  const headings = [];
  lines.forEach((line, index) => {
    const match = String(line?.normalized_text || '').trim().match(APPLIED_BLOCK_HEADING);
    if (match) headings.push({ index, symbol: match[1], line });
  });
  headings.forEach((heading, order) => {
    const end = order + 1 < headings.length ? headings[order + 1].index : lines.length;
    const block = lines.slice(heading.index + 1, end);
    if (!block.some((row) => APPLIED_CASE_HEADER.test(String(row?.normalized_text || '')))) return;
    // 표제 기호가 블록 안에서 "(차)" 로 한 번 더 확인되어야 한다.
    // 표제 기호를 되짚는 "(차)" 는 다른 칸과 한 줄에 놓이기도 한다. 토큰으로 확인한다.
    const echoToken = `(${heading.symbol})`;
    const echo = block.find((row) => String(row?.normalized_text || '')
      .replace(/\s+/g, ' ')
      .split(' ')
      .includes(echoToken));
    if (!echo) return;
    for (const row of block) {
      const match = String(row?.normalized_text || '').replace(/\s+/g, ' ').trim().match(APPLIED_CASE_ROW);
      if (!match) continue;
      pairs.push({
        standardSymbol: heading.symbol,
        caseSymbol: match[1].replace(/\s+/g, ''),
        line: row,
        headerLine: heading.line,
      });
    }
  });
  return pairs;
}

function extractStandardCaseComparisons(lines, standardLands, compCases, context = {}) {
  const standards=new Map((standardLands||[]).filter((row)=>row?.standard_land_symbol).map((row)=>[String(row.standard_land_symbol),row]));
  const cases=new Map((compCases||[]).filter((row)=>row?.case_symbol).map((row)=>[String(row.case_symbol),row]));
  const rows=[];const seen=new Set();
  for(let index=0;index<lines.length;index+=1){
    const caseMatch=String(lines[index]?.normalized_text||'').trim().match(CASE_ROW);if(!caseMatch||!cases.has(caseMatch[1]))continue;
    for(let offset=1;offset<=4&&index+offset<lines.length;offset+=1){
      const candidate=lines[index+offset];const text=String(candidate?.normalized_text||'').trim();if(CASE_ROW.test(text))break;
      const standardMatch=text.match(STANDARD_ROW);if(!standardMatch)continue;
      const standard=standards.get(standardMatch[1]);const compCase=cases.get(caseMatch[1]);if(!standard||!compCase)break;
      const key=`${standard.standard_land_id}|${compCase.comp_case_id}`;if(seen.has(key))break;seen.add(key);
      const refs=[sourceRef([lines[index],candidate],context)].filter(Boolean);
      rows.push({
        comparison_id:`SC_${context.appraisalId||'APP_001'}_${standardMatch[1]}_${caseMatch[1]}`,
        appraisal_id:context.appraisalId||'APP_001',standard_land_id:standard.standard_land_id||'',
        standard_land_symbol:standardMatch[1],comp_case_id:compCase.comp_case_id||'',comparison_case_symbol:caseMatch[1],
        source_refs:refs,confidence_level:refs.length?'HIGH':'LOW',review_status_code:REVIEW_STATUS.NEEDS_REVIEW,
        auto_confirmed:false,parser_notes:'평가서 격차율 산정표에서 연속 기재된 사례 행과 공시지가 표준지 행의 명시적 대응만 구조화한 검토 후보입니다. 임의 조합하지 않았습니다.',
      });
      break;
    }
  }
  // 매핑표 배치. 표준지·사례가 모두 실재할 때만 관계를 만든다(임의 조합 금지).
  for (const pair of mappingPairsFrom(lines)) {
    const standard = standards.get(pair.standardSymbol);
    const compCase = cases.get(pair.caseSymbol);
    if (!standard || !compCase) continue;
    const key = `${standard.standard_land_id}|${compCase.comp_case_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const refs = [sourceRef([pair.headerLine, pair.line], context)].filter(Boolean);
    rows.push({
      comparison_id:`SC_${context.appraisalId||'APP_001'}_${pair.standardSymbol}_${pair.caseSymbol}`,
      appraisal_id:context.appraisalId||'APP_001',standard_land_id:standard.standard_land_id||'',
      standard_land_symbol:pair.standardSymbol,comp_case_id:compCase.comp_case_id||'',comparison_case_symbol:pair.caseSymbol,
      source_refs:refs,confidence_level:refs.length?'HIGH':'LOW',review_status_code:REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed:false,parser_notes:'평가서의 "표준지 기호 / 사례 기호" 매핑표에 명시된 대응만 구조화한 검토 후보입니다. 임의 조합하지 않았습니다.',
    });
  }
  for (const pair of appliedCasePairsFrom(lines)) {
    const standard = standards.get(pair.standardSymbol);
    const compCase = cases.get(pair.caseSymbol);
    if (!standard || !compCase) continue;
    const key = `${standard.standard_land_id}|${compCase.comp_case_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const refs = [sourceRef([pair.headerLine, pair.line], context)].filter(Boolean);
    rows.push({
      comparison_id: `SC_${context.appraisalId || 'APP_001'}_${pair.standardSymbol}_${pair.caseSymbol}`,
      appraisal_id: context.appraisalId || 'APP_001',
      standard_land_id: standard.standard_land_id || '',
      standard_land_symbol: pair.standardSymbol,
      comp_case_id: compCase.comp_case_id || '',
      comparison_case_symbol: pair.caseSymbol,
      source_refs: refs,
      confidence_level: refs.length ? 'HIGH' : 'LOW',
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      parser_notes: '비교표준지별 "적용사례" 표에 명시된 대응만 구조화한 검토 후보입니다. 표제 기호가 블록 안에서 한 번 더 확인된 경우에만 만들었습니다.',
    });
  }
  return rows;
}

module.exports={extractStandardCaseComparisons,CASE_ROW,STANDARD_ROW,MAPPING_HEADER,mappingPairsFrom,APPLIED_BLOCK_HEADING,appliedCasePairsFrom};
