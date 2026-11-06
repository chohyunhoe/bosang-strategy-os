'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {buildBsoResultPackage}=require('../integrations/n8n/lk-bso-result.cjs');
function prepareResult(row,sha){
 if(!String(row.job_id||'').startsWith('BSO_'))return {publish:false,delivery_status:'NOT_BSO'};
 if(!['PUBLIC','SYNTHETIC'].includes(row.data_class))return {publish:false,delivery_status:'PRIVATE_BLOCKED'};
 try {const bundle=buildBsoResultPackage(row,sha);return {publish:true,delivery_status:'PREPARED',file_name:'RESULT_'+row.job_id+'.json',bundle};}
 catch(_){return {publish:false,delivery_status:'RESULT_VALIDATION_BLOCKED'};}
}
function patchDispatcher(original,folderId){
 if(!/^[A-Za-z0-9_-]+$/.test(folderId||''))throw Error('INVALID_FOLDER_ID');
 const w=structuredClone(original),byName=new Map(w.nodes.map(n=>[n.name,n]));
 if(byName.has('Prepare BSO Result Delivery'))throw Error('TRANSPORT_ALREADY_INSTALLED');
 for(const name of ['Restore LK Queue Result','Append LK Queue Result Event','LK Dispatcher Release Context','Find Inbox Files'])if(!byName.has(name))throw Error('MISSING_'+name);
 const old=w.connections['Append LK Queue Result Event'];
 if(JSON.stringify(old)!==JSON.stringify({main:[[{node:'LK Dispatcher Release Context',type:'main',index:0}]]}))throw Error('UNEXPECTED_RESULT_ROUTE');
 const credential=byName.get('Find Inbox Files').credentials;
 if(!credential?.googleDriveOAuth2Api)throw Error('DRIVE_CREDENTIAL_REQUIRED');
 const add=(name,type,parameters,x,y,extra={})=>w.nodes.push({name,id:crypto.randomUUID(),type,typeVersion:type.endsWith('.code')?2:type.endsWith('.if')?2.2:3,position:[x,y],parameters,...extra});
 const iff=expression=>({conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:crypto.randomUUID(),leftValue:'={{ '+expression+' }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
 const edge=name=>({node:name,type:'main',index:0});
 add('Prepare BSO Result Delivery','n8n-nodes-base.code',{jsCode:buildBsoResultPackage.toString()+'\n'+prepareResult.toString()+`\nconst row=$('Restore LK Queue Result').first(0).json;\nconst p=prepareResult(row,x=>require('crypto').createHash('sha256').update(x).digest('hex'));\nreturn [{json:{result:row,...p}}];`},5100,900);
 add('BSO Result Deliverable?','n8n-nodes-base.if',iff('$json.publish === true'),5340,900);
 add('Find Existing BSO Result','n8n-nodes-base.googleDrive',{resource:'fileFolder',searchMethod:'query',queryString:`={{ "'${folderId}' in parents and trashed = false and name = '" + $json.file_name + "'" }}`,returnAll:false,limit:2,filter:{driveId:{__rl:true,mode:'list',value:'My Drive'},whatToSearch:'files',includeTrashed:false},options:{fields:['id','name']}},5580,820,{credentials:credential,alwaysOutputData:true,onError:'continueRegularOutput'});
 add('Plan BSO Result Upload','n8n-nodes-base.code',{jsCode:`const p=$('Prepare BSO Result Delivery').first(0).json;const found=$input.all().map(i=>i.json);\nconst failed=found.some(r=>r.error);const exists=found.some(r=>r.id);\nconst upload=!failed&&!exists;\nreturn [{json:{...p,upload,delivery_status:failed?'DRIVE_LOOKUP_FAILED':exists?'RESULT_ALREADY_EXISTS_UNVERIFIED':'READY_TO_UPLOAD'},...(upload?{binary:{bso_result:{data:Buffer.from(JSON.stringify(p.bundle,null,2)).toString('base64'),mimeType:'application/json',fileName:p.file_name}}}:{})}];`},5820,820);
 add('BSO Result Upload Needed?','n8n-nodes-base.if',iff('$json.upload === true'),6060,820);
 add('Upload BSO Result','n8n-nodes-base.googleDrive',{inputDataFieldName:'bso_result',name:'={{ $json.file_name }}',driveId:{__rl:true,mode:'list',value:'My Drive'},folderId:{__rl:true,mode:'id',value:folderId},options:{simplifyOutput:false}},6300,740,{credentials:credential,onError:'continueRegularOutput',retryOnFail:false});
 add('Restore BSO Delivery Result','n8n-nodes-base.code',{jsCode:`const p=$('Prepare BSO Result Delivery').first(0).json;const v=$input.first().json;\nconst status=v.error?'RESULT_UPLOAD_FAILED':v.id?'RESULT_UPLOADED':v.delivery_status||'RESULT_DELIVERY_UNKNOWN';\nreturn [{json:{...p.result,bso_delivery_status:status}}];`},6540,900);
 w.connections['Append LK Queue Result Event']={main:[[edge('Prepare BSO Result Delivery')]]};
 w.connections['Prepare BSO Result Delivery']={main:[[edge('BSO Result Deliverable?')]]};
 w.connections['BSO Result Deliverable?']={main:[[edge('Find Existing BSO Result')],[edge('Restore BSO Delivery Result')]]};
 w.connections['Find Existing BSO Result']={main:[[edge('Plan BSO Result Upload')]]};
 w.connections['Plan BSO Result Upload']={main:[[edge('BSO Result Upload Needed?')]]};
 w.connections['BSO Result Upload Needed?']={main:[[edge('Upload BSO Result')],[edge('Restore BSO Delivery Result')]]};
 w.connections['Upload BSO Result']={main:[[edge('Restore BSO Delivery Result')]]};
 w.connections['Restore BSO Delivery Result']={main:[[edge('LK Dispatcher Release Context')]]};
 // Runtime execution data must never be pinned into a deployed workflow.
 w.pinData={};return w;
}
if(require.main===module){const [input,output,folder]=process.argv.slice(2);fs.writeFileSync(output,JSON.stringify(patchDispatcher(JSON.parse(fs.readFileSync(input)),folder),null,2),{flag:'wx',mode:0o600});}
module.exports={prepareResult,patchDispatcher};
