'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'release-v1');
const version = '1.0.0-rc.2';
execFileSync(process.execPath, [path.join(__dirname, 'build_product_v2_candidate.js')], { stdio:'inherit' });
// Delete only this builder's fixed output directory.
if (path.dirname(output) !== path.join(root, 'dist')) throw new Error('Invalid release output');
fs.rmSync(output, { recursive:true, force:true });
fs.cpSync(path.join(root, 'dist', 'product-v2-candidate'), output, { recursive:true });
for (const relative of ['index.html', 'app.js', 'session-diagnostics.js', 'work-ops-ui.js']) {
  const target = path.join(output, relative);
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replaceAll('Product v2 Candidate', `Release v1 · ${version}`).replaceAll('월요일 바로 쓰는 BSO', '업무 바로가기'));
}
const manifestPath = path.join(output, 'product-v2-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
Object.assign(manifest, {
  schema_version:'bso-release-v1/1.0', release_target:version,
  release_channel:'windows-pc-release-candidate', production_entry:false,
  case_registry:'SESSION_MEMORY_WITH_EXPLICIT_LOCAL_JSON_BACKUP',
  launch_command:'RUN_BSO.cmd',
  local_gate:'REAL_CASE_SMOKE_REQUIRED',
});
manifest.files = manifest.files.map(({path:relative}) => {
  const bytes = fs.readFileSync(path.join(output, relative));
  return { path:relative, bytes:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex') };
});
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`BSO Release v1 ${version} built: ${output}`);
