'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {spawn}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const server=path.join(root,'mcp','bso-local-bridge','server.mjs');
const child=spawn(process.execPath,[server],{cwd:root,env:{...process.env,BSO_REPO_ROOT:root},stdio:['pipe','pipe','pipe']});
const pending=new Map();let buffer='';let nextId=1;
child.stdout.on('data',(chunk)=>{buffer+=chunk.toString('utf8');let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);}});
function request(method,params={}){const id=nextId++;child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`timeout: ${method}`)),5000);pending.set(id,(message)=>{clearTimeout(timer);resolve(message);});});}

(async()=>{
  try{
    const initialized=await request('initialize',{protocolVersion:'2025-11-25'});assert.equal(initialized.result.serverInfo.name,'BSO Local Bridge');
    const listed=await request('tools/list');assert.deepEqual(listed.result.tools.map((tool)=>tool.name),['bso_local_bridge_status','bso_vworld_connection_probe','bso_list_graphics_outputs','bso_run_graphics_gate']);
    const status=await request('tools/call',{name:'bso_local_bridge_status',arguments:{}});const serialized=JSON.stringify(status);assert.doesNotMatch(serialized,/VWORLD_API_KEY\s*=/);assert.doesNotMatch(serialized,/C:\\\\Users\\\\RMARKET/i);assert.equal(status.result.structuredContent.secrets_exposed,false);
    if(String(process.env.CODEX_SANDBOX_NETWORK_DISABLED||'').toLowerCase()==='true')assert.equal(status.result.structuredContent.transport_status,'CODEX_NETWORK_ESCALATION_REQUIRED');
    const invalid=await request('tools/call',{name:'bso_list_graphics_outputs',arguments:{manifestPath:'../.env'}});assert.equal(invalid.error.code,-32602);
    const source=require('node:fs').readFileSync(server,'utf8');assert.doesNotMatch(source,/console\.log/);assert.match(source,/secrets_exposed:false/);assert.match(source,/graphics-input/);assert.match(source,/FIXED_NON_CASE_COORDINATE/);
    assert.match(source,/CODEX_NETWORK_ESCALATION_REQUIRED/);
    const probe=require('node:fs').readFileSync(path.join(root,'scripts','probe_vworld_local.ps1'),'utf8');assert.match(probe,/FIXED_NON_CASE_COORDINATE/);assert.match(probe,/secrets_exposed/);assert.doesNotMatch(probe,/Write-Host\s+\$key|Write-Output\s+\$uri/);
    const gate=require('node:fs').readFileSync(path.join(root,'bso','RUN_GRAPHICS_GATE.cmd'),'utf8');assert.match(gate,/\.\.\\\.env/);assert.match(gate,/ENV_FILE/);
    console.log('bso_local_mcp_bridge.test.js passed');
  } finally {child.kill();}
})().catch((failure)=>{child.kill();console.error(failure);process.exitCode=1;});
