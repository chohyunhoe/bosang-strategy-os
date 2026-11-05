'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=process.env.BSO_TEST_ROOT||path.resolve(__dirname,'../..');
(async()=>{
 const adapter=require(path.join(root,'parser/src/ruled_summary_adapter.js'));
 const engine=await import(pathToFileURL(path.join(root,'browser/product-v2/ruled-table-ocr.js')).href);
 const {CaseStore}=await import(pathToFileURL(path.join(root,'browser/product-v2/case-store.js')).href);
 let checks=0;const equal=(a,b,note)=>{assert.deepEqual(a,b,note);checks++;};
 const addresses=[['가상시 표본동',true],['|가상시\n.표본동',true],['가상도 예시시 시험구 표본동',true],['시험서\n구\n표본동',true],['예시시 종로2가',true],['가상시 시험면 표본리',true],['가상시 시험구',false],['가상시 표X동',false],['의 가상시 표본동',false],['가상시 .표본동',false],['표본동 가상시',false],['가상시 다른시 표본동',false],['표본동 가상시 표본리',false],['',false]];
 for(const [value,valid] of addresses){equal(adapter.cellAddressValid(value),valid,'cadastral address structure');equal(engine.cellAddressValid(value),valid,'browser/parser parity');}
 equal(engine.chooseCellAddress(['가상시 ??? 표본동','가상시 표본동','가상시\n표본동']).status,'SOURCE_CANDIDATE');
 equal(engine.chooseCellAddress(['가상시 표본동','다른시 표본동']).status,'CONFLICT','a well-formed jurisdiction conflict must remain unresolved');
 equal(engine.chooseCellAddress(['시험구 표본동','가상시 시험구 표본동']).value,'가상시 시험구 표본동','prefer the more complete compatible source reading');
 const width=900,height=500,data=new Uint8Array(width*height*4).fill(255);const ink=(x,y)=>{for(let d=0;d<2;d++){const p=((y+d)*width+x)*4;data[p]=data[p+1]=data[p+2]=0;}};
 for(let row=0;row<=3;row++)for(let x=50;x<=750;x++)ink(x,50+row*80);for(let col=0;col<=7;col++)for(let y=50;y<=290;y++)ink(50+col*100,y);
 const image={width,height,data};const headings={company:'평가업체',address:'소재지',lot:'지번',unit:'단가'};
 const read=async(box,mode)=>{if(mode.startsWith('header:'))return headings[mode.slice(7)];if(mode.startsWith('address'))return mode==='address'?'가상시 ??? 표본동':'가상시 표본동';if(mode.startsWith('text'))return'합성';if(mode.startsWith('lot'))return'91-2';if(mode.startsWith('category'))return'대';if(mode.startsWith('area'))return'100x1/2';if(mode.startsWith('number'))return box.left>640?'10,000':'200';return'';};
 let tables=await engine.recognizeRuledSummaries(image,read);equal(tables[0].rows[0].raw.address,'가상시 표본동','use the actual readable address retry');equal(tables[0].rows[0].alternatives.address[0],'가상시 ??? 표본동','retain the unreadable original');
 const base={meta:{},appraisals:[],lands:[],land_appraisal_results:[]};const page=t=>({page_no:1,image_width:width,image_height:height,ruled_tables:t});
 tables=await engine.recognizeRuledSummaries(image,async(b,m)=>m.startsWith('address')?'가상시 ??? 표본동':read(b,m));let parsed=adapter.applyRuledSummary(base,[page(tables)]);
 equal(parsed.land_appraisal_results[0].amount,10000,'uncertain location must not discard readable numeric evidence');equal(parsed.lands[0].parcel_address,'','malformed OCR must not become a canonical query address');equal(parsed.lands[0].candidate_parcel_address,'가상시 ??? 표본동 91-2');equal(parsed.lands.length,2,'empty locations must never merge unrelated rows');equal(parsed.meta.recognition_location_unresolved_rows,2);
 const store=new CaseStore();store.ingestDocument({fileMeta:{name:'synthetic.pdf'},pageModel:[],parsed});const group=()=>store.state.reviewQueue.find(r=>r.collection==='lands');equal(group().confirmable,false);equal(store.decide('GROUP:lands','CONFIRMED').ok,false,'location review cannot be bulk confirmed while addresses are missing');
 for(let i=0;i<store.state.lands.length;i++)store.updateRecord('lands',(_r,index)=>index===i,{parcel_address:'주소모름'});equal(group().confirmable,false,'invalid manual replacement must remain blocked');
 for(let i=0;i<store.state.lands.length;i++)store.updateRecord('lands',(_r,index)=>index===i,{parcel_address:'가상시 표본동 91-2'});equal(group().confirmable,true);equal(store.state.lands.every(r=>r.auto_confirmed===false),true);equal(group().status,'NEEDS_REVIEW','manual correction must not forge approval');
 tables=await engine.recognizeRuledSummaries(image,async(b,m)=>m==='address-sparse'?'다른시 표본동':m.startsWith('address')?'가상시 표본동':read(b,m));parsed=adapter.applyRuledSummary(base,[page(tables)]);equal(parsed.lands[0].parcel_address,'','contradictory jurisdictions must not select the first valid reading');equal(parsed.lands[0].location_recognition_status,'UNRESOLVED');

 equal(adapter.cellAddress('|가상시\n.표본동'),'가상시 표본동','remove only boundary OCR punctuation without substituting Korean letters');
 const punctuation=structuredClone(tables);punctuation[0].rows.forEach(r=>{r.raw.address='|가상시\n.표본동';r.address_reading_status='SOURCE_CANDIDATE';});const clean=adapter.applyRuledSummary(base,[page(punctuation)]);equal(clean.lands[0].parcel_address,'가상시 표본동 91-2');equal(clean.land_appraisal_results[0].source_refs[0].raw_text_excerpt.includes('|가상시 .표본동'),true,'preserve original punctuation in the evidence excerpt');

 equal(adapter.partialAreaShare('120 x 1/'),{area:120,numerator:1,denominator:null,shareIncomplete:true});equal(adapter.partialAreaShare('120 x 1/0'),null,'an invalid explicit denominator is not a missing denominator');equal(adapter.partialAreaShare('120 x 0/'),null);equal(adapter.partialAreaShare('120 x 1/2'),null,'complete shares use the strict parser');
 const partial=structuredClone(tables);partial[0].rows.forEach(r=>{r.raw.address='가상시 표본동';r.address_reading_status='SOURCE_CANDIDATE';r.raw.area='100x1/';});const incomplete=adapter.applyRuledSummary(base,[page(partial)]);equal(incomplete.land_appraisal_results.length,1,'duplicate source rows remain deduplicated');equal(incomplete.land_appraisal_results[0].area,100);equal(incomplete.land_appraisal_results[0].ownership_share_denominator,null,'never invent the missing denominator');equal(incomplete.land_appraisal_results[0].unit_price,null);equal(incomplete.land_appraisal_results[0].candidate_unit_price,200);equal(incomplete.land_appraisal_results[0].candidate_amount,10000);equal(incomplete.land_appraisal_results[0].recognition_status,'SHARE_DENOMINATOR_UNREADABLE');equal(incomplete.meta.recognition_checked_rows,0);equal(incomplete.meta.recognition_unresolved.some(r=>r.reason==='SHARE_DENOMINATOR_UNREADABLE'),true);

 equal(adapter.cellAddress('가상\n도\n예시시\n표본동'),'가상도 예시시 표본동','restore an explicitly wrapped province suffix');equal(engine.normalizeCellAddress('가상\n도\n예시시\n표본동'),'가상도 예시시 표본동');equal(adapter.cellAddress('가상도\n시'),'가상도 시','never glue a city suffix onto a complete province');equal(adapter.cellAddressValid('가상도\n시'),false);
 const conflict=structuredClone(partial);conflict[0].rows[1].raw.unit_price='201';const contradicted=adapter.applyRuledSummary(base,[page(conflict)]);equal(contradicted.land_appraisal_results[0].recognition_status,'CONFLICTING_TABLE_ROWS','different incomplete numeric candidates must remain conflicts');equal(contradicted.land_appraisal_results[0].amount,null);

 equal(adapter.cellAddressValid('가상시 평가'),false,'a value label ending in 가 is not a cadastral ga name');equal(engine.cellAddressValid('확인불가'),false,'an error placeholder must not become a ga locality');equal(adapter.cellAddressValid('가상시 종로2가'),true,'support numeric cadastral ga names');
 for(let i=0;i<store.state.lands.length;i++)store.updateRecord('lands',(_r,index)=>index===i,{parcel_address:'확인불가 91-2'});equal(group().confirmable,false,'an error placeholder plus lot is not a repaired location');
 console.log(`Cell address recovery regressions: ${checks} passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
