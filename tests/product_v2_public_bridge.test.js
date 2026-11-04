'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const worker = path.join(root, 'scripts', 'public_data_bridge.py');
const nodeBridge = fs.readFileSync(path.join(root, 'scripts', 'public_data_bridge.js'), 'utf8');
assert.match(nodeBridge, /PYTHONUTF8:\s*'1'/);
assert.match(nodeBridge, /PYTHONIOENCODING:\s*'utf-8'/);
const pythonCandidates = [process.env.PYTHON, process.env.PYTHON3, 'python3', 'python'].filter(Boolean);

function runWith(candidate, payload) {
  return spawnSync(candidate, [worker], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      PUBLIC_DATA_API_KEY: 'SECRET_PUBLIC_DATA_TEST_VALUE',
      VWORLD_API_KEY: 'SECRET_VWORLD_TEST_VALUE',
    },
  });
}

function runCode(candidate, code) {
  return spawnSync(candidate, ['-c', code], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env },
  });
}

let result = null;
let python = null;
for (const candidate of pythonCandidates) {
  const trial = runWith(candidate, { operation: 'status' });
  if (!trial.error && trial.status !== null) { result = trial; python = candidate; break; }
}

if (!result) {
  console.log('SKIP product_v2_public_bridge.test.js: Python runtime unavailable');
  process.exit(0);
}

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.doesNotMatch(result.stdout, /SECRET_PUBLIC_DATA_TEST_VALUE|SECRET_VWORLD_TEST_VALUE/);
const payload = JSON.parse(String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop());
assert.equal(payload.ok, true);
assert.equal(payload.public_data_configured, true);
assert.equal(payload.vworld_configured, true);
assert.equal(payload.secrets_exposed, false);
assert.ok(['DECODED', 'PERCENT_ENCODED_NORMALIZED'].includes(payload.public_data_key_form));
assert.equal(Object.keys(payload).some((key) => /key|secret/i.test(key) && !['public_data_key_form','secrets_exposed'].includes(key)), false);

const resolverCode = String.raw`
import io
import json
from types import SimpleNamespace
import scripts.public_data_bridge as bridge

class Provider:
    configured = True

class ExactClient:
    def __init__(self, provider):
        pass
    def search(self, query):
        return SimpleNamespace(
            ok=True,
            records=[SimpleNamespace(locatadd_nm='세종특별자치시 전동면 송선리', region_cd='3611035025')],
            error_code=None,
        )

bridge.PublicDataProvider = lambda: Provider()
bridge.LegalDongCodeClient = ExactClient
normal = bridge.resolve_pnu({'parcel_address':'세종특별자치시 전동면 송선리 78-1'})
mountain = bridge.resolve_pnu({'parcel_address':'세종특별자치시 전동면 송선리 산3-1'})

class MultipleClient:
    def __init__(self, provider):
        pass
    def search(self, query):
        return SimpleNamespace(
            ok=True,
            records=[
                SimpleNamespace(locatadd_nm='세종특별자치시 전동면 송선리', region_cd='3611035025'),
                SimpleNamespace(locatadd_nm='익명도 익명면 송선리', region_cd='4111111111'),
            ],
            error_code=None,
        )
bridge.LegalDongCodeClient = MultipleClient
multiple = bridge.resolve_pnu({'parcel_address':'송선리 78-1'})
contextual = bridge.resolve_pnu({'parcel_address':'송선리 78-1','address_context':'세종특별자치시 전동면 신규사업'})
korean_payload = bridge.read_request_payload(io.BytesIO('{"parcel_address":"표본동 202-5"}'.encode('utf-8')))
print(json.dumps({'normal':normal,'mountain':mountain,'multiple':multiple,'contextual':contextual,'korean_payload':korean_payload}, ensure_ascii=True))
`;
const resolver = runCode(python, resolverCode);
assert.equal(resolver.status, 0, resolver.stderr || resolver.stdout);
const resolved = JSON.parse(String(resolver.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop());
assert.equal(resolved.normal.ok, true);
assert.equal(resolved.normal.candidate.pnu, '3611035025100780001');
assert.equal(resolved.normal.candidate.review_status_code, 'NEEDS_REVIEW');
assert.equal(resolved.normal.candidate.auto_confirmed, false);
assert.equal(resolved.mountain.ok, true);
assert.equal(resolved.mountain.candidate.pnu, '3611035025200030001');
assert.equal(resolved.mountain.candidate.auto_confirmed, false);
assert.equal(resolved.multiple.ok, false);
assert.equal(resolved.multiple.error_code, 'LEGAL_DONG_MULTIPLE_CANDIDATES');
assert.equal(resolved.multiple.candidate, null);
assert.equal(resolved.contextual.ok, true);
assert.equal(resolved.contextual.candidate.pnu, '3611035025100780001');
assert.equal(resolved.contextual.candidate.origin, 'MOIS_LEGAL_DONG_CONTEXT_UNIQUE');
assert.equal(resolved.contextual.candidate.review_status_code, 'NEEDS_REVIEW');
assert.equal(resolved.korean_payload.parcel_address, '표본동 202-5');

console.log('product_v2_public_bridge.test.js passed');
