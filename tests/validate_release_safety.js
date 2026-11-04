'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build_release_candidate.js')], { stdio: 'inherit' });
const releaseRoot = path.join(root, 'dist', 'release-candidate');
const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'release-manifest.json'), 'utf8'));
const paths = manifest.files.map((entry) => entry.path);

assert.equal(manifest.privacy_profile, 'NO_BUNDLED_CASE_DATA');
assert.equal(manifest.default_external_network, 'NONE');
assert.ok(paths.includes('index.html'));
assert.ok(paths.includes('browser/parser-bundle.js'));
assert.ok(paths.includes('browser/release-core.js'));
assert.ok(paths.includes('browser/pdfjs-loader.mjs'));
assert.ok(paths.includes('browser/vendor/pdf.min.mjs'));
assert.ok(paths.includes('browser/vendor/tesseract/tessdata/kor.traineddata.gz'));
assert.ok(!paths.some((entry) => /(?:^|\/)(?:reference|input|output|parser\/fixtures)(?:\/|$)/.test(entry)));
assert.ok(!paths.some((entry) => /sample|actual|\.pdf$/i.test(entry)));

for (const entry of manifest.files) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  assert.ok(entry.bytes > 0, `${entry.path} must not be empty`);
}

const html = fs.readFileSync(path.join(releaseRoot, 'index.html'), 'utf8');
const scriptSources = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]);
assert.ok(scriptSources.length >= 3);
assert.ok(scriptSources.every((source) => source.startsWith('./browser/')), `all script sources must be same-origin: ${scriptSources.join(', ')}`);
assert.ok(!/cdnjs|cdn\.jsdelivr|unpkg|raw\.githubusercontent/i.test(html), 'release HTML must not execute third-party CDN code');
assert.ok(!/(?:sk-[A-Za-z0-9_-]{16,}|api[_-]?key\s*[:=]\s*["'][^"']{8,})/i.test(html), 'release HTML must not contain API credentials');
assert.ok(!/[A-Za-z]:\\Users\\[^\\\s]+/i.test(html), 'release HTML must not contain Windows user paths');
assert.ok(!/(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|\/root\/[^/\s]+)/.test(html), 'release HTML must not contain local absolute user paths');
// Flagged real identifiers are stored base64 so this test file embeds no plaintext real data.
const _b64 = (s) => Buffer.from(s, 'base64').toString('utf8');
assert.ok(!html.includes(_b64('7J207IOB7LKg')), 'release HTML must not contain the flagged owner name');
assert.doesNotMatch(html, new RegExp([_b64('7Iah7ISg64+Z'), _b64('7IKwMy0x'), 'LAND_00[1-5]', 'APP_001'].join('|')), 'release HTML must not contain retired case-specific identifiers');
assert.doesNotMatch(html, /function\s+s(?:9|10|11|12|13|14|15|16)[A-Za-z0-9_]*/, 'release HTML must not execute retired case-specific normalizers');
assert.doesNotMatch(html, /appraisal_company\s*===\s*["']제일["']|제일 평가서/, 'release HTML must not branch on a case-specific appraisal company');
assert.ok(html.includes('감정평가서 검토 보조'));
assert.ok(html.includes('자동 확정값이 아닙니다'));
assert.ok(html.includes('브라우저 벡터 지도는 개략 미리보기'));

console.log('release safety checks passed');
