import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const SERVER_NAME='BSO Local Bridge';
const VERSION='0.1.0';
const repoRoot=path.resolve(process.env.BSO_REPO_ROOT||process.cwd());
const bsoRoot=path.join(repoRoot,'bso');
const inputRoot=path.join(bsoRoot,'graphics-input');
const outputRoot=path.join(bsoRoot,'graphics-output');
const envCandidates=[path.join(bsoRoot,'.env'),path.join(repoRoot,'.env')];
const MAX_OUTPUT_CHARS=2400;
let running=false;

function send(message){process.stdout.write(`${JSON.stringify(message)}\n`);}
function result(id,payload){send({jsonrpc:'2.0',id,result:payload});}
function error(id,code,message){send({jsonrpc:'2.0',id,error:{code,message}});}
function toolResult(id,text,structuredContent,isError=false){result(id,{content:[{type:'text',text}],structuredContent,isError});}
function clean(value){return String(value==null?'':value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();}

function readLocalEnv(){
  const values={};
  const envPath=envCandidates.find((candidate)=>fs.existsSync(candidate));
  if(!envPath)return values;
  for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){
    const trimmed=line.trim();if(!trimmed||trimmed.startsWith('#'))continue;
    const index=trimmed.indexOf('=');if(index<1)continue;
    const key=trimmed.slice(0,index).trim();let value=trimmed.slice(index+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    values[key]=value.trim();
  }
  return values;
}

function inside(root,target){const relative=path.relative(root,target);return relative!==''&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);}
function resolveManifest(value){
  const input=clean(value).replace(/\\/g,'/');
  if(!input||input.includes('..')||!/^[0-9A-Za-z가-힣_./-]+\.json$/u.test(input))throw new Error('manifestPath must be a JSON file under bso/graphics-input.');
  const withoutPrefix=input.replace(/^bso\/graphics-input\//,'').replace(/^graphics-input\//,'');
  const target=path.resolve(inputRoot,withoutPrefix);
  if(!inside(inputRoot,target)||!fs.existsSync(target)||!fs.statSync(target).isFile())throw new Error('Manifest not found under bso/graphics-input.');
  return target;
}
function relativeBso(target){return path.relative(bsoRoot,target).replace(/\\/g,'/');}
function manifestData(target){
  const raw=fs.readFileSync(target,'utf8');
  if(/(?:vworld[_-]?api[_-]?key|[?&](?:key|token|secret|credential)=)/i.test(raw))throw new Error('Manifest must not contain API keys or credential query parameters.');
  const data=JSON.parse(raw);const caseId=clean(data.case_id);
  if(!/^[0-9A-Za-z가-힣_.-]{1,96}$/u.test(caseId))throw new Error('Manifest case_id is missing or unsafe.');
  return {data,caseId};
}
function configuredStatus(){
  const env=readLocalEnv();
  const qgisRoot=clean(env.QGIS_ROOT||'C:\\Program Files\\QGIS 4.2.0');
  const sandboxNetworkDisabled=clean(process.env.CODEX_SANDBOX_NETWORK_DISABLED).toLowerCase()==='true';
  const checks={env_file:envCandidates.some((candidate)=>fs.existsSync(candidate)),vworld_key:Boolean(clean(env.VWORLD_API_KEY)),qgis_root:Boolean(qgisRoot&&fs.existsSync(qgisRoot)),graphics_gate:fs.existsSync(path.join(bsoRoot,'RUN_GRAPHICS_GATE.cmd')),codex_network_enabled:!sandboxNetworkDisabled};
  const blockers=[];if(!checks.env_file)blockers.push('ENV_FILE_MISSING');if(!checks.vworld_key)blockers.push('VWORLD_API_KEY_MISSING');if(!checks.qgis_root)blockers.push('QGIS_ROOT_MISSING');if(!checks.graphics_gate)blockers.push('GRAPHICS_GATE_MISSING');
  return {available:blockers.length===0,status:blockers.length?'LOCAL_GATE_BLOCKED':'LOCAL_GATE_READY',checks,blockers,secrets_exposed:false,network_scope:sandboxNetworkDisabled?'APPROVED_HOST_EXECUTION_REQUIRED':'LOCAL_PROCESS_TO_VWORLD',transport_status:sandboxNetworkDisabled?'CODEX_NETWORK_ESCALATION_REQUIRED':'DIRECT_LOCAL_NETWORK'};
}
function scrub(value){
  let output=String(value||'');const env=readLocalEnv();
  for(const secret of [env.VWORLD_API_KEY,env.PUBLIC_DATA_API_KEY,repoRoot,env.QGIS_ROOT,env.BSO_GRAPHICS_CADASTRAL_ARCHIVE])if(secret)output=output.split(String(secret)).join('[REDACTED]');
  return output.replace(/[?&](?:key|apiKey|token|secret|credential)=[^&\s]+/gi,'&credential=[REDACTED]').slice(-MAX_OUTPUT_CHARS);
}
function safeResultSummary(caseId){
  const caseRoot=path.join(outputRoot,caseId);const resultPath=path.join(caseRoot,'graphics_manifest_result.json');const verificationPath=path.join(caseRoot,'parcel_verification_result.json');
  const summary={case_id:caseId,result_file:fs.existsSync(resultPath)?relativeBso(resultPath):null,verification_file:fs.existsSync(verificationPath)?relativeBso(verificationPath):null,verification_status:null,status:null,background_source:null,outputs:[],issues:[],secrets_exposed:false};
  if(fs.existsSync(verificationPath)){try{summary.verification_status=clean(JSON.parse(fs.readFileSync(verificationPath,'utf8')).status)||null;}catch{summary.verification_status='INVALID_JSON';}}
  if(fs.existsSync(resultPath)){
    try{const data=JSON.parse(fs.readFileSync(resultPath,'utf8'));summary.status=clean(data.status)||null;summary.background_source=clean(data.background_source)||null;summary.outputs=(Array.isArray(data.outputs)?data.outputs:[]).filter((file)=>typeof file==='string').map((file)=>path.isAbsolute(file)?path.resolve(file):path.resolve(caseRoot,file)).filter((file)=>inside(caseRoot,file)).map((file)=>relativeBso(file));summary.issues=(Array.isArray(data.issues)?data.issues:[]).slice(0,20).map((item)=>({code:clean(item?.code).slice(0,80),message:scrub(item?.message).slice(0,300)}));}catch{summary.status='INVALID_RESULT_JSON';}
  }
  return summary;
}
function runGate(manifest){
  return new Promise((resolve)=>{
    const relative=relativeBso(manifest).replace(/\//g,'\\');const command=`call RUN_GRAPHICS_GATE.cmd "${relative}"`;
    const child=spawn('cmd.exe',['/d','/s','/c',command],{cwd:bsoRoot,windowsHide:true,env:{...process.env}});let stdout='';let stderr='';
    const timer=setTimeout(()=>{child.kill();resolve({exitCode:124,stdout,stderr:'LOCAL_GATE_TIMEOUT'});},900000);
    child.stdout.on('data',(chunk)=>{stdout=(stdout+chunk.toString('utf8')).slice(-MAX_OUTPUT_CHARS);});child.stderr.on('data',(chunk)=>{stderr=(stderr+chunk.toString('utf8')).slice(-MAX_OUTPUT_CHARS);});
    child.on('error',(failure)=>{clearTimeout(timer);resolve({exitCode:127,stdout,stderr:failure.message});});child.on('close',(code)=>{clearTimeout(timer);resolve({exitCode:Number.isInteger(code)?code:1,stdout,stderr});});
  });
}
async function probeVworld(){
  const env=readLocalEnv();const key=clean(env.VWORLD_API_KEY);if(!key)return{ok:false,error_code:'VWORLD_API_KEY_MISSING',secrets_exposed:false};
  if(clean(process.env.CODEX_SANDBOX_NETWORK_DISABLED).toLowerCase()==='true')return{ok:false,error_code:'CODEX_NETWORK_ESCALATION_REQUIRED',next_action:'Run scripts/probe_vworld_local.ps1 through approved host execution.',secrets_exposed:false,request_profile:'FIXED_NON_CASE_COORDINATE'};
  const url=new URL('https://api.vworld.kr/req/image');url.search=new URLSearchParams({service:'image',version:'2.0',request:'getmap',format:'png',basemap:'PHOTO',crs:'EPSG:4326',zoom:'8',size:'256,256',center:'127.0000,36.5000',key,domain:clean(env.VWORLD_API_DOMAIN)||'localhost'}).toString();
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(url,{redirect:'error',headers:{Accept:'image/png'},signal:controller.signal});const contentType=clean(response.headers.get('content-type')).toLowerCase();const bytes=Buffer.from(await response.arrayBuffer());const ok=response.ok&&contentType.startsWith('image/png')&&bytes.length>0;
    return{ok,status:response.status,content_type:contentType.slice(0,80),byte_count:bytes.length,error_code:ok?null:'VWORLD_PROBE_REJECTED',secrets_exposed:false,request_profile:'FIXED_NON_CASE_COORDINATE'};
  }catch(failure){return{ok:false,status:null,content_type:null,byte_count:0,error_code:failure?.name==='AbortError'?'VWORLD_PROBE_TIMEOUT':'VWORLD_PROBE_NETWORK_FAILED',diagnostic:scrub(failure?.message||failure),secrets_exposed:false,request_profile:'FIXED_NON_CASE_COORDINATE'};}finally{clearTimeout(timer);}
}

const tools=[
  {name:'bso_local_bridge_status',title:'Check BSO Local Bridge',description:'Check whether this PC has the local BSO graphics prerequisites. Returns booleans and blocker codes only; never returns API keys or absolute paths.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:'bso_vworld_connection_probe',title:'Probe VWorld from This PC',description:'Send one fixed, non-case 256px satellite image request from the local PC to VWorld and return only status, content type, and byte count. The local key and request URL are never returned.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
  {name:'bso_list_graphics_outputs',title:'List BSO Graphics Outputs',description:'Read the existing verified graphics result for one manifest under bso/graphics-input without calling external services.',inputSchema:{type:'object',properties:{manifestPath:{type:'string',description:'Relative manifest path under bso/graphics-input.'}},required:['manifestPath'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:'bso_run_graphics_gate',title:'Run BSO Graphics Gate Locally',description:'Run the PNU exact verification and QGIS/VWorld graphics gate on this PC for an existing manifest under bso/graphics-input. The VWorld key is read only by RUN_GRAPHICS_GATE.cmd from local bso/.env and is never returned.',inputSchema:{type:'object',properties:{manifestPath:{type:'string',description:'Relative manifest path under bso/graphics-input.'}},required:['manifestPath'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}},
];

async function callTool(id,params){
  const name=params?.name;const args=params?.arguments||{};
  if(name==='bso_local_bridge_status'){const status=configuredStatus();toolResult(id,status.available?'BSO local graphics gate is ready.':`BSO local graphics gate blocked: ${status.blockers.join(', ')}`,status);return;}
  if(name==='bso_vworld_connection_probe'){const probe=await probeVworld();toolResult(id,probe.ok?`VWorld local connection succeeded: HTTP ${probe.status}, ${probe.byte_count} bytes.`:`VWorld local connection failed: ${probe.error_code}.`,probe,!probe.ok);return;}
  let manifest;let caseId;
  try{manifest=resolveManifest(args.manifestPath);({caseId}=manifestData(manifest));}catch(failure){error(id,-32602,failure.message);return;}
  if(name==='bso_list_graphics_outputs'){const summary=safeResultSummary(caseId);toolResult(id,summary.result_file?`Existing BSO result: ${summary.status||'UNKNOWN'}`:'No existing graphics result for this manifest.',summary);return;}
  if(name==='bso_run_graphics_gate'){
    if(running){toolResult(id,'Another BSO graphics gate is already running.',{ok:false,error_code:'LOCAL_GATE_BUSY',secrets_exposed:false},true);return;}
    const status=configuredStatus();if(!status.available){toolResult(id,`BSO local graphics gate blocked: ${status.blockers.join(', ')}`,{ok:false,error_code:'LOCAL_GATE_BLOCKED',...status},true);return;}
    running=true;try{const run=await runGate(manifest);const summary=safeResultSummary(caseId);const ok=run.exitCode===0&&['COMPLETED','PARTIAL_REVIEW_REQUIRED'].includes(summary.status);const payload={ok,exit_code:run.exitCode,...summary,diagnostic:ok?'':scrub(run.stderr||run.stdout),review_required:true,auto_confirmed:false,secrets_exposed:false};toolResult(id,ok?`Local BSO graphics gate completed: ${summary.status}`:`Local BSO graphics gate stopped: ${summary.status||`EXIT_${run.exitCode}`}`,payload,!ok);}finally{running=false;}return;
  }
  error(id,-32602,`Unknown tool: ${name||''}`);
}

async function handle(message){const {id,method,params}=message;
  if(method==='initialize'){result(id,{protocolVersion:params?.protocolVersion||'2025-11-25',capabilities:{tools:{}},serverInfo:{name:SERVER_NAME,version:VERSION},instructions:'Use this bridge only for local BSO graphics work. Never request or expose VWorld keys. Run only manifests already under bso/graphics-input. Treat all outputs as review required until PNU verification and visual review pass.'});return;}
  if(method==='ping'){result(id,{});return;}
  if(method==='tools/list'){result(id,{tools});return;}
  if(method==='tools/call'){try{await callTool(id,params);}catch(failure){error(id,-32603,scrub(failure?.message||failure));}return;}
  if(id!==undefined)error(id,-32601,`Method not found: ${method}`);
}
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});lines.on('line',(line)=>{if(!line.trim())return;try{void handle(JSON.parse(line));}catch{}});
