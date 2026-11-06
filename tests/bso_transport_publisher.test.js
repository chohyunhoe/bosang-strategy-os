'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {patchDispatcher,prepareResult}=require('../scripts/build_n8n_bso_transport');
test('publisher excludes private/non-BSO, preserves existing nodes and reconnects all paths to mutex release',()=>{
 assert.equal(prepareResult({job_id:'OTHER'}).publish,false);assert.equal(prepareResult({job_id:'BSO_1',data_class:'PRIVATE'}).delivery_status,'PRIVATE_BLOCKED');
 assert.equal(prepareResult({job_id:'BSO_1',data_class:'PUBLIC'},()=> '').delivery_status,'RESULT_VALIDATION_BLOCKED');
 const names=['Restore LK Queue Result','Append LK Queue Result Event','LK Dispatcher Release Context','Find Inbox Files'];
 const w={nodes:names.map(name=>({name,credentials:{googleDriveOAuth2Api:{id:'TEST_ONLY'}}})),connections:{'Append LK Queue Result Event':{main:[[{node:'LK Dispatcher Release Context',type:'main',index:0}]]}},pinData:{bad:'no deployment pins'}};
 const result=patchDispatcher(w,'FOLDER_FIXTURE');assert.deepEqual(result.nodes.slice(0,4),w.nodes);assert.deepEqual(result.pinData,{});
 const routes=result.connections;for(const start of ['BSO Result Deliverable?','BSO Result Upload Needed?','Upload BSO Result']){
 function walk(name,seen=new Set()){if(name==='LK Dispatcher Release Context')return;assert(!seen.has(name));seen.add(name);const edges=routes[name]?.main.flat();assert(edges?.length);for(const e of edges)walk(e.node,new Set(seen));}walk(start);}
 assert.equal(result.nodes.find(n=>n.name==='Upload BSO Result').retryOnFail,false);
 assert.throws(()=>patchDispatcher(result,'FOLDER_FIXTURE'),/ALREADY/);assert.throws(()=>patchDispatcher(w,"bad'folder"),/INVALID/);
});
