// 표준지 개별 직접조회(standard_traits) — 서버 캐시·계측·기능 표지 회귀.
// 실제 scripts/field_server.js를 띄우고 PYTHON을 가짜 워커로 바꿔 합성 응답만 사용(VWorld·키·네트워크 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const { createStandardTraitsCache } = require(path.join(root, 'scripts', 'standard_traits_cache.js'));
const P = (k) => `99999102011000${k}0000`; // 19자리 합성 PNU, 끝자리 규칙은 fake-traits-worker.js

test('캐시: 같은 PNU·연도 성공만 재사용 · 실패·불일치·충돌은 매번 다시 조회 · 계측', async () => {
  let t = 0; const calls = [];
  const c = createStandardTraitsCache({ now: () => t, ttlMs: 1000 });
  const worker = async (p) => { calls.push(p.items.map((x) => x.pnu)); return { ok: true, request_count: { land_characteristics: p.items.length },
    items: p.items.map(({ pnu, year }) => (pnu === P(1) ? { pnu, year, status: 'OK', record: { pnu, stdrYear: String(year), roadSideCodeNm: '세로(가)' } }
      : pnu === P(5) ? { pnu, year, status: 'OK', record: { pnu: P(1), stdrYear: String(year) } } // 서버가 다른 필지 레코드를 돌려준 경우
        : { pnu, year, status: 'FAILED', code: 'X' })) }; };
  const r1 = await c.handle({ items: [{ pnu: P(1), year: 2026 }, { pnu: P(3), year: 2026 }] }, worker);
  assert.equal(r1.ok, true); assert.deepEqual(r1.cache, { hits: 0, misses: 2 }); assert.equal(r1.request_count.land_characteristics, 2);
  const r2 = await c.handle({ items: [{ pnu: P(1), year: 2026 }, { pnu: P(3), year: 2026 }] }, worker);
  assert.deepEqual(calls, [[P(1), P(3)], [P(3)]]); // 성공한 P(1)은 재사용, 실패한 P(3)만 다시
  assert.equal(r2.items[0].cache.reused, true); assert.equal(r2.items[0].record.roadSideCodeNm, '세로(가)');
  assert.equal(r2.request_count.land_characteristics, 1);
  // 다른 연도는 다른 키
  await c.handle({ items: [{ pnu: P(1), year: 2025 }] }, worker); assert.deepEqual(calls.at(-1), [P(1)]);
  // 응답 레코드의 PNU가 요청과 다르면 MISMATCH · 캐시 안 함
  const r3 = await c.handle({ items: [{ pnu: P(5), year: 2026 }] }, worker);
  assert.equal(r3.items[0].status, 'MISMATCH'); assert.equal(c.size(), 2);
  // 만료 뒤에는 다시 조회
  t = 5000; await c.handle({ items: [{ pnu: P(1), year: 2026 }] }, worker); assert.deepEqual(calls.at(-1), [P(1)]);
  assert.equal(c.metrics.cache_hits, 1); assert.ok(c.metrics.failures >= 3); assert.equal(c.metrics.vworld_calls, 6);
  // 입력 검증: 워커를 부르지 않음
  const n = calls.length;
  assert.equal((await c.handle({ items: [] }, worker)).error_code, 'ITEMS_INVALID');
  assert.equal((await c.handle({ items: [1, 2, 3, 4, 5].map(() => ({ pnu: P(1), year: 2026 })) }, worker)).error_code, 'TOO_MANY_ITEMS');
  assert.equal((await c.handle({ items: [{ pnu: '1', year: 2026 }] }, worker)).error_code, 'PNU_INVALID');
  assert.equal(calls.length, n);
  // 워커 자체 실패: 캐시 항목만 있으면 나머지는 FAILED로, 없으면 오류 코드만
  const bad = async () => ({ ok: false, error_code: 'VWORLD_API_KEY_MISSING' });
  const r4 = await c.handle({ items: [{ pnu: P(1), year: 2026 }, { pnu: P(3), year: 2026 }] }, bad);
  assert.equal(r4.ok, true); assert.equal(r4.items[0].status, 'OK'); assert.equal(r4.items[1].status, 'FAILED');
  assert.equal((await c.handle({ items: [{ pnu: P(3), year: 2026 }] }, bad)).error_code, 'VWORLD_API_KEY_MISSING');
});

test('실제 field_server.js: 기능 표지 · standard_traits 경로 · 서버 캐시 재사용 · 워커에는 캐시 밖 항목만', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bso-traits-'));
  const log = path.join(dir, 'worker.log'); const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><meta name="referrer" content="no-referrer"><title>t</title>');
  const port = 4300 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'field_server.js'), '--page', page, '--port', String(port), '--env', path.join(dir, 'none.env')], {
    cwd: root, env: { ...process.env, PYTHON: path.join(here, 'fixtures', 'fake-traits-worker.js'), FAKE_WORKER_LOG: log, BSO_FIELD_STATE_DIR: dir, VWORLD_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', (d) => { if (String(d).includes('BSO field server')) resolve(); }); child.on('exit', () => reject(new Error('server exited'))); setTimeout(() => reject(new Error('start timeout')), 8000); });
    const base = `http://127.0.0.1:${port}/__public_data_bridge`;
    const status = await (await fetch(`${base}/status`)).json();
    assert.ok(status.capabilities.includes('standard_traits')); assert.match(status.server_rev, /std-direct/);
    const post = (items) => fetch(`${base}/standard_traits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }).then((r) => r.json());
    const items = [{ pnu: P(1), year: 2026 }, { pnu: P(2), year: 2026 }, { pnu: P(3), year: 2026 }];
    const a = await post(items);
    assert.deepEqual(a.items.map((x) => x.status), ['OK', 'MISMATCH', 'FAILED']);
    assert.equal(a.request_count.land_characteristics, 3); assert.deepEqual(a.cache, { hits: 0, misses: 3 });
    const b = await post(items);
    assert.equal(b.items[0].cache.reused, true); assert.equal(b.request_count.land_characteristics, 2); assert.deepEqual(b.cache, { hits: 1, misses: 2 });
    const sent = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((p) => p.operation === 'standard_traits').map((p) => p.items.map((x) => x.pnu));
    assert.deepEqual(sent, [[P(1), P(2), P(3)], [P(2), P(3)]]);
    const m = (await (await fetch(`${base}/status`)).json()).standard_traits_metrics;
    assert.equal(m.requests, 2); assert.equal(m.cache_hits, 1); assert.equal(m.vworld_calls, 5); assert.equal(m.failures, 4); assert.equal(m.cached, 1);
    const tooMany = await (await fetch(`${base}/standard_traits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [1, 2, 3, 4, 5].map(() => ({ pnu: P(1), year: 2026 })) }) })).json();
    assert.equal(tooMany.error_code, 'TOO_MANY_ITEMS');
    assert.ok(!JSON.stringify(status).match(/key=|VWORLD_API_KEY/));
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});
