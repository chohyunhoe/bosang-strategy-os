'use strict';
// BSO 현장상담 V1.0 상담기록 로컬 DB(SQLite, node:sqlite) — 이 PC 파일에만 저장한다.
// - 위치: local-data/field-server/consult-records.sqlite (gitignore). 백업: local-data/field-server/backups/.
// - 저장 항목: 상담 ID · 상담일시 · PNU · 지번 · 사업 · 상담쟁점 · 메모 · 후속조치 · 다필지 묶음 + 재열기용 화면 상태(payload).
// - 중복저장 방지: 상담 ID는 화면이 만들고(같은 ID 재전송 = 같은 기록), 내용 해시가 같으면 수정차수를 올리지 않는다.
//   다른 기기에서 먼저 고친 기록(base_rev 불일치)은 덮어쓰지 않고 REV_CONFLICT로 돌려준다.
// - 백업: VACUUM INTO로 일관된 사본. 시작 시 무결성 검사 실패면 손상 파일을 옆으로 옮기고 최신 정상 백업으로 자동 복구.
// - 외부 전송·클라우드 저장 없음. 값은 로그에 쓰지 않는다(건수·파일명만).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const ID_RE = /^C-\d{8}-\d{6}-[a-z0-9]{6}$/;
const LIMITS = Object.freeze({ parcels: 20, text: 4000, list: 200, issues: 40, followups: 60, payload: 200 * 1024, revisions: 20, backups: 30 });

function loadSqlite() {
  // Node 22.5+ 내장. 실험 기능 경고는 한 번만 나오며 동작에는 영향이 없다.
  const prev = process.emitWarning;
  process.emitWarning = (w, ...a) => { if (String(w && w.message ? w.message : w).includes('SQLite')) return; prev.call(process, w, ...a); };
  try { return require('node:sqlite'); } catch (_e) { return null; } finally { process.emitWarning = prev; }
}

const str = (v, max = LIMITS.text) => (v == null ? '' : String(v)).slice(0, max);
const strOrNull = (v, max = 200) => { const s = str(v, max).trim(); return s || null; };
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

// 화면이 보낸 기록을 검증·정규화. 잘못된 형식은 저장하지 않는다(부분 저장 없음).
function normalizeRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error_code: 'RECORD_INVALID' };
  const parcels = Array.isArray(input.parcels) ? input.parcels : null;
  if (!parcels || !parcels.length) return { ok: false, error_code: 'RECORD_PARCELS_REQUIRED' };
  if (parcels.length > LIMITS.parcels) return { ok: false, error_code: 'RECORD_TOO_MANY_PARCELS' };
  const consulted = new Date(input.consulted_at);
  if (!input.consulted_at || Number.isNaN(consulted.getTime())) return { ok: false, error_code: 'RECORD_CONSULTED_AT_INVALID' };
  const list = (v, max) => (Array.isArray(v) ? v : []).slice(0, max);
  const norm = parcels.map((p, i) => {
    const pnu = strOrNull(p && p.pnu, 19);
    return {
      idx: i, pnu: pnu && /^\d{19}$/.test(pnu) ? pnu : null, jibun: strOrNull(p && p.jibun, 200) || '(지번 미기재)', address: strOrNull(p && p.address, 300),
      in_bundle: Boolean(p && p.in_bundle),
      issues: list(p && p.issues, LIMITS.issues).map((x) => ({ id: str(x && x.id, 40), label: str(x && x.label, 120) })).filter((x) => x.id),
      memo: str(p && p.memo), other: str(p && p.other, 1000),
      followups: list(p && p.followups, LIMITS.followups).map((x) => str(x, 400)).filter(Boolean),
    };
  });
  const payload = input.payload == null ? null : JSON.stringify(input.payload);
  if (payload && payload.length > LIMITS.payload) return { ok: false, error_code: 'RECORD_PAYLOAD_TOO_LARGE' };
  return { ok: true, record: {
    consulted_at: consulted.toISOString(), project: strOrNull(input.project, 300), common_memo: str(input.common_memo),
    is_bundle: Boolean(input.is_bundle), parcels: norm, payload,
  } };
}

