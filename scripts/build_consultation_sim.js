'use strict';
// BSO 지번형 보상상담 시뮬레이터 빌드 — Product v2 / Release v1 빌드와 별도 출력(dist/consultation-sim).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'browser', 'consultation-sim');
const out = path.join(root, 'dist', 'consultation-sim');
if (path.dirname(out) !== path.join(root, 'dist')) throw new Error('Invalid consultation-sim output');

fs.rmSync(out, { recursive: true, force: true });
const files = fs.readdirSync(source, { recursive: true })
  .map(String)
  .filter((rel) => /\.(html|css|js)$/.test(rel))
  .sort();
const manifest = [];
for (const rel of files) {
  const content = fs.readFileSync(path.join(source, rel));
  const target = path.join(out, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  manifest.push({ path: rel.split(path.sep).join('/'), bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') });
}
const meta = {
  schema_version: 'bso-consultation-sim/0.1',
  stage: 'PR-1',
  production_entry: false,
  default_data_mode: 'SYNTHETIC',
  live_mode: 'LOCAL_PUBLIC_DATA_BRIDGE_ONLY_NO_SYNTHETIC_FALLBACK',
  live_map: 'PENDING_TERMS_REVIEW',
  state_model: 'CONSULTATION_DRAFT_SEPARATE_FROM_CASESTORE',
  persistence: 'SESSION_MEMORY_PLUS_EXPLICIT_USER_DOWNLOAD',
  files: manifest,
};
fs.writeFileSync(path.join(out, 'consultation-sim-manifest.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`consultation simulator built: ${out} (${manifest.length} files)`);
