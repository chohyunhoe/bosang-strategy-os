'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cmd = fs.readFileSync(path.join(root, 'RUN_BSO.cmd'), 'utf8');
const ps1 = fs.readFileSync(path.join(root, 'scripts', 'run_bso_v21.ps1'), 'utf8');

assert.match(cmd, /run_bso_v1\.ps1/i);
assert.match(ps1, /release:v2\.1:build/);
assert.match(ps1, /check_v2_1_local_capabilities\.js/);
assert.match(ps1, /serve_product_v2\.js/);
assert.match(ps1, /dist\\product-v2-1-release/);
assert.match(ps1, /127\.0\.0\.1/);
assert.match(ps1, /\.venv\\Scripts\\python\.exe/);
assert.match(ps1, /brief_output\\requirements\.txt/);
assert.match(ps1, /QGIS\/지적원본은 선택 기능/);
assert.match(ps1, /VWorld API 빠른지도/);
assert.match(ps1, /현장선별/);
assert.match(ps1, /신규사업/);
assert.match(ps1, /RTMS/);
assert.match(ps1, /건축물대장/);
assert.doesNotMatch(ps1, /Ensure-GraphicsEnvironment|Assert-SiheungSidecars|ShapefilePath/);
assert.doesNotMatch(ps1, /dist\\release-candidate/);

console.log('v2_1_launcher_contract.test.js passed');
