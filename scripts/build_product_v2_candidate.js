'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'product-v2-candidate');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build_browser_parser_bundle.js')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'scripts', 'build_browser_vendor.js')], { stdio: 'inherit' });

const files = [
  ['browser/product-v2/index.html', 'index.html'],
  ['browser/product-v2/styles.css', 'styles.css'],
  ['browser/product-v2/map-preview.css', 'map-preview.css'],
  ['browser/product-v2/app.js', 'app.js'],
  ['browser/product-v2/case-store.js', 'case-store.js'],
  ['browser/product-v2/document-workflow.js', 'document-workflow.js'],
  ['browser/product-v2/document-workflow-ui.js', 'document-workflow-ui.js'],
  ['browser/product-v2/case-registry.js', 'case-registry.js'],
  ['browser/product-v2/case-registry-ui.js', 'case-registry-ui.js'],
  ['browser/product-v2/session-diagnostics.js', 'session-diagnostics.js'],
  ['browser/product-v2/review-workbench.js', 'review-workbench.js'],
  ['browser/product-v2/execution-model.js', 'execution-model.js'],
  ['browser/product-v2/appraisal-coverage.js', 'appraisal-coverage.js'],
  ['browser/product-v2/record-inspector.js', 'record-inspector.js'],
  ['browser/product-v2/pnu-resolver-ui.js', 'pnu-resolver-ui.js'],
  ['browser/product-v2/issue-engine.js', 'issue-engine.js'],
  ['browser/product-v2/map-preview.js', 'map-preview.js'],
  ['browser/product-v2/vworld-api-map.js', 'vworld-api-map.js'],
  ['browser/product-v2/map-local-adapter.js', 'map-local-adapter.js'],
  ['browser/product-v2/map-bridge-ui.js', 'map-bridge-ui.js'],
  ['browser/product-v2/work-ops-adapter.js', 'work-ops-adapter.js'],
  ['browser/product-v2/work-ops-ui.js', 'work-ops-ui.js'],
  ['browser/product-v2/pre-field-kit.js', 'pre-field-kit.js'],
  ['browser/product-v2/output-adapter.js', 'output-adapter.js'],
  ['browser/product-v2/public-data-adapter.js', 'public-data-adapter.js'],
  ['browser/product-v2/pdf-source.js', 'pdf-source.js'],
  ['browser/product-v2/ocr-source.js', 'ocr-source.js'],
  ['browser/parser-bundle.js', 'parser-bundle.js'],
  ['browser/vendor/pdf.min.mjs', 'vendor/pdf.min.mjs'],
  ['browser/vendor/pdf.worker.min.mjs', 'vendor/pdf.worker.min.mjs'],
  ['browser/vendor/tesseract/tesseract.min.js', 'vendor/tesseract/tesseract.min.js'],
  ['browser/vendor/tesseract/worker.min.js', 'vendor/tesseract/worker.min.js'],
  ['browser/vendor/tesseract/core/tesseract-core-lstm.wasm.js', 'vendor/tesseract/core/tesseract-core-lstm.wasm.js'],
  ['browser/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js'],
  ['browser/vendor/tesseract/tessdata/kor.traineddata.gz', 'vendor/tesseract/tessdata/kor.traineddata.gz'],
  ['browser/vendor/tesseract/tessdata/eng.traineddata.gz', 'vendor/tesseract/tessdata/eng.traineddata.gz'],
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const manifest = [];
for (const [sourceRel, targetRel] of files) {
  const source = path.join(root, sourceRel);
  if (!fs.existsSync(source)) throw new Error(`missing product v2 source: ${sourceRel}`);
  const target = path.join(out, targetRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = fs.readFileSync(source);
  fs.writeFileSync(target, content);
  manifest.push({ path: targetRel, bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') });
}

const releaseMeta = {
  schema_version: 'bso-product-v2.1-rc/1.1',
  release_target: '2.1.1-hardening',
  production_entry: false,
  privacy_profile: 'LOCAL_BROWSER_PROCESSING_NO_CASE_BUNDLE',
  parser_contract: 'browser-parser/0.4',
  text_pdf: 'PDFJS_POSITIONAL_SOURCE_GROUPED_LINE_PARSER',
  text_pdf_note: 'PDF.js item coordinates are retained while building the page source, then grouped line text is passed to the current parser. Ambiguous blank table cells are not inferred.',
  scan_pdf: 'TESSERACT_KOR_ENG_LOCAL_FALLBACK',
  state_model: 'ONE_CASESTORE_ONE_REVIEW_QUEUE',
  review_runtime: 'CANONICAL_ONE_BY_ONE_WORKBENCH',
  case_registry: 'SESSION_MEMORY_ONLY_NO_PERSISTENT_STORAGE',
  session_diagnostics: 'USER_DOWNLOADABLE_AGGREGATE_EVENT_LOG_NO_CREDENTIALS_NO_SOURCE_TEXT',
  responsive_model: 'ONE_RENDERER_PC_MOBILE_PARITY',
  pnu_resolver: 'REVIEW_ONLY_MOIS_EXACT_OR_UNIQUE_SUFFIX',
  map_runtime: 'VWORLD_API_ONLY_QUICK_MAP_PLUS_OPTIONAL_LOCAL_QGIS_PRECISION_MAP',
  map_quick_contract: 'NO_LOCAL_CADASTRAL_ARCHIVE_REQUIRED',
  browser_capabilities: ['VWORLD_API_QUICK_MAP', 'PRE_FIELD_KIT'],
  local_capabilities: [
    'OUTPUT_BRIDGE','PUBLIC_DATA_BRIDGE','PNU_RESOLVER','FIELD_CANDIDATES','EARLY_SIGNAL','RTMS','BUILDING_LEDGER',
    'MAP_PRECISION_BRIDGE','VWORLD','QGIS',
  ],
  files: manifest,
};
fs.writeFileSync(path.join(out, 'product-v2-manifest.json'), `${JSON.stringify(releaseMeta, null, 2)}\n`, 'utf8');
console.log(`product v2.1 candidate built: ${out} (${manifest.length} runtime files)`);

