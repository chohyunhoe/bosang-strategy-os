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