// 목록·검색·내보내기용 요약 열. 필지 순서를 그대로 지킨다.
function derive(rec) {
  const uniq = (a) => [...new Set(a)];
  const issues = uniq(rec.parcels.flatMap((p) => p.issues.map((x) => x.label || x.id)));
  const followups = uniq(rec.parcels.flatMap((p) => p.followups));
  const memo = [rec.common_memo ? `[공통] ${rec.common_memo}` : '', ...rec.parcels.map((p, i) => {
    const t = [p.memo, p.other ? `기타: ${p.other}` : ''].filter(Boolean).join(' / ');
    return t ? (rec.parcels.length > 1 ? `[${i + 1}] ${t}` : t) : '';
  })].filter(Boolean).join('\n');
  return {
    pnu: rec.parcels.map((p) => p.pnu).filter(Boolean).join(',') || null,
    jibun: rec.parcels.map((p) => p.jibun).join(' · '),
    issues, followups, memo,
  };
}
const hashOf = (rec) => crypto.createHash('sha256').update(JSON.stringify([rec.consulted_at, rec.project, rec.common_memo, rec.is_bundle, rec.parcels, rec.payload])).digest('hex');

function openDb(sqlite, file) {
  const db = new sqlite.DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS consult_records(
      id TEXT PRIMARY KEY, rev INTEGER NOT NULL, consulted_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      project TEXT, pnu TEXT, jibun TEXT NOT NULL, issues TEXT NOT NULL, memo TEXT NOT NULL, followups TEXT NOT NULL,
      is_bundle INTEGER NOT NULL, parcel_count INTEGER NOT NULL, bundle TEXT NOT NULL, common_memo TEXT NOT NULL,
      payload TEXT, content_hash TEXT NOT NULL, client_id TEXT);
    CREATE TABLE IF NOT EXISTS consult_parcels(
      record_id TEXT NOT NULL REFERENCES consult_records(id) ON DELETE CASCADE, idx INTEGER NOT NULL,
      pnu TEXT, jibun TEXT NOT NULL, address TEXT, PRIMARY KEY(record_id, idx));
    CREATE TABLE IF NOT EXISTS consult_revisions(
      record_id TEXT NOT NULL REFERENCES consult_records(id) ON DELETE CASCADE, rev INTEGER NOT NULL, saved_at TEXT NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY(record_id, rev));
    CREATE TABLE IF NOT EXISTS client_state(client_id TEXT PRIMARY KEY, record_id TEXT, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_records_updated ON consult_records(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_parcels_pnu ON consult_parcels(pnu);`);
  db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
  return db;
}
function integrityOk(sqlite, file) {
  let db;
  try {
    db = new sqlite.DatabaseSync(file, { readOnly: true });
    const r = db.prepare('PRAGMA integrity_check').get();
    const v = r && Object.values(r)[0];
    const hasTable = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='consult_records'").get();
    return v === 'ok' && Boolean(hasTable);
  } catch (_e) { return false; } finally { try { db && db.close(); } catch (_e) { /* ignore */ } }
}
const listBackupFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^consult-records-\d{8}-\d{6}(-[a-z0-9-]+)?\.sqlite$/.test(f)).sort().reverse() : []);

// 사용 중 표지: 서버(lock: true)가 DB를 여는 동안 <db>.lock에 PID를 둔다. CLI 복구는 살아 있는 PID가 있으면 거부.
const lockFile = (file) => `${file}.lock`;
function lockHolder(file) {
  try { const pid = Number(fs.readFileSync(lockFile(file), 'utf8').trim()); if (!pid) return null; process.kill(pid, 0); return pid; } catch (e) { return e && e.code === 'EPERM' ? -1 : null; }
}
function createConsultStore({ file, backupDir = path.join(path.dirname(file), 'backups'), now = () => new Date(), log = () => {}, keepBackups = LIMITS.backups, lock = true } = {}) {
  const sqlite = loadSqlite();
  if (!sqlite) return { ok: false, reason: 'NODE_SQLITE_UNAVAILABLE', status: () => ({ ok: false, reason: 'NODE_SQLITE_UNAVAILABLE' }) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  let restoredFrom = null;
  // 시작 시 무결성 검사 → 손상이면 옆으로 옮기고 최신 정상 백업 복구(없으면 빈 DB로 시작하고 상태에 표시)
  if (fs.existsSync(file) && !integrityOk(sqlite, file)) {
    const bad = `${file}.corrupt-${stamp(now())}`;
    for (const ext of ['', '-wal', '-shm']) { if (fs.existsSync(file + ext)) fs.renameSync(file + ext, bad + ext); }
    const good = listBackupFiles(backupDir).find((f) => integrityOk(sqlite, path.join(backupDir, f)));
    if (good) { fs.copyFileSync(path.join(backupDir, good), file); restoredFrom = good; }
    log(`consult store: integrity check failed — moved aside (${path.basename(bad)}); ${good ? `restored from ${good}` : 'no valid backup, starting empty'}`);
  }
  const db = openDb(sqlite, file);
  if (lock) fs.writeFileSync(lockFile(file), String(process.pid));
  let lastBackup = listBackupFiles(backupDir)[0] || null;
  let changedSinceBackup = false;

  const q = {
    get: db.prepare('SELECT * FROM consult_records WHERE id = ?'),
    insert: db.prepare(`INSERT INTO consult_records(id, rev, consulted_at, created_at, updated_at, project, pnu, jibun, issues, memo, followups, is_bundle, parcel_count, bundle, common_memo, payload, content_hash, client_id)
      VALUES(@id, 1, @consulted_at, @t, @t, @project, @pnu, @jibun, @issues, @memo, @followups, @is_bundle, @parcel_count, @bundle, @common_memo, @payload, @content_hash, @client_id)`),
    update: db.prepare(`UPDATE consult_records SET rev = rev + 1, consulted_at=@consulted_at, updated_at=@t, project=@project, pnu=@pnu, jibun=@jibun, issues=@issues, memo=@memo, followups=@followups,
      is_bundle=@is_bundle, parcel_count=@parcel_count, bundle=@bundle, common_memo=@common_memo, payload=@payload, content_hash=@content_hash, client_id=@client_id WHERE id=@id AND rev=@base_rev`),
    delParcels: db.prepare('DELETE FROM consult_parcels WHERE record_id = ?'),
    addParcel: db.prepare('INSERT INTO consult_parcels(record_id, idx, pnu, jibun, address) VALUES(?, ?, ?, ?, ?)'),
    addRev: db.prepare('INSERT OR REPLACE INTO consult_revisions(record_id, rev, saved_at, body) VALUES(?, ?, ?, ?)'),
    trimRev: db.prepare('DELETE FROM consult_revisions WHERE record_id = ? AND rev <= ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM consult_records'),
    setResume: db.prepare('INSERT INTO client_state(client_id, record_id, updated_at) VALUES(?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET record_id=excluded.record_id, updated_at=excluded.updated_at'),
    getResume: db.prepare('SELECT record_id FROM client_state WHERE client_id = ?'),
  };
  // 재접속 복원: 기기(브라우저) 쿠키 ID별 '지금 열린 상담'. 브라우저 저장소를 쓰지 않고 이 PC DB에만 둔다.
  const CLIENT_RE = /^[A-Za-z0-9_-]{16,64}$/;
  function setResume(clientId, recordId) {
    if (!CLIENT_RE.test(String(clientId || ''))) return { ok: false, error_code: 'CLIENT_ID_INVALID' };
    if (recordId != null && !ID_RE.test(String(recordId))) return { ok: false, error_code: 'RECORD_ID_INVALID' };
    q.setResume.run(clientId, recordId == null ? null : String(recordId), now().toISOString()); return { ok: true, id: recordId == null ? null : String(recordId) };
  }
  function getResume(clientId) {
    if (!CLIENT_RE.test(String(clientId || ''))) return null;
    const r = q.getResume.get(clientId); return r && r.record_id ? get(r.record_id) : null;
  }
  const summary = (r) => ({ id: r.id, rev: r.rev, consulted_at: r.consulted_at, created_at: r.created_at, updated_at: r.updated_at, project: r.project, pnu: r.pnu, jibun: r.jibun,
    issues: JSON.parse(r.issues), memo: r.memo, followups: JSON.parse(r.followups), is_bundle: Boolean(r.is_bundle), parcel_count: r.parcel_count });
  const full = (r) => ({ ...summary(r), parcels: JSON.parse(r.bundle), common_memo: r.common_memo, payload: r.payload ? JSON.parse(r.payload) : null });

  function save(id, input, { baseRev = 0, clientId = null } = {}) {
    if (!ID_RE.test(String(id || ''))) return { ok: false, status: 400, error_code: 'RECORD_ID_INVALID' };
    const n = normalizeRecord(input); if (!n.ok) return { ...n, status: 400 };
    const rec = n.record; const d = derive(rec); const content_hash = hashOf(rec); const t = now().toISOString();
    const row = { id, consulted_at: rec.consulted_at, t, project: rec.project, pnu: d.pnu, jibun: d.jibun, issues: JSON.stringify(d.issues), memo: d.memo, followups: JSON.stringify(d.followups),
      is_bundle: rec.is_bundle ? 1 : 0, parcel_count: rec.parcels.length, bundle: JSON.stringify(rec.parcels), common_memo: rec.common_memo, payload: rec.payload, content_hash, client_id: strOrNull(clientId, 64) };
    const cur = q.get.get(id);
    if (cur && cur.content_hash === content_hash) return { ok: true, status: 200, id, rev: cur.rev, updated_at: cur.updated_at, unchanged: true };
    if (cur && Number(baseRev) !== cur.rev) return { ok: false, status: 409, error_code: 'REV_CONFLICT', id, rev: cur.rev, updated_at: cur.updated_at };
    if (!cur && Number(baseRev) !== 0) return { ok: false, status: 409, error_code: 'REV_CONFLICT_MISSING', id, rev: 0 };
    db.exec('BEGIN IMMEDIATE');
    try {
      if (cur) { const r = q.update.run({ ...row, base_rev: cur.rev }); if (r.changes !== 1) throw new Error('REV_RACE'); } else q.insert.run(row);
      q.delParcels.run(id);
      rec.parcels.forEach((p) => q.addParcel.run(id, p.idx, p.pnu, p.jibun, p.address));
      const after = q.get.get(id);
      q.addRev.run(id, after.rev, t, JSON.stringify(full(after)));
      q.trimRev.run(id, after.rev - LIMITS.revisions);
      db.exec('COMMIT');
      changedSinceBackup = true;
      return { ok: true, status: cur ? 200 : 201, id, rev: after.rev, updated_at: t, created: !cur };
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_e) { /* ignore */ }
      if (e.message === 'REV_RACE') { const c = q.get.get(id); return { ok: false, status: 409, error_code: 'REV_CONFLICT', id, rev: c ? c.rev : 0 }; }
      log('consult store: save failed'); return { ok: false, status: 500, error_code: 'RECORD_SAVE_FAILED' };
    }
  }
  function get(id) { if (!ID_RE.test(String(id || ''))) return null; const r = q.get.get(id); return r ? full(r) : null; }
  function list({ q: text = '', limit = 50 } = {}) {
    const lim = Math.max(1, Math.min(LIMITS.list, Number(limit) || 50));
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    const where = words.map(() => `(r.id LIKE ? ESCAPE '\\' OR r.jibun LIKE ? ESCAPE '\\' OR IFNULL(r.pnu,'') LIKE ? ESCAPE '\\' OR IFNULL(r.project,'') LIKE ? ESCAPE '\\' OR r.memo LIKE ? ESCAPE '\\' OR r.issues LIKE ? ESCAPE '\\' OR r.followups LIKE ? ESCAPE '\\' OR r.consulted_at LIKE ? ESCAPE '\\'
      OR EXISTS(SELECT 1 FROM consult_parcels p WHERE p.record_id = r.id AND (IFNULL(p.address,'') LIKE ? ESCAPE '\\')))`).join(' AND ');
    const args = words.flatMap((w) => { const like = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; return Array(9).fill(like); });
    const rows = db.prepare(`SELECT r.* FROM consult_records r ${where ? `WHERE ${where}` : ''} ORDER BY r.updated_at DESC LIMIT ${lim}`).all(...args);
    return { total: q.count.get().n, items: rows.map(summary) };
  }
  function revisions(id) { return db.prepare('SELECT rev, saved_at FROM consult_revisions WHERE record_id = ? ORDER BY rev DESC').all(id); }
  function all() { return db.prepare('SELECT * FROM consult_records ORDER BY consulted_at, id').all().map(full); }

  function backup(label = '') {
    const name = `consult-records-${stamp(now())}${label ? `-${String(label).replace(/[^a-z0-9-]/g, '').slice(0, 20)}` : ''}.sqlite`;
    const dest = path.join(backupDir, name);
    if (fs.existsSync(dest)) fs.rmSync(dest);
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    if (!integrityOk(sqlite, dest)) { fs.rmSync(dest, { force: true }); return { ok: false, error_code: 'BACKUP_VERIFY_FAILED' }; }
    lastBackup = name; changedSinceBackup = false;
    const files = listBackupFiles(backupDir);
    files.slice(keepBackups).forEach((f) => fs.rmSync(path.join(backupDir, f), { force: true }));
    return { ok: true, file: name, records: q.count.get().n };
  }
  function backupIfChanged(label = 'auto') { return changedSinceBackup ? backup(label) : { ok: true, skipped: true }; }
  function status() {
    return { ok: true, records: q.count.get().n, last_backup: lastBackup, backups: listBackupFiles(backupDir).length, restored_from: restoredFrom, schema_version: SCHEMA_VERSION };
  }
  function close() {
    try { db.close(); } catch (_e) { /* ignore */ }
    if (lock) { try { if (fs.readFileSync(lockFile(file), 'utf8').trim() === String(process.pid)) fs.rmSync(lockFile(file)); } catch (_e) { /* ignore */ } }
  }
  return { ok: true, save, get, list, all, revisions, setResume, getResume, backup, backupIfChanged, status, close, file, backupDir };
}

// ── 내보내기 ─────────────────────────────────────────────────────────────
const EXPORT_COLUMNS = [['id', '상담ID'], ['consulted_at', '상담일시'], ['project', '사업'], ['pnu', 'PNU'], ['jibun', '지번'], ['issues', '상담쟁점'], ['memo', '메모'], ['followups', '후속조치'],
  ['parcel_count', '필지수'], ['is_bundle', '다필지묶음'], ['updated_at', '최종수정'], ['rev', '수정차수']];
function toCsv(records) {
  const cell = (v) => { const s = Array.isArray(v) ? v.join(' | ') : typeof v === 'boolean' ? (v ? 'Y' : 'N') : v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const kst = (iso) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 16) : '');
  const rows = records.map((r) => EXPORT_COLUMNS.map(([k]) => cell(['consulted_at', 'updated_at'].includes(k) ? kst(r[k]) : r[k])).join(','));
  return `﻿${[EXPORT_COLUMNS.map(([, l]) => l).join(','), ...rows].join('\r\n')}\r\n`;
}
function toJson(records) {
  return JSON.stringify({ schema: 'bso-consult-records-export/v1', exported_at: new Date().toISOString(), note: '로컬 상담기록 내보내기 · 개인정보 포함 가능 · 공개 저장소·클라우드 업로드 금지',
    records: records.map(({ payload, ...r }) => r) }, null, 2);
}

// ── 복구(서버 정지 상태에서 CLI로) ────────────────────────────────────────
function restoreFromBackup({ file, backupFile, now = () => new Date() }) {
  const sqlite = loadSqlite(); if (!sqlite) return { ok: false, error_code: 'NODE_SQLITE_UNAVAILABLE' };
  if (!fs.existsSync(backupFile) || !integrityOk(sqlite, backupFile)) return { ok: false, error_code: 'BACKUP_INVALID' };
  let pre = null;
  if (fs.existsSync(file)) {
    // 다른 프로세스(서버)가 쓰고 있으면 거부: 사용 중 표지(PID) + 쓰기 잠금을 확인한다.
    if (lockHolder(file)) return { ok: false, error_code: 'DB_IN_USE_STOP_SERVER_FIRST' };
    try { const d = new sqlite.DatabaseSync(file); d.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);'); d.close(); } catch (_e) { return { ok: false, error_code: 'DB_IN_USE_STOP_SERVER_FIRST' }; }
    pre = `${file}.pre-restore-${stamp(now())}`;
    for (const ext of ['', '-wal', '-shm']) { if (fs.existsSync(file + ext)) fs.renameSync(file + ext, pre + ext); }
  }
  fs.copyFileSync(backupFile, file);
  return { ok: true, restored: path.basename(backupFile), previous_moved_to: pre ? path.basename(pre) : null };
}

module.exports = { createConsultStore, normalizeRecord, restoreFromBackup, toCsv, toJson, listBackupFiles, integrityOk: (f) => { const s = loadSqlite(); return Boolean(s) && integrityOk(s, f); }, ID_RE, LIMITS, SCHEMA_VERSION, EXPORT_COLUMNS };
