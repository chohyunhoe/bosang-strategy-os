'use strict';

// Privacy boundary guard for the Gongju (Songseon/Donghyeon) real-appraisal-case
// purge. The real place/owner/case tokens are deliberately NOT written here in
// plaintext — see the base64 table below.
//
// Locks in the P0 cleanup: no real-case-derived identifier may re-enter the
// tracked repository, demo/fixture PNUs must stay in a synthetic namespace, and
// no personal-number pattern may appear. Forbidden tokens are stored base64 so
// the guard itself never embeds the real strings (which would defeat the scan).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const dec = (b64) => Buffer.from(b64, 'base64').toString('utf8');

// --- Real-case identifiers that must NOT appear in any tracked file ---
const FORBIDDEN_B64 = {
  owner: '7J207IOB7LKg',
  org: '7Lap7LKt64Ko64+E6rCc67Cc6rO17IKs',
  dong1: '7Iah7ISg64+Z',
  dong2: '64+Z7ZiE64+Z',
  fname_frag: '6rO17KO87Iah7ISg64+Z7ZiE',
  project: '7Iah7ISgwrfrj5ntmITsp4Dqtaw=',
  addr1: '6rO17KO87IucIOyGoeyEoA==',
  addr2: '6rO17KO8IOyGoeyEoA==',
  pnu1: 'NDQxNTAxMjYwMDEwMDc4MDAwMQ==',
  pnu2: 'NDQxNTAxMjYwMDEwMDc4MDAwNA==',
  pnu3: 'NDQxNTAxMjYwMDEwMTUxMDAwMA==',
  pnu4: 'NDQxNTAxMjYwMDEwMTc2MDAwMQ==',
  pnu5: 'NDQxNTAxMjYwMDEwNDA5MDAwMA==',
  pnu6: 'NDQxNTAxMjYwMDEwNTY0MDAwMg==',
  pnu7: 'NDQxNTAxMjYwMDIwMDAzMDAwMQ==',
  pnu8: 'NDQxNTAxMjcwMDEwMjY5MDAwNQ==',
  pnu9: 'NDQxNTAzNDAyMTEwMDAzMDAwMQ==',
  amt1: 'NzE3Mzk1NzAwMA==',
  amt2: 'NzI2MjU5OTAwMA==',
  amt3: 'NzI5MTEzNTAwMA==',
  amt4: 'NzY0MzM0NjAwMA==',
  amt5: 'NzY3MjY5NjAwMA==',
  amt6: 'NjQ5NDc0ODAwMA==',
  amt7: 'NjU1MzUyNDAwMA==',
  amt8: 'NjkwNjE4MDAwMA==',
};
const FORBIDDEN = Object.fromEntries(
  Object.entries(FORBIDDEN_B64).map(([k, v]) => [k, dec(v)])
);

// Demo/fixture/doc/test files rewritten by the purge — their 19-digit PNUs must
// use only a synthetic namespace (prefix 99999… or 88888…; real 법정동 codes
// start 11–50, so these prefixes can never be a real region).
const PURGED_FILES = [
  'index.html', 'index.head-backup.html', 'index_standalone.html',
  'bosang_os_v04_alpha2_stable16.html',
  'sample_case_gongju.json', 'sample_case_001_v021_full.json',
  'reference/sample_case_001_v021_full.json',
  'input/pnu_list_sample.csv',
  'README.md', 'api_runtime_qa.md', 'demo_walkthrough.md',
  'vworld_success_flow.md', 'vworld_batch_lookup_design.md',
  'public_data_api_design.md',
];
const SYNTHETIC_PNU_PREFIX = /^(99999|88888)/;

const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.pdf', '.xlsx', '.xls', '.zip', '.woff', '.woff2', '.ttf', '.eot',
  '.qgz', '.qgs',
]);

// Real-document binaries that must never be tracked. Their contents cannot be
// scanned as text, so tracking one hides real case data from every content check.
const FORBIDDEN_TRACKED_EXT = new Set(['.pdf', '.xlsx', '.xls', '.hwp', '.hwpx', '.doc', '.docx']);

// Binaries verified to contain no real-case data and required by the build.
// bso_brief_template_v0.1.docx holds only {{PLACEHOLDER}} tokens — its inflated
// XML was checked against every FORBIDDEN token. Add an entry ONLY after the
// same verification; an unverified binary is an unreviewable privacy hole.
const ALLOWED_TRACKED_BINARIES = new Set([
  'brief_output/templates/bso_brief_template_v0.1.docx',
]);

// `git ls-files` WITHOUT -z octal-escapes and double-quotes any non-ASCII path,
// so a Korean filename arrives as a quoted escape string: path.extname() then
// sees `.pdf"` (trailing quote, so no SKIP_EXT hit) and readFileSync() fails on
// that literal string, which readIfText() swallowed as null. The file was thus
// silently skipped by every check. -z yields raw NUL-separated paths instead.
function trackedPaths() {
  return childProcess
    .execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((rel) => !rel.startsWith('node_modules/'));
}

