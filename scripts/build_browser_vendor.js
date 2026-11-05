'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'browser', 'vendor');
const assets = [
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'tesseract/tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz', 'tesseract/tessdata/kor.traineddata.gz'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/tessdata/eng.traineddata.gz'],
];

fs.mkdirSync(vendorDir, { recursive: true });
for (const [sourceRelative, outputName] of assets) {
  const source = path.join(root, sourceRelative);
  if (!fs.existsSync(source)) {
    throw new Error(`browser vendor source is missing: ${sourceRelative}`);
  }
  const output = path.join(vendorDir, outputName);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(source, output);
}

console.log(`browser vendor assets built: ${assets.map((asset) => asset[1]).join(', ')}`);

const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fastModel = {
  url: 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/65727574dfcd264acbb0c3e07860e4e9e9b22185/eng.traineddata',
  sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
};
const fastPath = path.join(vendorDir, 'tesseract/tessdata/eng_fast.traineddata.gz');
let fastBytes = null;
try {
  const cached = zlib.gunzipSync(fs.readFileSync(fastPath));
  if (crypto.createHash('sha256').update(cached).digest('hex') === fastModel.sha256) fastBytes = cached;
} catch {}
if (!fastBytes) {
  // Public model only, downloaded at build time. Runtime PDF data stays local.
  const downloader = "fetch(process.argv[1],{signal:AbortSignal.timeout(60000)}).then(async r=>{if(!r.ok)throw new Error('model HTTP '+r.status);process.stdout.write(Buffer.from(await r.arrayBuffer()));}).catch(e=>{console.error(e.message);process.exitCode=1;});";
  fastBytes = execFileSync(process.execPath, ['-e', downloader, fastModel.url], { maxBuffer: 16 * 1024 * 1024 });
  if (crypto.createHash('sha256').update(fastBytes).digest('hex') !== fastModel.sha256) throw new Error('OCR_FAST_MODEL_CHECKSUM_MISMATCH');
  fs.writeFileSync(fastPath, zlib.gzipSync(fastBytes));
}
fs.writeFileSync(path.join(vendorDir, 'tesseract/tessdata/NOTICE.txt'),
  'eng_fast: tesseract-ocr/tessdata_fast 4.1.0 (commit 65727574dfcd264acbb0c3e07860e4e9e9b22185).\nCopyright 1988-1995 Hewlett Packard Company; 2006-2022 Google Inc.\nLicensed under Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0\nSource: ' + fastModel.url + '\nSHA-256: ' + fastModel.sha256 + '\n\n' + fs.readFileSync(path.join(root, 'licenses/tessdata-fast-LICENSE.txt'), 'utf8')); 

