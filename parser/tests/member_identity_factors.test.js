'use strict';
const assert=require('node:assert/strict');
const {parseAppraisalPages}=require('../src/appraisal_pages_parser');
const {parseCalculationRowText}=require('../src/extractors/land_price_calculation_extractor');
const calc=(serial,other='2.00',address='표본동 10-2')=>`${serial} ${address} 50 100 준주거 가 200,000 1.01000 1.00 0.90 1.00 0.80 0.95 1.00 1.00 0.684 ${other} 276,336 276,000 가로조건 및 환경조건 등에 관한 검토의견을 별도로 기재함`;
function pages(memberOnly=false){return [
 {page_no:1,text:'토지가격 산출근거\n가로 접근 환경 개별요인 획지 행정 기타 계\n'+calc(101)+'\n'+calc(102)},
 {page_no:2,text:'토지평가조서\n'+(memberOnly?'조합원번호':'연번 조합원번호')+' 소재지 지번 지목 소유면적 단가 금액\n'+(memberOnly?'':'101 ')+'500-1 표본동 10-2 대지 50 100 276,000 13,800,000 익명갑\n'+(memberOnly?'':'102 ')+'500-2 표본동 10-2 대지 50 100 276,000 13,800,000 익명을'},
];}
const parse=(p,id='APP_B')=>parseAppraisalPages(p,{appraisalId:id,fileName:'synthetic.pdf'});
const a=parse(pages(false),'APP_A'),b=parse(pages(true));
assert.deepEqual(a.lands.map(r=>r.member_no),['500-1','500-2']);
assert.deepEqual(b.lands.map(r=>r.member_no),['500-1','500-2']);
assert.ok(b.lands.every(r=>r.member_no_origin==='EXPLICIT_STATEMENT_HEADER'&&r.member_no_source_refs.length===2));
for(const r of b.land_appraisal_results){
 assert.equal(r.calculation_link_method,'IDENTICAL_OWNERSHIP_GROUP_VALUES');
 assert.equal(r.individual_factor_total,.684);assert.equal(r.other_factor,2);
 assert.equal(r.calculated_unit_price,276336);assert.equal(r.amount,13800000);
 assert.deepEqual(r.individual_factor_details.map(d=>d.factor_value),[.9,1,.8,.95,1,1]);
 assert.ok(r.source_refs.filter(s=>s.page_no===1).length>=2);
 assert.equal(r.auto_confirmed,false);
}
assert.equal(parseCalculationRowText(calc(101)).factor_columns_ambiguous,undefined,'remarks after the complete numeric run do not invalidate columns');
for(const mutate of [
 p=>p[0].text=p[0].text.replace(calc(102),calc(102,'2.10')),
 p=>p[0].text=p[0].text.replace('\n'+calc(102),''),
 p=>p[0].text=p[0].text.replace(calc(102),calc(102,'2.00','표본동 20-3')),
 p=>p[1].text=p[1].text.replace('276,000 13,800,000 익명을','280,000 14,000,000 익명을'),
]){const p=pages(true);mutate(p);const r=parse(p);assert.ok(r.land_appraisal_results.every(r=>!r.calculation_link_method),'conflicting/incomplete ownership groups cannot borrow values');}
const reversed=pages(true);reversed[0].text=reversed[0].text.replace('가로 접근','접근 가로');
assert.ok(parse(reversed).land_appraisal_results.every(r=>r.individual_factor_details.length===0));
const noHeader=pages(true);noHeader[1].text=noHeader[1].text.replace('조합원번호','기호');
assert.ok(parse(noHeader).lands.every(r=>!r.member_no),'hyphenated identifiers alone do not establish membership semantics');
(async()=>{
 const {CaseStore}=await import('../../browser/product-v2/case-store.js');
 const make=()=>{const s=new CaseStore();s.ingestDocument({fileMeta:{name:'first.pdf'},pageModel:pages(false),parsed:a});return s;};
 const s=make();s.ingestDocument({fileMeta:{name:'second.pdf'},pageModel:pages(true),parsed:b});
 assert.equal(s.state.lands.length,2);assert.equal(s.state.appraisalResults.length,4);
 assert.ok(s.state.lands.every(r=>r.ownership_match_method==='EXPLICIT_MEMBER_NUMBER'&&r.source_appraisal_ids.length===2));
 for(const land of s.state.lands)assert.equal(s.state.appraisalResults.filter(r=>r.land_id===land.land_id).length,2);
 const missing=make();missing.ingestDocument({fileMeta:{name:'unknown.pdf'},pageModel:noHeader,parsed:parse(noHeader)});assert.equal(missing.state.lands.length,4);
 const duplicate=structuredClone(b);duplicate.lands[1].member_no=duplicate.lands[0].member_no;
 const d=make();d.ingestDocument({fileMeta:{name:'ambiguous.pdf'},pageModel:pages(true),parsed:duplicate});assert.equal(d.state.lands.length,4);
 const conflict=structuredClone(b);conflict.lands.forEach((r,i)=>r.member_no=`900-${i+1}`);
 const c=make();c.ingestDocument({fileMeta:{name:'other.pdf'},pageModel:pages(true),parsed:conflict});assert.equal(c.state.lands.length,4);
 console.log('member identity and identical factor group tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

const {buildAppraisalRowSubjectStandardLinks,CONDITION_FIELDS}=require('../src/extractors/subject_factor_comparison_extractor');
const linkContext={appraisalId:'APP_B',lands:b.lands,landAppraisalResults:b.land_appraisal_results,standardLands:[{standard_land_id:'STD_A',standard_land_symbol:'가',source_refs:[{page_no:3}]}]};
const links=buildAppraisalRowSubjectStandardLinks(linkContext);
assert.equal(links.length,2);
assert.deepEqual(CONDITION_FIELDS.map(field=>links[0][field]),[.9,1,.8,.95,1,1]);
assert.equal(links[0].auto_confirmed,false);
assert.ok(links[0].source_refs.some(ref=>String(ref.raw_text_excerpt).includes('가로 접근')));
const incomplete=structuredClone(linkContext);incomplete.landAppraisalResults.forEach(r=>r.individual_factor_details.pop());
assert.ok(buildAppraisalRowSubjectStandardLinks(incomplete).every(r=>r.street_condition===undefined));
