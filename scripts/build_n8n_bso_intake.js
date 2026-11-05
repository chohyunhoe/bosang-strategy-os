'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { validateBsoIntake, planBsoIntake, restoreBsoQueueContext } = require('../integrations/n8n/lk-bso-intake.cjs');
const EXTRA_COLUMNS = ['bso_context_json', 'bso_receipt_json', 'intake_source_file_id', 'intake_execution_id'];

function patchDispatcher(source) {
  const w = structuredClone(source);
  const node = name => { const hits = w.nodes.filter(n => n.name === name); if (hits.length !== 1) throw Error('EXPECTED_NODE: ' + name); return hits[0]; };
  const select = node('Select LK Queue Job');
  const marker = "const j=rows.find(r=>['PENDING','RETRY'].includes(r.status));";
  if (!select.parameters.jsCode.includes(marker)) throw Error('SELECT_SHAPE_CHANGED');
  select.parameters.jsCode = restoreBsoQueueContext.toString() + '\n' + select.parameters.jsCode.replace(marker,
    "let j=rows.find(r=>['PENDING','RETRY'].includes(r.status));if(j){try{j=restoreBsoQueueContext(j,sha)}catch(e){return [{json:{...j,queue_mode:true,queue_ready:false,status:'BLOCKED',error_code:e.message,review_status:'PENDING',dispatcher_execution_id:String($execution.id),finished_at:new Date().toISOString(),recorded_at:new Date().toISOString(),event_id:String($execution.id)+':INVALID_CONTEXT'}}]}};");
  for (const name of ['Persist LK Queue Claim', 'Persist LK Queue Result']) {
    const columns = node(name).parameters.columns;
    for (const field of EXTRA_COLUMNS) {
      columns.value[field] = field === 'bso_receipt_json' && name === 'Persist LK Queue Result'
        ? '={{ $json.bso_receipt ? JSON.stringify($json.bso_receipt) : ($json.bso_receipt_json ?? "") }}'
        : '={{ $json.' + field + ' ?? "" }}';
      columns.schema.push({ id: field, displayName: field, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
    }
  }
  return w;
}

function buildIntake(source, folderId) {
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) throw Error('FOLDER_ID_REQUIRED');
  const nodes = [], connections = {};
  const from = name => { const n = source.nodes.find(n => n.name === name); if (!n) throw Error('EXPECTED_NODE: ' + name); return structuredClone(n); };
  function add(name, type, parameters, extra = {}) {
    const n = { id: randomUUID(), name, type: 'n8n-nodes-base.' + type, typeVersion: type === 'code' ? 2 : 1, position: [nodes.length * 220, 240], parameters, ...extra };
    nodes.push(n); return n;
  }
  function copy(original, name) { const n = from(original); n.id = randomUUID(); n.name = name; n.position = [nodes.length * 220, 240]; nodes.push(n); return n; }
  const code = (name, jsCode) => add(name, 'code', { jsCode });
  function link(a, b, port = 0) { connections[a] ??= { main: [] }; connections[a].main[port] ??= []; connections[a].main[port].push({ node: b, type: 'main', index: 0 }); }
  function gate(name, expression) { const n = copy('LK Queue Has Job?', name); n.parameters.conditions.conditions[0].leftValue = expression; return n; }
  add('Manual Intake Check', 'manualTrigger', {});
  const trigger = copy('New Private Inbox File', 'New BSO JSON File'); trigger.parameters.folderToWatch.value = folderId;
  const recovery = copy('LK Queue Hourly Recovery', 'BSO Daily Intake Recovery'); recovery.parameters.rule = { interval: [{ field: 'cronExpression', expression: '0 15 7 * * *' }] };
  const search = copy('Find Inbox Files', 'Find BSO JSON Files');
  search.parameters.queryString = "'" + folderId + "' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'";
  code('Select BSO JSON Files', "const rows=$input.all().map(x=>x.json).filter(f=>f.id&&/^BSO_[A-Za-z0-9_-]+\\.json$/.test(f.name||''));if(rows.length>100)throw Error('BSO_INTAKE_FOLDER_LIMIT_100');return rows.map(f=>({json:{file_id:f.id,file_name:f.name,file_size:Number(f.size||0)}}));");
  const download = add('Download BSO JSON', 'googleDrive', { operation: 'download', fileId: { __rl: true, mode: 'id', value: '={{ $json.file_id }}' }, options: { binaryPropertyName: 'data' } }, { typeVersion: 3, credentials: structuredClone(search.credentials), onError: 'continueRegularOutput' });
  code('Parse BSO JSON Batch', "const candidates=[];for(let i=0;i<$input.all().length;i++){const item=$input.all()[i];let source={};try{source=$('Select BSO JSON Files').itemMatching(i).json}catch(_){}try{if(item.json.error)throw Error('BSO_DOWNLOAD_FAILED');const bytes=await this.helpers.getBinaryDataBuffer(i,'data');if(bytes.length>100000)throw Error('BSO_JSON_TOO_LARGE');candidates.push({file_id:source.file_id,job:JSON.parse(bytes.toString('utf8'))})}catch(e){candidates.push({file_id:source.file_id,error:e.message==='BSO_JSON_TOO_LARGE'?e.message:'BSO_JSON_READ_FAILED'})}}return [{json:{candidates}}];");
  copy('Acquire LK Dispatcher Mutex', 'Acquire Intake Mutex');
  code('Check Intake Mutex', "const held=$input.all().some(x=>x.json.id===1&&x.json.lock_key==='DISPATCHER'&&x.json.state==='HELD'&&x.json.owner===String($execution.id));return [{json:{mutex_acquired:held}}];");
  gate('Intake Mutex Acquired?', '={{ $json.mutex_acquired === true }}');
  const read = copy('Read LK AI Jobs', 'Read Queue For Intake'); read.onError = 'continueRegularOutput';
  code('Plan BSO Intake', validateBsoIntake.toString() + '\n' + planBsoIntake.toString() + "\nconst sha=v=>require('crypto').createHash('sha256').update(v,'utf8').digest('hex');try{const existing=$input.all().map(x=>x.json);if(existing.some(r=>r.error))throw Error('BSO_QUEUE_READ_FAILED');const plan=planBsoIntake($('Parse BSO JSON Batch').first(0).json.candidates,existing,sha,$execution.id,new Date().toISOString());return [{json:plan}]}catch(e){return [{json:{rows:[],events:[{status:'BLOCKED',error_code:e.message}],inserted:0,skipped:0,blocked:1,external_model_calls:0}}]};");
  gate('Has New BSO Jobs?', '={{ $json.rows.length > 0 }}');
  code('Expand BSO Queue Rows', 'return $input.first().json.rows.map(row=>({json:row}));');
  const append = copy('Persist LK Queue Claim', 'Append BSO Jobs Once'); append.parameters.operation = 'append'; append.onError = 'continueRegularOutput';
  delete append.parameters.columns.matchingColumns;
  for (const field of EXTRA_COLUMNS) {
    append.parameters.columns.value[field] = '={{ $json.' + field + ' ?? "" }}';
    append.parameters.columns.schema.push({ id: field, displayName: field, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false });
  }
  code('Summarize BSO Intake', "const p=$('Plan BSO Intake').first(0).json,acks=$input.all().map(x=>x.json);const confirmed=p.rows.filter(r=>acks.some(a=>a.job_id===r.job_id&&a.input_sha256===r.input_sha256&&a.status==='PENDING_APPROVAL')).length;return [{json:{status:confirmed===p.rows.length?'STAGED':'PARTIAL_WRITE_REQUIRES_REVIEW',confirmed,skipped:p.skipped,blocked:p.blocked,events:p.events,external_model_calls:0,execution_id:String($execution.id)}}];");
  const release = copy('Release LK Dispatcher Mutex', 'Release Intake Mutex');
  code('BSO Intake Receipt', "const released=$input.all().some(x=>x.json.id===1&&x.json.state==='FREE'&&x.json.owner==='NONE');return [{json:{...$('Summarize BSO Intake').first(0).json,mutex_released:released,...(!released?{status:'BLOCKED_MUTEX_RELEASE_FAILED'}:{})}}];");
  code('Intake Busy Skipped', "return [{json:{status:'BUSY_SKIPPED',external_model_calls:0}}];");
  for (const start of ['Manual Intake Check', 'New BSO JSON File', 'BSO Daily Intake Recovery']) link(start, search.name);
  const chain = [search.name, 'Select BSO JSON Files', download.name, 'Parse BSO JSON Batch', 'Acquire Intake Mutex', 'Check Intake Mutex', 'Intake Mutex Acquired?'];
  for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1]);
  link('Intake Mutex Acquired?', read.name); link('Intake Mutex Acquired?', 'Intake Busy Skipped', 1);
  link(read.name, 'Plan BSO Intake'); link('Plan BSO Intake', 'Has New BSO Jobs?');
  link('Has New BSO Jobs?', 'Expand BSO Queue Rows'); link('Expand BSO Queue Rows', append.name); link(append.name, 'Summarize BSO Intake');
  link('Has New BSO Jobs?', 'Summarize BSO Intake', 1); link('Summarize BSO Intake', release.name); link(release.name, 'BSO Intake Receipt');
  // Compact rows keep the graph usable in the editor.
  nodes.forEach((n, i) => { n.position = [(i % 5) * 280, Math.floor(i / 5) * 260]; });
  return { name: 'LK BSO JSON Intake | Private Drive - Approval Queue', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Seoul', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false }, pinData: {} };
}

if (require.main === module) {
  const [sourcePath, folderId, outputPath, dispatcherPath] = process.argv.slice(2);
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  fs.writeFileSync(outputPath, JSON.stringify(buildIntake(source, folderId), null, 2), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(dispatcherPath, JSON.stringify(patchDispatcher(source), null, 2), { flag: 'wx', mode: 0o600 });
  console.log('PRIVATE_INTAKE_AND_DISPATCHER_PATCH_WRITTEN_NOT_DEPLOYED');
}
module.exports = { buildIntake, patchDispatcher, EXTRA_COLUMNS };
