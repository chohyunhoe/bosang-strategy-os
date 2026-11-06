'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{pathToFileURL}=require('node:url'),path=require('node:path');
test('UI retries the same job after ambiguous delivery, imports bound results, and preserves draft',async()=>{
 const dom=new JSDOM('<main></main>',{url:'http://127.0.0.1:4174'}),keys=['document','FormData','fetch'];const old=Object.fromEntries(keys.map(k=>[k,global[k]]));
 try{
 global.document=dom.window.document;global.FormData=dom.window.FormData;
 const api=await import(pathToFileURL(path.resolve(__dirname,'../browser/product-v2/document-workflow.js'))),ui=await import(pathToFileURL(path.resolve(__dirname,'../browser/product-v2/document-workflow-ui.js')));
 let rows=api.registerDocument([],{title:'Synthetic',purpose:'test',owner:'QA',template_ref:'v1',source_ref:'synthetic',actor:'QA'});rows=api.attachDocumentArtifact(rows,rows[0].id,{name:'test.txt',size:4,sha256:'a'.repeat(64)},'QA');
 let listener;const store={state:{route:'outputs',documentWorkflow:rows},subscribe(fn){listener=fn;return()=>{};},emit(){listener();}};
 const requests=[];let fail=true;
 global.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push({url,body});if(fail){fail=false;throw Error('ambiguous');}return {ok:true,json:async()=>({ok:true,status:'SYNC_FILE_PRESENT',duplicate:true})};};
 const installed=ui.installDocumentWorkflowUi(store);
 async function submit(selector,values,button){const form=document.querySelector(selector);for(const [name,value]of Object.entries(values))form.elements.namedItem(name).value=value;form.dispatchEvent(new dom.window.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector(button||'button')}));for(let n=0;n<20;n++)await new Promise(r=>setTimeout(r,5));}
 await submit('[data-doc-handoff]',{actor:'QA',prompt:'synthetic request',data_class:'SYNTHETIC'},'[value="send"]');
 assert.match(document.querySelector('[data-doc-message]').textContent,/같은 지시문/);
 await submit('[data-doc-handoff]',{actor:'QA',prompt:'synthetic request',data_class:'SYNTHETIC'},'[value="send"]');
 assert.equal(requests.length,2);assert.equal(requests[0].body.job_id,requests[1].body.job_id);assert.equal(store.state.documentWorkflow[0].handoffs.length,1);
 const job=requests[1].body,output='<script>bad()</script> synthetic result',hash=await api.sha256Bytes(new TextEncoder().encode(output));
 global.fetch=async()=>({ok:true,json:async()=>({ok:true,status:'RESULT_READY',result:{schema_version:'lk-bso-result/1.0',output,bso_receipt:{...job.bso_context,schema_version:'lk-bso-receipt/1.0',job_id:job.job_id,input_sha256:job.input_sha256,output_sha256:hash,execution_id:'NO_MODEL_FIXTURE',status:'NEEDS_GPT_REVIEW',human_approved:false},verification:{output_sha256_checked:true,provider_guard_passed:true,human_approved:false,legal_accuracy_approved:false}}})});
 await submit('[data-doc-sync-result]',{actor:'QA'});assert.equal(store.state.documentWorkflow[0].execution_receipts.length,1);assert.equal(store.state.documentWorkflow[0].status,'DRAFT');assert.equal(document.querySelector('[data-doc-result-preview] script'),null);assert.match(document.querySelector('[data-doc-result-preview]').textContent,/synthetic result/);
 installed.destroy();
 }finally{for(const k of keys)global[k]=old[k];dom.window.close();}
});
