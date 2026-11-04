'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outputRoot = path.join(root, 'dist', 'release-candidate');
const files = [
  'index.html',
  'browser/release-core.js',
  'browser/mobile-review-p0.js',
  'browser/mobile-review-router.js',
  'browser/parser-bundle.js',
  'browser/pdfjs-loader.mjs',
  'browser/release-factor-matrix.mjs',
  'browser/vendor/pdf.min.mjs',
  'browser/vendor/pdf.worker.min.mjs',
  'browser/vendor/tesseract/tesseract.min.js',
  'browser/vendor/tesseract/worker.min.js',
  'browser/vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'browser/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'browser/vendor/tesseract/tessdata/kor.traineddata.gz',
  'browser/vendor/tesseract/tessdata/eng.traineddata.gz',
];

for (const scriptName of ['build_browser_parser_bundle.js', 'build_browser_vendor.js']) {
  execFileSync(process.execPath, [path.join(root, 'scripts', scriptName)], { stdio: 'inherit' });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

const manifestFiles = files.map((relativePath) => {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) throw new Error(`release file is missing: ${relativePath}`);
  const content = fs.readFileSync(source);
  const destination = path.join(outputRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
  return { path: relativePath, bytes: content.length, sha256: sha256(content) };
});

const outputIndexPath = path.join(outputRoot, 'index.html');
let outputIndex = fs.readFileSync(outputIndexPath, 'utf8');
const mobileTags = [
  '<script src="./browser/mobile-review-p0.js"></script>',
  '<script src="./browser/mobile-review-router.js"></script>',
];
if (!outputIndex.includes('</body>')) throw new Error('release index is missing </body>');
for (const tag of mobileTags) {
  if (!outputIndex.includes(tag)) outputIndex = outputIndex.replace('</body>', `  ${tag}\n</body>`);
}
fs.writeFileSync(outputIndexPath, outputIndex, 'utf8');
const indexManifest = manifestFiles.find((item) => item.path === 'index.html');
const indexBuffer = Buffer.from(outputIndex);
indexManifest.bytes = indexBuffer.length;
indexManifest.sha256 = sha256(indexBuffer);

const readme = [
  '보상전략 OS — five-stage release candidate',
  '',
  '1. 이 폴더에서 정적 HTTP 서버를 실행합니다: python -m http.server 8080',
  '2. 브라우저에서 http://127.0.0.1:8080 을 엽니다.',
  '3. 평가서와 지도 파일은 현재 브라우저 세션에서만 처리합니다.',
  '',
  '이 도구는 감정평가·법률판단을 대체하지 않는 검토 보조 도구입니다.',
  '브라우저 지도는 개략 미리보기이며 최종 축척·레이아웃은 QGIS 산출물에서 확인합니다.',
].join('\n');
fs.writeFileSync(path.join(outputRoot, 'README.txt'), `${readme}\n`, 'utf8');
manifestFiles.push({ path: 'README.txt', bytes: Buffer.byteLength(`${readme}\n`), sha256: sha256(Buffer.from(`${readme}\n`)) });

const manifest = {
  schema_version: '0.1',
  artifact_type: 'BOSANG_OS_FIVE_STAGE_RC',
  privacy_profile: 'NO_BUNDLED_CASE_DATA',
  default_external_network: 'NONE',
  files: manifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
};
fs.writeFileSync(path.join(outputRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`release candidate built: ${outputRoot} (${manifestFiles.length} files)`);
