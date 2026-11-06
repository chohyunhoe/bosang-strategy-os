'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{pathToFileURL}=require('node:url'),path=require('node:path');
async function setup(t,options={}){
 const dom=new JSDOM('<main></main>',{url:'http://127.0.0.1:4174',pretendToBeVisual:true});
 const keys=['document','FormData','fetch'],original=Object.fromEntries(keys.map(k=>[k,global[k]]));global.document=dom.window.document;global.FormData=dom.window.FormData;
 const api=await import(pathToFileURL(path.resolve(__dirname,'../browser/product-v2/document-workflow.js'))),ui=await import(pathToFileURL(path.resolve(__dirname,'../browser/product-v2/document-workflow-ui.js')));
 let rows=api.registerDocument([],{title:'Synthetic',purpose:'test',owner:'QA',template_ref:'v1',source_ref:'synthetic',actor:'QA'});rows=api.attachDocumentArtifact(rows,rows[0].id,{name:'test.txt',size:4,sha256:'a'.repeat(64)},'QA');
 const request=await api.createDocumentHandoff(rows,rows[0].id,'Synthetic request','SYNTHETIC','QA');let listener;
 const store={state:{route:'outputs',documentWorkflow:request.rows},subscribe(fn){listener=fn;return()=>{};},emit(){listener();}};
 const output='<script>bad()</script> synthetic result',hash=await api.sha256Bytes(new TextEncoder().encode(output)),job=request.job;
 const bundle={schema_version:'lk-bso-result/1.0',output,bso_receipt:{...job.bso_context,schema_version:'lk-bso-receipt/1.0',job_id:job.job_id,input_sha256:job.input_sha256,output_sha256:hash,execution_id:'NO_MODEL_FIXTURE',status:'NEEDS_GPT_REVIEW',human_approved:false},verification:{output_sha256_checked:true,provider_guard_passed:true,human_approved:false,legal_accuracy_approved:false}};
 const response=value=>({ok:true,json:async()=>value}),ready=()=>response({ok:true,status:'RESULT_READY',result:bundle});
 let requests=[];global.fetch=async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});return ready();};
 const installed=ui.installDocumentWorkflowUi(store,options);
 t.after(()=>{installed.destroy();for(const k of keys)global[k]=original[k];dom.window.close();});
 return {api,store,installed,requests,ready,response,bundle,dom};
}
test('automatic receive reads only results, imports once and never approves or stores output in case metadata',async t=>{
 const x=await setup(t);await x.installed.checkResults();await x.installed.checkResults();
 assert.equal(x.requests.length,1);assert(x.requests[0].url.endsWith('/result'));assert.equal(x.requests[0].body.prompt,undefined);
 const row=x.store.state.documentWorkflow[0];assert.equal(row.execution_receipts.length,1);assert.equal(row.status,'DRAFT');assert.deepEqual(row.checks,{});assert.equal(row.execution_receipts[0].human_approved,false);assert.equal(JSON.stringify(row).includes(x.bundle.output),false);
 assert.equal(document.querySelector('[data-doc-result-preview] script'),null);assert.match(document.querySelector('[data-doc-message]').textContent,/자동 수신/);assert(document.querySelector('[data-doc-id] details').open);
});
test('late responses cannot attach after case change, revision change or destroy',async t=>{
 const x=await setup(t);let release;global.fetch=()=>new Promise(r=>{release=r;});
 const original=x.store.state,p=x.installed.checkResults();x.store.state={route:'outputs',documentWorkflow:[]};x.store.emit();release(x.ready());await p;assert.equal(original.documentWorkflow[0].execution_receipts,undefined);assert.deepEqual(x.store.state.documentWorkflow,[]);
 x.store.state=original;x.store.emit();const q=x.installed.checkResults();x.store.state.documentWorkflow=x.api.changeDocument(original.documentWorkflow,'WORK_DOC_1','REVISE',{actor:'QA',reference:'changed'});x.store.emit();release(x.ready());await q;assert.equal(x.store.state.documentWorkflow[0].execution_receipts,undefined);
 x.store.state={route:'outputs',documentWorkflow:[]};
 const second=await x.api.createDocumentHandoff(x.api.attachDocumentArtifact(x.api.registerDocument([],{title:'D',purpose:'test',owner:'QA',template_ref:'v1',source_ref:'synthetic',actor:'QA'}),'WORK_DOC_1',{name:'f',size:1,sha256:'a'.repeat(64)},'QA'),'WORK_DOC_1','Synthetic second','SYNTHETIC','QA');x.store.state.documentWorkflow=second.rows;x.store.emit();
 const r=x.installed.checkResults();x.installed.destroy();release(x.ready());await r;assert.equal(x.store.state.documentWorkflow[0].execution_receipts,undefined);assert.equal(document.querySelector('[data-document-workflow]'),null);
});
test('editing, hidden tabs, paused polling and other routes make no network calls',async t=>{
 const x=await setup(t);const input=document.querySelector('[data-doc-register] [name="title"]');input.value='unfinished';input.dispatchEvent(new x.dom.window.Event('input',{bubbles:true}));await x.installed.checkResults();assert.equal(x.requests.length,0);assert.equal(input.value,'unfinished');
 input.value='';input.dispatchEvent(new x.dom.window.Event('input',{bubbles:true}));document.querySelector('[data-doc-auto-toggle]').click();await x.installed.checkResults();assert.equal(x.requests.length,0);document.querySelector('[data-doc-auto-toggle]').click();
 Object.defineProperty(document,'hidden',{configurable:true,value:true});await x.installed.checkResults();assert.equal(x.requests.length,0);Object.defineProperty(document,'hidden',{configurable:true,value:false});
 x.store.state.route='home';x.store.emit();await x.installed.checkResults();assert.equal(x.requests.length,0);x.store.state.route='outputs';x.store.emit();await x.installed.checkResults();assert.equal(x.requests.length,1);
});
test('network failure backs off, then recovers without starting an AI job; waiting gets a delay label',async t=>{
 let clock=1000;const x=await setup(t,{now:()=>clock});let calls=0;global.fetch=async()=>{calls++;throw Error('offline');};
 await x.installed.checkResults();assert.equal(calls,1);assert.match(document.querySelector('[data-doc-delivery]').textContent,/확인 실패/);clock+=15000;await x.installed.checkResults();assert.equal(calls,1);
 clock+=15000;global.fetch=async()=>{calls++;return x.response({ok:true,status:'WAITING'});};await x.installed.checkResults();assert.equal(calls,2);clock+=300000;await x.installed.checkResults();assert.match(document.querySelector('[data-doc-delivery]').textContent,/5분 이상/);
 clock+=15000;global.fetch=async()=>x.ready();await x.installed.checkResults();assert.equal(x.store.state.documentWorkflow[0].execution_receipts.length,1);
});
test('tampered results are rejected and requests cannot overlap',async t=>{
 const x=await setup(t);let release,calls=0;global.fetch=()=>{calls++;return new Promise(r=>{release=r;});};const p=x.installed.checkResults();await x.installed.checkResults();assert.equal(calls,1);
 release(x.response({ok:true,status:'RESULT_READY',result:{...x.bundle,output:'tampered'}}));await p;assert.equal(x.store.state.documentWorkflow[0].execution_receipts,undefined);assert.match(document.querySelector('[data-doc-delivery]').textContent,/확인 실패/);
});
