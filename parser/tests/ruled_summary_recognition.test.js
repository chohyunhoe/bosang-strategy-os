'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {applyRuledSummary,number,areaShare}=require('../src/ruled_summary_adapter');
(async()=>{
 const engine=await import(pathToFileURL(path.resolve(__dirname,'../../browser/product-v2/ruled-table-ocr.js')).href);
 let checks=0;
 const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
 function image(scale=1,offset=0,rowCount=2){const width=900*scale,height=500*scale,data=new Uint8Array(width*height*4).fill(255);const ink=(x,y)=>{for(let dy=0;dy<2*scale;dy++)for(let dx=0;dx<2*scale;dx++){const p=((y+dy)*width+x+dx)*4;data[p]=data[p+1]=data[p+2]=0;}};for(let j=0;j<=rowCount+1;j++)for(let x=50+offset;x<=750+offset;x++)ink(x*scale,(50+j*80)*scale);for(let j=0;j<=7;j++)for(let y=50;y<=50+(rowCount+1)*80;y++)ink((50+offset+j*100)*scale,y*scale);return{width,height,data};}
 for(const [scale,offset] of [[1,0],[2,15]]){const tables=engine.detectRuledTables(image(scale,offset));equal(tables.length,1,'geometry must work without case-specific coordinates');equal(engine.summaryTablePlans(tables)[0].rows.length,2);equal(engine.summaryTablePlans(tables)[0].headers.length,7);}
 equal(engine.detectRuledTables({width:300,height:300,data:new Uint8Array(4)}),[],'truncated pixels');
 equal(engine.summaryTablePlans(engine.detectRuledTables({...image(),data:new Uint8Array(900*500*4).fill(255)})),[],'blank page');
 equal(engine.readStrictNumber('1,234.567'),1234.567,'decimal area remains decimal');equal(engine.readStrictNumber('1,234.567',true),1234567,'money separator recovery is field-scoped');
 equal(engine.readStrictNumber('12,34'),null);equal(engine.readAreaShare('100 x 1/'),null);equal(engine.readAreaShare('100 x 2/1'),null);equal(engine.arithmeticMatches(engine.readAreaShare('100 x 1/2'),200,10000),true);
 const headings={company:'평가업체',address:'소재지',lot:'지번',unit:'단가'};
 const values={text:'합성',address:'가상시 시험동',lot:'91-2','lot-korean':'91-2',category:'대',area:'100x1/2',number:'200'};
 const read=async(box,mode)=>{if(mode.startsWith('header:'))return headings[mode.slice(7)];const base=mode.replace(/-pass\d+$/,'');if(base==='number')return box.left>640?'10,000':'200';return values[base]||'';};
 const detected=await engine.recognizeRuledSummaries(image(),read);equal(detected.length,1);equal(detected[0].rows.length,2);equal(detected[0].rows.map(r=>r.arithmetic_match),[true,true]);
 const failed=await engine.recognizeRuledSummaries(image(),async(box,mode)=>mode==='lot-pass7'?'91-3':read(box,mode));equal(failed[0].rows[0].lot,'','conflicting parcel readings must not use majority vote');
 const mountain=await engine.recognizeRuledSummaries(image(),async(box,mode)=>mode==='lot-korean'?'산91-2':read(box,mode));equal(mountain[0].rows[0].lot,'산91-2','numeric whitelist must not erase mountain identity');
 equal(await engine.recognizeRuledSummaries(image(),async(box,mode)=>mode==='header:unit'?'면적':read(box,mode)),[],'wrong table family is not promoted');
 const base={meta:{},appraisals:[],lands:[],land_appraisal_results:[]};
 const table=structuredClone(detected[0]);table.rows[1].raw.lot='91-3';
 const pages=[{page_no:1,image_width:900,image_height:500,ruled_tables:[table]}];
 let parsed=applyRuledSummary(base,pages,{appraisalId:'APP_SYNTHETIC',fileName:'synthetic.pdf'});
 equal(parsed.lands.length,2);equal(parsed.land_appraisal_results.map(r=>[r.unit_price,r.amount,r.ownership_share_denominator]),[[200,10000,2],[200,10000,2]]);
 equal(parsed.meta.recognition_checked_rows,2);equal(parsed.land_appraisal_results.every(r=>r.auto_confirmed===false),true,'machine arithmetic must not forge human approval');
 equal(parsed.land_appraisal_results[0].source_refs[0].extraction_method,'RULED_CELL_OCR');
 const other=structuredClone(pages[0]);other.page_no=2;other.ruled_tables[0].rows.forEach(r=>{r.raw.company='가상';r.raw.unit_price='300';r.raw.amount='15,000';});
 parsed=applyRuledSummary(base,[...pages,other],{appraisalId:'APP_SYNTHETIC'});equal(parsed.appraisals.length,2);equal(parsed.lands.length,2);equal(parsed.land_appraisal_results.length,4);
 const mismatch=structuredClone(pages);mismatch[0].ruled_tables[0].rows[0].raw.amount='9,990';parsed=applyRuledSummary(base,mismatch);equal(parsed.land_appraisal_results[0].amount,null,'do not compute an unprinted price');equal(parsed.land_appraisal_results[0].candidate_amount,9990);equal(parsed.meta.recognition_unresolved.length,1);
 const bad=structuredClone(pages);bad[0].ruled_tables[0].rows[0].bbox.right=10000;bad[0].ruled_tables[0].rows[1].raw.land_category='모름';parsed=applyRuledSummary(base,bad);equal(parsed.lands.length,0);equal(parsed.meta.recognition_rows,2);equal(parsed.meta.recognition_unresolved.length,2,'invalid rows must remain counted as unresolved');
 const existing={...base,lands:[{land_id:'EXISTING'}]};equal(applyRuledSummary(existing,pages),existing,'normal parser evidence must not be overwritten');
 equal(number('9007199254740992'),null);equal(areaShare('100 x 0/1'),null);
 const {CaseStore}=await import(pathToFileURL(path.resolve(__dirname,'../../browser/product-v2/case-store.js')).href);
 const store=new CaseStore();parsed=applyRuledSummary(base,[...pages,other],{appraisalId:'APP_SYNTHETIC'});store.ingestDocument({fileMeta:{name:'synthetic.pdf',size:1},pageModel:[],parsed});
 equal(store.state.sourceDocuments.length,1);equal(store.state.appraisals.length,2);equal(new Set(store.state.appraisalResults.map(r=>r.appraisal_id)).size,2);equal(store.state.appraisalResults.length,4,'one PDF containing two firms must not create missing cross-product rows');equal(store.state.documentSanity.length,2);equal(store.state.lands.every(r=>r.source_appraisal_ids.length===2),true);


 equal((await engine.recognizeRuledSummaries(image(1,0,1),read))[0].rows.length,1,'single-parcel summaries are supported');
 const mountainConflict=await engine.recognizeRuledSummaries(image(),async(box,mode)=>mode==='lot-korean'?'산91-3':read(box,mode));equal(mountainConflict[0].rows[0].lot,'','mountain prefix and conflicting digits must not be combined');
 const mountainIncomplete=await engine.recognizeRuledSummaries(image(),async(box,mode)=>mode==='lot-korean'?'산 모름':read(box,mode));equal(mountainIncomplete[0].rows[0].lot,'','an incomplete mountain lot cannot borrow digits');
 const addressPages=['신리','가상시 동면 신리','가상시 서면 신리'].map((address,i)=>{const page=structuredClone(pages[0]);page.page_no=i+1;page.ruled_tables[0].rows=page.ruled_tables[0].rows.slice(0,1);page.ruled_tables[0].rows[0].raw.address=address;page.ruled_tables[0].rows[0].raw.company=['가상','합성','시험'][i];return page;});
 equal(applyRuledSummary(base,addressPages).lands.length,3,'abbreviated locality cannot pick the first of conflicting jurisdictions');equal(applyRuledSummary(base,[...addressPages].reverse()).lands.length,3,'parcel linkage must not depend on source order');
 const gate=require('../src/parse_sanity_gate').evaluateParseSanity;
 equal(gate(applyRuledSummary(base,bad)).hold_codes.includes('UNRESOLVED_RULED_OCR_ROWS'),true,'unreadable rows are a promotion hold');
 const partialPages=structuredClone(pages);partialPages[0].ruled_tables[0].rows[1].raw.lot='';const partialParsed=applyRuledSummary(base,partialPages);
 const partialStore=new CaseStore();partialStore.ingestDocument({fileMeta:{name:'partial.pdf'},pageModel:[],parsed:partialParsed});equal(partialStore.state.reviewQueue.find(r=>r.collection==='appraisalResults').confirmable,false,'a readable subset must not masquerade as complete coverage');
 const parse=require('../src/appraisal_pages_parser').parseAppraisalPages;
 const integrated=parse(pages,{appraisalId:'APP_INTEGRATION',fileName:'synthetic.pdf'});
 equal(integrated.land_appraisal_results.length,2,'the actual page parser must consume grid evidence');
 const emptyCanvas={width:900,height:500,getContext:()=>({getImageData:()=>({data:new Uint8Array(900*500*4).fill(255)})})};
 let touched=false;equal(await engine.recognizeCanvasSummaries(emptyCanvas,{setParameters:async()=>{touched=true;}}),[]);equal(touched,false,'pages without a supported grid must not change worker segmentation');
 const previousDocument=globalThis.document;const params=[],languages=[];const errorImage=image();for(let c=0;c<3;c++)errorImage.data[(80*900+80)*4+c]=0;
 globalThis.document={createElement:()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8Array(w*h*4)}),putImageData(){},fillRect(){},drawImage(){}})})};
 try{await assert.rejects(engine.recognizeCanvasSummaries({width:900,height:500,getContext:()=>({getImageData:()=>({data:errorImage.data})})},{reinitialize:async lang=>languages.push(lang),setParameters:async p=>params.push(p),recognize:async()=>{throw new Error('CELL_FAILURE');}}),/CELL_FAILURE/);checks++;equal(languages.at(-1),'kor+eng');equal(params.at(-1),{tessedit_pageseg_mode:'3',tessedit_char_whitelist:''},'worker defaults must restore after OCR failure');}finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
 const rejectedStore=new CaseStore();rejectedStore.ingestDocument({fileMeta:{name:'synthetic.pdf'},pageModel:[],parsed:applyRuledSummary(base,bad)});equal(rejectedStore.state.sourceDocuments[0].recognition_report.unresolved.length,2,'rejected cell evidence must survive in the case backup');

 equal(engine.normalizedCellScale({height:14}),3.2,'scale derives from observed text band height');equal(engine.normalizedCellScale({height:100}),1,'large glyphs are not enlarged');equal(engine.normalizedCellScale({height:6}),4,'enlargement is bounded');
 const {cellAddress}=require('../src/ruled_summary_adapter');equal(cellAddress('가상시\n시험서\n구\n표본동'),'가상시 시험서구 표본동','an isolated administrative suffix joins only its wrapped word');equal(cellAddress('가상시\n시험구\n동'),'가상시 시험구 동','do not join already complete administrative tokens');equal(cellAddress('가상시 시험서 구 표본동'),'가상시 시험서 구 표본동','same-line ambiguous spaces remain untouched');
 const wrappedPages=structuredClone(pages);wrappedPages[0].ruled_tables[0].rows[0].raw.address='가상시\n시험서\n구\n표본동';const wrapped=applyRuledSummary(base,wrappedPages);equal(wrapped.lands[0].parcel_address,'가상시 시험서구 표본동 91-2');equal(wrapped.land_appraisal_results[0].source_refs[0].raw_text_excerpt.includes('시험서 구'),true,'original OCR excerpt remains available');

 const modelRead=async(box,mode,ambiguous=false)=>{if(mode.startsWith('header:'))return read(box,mode);if(mode.startsWith('area'))return '100';if(mode.startsWith('number')){const amount=box.left>640;if(mode==='number-best')return amount?'20,100':'201';if(mode==='number-best-small')return ambiguous?(amount?'20,200':'202'):(amount?'20,100':'201');return amount?'19,800':'200';}return read(box,mode);};
 const recoveredModel=await engine.recognizeRuledSummaries(image(),(b,m)=>modelRead(b,m));equal(recoveredModel[0].rows[0].raw.unit_price,'201','a unique printed model reread may recover money');equal(recoveredModel[0].rows[0].amount,20100);
 const ambiguousModel=await engine.recognizeRuledSummaries(image(),(b,m)=>modelRead(b,m,true));equal(ambiguousModel[0].rows[0].arithmetic_match,false,'two different consistent model readings remain unresolved');equal(ambiguousModel[0].rows[0].raw.unit_price,'200','ambiguous model votes must not overwrite source readings');
 const companyRetry=await engine.recognizeRuledSummaries(image(),async(b,m)=>m==='text'?'':m.startsWith('text-')?'합성':read(b,m));equal(companyRetry[0].rows[0].company,'합성','an unreadable company cell may use a unique explicit reread');
 const languagePhases=[];await engine.recognizeRuledSummaries(image(),async(b,m)=>{if(!m.startsWith('header:'))languagePhases.push(m==='lot-korean'||!(/^(?:lot|number|area)(?:-|$)/.test(m))?'kor':'number');return read(b,m);});equal(languagePhases.filter((p,i)=>i===0||p!==languagePhases[i-1]),['kor','number','kor','number'],'metadata reads must not repeatedly switch language models within a row');
 console.log(`Ruled summary recognition regressions: ${checks} passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
