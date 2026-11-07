'use strict';
const {test,expect}=require('@playwright/test');
test('reversed ownership columns and rows preserve identity; old matches require reimport',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {CaseStore}=await import('/case-store.js');
  const {caseSnapshotForOutput}=await import('/output-adapter.js');
  const make=(text,id)=>window.BosangParser.parseAppraisalPages([{page_no:1,text:'토지평가조서\n'+text}],{appraisalId:id,fileName:'synthetic.pdf'});
  const a=make('연번 조합원번호 소재지 지번 지목 소유면적 편입면적 단가 금액 소유자\n11 1 표본동 10-2 대 50 100 200,000 10,000,000 익명갑\n12 2 표본동 10-2 대 50 100 300,000 15,000,000 익명을','APP_A');
  const b=make('조합원번호 연번 소재지 지번 지목 소유면적 편입면적 단가 금액 소유자\n2 1 표본동 10-2 대 50 100 330,000 16,500,000 익명을\n1 2 표본동 10-2 대 50 100 220,000 11,000,000 익명갑','APP_B');
  const s=new CaseStore();[a,b].forEach((parsed,i)=>s.ingestDocument({fileMeta:{name:`synthetic-${i}.pdf`},pageModel:[],parsed}));
  const pairs=s.state.lands.map(land=>({member:land.member_no,prices:s.state.appraisalResults.filter(r=>r.land_id===land.land_id).map(r=>r.unit_price)}));
  const old=s.snapshot();old.lands.forEach(row=>delete row.member_no_evidence_version);
  old.reviewDecisions={'GROUP:appraisalResults':{status:'CONFIRMED'}};
  s.restoreSnapshot(old);
  return {pairs,status:s.state.status,error:s.state.error,decisions:s.state.reviewDecisions,codes:s.state.documentSanity.flatMap(d=>d.hold_codes),output:caseSnapshotForOutput(s.state).meta.review_status};
 });
 expect(result.pairs).toEqual([{member:'1',prices:[200000,220000]},{member:'2',prices:[300000,330000]}]);
 expect(result.status).toBe('PARSE_HOLD');expect(result.error).toContain('다시 불러오');
 expect(result.codes).toContain('OWNERSHIP_HEADER_REIMPORT_REQUIRED');expect(result.decisions).toEqual({});expect(result.output).toBe('REVIEW_REQUIRED');
});
