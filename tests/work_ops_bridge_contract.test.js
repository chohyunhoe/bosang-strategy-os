'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { POST_OPERATIONS } = require('../scripts/public_data_bridge.js');

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'scripts', 'public_data_bridge.py'), 'utf8');
const workOps = fs.readFileSync(path.join(root, 'public_data', 'work_ops.py'), 'utf8');

for (const [route, operation] of [
  ['/__public_data_bridge/resolve_pnu','resolve_pnu'],
  ['/__public_data_bridge/field_candidates','field_candidates'],
  ['/__public_data_bridge/early_signals','early_signals'],
  ['/__public_data_bridge/rtms','rtms'],
  ['/__public_data_bridge/building','building'],
]) {
  assert.equal(POST_OPERATIONS.get(route), operation, `${route} must be routed`);
  assert.match(worker, new RegExp(`operation == ["']${operation}["']`));
}

assert.match(workOps, /P1/);
assert.match(workOps, /주유소·연료/);
assert.match(workOps, /P4/);
assert.match(workOps, /화훼·원예/);
assert.match(workOps, /P5/);
assert.match(workOps, /FIELD_ACTIVE/);
assert.match(workOps, /FIELD_ACTIVE는 현장확인 우선순위이며 편입·보상대상 확정이 아닙니다/);
assert.match(workOps, /EARLY_SIGNAL은 신규사업 후보 신호/);
assert.match(workOps, /RtmsTradeClient/);
assert.match(workOps, /BuildingLedgerClient/);
assert.doesNotMatch(workOps, /auto_confirmed["']?\s*:\s*True/);

console.log('work_ops_bridge_contract.test.js passed');