// git stores these filenames decomposed (NFD), so a substring test against the
// composed (NFC) forbidden tokens fails unless the path is normalized first.
// Match on NFC; keep the raw path for filesystem access.
function matchablePath(rel) {
  return rel.normalize('NFC');
}

function trackedTextFiles() {
  return trackedPaths().filter((rel) => !SKIP_EXT.has(path.extname(rel).toLowerCase()));
}

function readIfText(rel) {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  } catch (_) {
    return null;
  }
}

function run() {
  const files = trackedTextFiles();
  assert.ok(files.length > 0, 'expected tracked files to scan');
  const allPaths = trackedPaths();

  // 0. Self-test for the path matcher itself. git stores Korean filenames
  //    decomposed (NFD), so a raw substring test against the composed (NFC)
  //    tokens silently misses them. If this fails, checks 0a/0b are blind and
  //    a real-case file could sit in the repo while the guard reports success.
  const nfdProbe = `${FORBIDDEN.owner}(probe).pdf`.normalize('NFD');
  assert.ok(
    !nfdProbe.includes(FORBIDDEN.owner),
    'self-test broken: NFD probe should not match the NFC token directly'
  );
  assert.ok(
    matchablePath(nfdProbe).includes(FORBIDDEN.owner),
    'matchablePath must normalize NFD paths to NFC or the path checks are blind'
  );

  // 0a. No tracked FILE PATH may carry a real-case identifier. Content checks
  //     cannot see a filename, and binaries are never read at all.
  const pathHits = [];
  for (const rel of allPaths) {
    const name = matchablePath(rel);
    for (const [key, needle] of Object.entries(FORBIDDEN)) {
      if (name.includes(needle)) pathHits.push(`${rel} :: forbidden[${key}]`);
    }
  }
  assert.deepStrictEqual(
    pathHits, [],
    `real-case identifiers must not appear in tracked file paths:\n${pathHits.join('\n')}`
  );

  // 0b. No real-document binary may be tracked at all (parser/fixtures/pdf/README.md
  //     policy: real appraisal PDFs stay local-only). Such a file's contents are
  //     unscannable, so tracking one is an unreviewable privacy hole.
  const binaryHits = allPaths.filter(
    (rel) => FORBIDDEN_TRACKED_EXT.has(path.extname(matchablePath(rel)).toLowerCase())
      && !ALLOWED_TRACKED_BINARIES.has(matchablePath(rel))
  );
  assert.deepStrictEqual(
    binaryHits, [],
    `real-document binaries must not be tracked (keep them local-only):\n${binaryHits.join('\n')}`
  );

  // 1. No real-case identifier anywhere in tracked content.
  const hits = [];
  for (const rel of files) {
    const text = readIfText(rel);
    if (text == null) continue;
    for (const [key, needle] of Object.entries(FORBIDDEN)) {
      if (text.includes(needle)) hits.push(`${rel} :: forbidden[${key}]`);
    }
  }
  assert.deepStrictEqual(
    hits, [],
    `real-case identifiers must not appear in tracked files:\n${hits.join('\n')}`
  );

  // 2. Real appraisal PDF filename pattern must be absent (owner( + .pdf).
  const pdfNamePattern = new RegExp(`${FORBIDDEN.owner}\\([^)]*\\)[^\\n]*\\.pdf`);
  for (const rel of files) {
    const text = readIfText(rel);
    if (text == null) continue;
    assert.ok(
      !pdfNamePattern.test(text),
      `real appraisal PDF filename pattern found in ${rel}`
    );
  }

  // 3. Every 19-digit PNU in the purged files uses the synthetic namespace.
  const pnu19 = /(?<!\d)\d{19}(?!\d)/g;
  for (const rel of PURGED_FILES) {
    const text = readIfText(rel);
    if (text == null) continue;
    const matches = text.match(pnu19) || [];
    for (const m of matches) {
      assert.ok(
        SYNTHETIC_PNU_PREFIX.test(m),
        `${rel}: 19-digit PNU ${m} is outside the synthetic namespace`
      );
    }
  }

  // 4. No resident-registration / corporate-registration / account patterns.
  const rrn = /\b\d{6}[- ]?[1-4]\d{6}\b/;          // 주민등록번호
  const corp = /\b\d{6}-?\d{7}\b/;                 // 법인등록번호 6-7
  for (const rel of PURGED_FILES) {
    const text = readIfText(rel);
    if (text == null) continue;
    assert.ok(!rrn.test(text), `resident-registration-number pattern in ${rel}`);
    assert.ok(!corp.test(text), `corporate-registration-number pattern in ${rel}`);
  }

  // 5. Fixture schema sanity — the primary demo case must still parse and keep
  //    its anonymization label and core arrays.
  const sample = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'sample_case_gongju.json'), 'utf8')
  );
  for (const key of ['appraisals', 'land_appraisal_results', 'comparison_summary_by_land']) {
    assert.ok(Array.isArray(sample[key]) && sample[key].length > 0,
      `sample_case_gongju.json must keep non-empty ${key}`);
  }

  console.log(`Privacy purge guard passed: scanned ${files.length} tracked text files and ${allPaths.length} tracked paths, no real-case identifiers.`);
}

run();
