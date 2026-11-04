'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const release = path.join(root, 'dist', 'product-v2-1-release');
const required = [
  'index.html','styles.css','app.js','case-store.js','case-registry.js','case-registry-ui.js','session-diagnostics.js','review-workbench.js',
  'appraisal-coverage.js','record-inspector.js','pnu-resolver-ui.js','public-data-adapter.js','map-preview.js','vworld-api-map.js','map-local-adapter.js','map-bridge-ui.js',
  'work-ops-adapter.js','work-ops-ui.js','pre-field-kit.js','output-adapter.js','pdf-source.js','ocr-source.js','parser-bundle.js','product-v2-manifest.json',
];
for (const file of required) assert.ok(fs.existsSync(path.join(release, file)), `missing local workspace file: ${file}`);

const manifest = JSON.parse(fs.readFileSync(path.join(release, 'product-v2-manifest.json'), 'utf8'));
assert.equal(manifest.production_entry, true);
assert.equal(manifest.release_channel, 'local-workspace-candidate');
assert.equal(manifest.release_target, '2.1.3');
assert.equal(manifest.state_model, 'ONE_CASESTORE_ONE_REVIEW_QUEUE');
assert.equal(manifest.review_runtime, 'CANONICAL_ONE_BY_ONE_WORKBENCH');
assert.equal(manifest.responsive_model, 'ONE_RENDERER_PC_MOBILE_PARITY');
assert.equal(manifest.privacy_profile, 'LOCAL_BROWSER_PROCESSING_NO_CASE_BUNDLE');
assert.equal(manifest.session_diagnostics, 'USER_DOWNLOADABLE_AGGREGATE_EVENT_LOG_NO_CREDENTIALS_NO_SOURCE_TEXT');
for (const capability of ['FIELD_CANDIDATES','EARLY_SIGNAL','RTMS','BUILDING_LEDGER','OUTPUT_BRIDGE']) assert.ok(manifest.local_capabilities.includes(capability));
assert.ok(Array.isArray(manifest.files) && manifest.files.length >= 24, 'release manifest must list runtime files');
for (const entry of manifest.files) {
  const full = path.join(release, entry.path);
  assert.ok(fs.existsSync(full), `manifest file missing: ${entry.path}`);
  const content = fs.readFileSync(full);
  assert.equal(entry.bytes, content.length, `manifest byte count mismatch: ${entry.path}`);
  assert.equal(entry.sha256, crypto.createHash('sha256').update(content).digest('hex'), `manifest sha mismatch: ${entry.path}`);
}

const index = fs.readFileSync(path.join(release, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(release, 'app.js'), 'utf8');
const workbench = fs.readFileSync(path.join(release, 'review-workbench.js'), 'utf8');
const workOps = fs.readFileSync(path.join(release, 'work-ops-ui.js'), 'utf8');
const quickMap = fs.readFileSync(path.join(release, 'vworld-api-map.js'), 'utf8');
const mapPreview = fs.readFileSync(path.join(release, 'map-preview.js'), 'utf8');
const diagnostics = fs.readFileSync(path.join(release, 'session-diagnostics.js'), 'utf8');
assert.match(index, /Product v2\.1\.3/);
assert.doesNotMatch(index, /Product v2 Candidate/);
assert.match(app, /v2\.1\.3/);
// 실행 로그가 보고하는 버전도 릴리스 버전과 같아야 한다.
assert.match(diagnostics, /const APP_BUILD_VERSION = '2\.1\.3';/);
assert.doesNotMatch(diagnostics, /Product v2 Candidate/);
assert.match(app, /data-map-import/);
assert.match(app, /state\.mapContext[\s\S]*renderMapPreview/);
assert.match(mapPreview, /없음\(벡터 검토\)/);
assert.match(mapPreview, /가져온 벡터 형상\(원천 별도 검수\)/);
assert.match(workbench, /전체 검수/);
assert.match(workOps, /현장선별 엔진/);
assert.match(workOps, /나라장터 EARLY_SIGNAL/);
assert.match(workOps, /RTMS 거래사례 후보/);
assert.match(workOps, /건축물대장 조회/);
assert.match(quickMap, /local_cadastral_archive_required:false/);
assert.match(quickMap, /PNU_EXACT_ONE_POLYGON_WITH_LABELED_POINT_FALLBACK/);
assert.match(quickMap, /EXACT_ONE_POLYGON_ONLY/);
assert.match(quickMap, /VWORLD_SEARCH_UNIQUE_PARCEL_TO_EXACT_PNU/);
assert.match(quickMap, /default_basemap:'PHOTO'/);
assert.match(quickMap, /layers = ''/);
assert.match(quickMap, /TARGET:'YELLOW'.+STANDARD:'RED'.+CASE:'BLUE'/s);
assert.match(quickMap, /SUBJECT_STANDARD_PER_MATCH/);
assert.match(quickMap, /STANDARD_CASE_PER_MATCH/);
assert.match(mapPreview, /map-label-leader/);
assert.match(mapPreview, /map-inset/);
assert.match(mapPreview, /insetBackgroundUrl/);
assert.match(mapPreview, /view\.zoom<18\?2:1/);
assert.match(mapPreview, /prioritizedInsets/);
assert.match(mapPreview, /fill:rgba\(0,0,0,\.35\)/);
assert.match(mapPreview, /rgba\(0,229,255,\.58\)/);
assert.match(mapPreview, /slice\(0,6\)/);
assert.match(mapPreview, /insetView/);
assert.match(mapPreview, /clipPath/);
assert.match(quickMap, /png_export:true/);
assert.match(quickMap, /reportGraphic:true,insets:true/);
assert.match(quickMap, /CONDITIONAL_AERIAL_INSETS_FOR_SMALL_PARCELS/);
assert.match(diagnostics, /bso-session-diagnostics\/1\.0/);
assert.match(diagnostics, /data-session-log-download/);
assert.doesNotMatch(diagnostics, /localStorage|sessionStorage|indexedDB/);

const forbidden = ['mobile-review-p0','mobile-review-router','stable16','bosang_strategy_os_killerkit'];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(html|css|js|mjs|json)$/i.test(entry.name) || entry.name === 'parser-bundle.js') continue;
    const text = fs.readFileSync(full, 'utf8').toLowerCase();
    for (const token of forbidden) assert.equal(text.includes(token.toLowerCase()), false, `${path.relative(release, full)} contains ${token}`);
  }
}
walk(release);
for (const name of ['case.json','.env','node_modules','graphics-output','parser/output']) assert.equal(fs.existsSync(path.join(release, name)), false, `forbidden release path ${name}`);

console.log('Product v2.1.3 local workspace release safety gate passed');
