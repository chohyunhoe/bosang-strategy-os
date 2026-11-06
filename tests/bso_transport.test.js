'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path'), http=require('node:http'), crypto=require('node:crypto');
const {sendJob,readResult,handleBsoTransportRequest}=require('../scripts/bso_transport_bridge');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bso-sync-')),dir=path.join(root,'drive');fs.mkdirSync(dir);
 fs.writeFileSync(path.join(root,'.bso-transport.json'),JSON.stringify({enabled:true,sync_folder:dir}));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const job={schema_version:'lk-bso-job/1.0',job_id:'BSO_SYNTHETIC_TRANSPORT',status:'READY',attempts:0,data_class:'SYNTHETIC',prompt:'synthetic only',input_sha256:sha('synthetic only'),bso_context:{schema_version:'lk-bso-job/1.0',document_id:'WORK_DOC_1',revision:1,artifact_sha256:sha('file')}};
 const request={job_id:job.job_id,input_sha256:job.input_sha256,...job.bso_context};
 const result={schema_version:'lk-bso-result/1.0',bso_receipt:{...request,schema_version:'lk-bso-receipt/1.0',output_sha256:sha('synthetic output'),status:'NEEDS_GPT_REVIEW',human_approved:false,execution_id:'FIXTURE_NO_MODEL'},output:'synthetic output',verification:{output_sha256_checked:true,provider_guard_passed:true,human_approved:false,legal_accuracy_approved:false}};
 return {root,dir,job,request,result};
}
test('send is idempotent, does not overwrite collisions, and excludes private or invalid inputs',t=>{
 const {root,dir,job}=fixture(t);assert.equal(sendJob(job,root).status,'SYNC_FILE_WRITTEN');assert.equal(sendJob(job,root).duplicate,true);
 assert.equal(sendJob(Object.fromEntries(Object.entries(job).reverse()),root).duplicate,true);
 const original=fs.readFileSync(path.join(dir,job.job_id+'.json'),'utf8');
 for(const patch of [{data_class:'PRIVATE'},{job_id:'../../bad'},{input_sha256:sha('bad')},{prompt:'other',input_sha256:sha('other')},{extra:'not allowed'}])assert.throws(()=>sendJob({...job,...patch},root));
 assert.equal(fs.readFileSync(path.join(dir,job.job_id+'.json'),'utf8'),original);assert.equal(fs.readdirSync(dir).length,1);
});
test('receive binds job, revision and hashes; output is not human approval',t=>{
 const {root,dir,job,request,result}=fixture(t),file=path.join(dir,'RESULT_'+job.job_id+'.json');
 assert.equal(readResult(request,root).status,'WAITING');fs.writeFileSync(file,JSON.stringify({...result,secret:'never return'}));
 const value=readResult(request,root);assert.equal(value.status,'RESULT_READY');assert.equal(value.result.verification.human_approved,false);assert.equal(value.result.secret,undefined);
 for(const patch of [{revision:2},{job_id:'BSO_../bad'},{input_sha256:sha('different')}])assert.throws(()=>readResult({...request,...patch},root));
 fs.writeFileSync(file,JSON.stringify({...result,output:'tampered'}));assert.throws(()=>readResult(request,root),/INTEGRITY/);
 fs.writeFileSync(file,JSON.stringify({...result,bso_receipt:{...result.bso_receipt,human_approved:true}}));assert.throws(()=>readResult(request,root),/CONTEXT/);
});
test('HTTP requires loopback origin/header, bounds bodies, and hides paths',async t=>{
 const {root,job}=fixture(t),server=http.createServer((req,res)=>handleBsoTransportRequest(req,res,new URL(req.url,'http://localhost').pathname,root));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port,headers={'Content-Type':'application/json','X-BSO-Transport':'1'};
 assert.equal((await fetch(base+'/__bso_transport/status')).status,403);
 assert.equal((await fetch(base+'/__bso_transport/send',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(job)})).status,403);
 assert.equal((await fetch(base+'/__bso_transport/send',{method:'POST',headers,body:'x'.repeat(100001)})).status,413);
 const state=await (await fetch(base+'/__bso_transport/status',{headers})).json();assert.equal(state.model_execution_automatic,false);assert.equal(JSON.stringify(state).includes(root),false);
 assert.equal((await (await fetch(base+'/__bso_transport/send',{method:'POST',headers,body:JSON.stringify(job)})).json()).ok,true);
});
