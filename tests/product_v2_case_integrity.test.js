'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const urls = new Map();
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let code = fs.readFileSync(path.join(__dirname, '../browser/product-v2', name), 'utf8');
  code = code.replace(/from '\.\/([^']+)'/g, (_, dependency) => `from '${moduleUrl(dependency)}'`);
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  urls.set(name, url); return url;
}
function parsed(id, address = '가상시 동면 신리 1-1', pnu = '', category = '답', area = 100) {
  const ref = [{ appraisal_id:id, page_no:1, source_label:'합성 원문', raw_text_excerpt:'합성 검증 자료' }];
  return {
    meta:{parse_status:'TEXT_PARSED'}, case:{case_name:'합성 사건'},
    appraisals:[{appraisal_id:id,appraisal_company:'합성'+id,review_status_code:'NEEDS_REVIEW'}],
    lands:[{land_id:'L1',parcel_address:address,pnu,land_category:category,area,source_refs:ref,review_status_code:'NEEDS_REVIEW'}],
    land_appraisal_results:[{land_id:'L1',appraisal_id:id,unit_price:100000,amount:area*100000,review_status_code:'NEEDS_REVIEW',source_refs:ref}],
  };
}
function ingest(store, data) { store.ingestDocument({fileMeta:{name:'synthetic.pdf'},pageModel:[],parsed:data}); }
(async () => {
  globalThis.window = {BosangParser:{evaluateParseSanity:()=>({status:'READY',hold_codes:[],holds:[]})}};
  const {CaseStore} = await import(moduleUrl('case-store.js'));
  const {SessionCaseRegistry} = await import(moduleUrl('case-registry.js'));
  const {caseSnapshotForOutput} = await import(moduleUrl('output-adapter.js'));
  const store = new CaseStore(); ingest(store,parsed('A'));
  for (const item of store.state.reviewQueue) store.decide(item.review_id,'CONFIRMED');
  const unchangedCaseDecision = store.state.reviewDecisions['GROUP:caseInfo'];
  assert.equal(caseSnapshotForOutput(store.state).meta.review_status,'REVIEWED');
  ingest(store,parsed('B'));
  for (const group of ['appraisals','lands','appraisalResults']) {
    assert.equal(store.state.reviewQueue.find(row=>row.collection===group).status,'NEEDS_REVIEW',group+' must be reviewed again after new input');
    assert.equal(store.state.reviewDecisions['GROUP:'+group],undefined);
  }
  assert.deepEqual(store.state.reviewDecisions['GROUP:caseInfo'],unchangedCaseDecision,'unchanged groups keep their review');
  const output = caseSnapshotForOutput(store.state);
  assert.equal(output.meta.review_status,'REVIEW_REQUIRED');
  assert.equal(output.land_appraisal_results[1].review_status_code,'NEEDS_REVIEW');
  assert.equal(output.land_appraisal_results[1].review_origin,undefined);
  // Even a stale decision cannot override a pending or blocked canonical queue.
  store.state.reviewDecisions['GROUP:appraisalResults']={status:'CONFIRMED',reviewed_at:'2026-01-01T00:00:00Z'};
  assert.equal(caseSnapshotForOutput(store.state).land_appraisal_results[1].review_status_code,'NEEDS_REVIEW');
  store.state.reviewQueue.find(row=>row.collection==='appraisalResults').status='CONFIRMED';
  store.state.reviewQueue.find(row=>row.collection==='appraisalResults').row_count=1;
  assert.equal(caseSnapshotForOutput(store.state).land_appraisal_results[1].review_status_code,'NEEDS_REVIEW','stale row count cannot confirm appended rows');
  store.rebuildReviewQueue();store.decide('GROUP:appraisalResults','HOLD','원문 재검토');
  const registry = new SessionCaseRegistry(store);registry.ensureActive();
  registry.importBundle(registry.exportBundle());
  assert.equal(store.state.reviewDecisions['GROUP:appraisalResults'].status,'HOLD');
  assert.equal(caseSnapshotForOutput(store.state).meta.review_status,'REVIEW_REQUIRED');
  ingest(store,parsed('C'));
  assert.equal(store.state.reviewDecisions['GROUP:appraisalResults'].status,'HOLD','new input must preserve existing hold notes');
  assert.equal(store.state.reviewDecisions['GROUP:appraisalResults'].note,'원문 재검토');
  store.state.subjectFactorTotals=[{appraisal_id:'A',total_factor:1}];
  store.state.subjectFactorDetails=[{appraisal_id:'A',total_factor:1}];
  store.rebuildReviewQueue();store.decide('GROUP:subjectFactorTotals','CONFIRMED');
  store.updateRecord('subjectFactorDetails',()=>true,{total_factor:0.9});
  assert.equal(store.state.reviewDecisions['GROUP:subjectFactorTotals'],undefined,'detail edits invalidate the shared factor review');
  store.state.issueCandidates=[{issue_id:'SYNTHETIC_OLD_ISSUE',description:'이전 합성 쟁점'}];
  store.state.reviewDecisions['GROUP:issueCandidates']={status:'HOLD',note:'추가 원문 대조'};
  store.rebuildIssues();
  assert.equal(store.state.reviewDecisions['GROUP:issueCandidates'].note,'추가 원문 대조','derived issue refresh must preserve an existing hold note');
  const cases = [
    ['different explicit municipalities',parsed('A'),parsed('B','가상시 서면 신리 1-1'),2],
    ['different explicit PNUs',parsed('A',undefined,'9999910100100010001'),parsed('B',undefined,'9999910200100010001'),2],
    ['abbreviated address and category alias',parsed('A','합성동 산3-1','','임'),parsed('B','가상시 합성동 산3-1','','임야'),1],
    ['unique missing category',parsed('A'),parsed('B','신리 1-1','',''),1],
    ['same PNU but different areas',parsed('A',undefined,'9999910100100010001'),parsed('B',undefined,'9999910100100010001','답',120),2],
    ['same PNU but different categories',parsed('A',undefined,'9999910100100010001'),parsed('B',undefined,'9999910100100010001','전'),2],
    ['full address conflict despite same PNU',parsed('A',undefined,'9999910100100010001'),parsed('B','가상시 서면 신리 1-1','9999910100100010001'),2],
  ];
  for (const [label,a,b,count] of cases) {
    const item = new CaseStore();ingest(item,a);ingest(item,b);
    assert.equal(item.state.lands.length,count,label);
    assert.equal(new Set(item.state.appraisalResults.map(row=>row.land_id)).size,count,label+' result linkage');
  }
  const ambiguous = new CaseStore();
  ingest(ambiguous,parsed('A'));ingest(ambiguous,parsed('B','가상시 서면 신리 1-1'));ingest(ambiguous,parsed('C','신리 1-1'));
  assert.equal(ambiguous.state.lands.length,3,'multiple abbreviated candidates are not guessed');
  const abbreviatedFirst = new CaseStore();
  ingest(abbreviatedFirst,parsed('A','신리 1-1'));ingest(abbreviatedFirst,parsed('B'));ingest(abbreviatedFirst,parsed('C','가상시 서면 신리 1-1'));
  assert.equal(abbreviatedFirst.state.lands.length,2,'later full jurisdiction evidence is retained even when display address is abbreviated');
  for(const reverse of [false,true]){
    const item=new CaseStore();ingest(item,parsed('A','신리 1-1'));
    const incoming=parsed('B');const other=parsed('B','가상시 서면 신리 1-1');
    other.lands[0].land_id='L2';other.land_appraisal_results[0].land_id='L2';
    incoming.lands.push(other.lands[0]);incoming.land_appraisal_results.push(other.land_appraisal_results[0]);
    if(reverse)incoming.lands.reverse();
    ingest(item,incoming);
    assert.equal(item.state.lands.length,3,'incoming full addresses must not claim an ambiguous old row in either order');
    const originalLand=item.state.appraisalResults.find(row=>row.appraisal_id==='A').land_id;
    assert.ok(item.state.appraisalResults.filter(row=>row.appraisal_id==='B').every(row=>row.land_id!==originalLand));
  }
  const corrected=new CaseStore();ingest(corrected,parsed('A'));
  corrected.updateRecord('lands',()=>true,{parcel_address:'가상시 서면 신리 1-1'});
  ingest(corrected,parsed('B','가상시 서면 신리 1-1'));
  assert.equal(corrected.state.lands.length,1,'manual address corrections replace matching evidence without losing history');
  assert.deepEqual(corrected.state.lands[0].parcel_address_history,['가상시 동면 신리 1-1']);
  assert.equal(corrected.state.lands[0].source_refs.length,2);
  console.log('Product v2 case integrity: review invalidation, output defense, hold restore and parcel identity passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
