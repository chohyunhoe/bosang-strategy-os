'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const release = path.join(root, 'dist', 'release-v1');
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'product-v2-manifest.json')));
assert.equal(manifest.release_target, '1.0.0-rc.3');
assert.equal(manifest.release_channel, 'windows-pc-release-candidate');
assert.equal(manifest.production_entry, false);
assert.equal(manifest.local_gate, 'REAL_CASE_SMOKE_REQUIRED');
for (const entry of manifest.files) {
  assert.equal(path.resolve(release,entry.path).startsWith(release + path.sep), true);
  const bytes = fs.readFileSync(path.join(release,entry.path));
  assert.equal(entry.bytes, bytes.length, entry.path);
  assert.equal(entry.sha256, crypto.createHash('sha256').update(bytes).digest('hex'), entry.path);
}
for (const name of ['index.html','app.js','session-diagnostics.js']) {
  const content = fs.readFileSync(path.join(release,name),'utf8');
  assert.match(content, /Release v1 · 1\.0\.0-rc\.3/);
  assert.doesNotMatch(content, /Product v2 Candidate/);
}
for (const name of ['.env','.bso-runtime.json','node_modules','local_only','case.json','graphics-input']) assert.equal(fs.existsSync(path.join(release,name)),false);

// Load the real browser modules without changing the repository's module type.
const urls = new Map();
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let code = fs.readFileSync(path.join(release,name),'utf8');
  code = code.replace(/from '\.\/([^']+)'/g, (_, dependency) => `from '${moduleUrl(dependency)}'`);
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  urls.set(name,url);return url;
}
(async () => {
  const {CaseStore} = await import(moduleUrl('case-store.js'));
  const {SessionCaseRegistry} = await import(moduleUrl('case-registry.js'));
  const store = new CaseStore();
  const registry = new SessionCaseRegistry(store,{maxCases:2});
  registry.ensureActive();
  store.state.caseInfo = {case_name:'합성 보류 사건'};
  store.state.sourceDocuments = [{document_id:'DOC_001',appraisal_id:'APP_001'}];
  store.state.documentSanity = [{appraisal_id:'APP_001',status:'PARSE_HOLD',hold_codes:['TOTAL_MISMATCH']}];
  store.state.batchHasHold = true;store.state.status = 'PARSE_HOLD';
  store.state.reviewDecisions = {'GROUP:caseInfo':{status:'HOLD',note:'원문 확인 필요'}};
  store.emit();
  const firstId = registry.activeId;
  const bundle = registry.exportBundle();
  registry.importBundle(bundle);
  assert.equal(store.state.status,'PARSE_HOLD','backup must not promote a held document');
  assert.equal(store.state.batchHasHold,true);
  assert.equal(store.state.reviewDecisions['GROUP:caseInfo'].status,'HOLD');
  assert.equal(store.state.capabilities.publicData,'NOT_CONNECTED','saved data is not a live provider connection');
  registry.startNew();
  registry.switchTo(firstId);
  assert.equal(store.state.status,'PARSE_HOLD','case switching must preserve hold');
  const before = JSON.stringify(store.snapshot());
  const ids = [...registry.entries.keys()];
  const malformed = JSON.parse(JSON.stringify(bundle));
  malformed.entries[0].snapshot.lands = 'broken';
  assert.throws(()=>registry.importBundle(malformed),/목록 형식/);
  assert.equal(JSON.stringify(store.snapshot()),before,'failed import must preserve live work');
  assert.deepEqual([...registry.entries.keys()],ids);
  const duplicate = JSON.parse(JSON.stringify(bundle));
  duplicate.entries.push(duplicate.entries[0]);
  assert.throws(()=>registry.importBundle(duplicate),/중복/);
  assert.throws(()=>registry.startNew(),/가득/);
  assert.deepEqual([...registry.entries.keys()],ids,'full registry must not evict unsaved cases');
  store.setStatus('PROCESSING');
  assert.throws(()=>registry.startNew(),/처리 완료/);
  assert.throws(()=>registry.switchTo(firstId),/처리 완료/);
  assert.throws(()=>registry.remove(firstId),/처리 완료/);
  assert.throws(()=>registry.importBundle(bundle),/처리 완료/);
  const processing = store.snapshot();processing.status='PROCESSING';processing.documentSanity=[];processing.batchHasHold=false;
  store.restoreSnapshot(processing);
  assert.equal(store.state.status,'PARSE_HOLD','interrupted processing needs review after restore');
  console.log('Release v1 integrity, backup hold, atomic import and no-eviction gates passed.');
})().catch((error)=>{ console.error(error.message);process.exitCode=1; });
