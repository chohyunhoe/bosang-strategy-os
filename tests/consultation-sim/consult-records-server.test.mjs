// V1.0 상담기록 로컬 DB — 저장소 모듈 + 실제 field_server.js API·인증·백업·복구 회귀. 합성 데이터만(실명·연락처 없음, 네트워크·키 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const { createConsultStore, restoreFromBackup, toCsv, normalizeRecord } = require(path.join(root, 'scripts', 'consult_store.js'));
const { createAutosave, SAVE_STATE, newRecordId, RECORD_ID_RE } = await import(path.join(root, 'browser', 'consultation-sim', 'core', 'consult-autosave.js'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bso-rec-'));
const REC = (memo = '합성 메모', extra = {}) => ({ consulted_at: '2026-11-26T05:00:00.000Z', project: '가상 산업단지(합성) · 가상 고시 제0000-1호', is_bundle: false, common_memo: '',
  parcels: [{ pnu: '9999910101100010000', jibun: '바위리 12-3', address: '가상도 연습시 숲내읍 바위리 12-3', issues: [{ id: 'stage', label: '절차 단계 확인' }], memo, other: '', followups: ['받은 통지문 원문으로 현재 절차 단계 확인'] }],
  payload: { v: 1, slots: [{ row: { serial: 1, key: '바위리|0|12|3' }, issues: ['stage'], memo }] }, ...extra });
const ID = 'C-20261126-140000-abc123';

test('저장소: 생성·같은 내용 재전송(중복 없음)·수정차수·충돌·검색·내보내기·수정 이력', () => {
  const dir = tmp(); const s = createConsultStore({ file: path.join(dir, 'db.sqlite') });
  assert.equal(s.ok, true);
  const a = s.save(ID, REC(), {}); assert.equal(a.status, 201); assert.equal(a.rev, 1);
  const b = s.save(ID, REC(), { baseRev: 1 }); assert.equal(b.unchanged, true); assert.equal(b.rev, 1);
  const b2 = s.save(ID, REC(), { baseRev: 0 }); assert.equal(b2.unchanged, true, '같은 내용 재전송은 차수와 무관하게 중복 저장 안 함');
  const c = s.save(ID, REC('수정'), { baseRev: 1 }); assert.equal(c.rev, 2);
  const d = s.save(ID, REC('다른 기기'), { baseRev: 1 }); assert.equal(d.status, 409); assert.equal(d.error_code, 'REV_CONFLICT'); assert.equal(d.rev, 2);
  assert.equal(s.get(ID).memo, '수정');
  assert.equal(s.save('C-20261126-140000-zzz999', REC(), { baseRev: 3 }).error_code, 'REV_CONFLICT_MISSING');
  assert.equal(s.save('bad id', REC(), {}).error_code, 'RECORD_ID_INVALID');
  assert.equal(s.save(ID, { ...REC(), parcels: [] }, { baseRev: 2 }).error_code, 'RECORD_PARCELS_REQUIRED');
  assert.equal(s.list({ q: '바위리' }).items.length, 1);
  assert.equal(s.list({ q: '9999910101100010000' }).items.length, 1);
  assert.equal(s.list({ q: '절차' }).items.length, 1);
  assert.equal(s.list({ q: '수정' }).items.length, 1);
  assert.equal(s.list({ q: '없는말' }).items.length, 0);
  assert.equal(s.list({ q: '%' }).items.length, 0, 'LIKE 와일드카드는 글자로 취급');
  const full = s.get(ID);
  for (const k of ['id', 'consulted_at', 'pnu', 'jibun', 'project', 'issues', 'memo', 'followups', 'parcels', 'is_bundle', 'payload']) assert.ok(k in full, k);
  assert.deepEqual(s.revisions(ID).map((r) => r.rev), [2, 1]);
  const csv = toCsv(s.all());
  assert.match(csv, /^﻿상담ID,상담일시,사업,PNU,지번,상담쟁점,메모,후속조치,필지수,다필지묶음,최종수정,수정차수/);
  assert.match(csv, /C-20261126-140000-abc123,2026-11-26 14:00,/);
  s.close();
});

test('저장소: 다필지 묶음 · 필지별 PNU 검색 · 입력 검증', () => {
  const dir = tmp(); const s = createConsultStore({ file: path.join(dir, 'db.sqlite') });
  const r = REC('', { is_bundle: true, common_memo: '공통 합성', parcels: [
    { pnu: '9999910101100010000', jibun: '바위리 12-3', issues: [{ id: 'stage', label: '절차 단계 확인' }], memo: '첫째', followups: ['a'], in_bundle: true },
    { pnu: '9999910101100020000', jibun: '새솔리 12-3', issues: [{ id: 'remainder', label: '잔여지' }], memo: '둘째', followups: ['b', 'a'], in_bundle: true }] });
  s.save(ID, r, {});
  const g = s.get(ID);
  assert.equal(g.parcel_count, 2); assert.equal(g.is_bundle, true); assert.equal(g.jibun, '바위리 12-3 · 새솔리 12-3');
  assert.deepEqual(g.followups, ['a', 'b']); assert.match(g.memo, /\[공통\] 공통 합성/); assert.match(g.memo, /\[2\] 둘째/);
  assert.equal(s.list({ q: '9999910101100020000' }).items.length, 1);
  assert.equal(normalizeRecord({ ...REC(), consulted_at: 'x' }).error_code, 'RECORD_CONSULTED_AT_INVALID');
  assert.equal(normalizeRecord({ ...REC(), parcels: Array(21).fill(REC().parcels[0]) }).error_code, 'RECORD_TOO_MANY_PARCELS');
  assert.equal(normalizeRecord({ ...REC(), parcels: [{ ...REC().parcels[0], pnu: '123' }] }).record.parcels[0].pnu, null, '19자리가 아닌 PNU는 저장 안 함');
  s.close();
});

test('백업·손상 자동복구·CLI 복구(사용 중 거부 · 이전 DB 보존)', () => {
  const dir = tmp(); const file = path.join(dir, 'db.sqlite');
  let s = createConsultStore({ file });
  s.save(ID, REC(), {});
  const b = s.backup('t'); assert.equal(b.ok, true); assert.equal(b.records, 1);
  assert.equal(restoreFromBackup({ file, backupFile: path.join(s.backupDir, b.file) }).error_code, 'DB_IN_USE_STOP_SERVER_FIRST', '서버가 쓰는 중이면 복구 거부');
  s.save('C-20261126-150000-def456', REC('나중'), {});
  s.close();
  // CLI 복구: 최신 백업(1건)으로 되돌리고 이전 DB는 옆에 보존
  const cli = spawnSync(process.execPath, [path.join(root, 'scripts', 'consult_db.js'), 'restore', '--from', 'latest', '--db', file], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); const out = JSON.parse(cli.stdout); assert.equal(out.ok, true); assert.ok(out.previous_moved_to);
  s = createConsultStore({ file }); assert.equal(s.status().records, 1); s.close();
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.pre-restore-')));
  // 손상: 파일을 망가뜨리면 다음 시작 때 손상본을 옆으로 옮기고 최신 정상 백업으로 자동 복구
  for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  fs.writeFileSync(file, Buffer.from('not a sqlite database at all — corrupted'.repeat(50)));
  s = createConsultStore({ file });
  assert.equal(s.ok, true); assert.ok(s.status().restored_from); assert.equal(s.status().records, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.corrupt-')));
  s.close();
  const st = spawnSync(process.execPath, [path.join(root, 'scripts', 'consult_db.js'), 'status', '--db', file], { encoding: 'utf8' });
  assert.equal(st.status, 0); assert.equal(JSON.parse(st.stdout).integrity_ok, true);
});

test('화면 자동저장: 디바운스·한 번에 하나·같은 내용 재전송 없음·실패 재시도·충돌 정지·인증 만료·마지막 저장', async () => {
  assert.match(newRecordId(new Date(2026, 10, 26, 9, 5, 7), () => 0.5), /^C-20261126-090507-[a-z0-9]{6}$/);
  assert.ok(RECORD_ID_RE.test(newRecordId()));
  const timers = []; const setTimer = (f, ms) => { timers.push({ f, ms }); return timers.length; }; const clearTimer = () => {};
  const runTimers = async () => { while (timers.length) { const t = timers.shift(); t.f(); await new Promise((r) => setImmediate(r)); } };
  const calls = []; let mode = 'ok'; let rev = 0; let release = null;
  const resumes = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/resume')) { resumes.push(JSON.parse(init.body).id); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (release) await new Promise((r) => { const f = release; release = null; f(r); });
    const respond = (status, j) => ({ ok: status < 300, status, json: async () => j });
    if (mode === 'fail') return respond(500, { ok: false, error_code: 'RECORD_SAVE_FAILED' });
    if (mode === 'conflict') return respond(409, { ok: false, error_code: 'REV_CONFLICT', rev: 9 });
    if (mode === 'auth') return respond(401, { ok: false, error_code: 'FIELD_ACCESS_TOKEN_REQUIRED', pair: '/pair' });
    rev += 1; return respond(200, { ok: true, rev, created: init.body && JSON.parse(init.body).base_rev === 0, updated_at: '2026-11-26T05:00:00Z' });
  };
  const states = []; let auth = 0; const finals = [];
  const a = createAutosave({ fetchImpl, setTimer, clearTimer, onState: (x) => states.push(x.status), onAuthExpired: () => { auth += 1; }, onFinalFail: (id, c) => finals.push(c) });
  let memo = ''; a.setProducer(() => (memo ? { parcels: [{ jibun: 'x', memo }], payload: {} } : null));
  a.enable(true);
  a.touch(); await runTimers(); assert.equal(calls.length, 0, '내용 없으면 기록을 만들지 않음');
  memo = 'a'; a.touch(); memo = 'ab'; a.touch(); await runTimers();
  assert.equal(calls.length, 1, '연속 입력은 한 번에'); assert.equal(calls[0].body.base_rev, 0); assert.equal(calls[0].body.record.parcels[0].memo, 'ab');
  const id = a.state().id; assert.ok(RECORD_ID_RE.test(id)); assert.equal(a.state().status, SAVE_STATE.SAVED);
  assert.deepEqual(resumes, [id], '처음 만든 기록만 이 기기의 열린 상담으로 지정');
  a.touch(); await runTimers(); assert.equal(calls.length, 1, '같은 내용은 다시 보내지 않음');
  // 보내는 중 바뀐 내용 → 끝난 뒤 한 번 더(동시에 두 개 보내지 않음)
  let unblock; release = (r) => { unblock = r; };
  memo = 'abc'; a.touch(); const t1 = timers.shift(); t1.f(); await new Promise((r) => setImmediate(r));
  memo = 'abcd'; a.touch(); const t2 = timers.shift(); t2.f(); await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2, '보내는 중에는 새 요청을 내지 않음'); unblock(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 3); assert.equal(calls[2].body.record.parcels[0].memo, 'abcd'); assert.equal(calls[2].body.base_rev, 2);
  assert.ok(calls.every((c) => c.url.endsWith(id)), '같은 상담 ID로만 저장');
  // 실패 → FAILED + 재시도 예약 → 복구되면 SAVED
  mode = 'fail'; memo = 'e'; a.touch(); timers.shift().f(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(a.state().status, SAVE_STATE.FAILED); assert.equal(a.state().error, 'RECORD_SAVE_FAILED'); assert.equal(timers.at(-1).ms, 5000);
  mode = 'ok'; await runTimers(); assert.equal(a.state().status, SAVE_STATE.SAVED);
  // 충돌 → 멈춤(자동 덮어쓰기 없음) → overwrite는 서버 최신 차수로
  mode = 'conflict'; memo = 'f'; a.touch(); await runTimers(); assert.equal(a.state().status, SAVE_STATE.CONFLICT);
  const n = calls.length; memo = 'g'; a.touch(); await runTimers(); assert.equal(calls.length, n, '충돌 중에는 보내지 않음');
  mode = 'ok'; await a.overwrite(); assert.equal(calls.at(-1).body.base_rev, 9); assert.equal(a.state().status, SAVE_STATE.SAVED);
  // 인증 만료 → AUTH + 콜백, 다시 연결되면 이어서 저장
  mode = 'auth'; memo = 'h'; a.touch(); await runTimers(); assert.equal(a.state().status, SAVE_STATE.AUTH); assert.equal(auth, 1);
  mode = 'ok'; await a.authRestored(); assert.equal(a.state().status, SAVE_STATE.SAVED); assert.equal(calls.at(-1).body.record.parcels[0].memo, 'h');
  // 마지막 저장(새 상담 직전): 내용을 미리 잡고, detach 뒤에도 같은 ID로 보냄
  memo = 'last'; const fin = a.finalize(); a.detach(); memo = ''; await fin;
  assert.equal(calls.at(-1).body.record.parcels[0].memo, 'last'); assert.ok(calls.at(-1).url.endsWith(id)); assert.equal(a.state().id, null);
  mode = 'fail'; memo = 'n1'; a.touch(); timers.shift().f(); await new Promise((r) => setTimeout(r, 5)); mode = 'ok'; timers.length = 0;
  // 다시 열기(attach): 같은 ID·차수에 이어서 저장, 읽기 전용이면 저장 안 함
  a.attach({ id: 'C-20261126-150000-def456', rev: 4, consulted_at: '2026-11-26T06:00:00Z' }); memo = 'n2'; a.touch(); await runTimers();
  assert.ok(calls.at(-1).url.endsWith('C-20261126-150000-def456')); assert.equal(calls.at(-1).body.base_rev, 4); assert.equal(calls.at(-1).body.record.consulted_at, '2026-11-26T06:00:00Z', '상담일시는 처음 값 유지');
  a.attach({ id: 'C-20261126-150000-def456', rev: 5, consulted_at: '2026-11-26T06:00:00Z', readOnly: true }); const m = calls.length; memo = 'ro'; a.touch(); await runTimers();
  assert.equal(calls.length, m, '읽기 전용은 저장하지 않음'); assert.equal(a.state().status, SAVE_STATE.READONLY);
  assert.deepEqual(finals, []);
});

// ── 실제 서버 ──────────────────────────────────────────────────────────────
async function startServer({ dir, port, args = [] }) {
  const page = path.join(dir, 'page.html');
  if (!fs.existsSync(page)) fs.writeFileSync(page, '<!doctype html><meta name="referrer" content="no-referrer"><title>t</title>');
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'field_server.js'), '--page', page, '--port', String(port), '--env', path.join(dir, 'none.env'), ...args], {
    cwd: root, env: { ...process.env, PYTHON: path.join(here, 'fixtures', 'fake-traits-worker.js'), BSO_FIELD_STATE_DIR: dir, VWORLD_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((resolve, reject) => { child.stdout.on('data', (d) => { log += d; if (log.includes('BSO field server')) resolve(); }); child.on('exit', () => reject(new Error(`server exited: ${log}`))); setTimeout(() => reject(new Error('start timeout')), 8000); });
  const stop = () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); });
  return { child, stop, log: () => log };
}
const base = (port) => `http://127.0.0.1:${port}`;

