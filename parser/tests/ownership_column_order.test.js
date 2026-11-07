'use strict';
const assert=require('node:assert/strict');
const {parseAppraisalPages}=require('../src/appraisal_pages_parser');
const statement=(header,rows)=>[{page_no:1,text:'토지평가조서\n'+header+' 소재지 지번 지목 소유면적 편입면적 단가 금액 소유자\n'+rows.join('\n')}];
const row=(ids,owner,unit)=>`${ids} 표본동 10-2 대 50 100 ${unit.toLocaleString('en-US')} ${(unit*50).toLocaleString('en-US')} ${owner}`;
const first=statement('연번 조합원번호',[row('11 1','익명갑',200000),row('12 2','익명을',300000)]);
const second=statement('조합원번호 연번',[row('2 1','익명을',330000),row('1 2','익명갑',220000)]);
const parse=(pages,id)=>parseAppraisalPages(pages,{appraisalId:id,fileName:'synthetic.pdf'});
const a=parse(first,'APP_A'),b=parse(second,'APP_B');
assert.deepEqual(b.lands.map(r=>r.member_no),['2','1'],'header column order determines membership; the serial column is not the owner identifier');
(async()=>{
 const {CaseStore}=await import('../../browser/product-v2/case-store.js');
 globalThis.window={BosangParser:{evaluateParseSanity:()=>({status:'READY',hold_codes:[],holds:[]})}};
 for(const reverse of [false,true]){
  const s=new CaseStore();
  const inputs=reverse?[[second,b],[first,a]]:[[first,a],[second,b]];
  inputs.forEach(([pageModel,parsed],i)=>s.ingestDocument({fileMeta:{name:`synthetic-${i}.pdf`},pageModel,parsed}));
  assert.equal(s.state.lands.length,2);
  for(const [member,prices] of [['1',[200000,220000]],['2',[300000,330000]]]){
   const land=s.state.lands.find(r=>r.member_no===member);
   assert.deepEqual(s.state.appraisalResults.filter(r=>r.land_id===land.land_id).map(r=>r.unit_price).sort((a,b)=>a-b),prices);
  }
  const restored=new CaseStore();restored.restoreSnapshot(s.snapshot());assert.equal(restored.state.status,'READY');
  const legacy=s.snapshot();legacy.lands.forEach(r=>delete r.member_no_evidence_version);
  legacy.reviewDecisions={'GROUP:appraisalResults':{status:'CONFIRMED'}};
  const held=new CaseStore();held.restoreSnapshot(legacy);
  assert.equal(held.state.status,'PARSE_HOLD');assert.deepEqual(held.state.reviewDecisions,{});
  assert.ok(held.state.documentSanity.every(d=>d.hold_codes.includes('OWNERSHIP_HEADER_REIMPORT_REQUIRED')));
 }
 const layouts=['연번 조합원번호','조합원번호 연번','조합원번호'];
 for(const h1 of layouts)for(const h2 of layouts)for(const reverseRows of [false,true])for(const reverseFiles of [false,true]){
  const make=(header,id,isSecond)=>{
   const owners=[{member:'1',owner:'익명갑',unit:isSecond?220000:200000},{member:'2',owner:'익명을',unit:isSecond?330000:300000}];
   if(isSecond&&reverseRows)owners.reverse();
   const pages=statement(header,owners.map((o,i)=>row(header==='조합원번호'?o.member:header.startsWith('연번')?`${i+1} ${o.member}`:`${o.member} ${i+1}`,o.owner,o.unit)));
   return {fileMeta:{name:'synthetic.pdf'},pageModel:pages,parsed:parse(pages,id)};
  };
  const inputs=[make(h1,'APP_A',false),make(h2,'APP_B',true)];if(reverseFiles)inputs.reverse();
  const s=new CaseStore();inputs.forEach(input=>s.ingestDocument(input));assert.equal(s.state.lands.length,2);
  for(const [member,prices] of [['1',[200000,220000]],['2',[300000,330000]]]){
   const land=s.state.lands.find(r=>r.member_no===member);
   assert.deepEqual(s.state.appraisalResults.filter(r=>r.land_id===land.land_id).map(r=>r.unit_price).sort((a,b)=>a-b),prices);
  }
 }
 // One old row must not be claimed by two incoming owners just because area/PNU match.
 const onlyA=structuredClone(a);onlyA.lands=onlyA.lands.slice(0,1);onlyA.land_appraisal_results=onlyA.land_appraisal_results.slice(0,1);
 for(const input of [parse(statement('기호',[row('1','익명갑',220000),row('2','익명을',330000)]),'APP_MISSING'),parse(unsupportedTwo,'APP_UNKNOWN')]){
  const s=new CaseStore();s.ingestDocument({fileMeta:{name:'a.pdf'},pageModel:first,parsed:onlyA});
  s.ingestDocument({fileMeta:{name:'b.pdf'},pageModel:[],parsed:input});assert.equal(s.state.lands.length,3);
  assert.equal(s.state.appraisalResults.filter(r=>r.land_id===s.state.lands[0].land_id).length,1);
 }
 console.log('ownership column order regressions passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Same unit price and same product do not establish the owner of each detail.
const calc=(serial,street,access)=>`${serial} 표본동 10-2 50 100 준주거 가 200,000 1.00000 1.00 ${street} ${access} 1.00 1.00 1.00 1.00 0.720 2.00 288,000 288,000`;
const factorPage={page_no:1,text:'토지가격 산출근거\n가로 접근 환경 획지 행정 기타 계\n'+calc(1,'.80','.90')+'\n'+calc(2,'.90','.80')};
// Parser requires leading zeros for directly read numeric cells.
factorPage.text=factorPage.text.replace(/ (?=\.\d)/g,' 0');
const factorStatement=statement('조합원번호 연번',[row('2 1','익명을',288000),row('1 2','익명갑',288000)])[0];factorStatement.page_no=2;
const fp=parse([factorPage,factorStatement],'APP_FACTORS');
for(const member of ['1','2']){
 const land=fp.lands.find(r=>r.member_no===member),result=fp.land_appraisal_results.find(r=>r.land_id===land.land_id);
 assert.equal(result.individual_factor_details[0].factor_value,member==='1'?.9:.8,'factor serial joins the explicit serial column, not the first numeric token');
}
const memberOnly=structuredClone(factorStatement);memberOnly.text=memberOnly.text.replace('조합원번호 연번','조합원번호').replace('2 1 표본동','2 표본동').replace('1 2 표본동','1 표본동');
assert.ok(parse([factorPage,memberOnly],'APP_NO_SERIAL').land_appraisal_results.every(r=>!r.calculation_link_method),'member numbers that collide with calculation serials do not authorize a join');
// Even when the legacy row parser can read an unfamiliar header, it must not invent member identity.
const unsupportedTwo=statement('기호 조합원번호',[row('1 11','익명갑',200000),row('2 12','익명을',300000)]);
assert.ok(parse(unsupportedTwo,'APP_UNKNOWN').lands.every(r=>!r.member_no&&r.ownership_identity_status==='UNRESOLVED_MEMBER_HEADER'));
const {attachIndividualFactorDetails}=require('../src/extractors/individual_factor_details_extractor');
const prose=[{page_no:1,line_no:1,raw_text:'표본동 10-2',normalized_text:'표본동 10-2'},{page_no:1,line_no:2,raw_text:'접근조건 교통시설 0.8',normalized_text:'접근조건 교통시설 0.8'}];
assert.ok(attachIndividualFactorDetails(prose,[{land_id:'A',parcel_address:'표본동 10-2'},{land_id:'B',parcel_address:'표본동 10-2'}]).every(r=>r.individual_factor_details.length===0));

const detailPage={page_no:1,text:'개별요인 상세내역\n가로 접근 환경 획지 행정 기타 누계\n1 가 0.80 0.90 1.00 1.00 1.00 1.00 0.720\n2 가 0.90 0.80 1.00 1.00 1.00 1.00 0.720'};
const dp=parse([detailPage,factorStatement],'APP_DETAIL');
for(const member of ['1','2']){
 const land=dp.lands.find(r=>r.member_no===member);
 const comparison=dp.subject_to_standard_factor_comparisons.find(r=>r.land_id===land.land_id);
 assert.equal(comparison.street_condition,member==='1'?.9:.8);
}
assert.equal(parse([detailPage,memberOnly],'APP_DETAIL_NO_SERIAL').subject_to_standard_factor_comparisons.length,0);
