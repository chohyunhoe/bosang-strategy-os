'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'map_bridge.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'scripts', 'serve_product_v2.js'), 'utf8');
const { buildManifest, sanitizeMessage, validatedVworldImageUrl } = require(path.join(root, 'scripts', 'map_bridge.js'));

assert.match(server, /handleMapBridgeRequest/);
assert.match(server, /127\.0\.0\.1/);
assert.doesNotMatch(source, /console\.log\([^\n]*(VWORLD_API_KEY|CADASTRAL_ARCHIVE)/);
assert.match(source, /secrets_exposed:\s*false/);
assert.match(source, /VWORLD_IMAGE_PROXY_URL_REJECTED/);
assert.match(source, /CODEX_NETWORK_ESCALATION_REQUIRED/);

const imageUrl = 'https://api.vworld.kr/req/image?service=image&request=getmap&format=png&basemap=PHOTO&key=SESSION_ONLY&center=127,36';
assert(validatedVworldImageUrl(imageUrl));
assert.equal(validatedVworldImageUrl('https://evil.example/req/image?service=image&request=getmap&format=png&basemap=PHOTO&key=x'), null);
assert.equal(validatedVworldImageUrl('https://api.vworld.kr/req/data?service=image&request=getmap&format=png&basemap=PHOTO&key=x'), null);
assert.equal(validatedVworldImageUrl('https://api.vworld.kr/req/image?service=image&request=getmap&format=png&basemap=GRAPHIC&key=x'), null);

const state = {
  caseInfo: { case_name:'익명 사건' },
  lands: [
    { land_id:'LAND_001', parcel_address:'익명시 샘플동 1-1', pnu:'1111111111100010001' },
    { land_id:'LAND_002', parcel_address:'익명시 샘플동 1-2', pnu:'1111111111100010002' },
  ],
  standardLands: [
    { standard_land_symbol:'A', parcel_address:'익명시 샘플동 2-1', pnu:'1111111111100020001' },
    { standard_land_symbol:'B', parcel_address:'익명시 샘플동 2-2', pnu:'1111111111100020002' },
  ],
  appraisalResults: [
    { land_id:'LAND_001', standard_land_symbol:'B' },
    { land_id:'LAND_002', standard_land_symbol:'B' },
  ],
};

const manifest = buildManifest(state, '/local-only/cadastral.zip', 'EPSG:5174');
assert.equal(manifest.layers.length, 2);
assert.deepEqual(manifest.layers.find((layer) => layer.role === 'subject').pnus, [
  '1111111111100010001','1111111111100010002',
]);
assert.deepEqual(manifest.layers.find((layer) => layer.role === 'standard').pnus, [
  '1111111111100020002',
], 'only standards referenced by appraisal rows should be required');
assert.equal(manifest.parcel_verification.required_pnus.length, 3);
assert.equal(manifest.privacy.raw_personal_data_in_output, false);
assert.deepEqual(manifest.outputs, ['subject_vs_standard']);

assert.throws(
  () => buildManifest({ ...state, lands:[{ ...state.lands[0], pnu:'' }] }, '/local/cadastral.zip', 'EPSG:5174'),
  (error) => error && error.code === 'SUBJECT_PNU_INCOMPLETE',
);
assert.throws(
  () => buildManifest({ ...state, standardLands:[{ ...state.standardLands[1], pnu:'' }] }, '/local/cadastral.zip', 'EPSG:5174'),
  (error) => error && error.code === 'STANDARD_PNU_INCOMPLETE',
);

const previousVworld = process.env.VWORLD_API_KEY;
process.env.VWORLD_API_KEY = 'SECRET_VWORLD_MAP_TEST';
try {
  const workspace = process.platform === 'win32' ? 'C:\\Temp\\bso-v2-map-secret' : '/tmp/bso-v2-map-secret';
  const archive = process.platform === 'win32' ? 'D:\\private\\cadastral-secret.zip' : '/private/cadastral-secret.zip';
  const raw = `QGIS failed workspace=${workspace} archive=${archive} key=${process.env.VWORLD_API_KEY}`;
  const sanitized = sanitizeMessage(raw, workspace, archive);
  assert.doesNotMatch(sanitized, /bso-v2-map-secret|cadastral-secret\.zip|SECRET_VWORLD_MAP_TEST/);
  assert.match(sanitized, /\[REDACTED\]/);
} finally {
  if (previousVworld === undefined) delete process.env.VWORLD_API_KEY;
  else process.env.VWORLD_API_KEY = previousVworld;
}

console.log('product_v2_map_bridge.test.js passed');
