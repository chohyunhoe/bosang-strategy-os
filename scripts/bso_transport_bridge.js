'use strict';
// A user-configured desktop Drive folder, never a credential or arbitrary browser path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateBsoIntake } = require('../integrations/n8n/lk-bso-intake.cjs');
const ROOT = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const idOk = id => /^BSO_[A-Za-z0-9_-]{1,76}$/.test(id || '');
function folder(root = ROOT) {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.bso-transport.json'), 'utf8'));
  if (config.enabled !== true || !path.isAbsolute(config.sync_folder || '')) throw Error('TRANSPORT_NOT_CONFIGURED');
  const resolved = fs.realpathSync(config.sync_folder);
  if (!fs.statSync(resolved).isDirectory()) throw Error('SYNC_FOLDER_UNAVAILABLE');
  return resolved;
}
function readBounded(file, max = 2000000) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > max) throw Error('INVALID_TRANSPORT_FILE');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function sendJob(job, root = ROOT) {
  job = validateBsoIntake(job, sha);
  const dir = folder(root), file = path.join(dir, job.job_id + '.json');
  if (fs.existsSync(file)) {
    const old = validateBsoIntake(readBounded(file, 100000), sha);
    if (!require('node:util').isDeepStrictEqual(old, job)) throw Error('JOB_ID_COLLISION');
    return { ok: true, status: 'SYNC_FILE_PRESENT', duplicate: true, cloud_receipt_verified: false };
  }
  const temp = path.join(dir, '.' + crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temp, JSON.stringify(job, null, 2), { flag: 'wx', mode: 0o600 });
    fs.copyFileSync(temp, file, fs.constants.COPYFILE_EXCL);
  } finally { try { fs.unlinkSync(temp); } catch (_) {} }
  return { ok: true, status: 'SYNC_FILE_WRITTEN', duplicate: false, cloud_receipt_verified: false };
}
function readResult(request, root = ROOT) {
  if (!request || !idOk(request.job_id) || !/^WORK_DOC_\d+$/.test(request.document_id || '') || !Number.isSafeInteger(request.revision) || request.revision < 1 || !/^[a-f0-9]{64}$/.test(request.input_sha256 || '') || !/^[a-f0-9]{64}$/.test(request.artifact_sha256 || '')) throw Error('INVALID_RESULT_REQUEST');
  const file = path.join(folder(root), 'RESULT_' + request.job_id + '.json');
  if (!fs.existsSync(file)) return { ok: true, status: 'WAITING' };
  const source = readBounded(file), r = source?.bso_receipt, v = source?.verification;
  if (source.schema_version !== 'lk-bso-result/1.0' || !r || ['job_id', 'document_id', 'revision', 'input_sha256', 'artifact_sha256'].some(k => request[k] !== r[k]) || r.schema_version !== 'lk-bso-receipt/1.0' || r.human_approved !== false || !['NEEDS_GPT_REVIEW', 'BLOCKED'].includes(r.status) || typeof r.execution_id !== 'string' || !r.execution_id || r.execution_id.length > 128) throw Error('RESULT_CONTEXT_MISMATCH');
  if (typeof source.output !== 'string' || source.output.length > 100000 || sha(source.output) !== r.output_sha256 || v?.output_sha256_checked !== true || v.human_approved !== false || v.legal_accuracy_approved !== false || (r.status === 'BLOCKED' ? source.output !== '' : !source.output.trim() || v.provider_guard_passed !== true)) throw Error('RESULT_INTEGRITY_FAILED');
  return { ok: true, status: 'RESULT_READY', result: { schema_version: source.schema_version,
    bso_receipt: Object.fromEntries(['schema_version','job_id','document_id','revision','input_sha256','artifact_sha256','output_sha256','execution_id','status','human_approved'].map(k => [k, r[k]])),
    output: source.output, verification: { output_sha256_checked: true, provider_guard_passed: r.status === 'NEEDS_GPT_REVIEW', human_approved: false, legal_accuracy_approved: false }, evidence_source: 'SYNC_FOLDER_METADATA_NOT_AUTHENTICATED' } };
}
function allowed(req) {
  const host = req.headers.host || '';
  return /^127\.0\.0\.1:\d+$/.test(host) && (!req.headers.origin || req.headers.origin === 'http://' + host) && !['cross-site','same-site'].includes(req.headers['sec-fetch-site']) && req.headers['x-bso-transport'] === '1';
}
function handleBsoTransportRequest(req, res, pathname, root = ROOT) {
  if (!pathname.startsWith('/__bso_transport/')) return false;
  const reply = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  if (!allowed(req)) { reply(403, { ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }); return true; }
  if (pathname === '/__bso_transport/status' && req.method === 'GET') {
    try { folder(root); reply(200, { ok: true, available: true, transport: 'DESKTOP_DRIVE_SYNC', model_execution_automatic: false }); }
    catch (_) { reply(200, { ok: true, available: false, code: 'SYNC_FOLDER_UNAVAILABLE' }); }
    return true;
  }
  if (req.method !== 'POST' || !['/__bso_transport/send','/__bso_transport/result'].includes(pathname)) { reply(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }); return true; }
  if (!(req.headers['content-type'] || '').startsWith('application/json')) { reply(415, { ok: false, code: 'JSON_REQUIRED' }); return true; }
  let bytes = 0, overflow = false; const chunks = [];
  req.on('data', c => { bytes += c.length; if (bytes > 100000) overflow = true; else chunks.push(c); });
  req.on('end', () => {
    if (overflow) return reply(413, { ok: false, code: 'BODY_TOO_LARGE' });
    try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); reply(200, pathname.endsWith('/send') ? sendJob(body, root) : readResult(body, root)); }
    catch (e) { const safe = /^(BSO_|INVALID_|RESULT_|JOB_ID_COLLISION)/.test(e.message) ? e.message : 'TRANSPORT_UNAVAILABLE'; reply(422, { ok: false, code: safe }); }
  });
  return true;
}
module.exports = { sendJob, readResult, handleBsoTransportRequest };