test('실제 field_server.js: 기능 표지·저장·재시작 후 유지·재접속 복원(기기 쿠키)·내보내기·백업', async () => {
  const dir = tmp(); const port = 4900 + Math.floor(Math.random() * 300);
  let srv = await startServer({ dir, port });
  try {
    const status = await (await fetch(`${base(port)}/__public_data_bridge/status`)).json();
    assert.ok(status.capabilities.includes('consult_records')); assert.match(status.server_rev, /v1\.0/); assert.equal(status.consult_store.ok, true);
    const pageRes = await fetch(`${base(port)}/`); const cookie = (pageRes.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^bso_client=[A-Za-z0-9_-]{20,}$/, '기기 ID 쿠키');
    const put = (body, c = cookie) => fetch(`${base(port)}/__field/records/${ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: c }, body: JSON.stringify(body) });
    assert.equal((await put({ base_rev: 0, record: REC() })).status, 201);
    await fetch(`${base(port)}/__field/records/resume`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ id: ID }) });
    assert.equal((await (await put({ base_rev: 0, record: REC() })).json()).unchanged, true);
    assert.equal((await fetch(`${base(port)}/__field/records/${ID}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415, 'JSON 아닌 요청 거부(CSRF 방어)');
    await srv.stop();
    srv = await startServer({ dir, port }); // 서버 재시작
    assert.match(srv.log(), /consult records: 1 · start backup consult-records-/);
    const resume = await (await fetch(`${base(port)}/__field/records/resume`, { headers: { Cookie: cookie } })).json();
    assert.equal(resume.record?.id, ID, '재시작 후 이 기기에서 열던 상담 복원'); assert.equal(resume.record.memo, '합성 메모');
    const other = await (await fetch(`${base(port)}/__field/records/resume`, { headers: { Cookie: 'bso_client=AAAAAAAAAAAAAAAAAAAAAAAA' } })).json();
    assert.equal(other.record, null, '다른 기기에는 남의 열린 상담을 띄우지 않음');
    const list = await (await fetch(`${base(port)}/__field/records?q=${encodeURIComponent('바위리')}`)).json(); assert.equal(list.items.length, 1);
    const csv = await fetch(`${base(port)}/__field/records/export?format=csv`); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /attachment/);
    assert.match(await csv.text(), /C-20261126-140000-abc123/);
    const one = await (await fetch(`${base(port)}/__field/records/export?format=json&id=${ID}`)).json(); assert.equal(one.records.length, 1); assert.equal(one.records[0].payload, undefined, '내보내기에 화면 상태 원본은 넣지 않음');
    const bk = await (await fetch(`${base(port)}/__field/records/backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    assert.equal(bk.ok, true); assert.ok(!bk.file.includes('/') && !bk.file.includes('\\'), '응답에 경로 없음');
    await fetch(`${base(port)}/__field/records/resume`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ id: null }) });
    assert.equal((await (await fetch(`${base(port)}/__field/records/resume`, { headers: { Cookie: cookie } })).json()).record, null, '새 상담 뒤에는 복원 안 함');
  } finally { await srv.stop(); }
  assert.ok(fs.existsSync(path.join(dir, 'consult-records.sqlite')));
});

test('실제 field_server.js 인증: 토큰 없으면 화면은 /pair로·API는 401+pair · 만료 코드 재발급 · 페어링 뒤 저장', async () => {
  const dir = tmp(); const port = 5300 + Math.floor(Math.random() * 300);
  const srv = await startServer({ dir, port, args: ['--require-token', '--allow-http-token'] });
  try {
    const page = await fetch(`${base(port)}/`, { redirect: 'manual', headers: { Accept: 'text/html' } });
    assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/pair');
    const api = await fetch(`${base(port)}/__field/records`); assert.equal(api.status, 401);
    assert.deepEqual(await api.json(), { ok: false, error_code: 'FIELD_ACCESS_TOKEN_REQUIRED', pair: '/pair' });
    const code = /코드: (\d{6})/.exec(fs.readFileSync(path.join(dir, 'pair-code.txt'), 'utf8'))[1];
    const pr = await fetch(`${base(port)}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    assert.equal(pr.status, 200); const auth = pr.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base(port)}/__field/records`, { headers: { Cookie: auth } })).status, 200);
    // 1회용 코드 사용 뒤 /pair 화면을 열면 새 코드가 PC 파일에 생긴다(채팅·응답에는 없음)
    const html = await (await fetch(`${base(port)}/pair`)).text();
    assert.doesNotMatch(html, /\d{6}<\/|코드: \d{6}/); assert.match(html, /pair-code\.txt/);
    assert.match(fs.readFileSync(path.join(dir, 'pair-code.txt'), 'utf8'), /코드: \d{6}/);
    assert.notEqual(/코드: (\d{6})/.exec(fs.readFileSync(path.join(dir, 'pair-code.txt'), 'utf8'))[1], null);
  } finally { await srv.stop(); }
});

test('공개 저장소 보호: DB·백업·상담기록 내보내기 파일은 gitignore 대상', () => {
  const r = spawnSync('git', ['check-ignore', '-v', 'local-data/field-server/consult-records.sqlite', 'local-data/field-server/backups/consult-records-20261126-000000.sqlite', 'some/x.sqlite', 'some/x.sqlite-wal', '상담기록_전체_2026-11-26_3건.csv'], { cwd: root, encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 5, r.stdout + r.stderr);
});
