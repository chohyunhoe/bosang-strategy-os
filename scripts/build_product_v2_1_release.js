'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const candidate = path.join(root, 'dist', 'product-v2-candidate');
const release = path.join(root, 'dist', 'product-v2-1-release');

execFileSync(process.execPath, [path.join(root, 'scripts', 'build_product_v2_candidate.js')], { stdio: 'inherit' });
fs.rmSync(release, { recursive: true, force: true });
fs.cpSync(candidate, release, { recursive: true });

function replaceFile(relative, replacements) {
  const target = path.join(release, relative);
  let text = fs.readFileSync(target, 'utf8');
  for (const [from, to] of replacements) text = text.split(from).join(to);
  fs.writeFileSync(target, text, 'utf8');
}
function fileIntegrity(relative) {
  const content = fs.readFileSync(path.join(release, relative));
  return {
    path: relative,
    bytes: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

replaceFile('index.html', [
  ['보상전략 OS · Product v2 Candidate', '보상전략 OS · Product v2.1.3'],
]);
replaceFile('app.js', [
  ['Product v2 Candidate', 'v2.1.3'],
]);
// 실행 로그의 APP_SESSION_STARTED.version 도 같은 릴리스 버전을 가리켜야 한다.
// 이 치환이 없으면 로그만 옛 버전을 보고해 배포 대조가 어긋난다.
replaceFile('session-diagnostics.js', [
  ["const APP_BUILD_VERSION = 'Product v2 Candidate';", "const APP_BUILD_VERSION = '2.1.3';"],
]);

const manifestPath = path.join(release, 'product-v2-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.schema_version = 'bso-product-v2.1.3-release/1.0';
manifest.release_target = '2.1.3';
manifest.production_entry = true;
manifest.release_channel = 'local-workspace-candidate';
manifest.build_note = 'Unified Monday workspace candidate: appraisal review, API quick maps, field screening, early signals, RTMS, building ledger and local output center. No case data, credentials, local outputs, or legacy mobile runtime are bundled.';
manifest.files = (manifest.files || []).map((entry) => fileIntegrity(entry.path));
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const forbidden = [
  'mobile-review-p0', 'mobile-review-router', 'bosang_strategy_os_killerkit', 'stable16',
  'OPENAI_API_KEY=', 'VWORLD_API_KEY=', 'PUBLIC_DATA_API_KEY=',
];
const textFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:html|css|js|mjs|json|txt)$/i.test(entry.name) && entry.name !== 'parser-bundle.js') textFiles.push(full);
  }
}
walk(release);
for (const file of textFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const token of forbidden) {
    if (text.toLowerCase().includes(token.toLowerCase())) throw new Error(`forbidden release token ${token} in ${path.relative(release, file)}`);
  }
}

for (const forbiddenPath of ['case.json','.env','node_modules','graphics-output','parser/output']) {
  if (fs.existsSync(path.join(release, forbiddenPath))) throw new Error(`forbidden release path: ${forbiddenPath}`);
}

console.log(`Product v2.1.3 local workspace release built: ${release}`);
