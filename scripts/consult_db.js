#!/usr/bin/env node
'use strict';
// BSO 현장상담 V1.0 상담기록 DB 관리(이 PC 전용 CLI). 값은 출력하지 않고 건수·파일명만 출력한다.
//   node scripts/consult_db.js status   [--db <sqlite>]          건수·백업 목록·무결성
//   node scripts/consult_db.js backup   [--db <sqlite>]          지금 백업(local-data/field-server/backups)
//   node scripts/consult_db.js verify   --file <sqlite>          백업 파일 무결성 확인
//   node scripts/consult_db.js restore  --from <백업파일|latest> [--db <sqlite>]
//        서버를 먼저 멈춘다(사용 중이면 거부). 현재 DB는 *.pre-restore-<시각>으로 옮겨 보존한다.
//   node scripts/consult_db.js export   [--format csv|json] --out <파일>   (local-data 아래로만 권장 · 커밋 금지)
const fs = require('node:fs');
const path = require('node:path');
const { createConsultStore, restoreFromBackup, listBackupFiles, integrityOk, toCsv, toJson } = require('./consult_store.js');

const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i > 0 ? argv[i + 1] : fallback; };
const stateDir = process.env.BSO_FIELD_STATE_DIR ? path.resolve(process.env.BSO_FIELD_STATE_DIR) : path.join(root, 'local-data', 'field-server');
const dbFile = path.resolve(arg('db', process.env.BSO_CONSULT_DB || path.join(stateDir, 'consult-records.sqlite')));
const backupDir = path.join(path.dirname(dbFile), 'backups');
const out = (o) => console.log(JSON.stringify(o, null, 2));

function main() {
  if (cmd === 'status') {
    const exists = fs.existsSync(dbFile);
    const s = exists ? createConsultStore({ file: dbFile, lock: false }) : null;
    out({ db: path.basename(dbFile), exists, integrity_ok: exists ? integrityOk(dbFile) : null, ...(s && s.ok ? s.status() : {}), backup_files: listBackupFiles(backupDir).slice(0, 10) });
    if (s && s.close) s.close();
    return 0;
  }
  if (cmd === 'backup') {
    const s = createConsultStore({ file: dbFile, lock: false }); if (!s.ok) { out({ ok: false, error_code: s.reason }); return 1; }
    const r = s.backup('cli'); s.close(); out(r); return r.ok ? 0 : 1;
  }
  if (cmd === 'verify') {
    const f = arg('file'); if (!f) { console.error('--file 필요'); return 2; }
    const ok = integrityOk(path.resolve(f)); out({ file: path.basename(f), integrity_ok: ok }); return ok ? 0 : 1;
  }
  if (cmd === 'restore') {
    let from = arg('from'); if (!from) { console.error('--from <백업파일|latest> 필요'); return 2; }
    if (from === 'latest') { const f = listBackupFiles(backupDir).find((x) => integrityOk(path.join(backupDir, x))); if (!f) { out({ ok: false, error_code: 'NO_VALID_BACKUP' }); return 1; } from = path.join(backupDir, f); }
    else if (!path.isAbsolute(from) && !fs.existsSync(from)) from = path.join(backupDir, from);
    const r = restoreFromBackup({ file: dbFile, backupFile: path.resolve(from) }); out(r); return r.ok ? 0 : 1;
  }
  if (cmd === 'export') {
    const fmt = arg('format', 'csv') === 'json' ? 'json' : 'csv'; const file = arg('out'); if (!file) { console.error('--out <파일> 필요'); return 2; }
    const s = createConsultStore({ file: dbFile, lock: false }); if (!s.ok) { out({ ok: false, error_code: s.reason }); return 1; }
    const list = s.all(); s.close();
    fs.writeFileSync(path.resolve(file), fmt === 'json' ? toJson(list) : toCsv(list));
    out({ ok: true, records: list.length, file: path.basename(file) }); return 0;
  }
  console.error('사용: node scripts/consult_db.js status|backup|verify|restore|export (파일 머리 주석 참조)');
  return 2;
}
process.exitCode = main();
