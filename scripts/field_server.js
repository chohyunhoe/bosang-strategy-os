'use strict';
// BSO 현장 상담 전용 최소 서버 — Fold8·PC가 같은 화면을 쓰되 API 키는 이 PC 프로세스 밖으로 나가지 않는다.
// - 제공: 현장 상담 HTML 1개 + 허용 목록 연산(status·resolve_pnu·pnu_parcel·vworld_land·parcel_map·standard_lands·standard_traits) + 항공영상 프록시(/__field/aerial).
// - standard_traits: 표준지 후보·선택 표준지의 PNU·공시연도 직접조회. 성공 응답만 이 프로세스 메모리에 캐시(재시작 시 비움).
// - 제공 안 함: Product v2·Release v1·다른 데이터 브리지(rtms·building 등)·파일 목록·정적 디렉터리.
// - 항상 루프백(127.0.0.1)에만 바인딩한다. 평문 HTTP LAN 바인딩은 없다(GPT 보안검수 2026-11-24).
//   Fold8 등 다른 기기는 Tailscale Serve(tailnet 전용 HTTPS → 127.0.0.1 프록시)로만 접속. Funnel(인터넷 공개)·포트포워딩·방화벽 변경 없음.
// - --require-token: 앱 자체 접근 토큰(이중 인증). 토큰 교환(/?t=)은 Serve를 거친 HTTPS 요청에서만 허용하고
//   쿠키는 Secure·HttpOnly·SameSite=Strict. (로컬 시험용 --allow-http-token은 루프백 직접 HTTP에서만.)
// - --allowed-login <tailnet 로그인>(반복 가능): Serve가 붙이는 Tailscale-User-Login 헤더가 목록에 없으면 403.
//   이 헤더는 루프백 프록시(Serve)를 거친 요청에서만 신뢰한다.
// - 응답: no-store·nosniff·no-referrer·CSP. 오류 메시지는 코드만. 키는 Referer와 함께 서버에서만 VWorld로 보낸다.
// - V1.0 상담기록: /__field/records*(목록·검색·재열기·저장·내보내기·백업). SQLite 파일은 이 PC의 local-data/field-server에만(gitignore).
//   같은 인증(토큰 쿠키·tailnet 허용목록) 뒤에서만 동작. 인증 만료 시 화면 요청은 /pair로 보내고, API는 401 + pair 경로를 돌려준다.
// 사용: node scripts/field_server.js --page <html> [--port 4190] [--require-token] [--allowed-login a@b] [--env <.env 경로>] [--db <sqlite 경로>]
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runWorker } = require('./public_data_bridge.js');
const { createStandardTraitsCache } = require('./standard_traits_cache.js');
const { createConsultStore, toCsv, toJson } = require('./consult_store.js');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const REQUIRE_TOKEN = process.argv.includes('--require-token');
const ALLOW_HTTP_TOKEN = process.argv.includes('--allow-http-token');
const ALLOWED_LOGINS = process.argv.flatMap((a, i) => (a === '--allowed-login' && process.argv[i + 1] ? [process.argv[i + 1].toLowerCase()] : []));
if (process.argv.includes('--lan')) { console.error('--lan(평문 HTTP LAN 바인딩)은 제거되었습니다. Tailscale Serve로 접속하세요.'); process.exit(2); }
const PORT = Number(arg('port', process.env.BSO_FIELD_PORT || 4190));
const PAGE = path.resolve(arg('page', path.join(root, 'dist', 'notice-field', 'field-empty.html')));

// .env → 이 프로세스 환경(VWORLD_*, PUBLIC_DATA_*만). 값은 출력하지 않는다.
function loadEnv(file) {
  if (!file || !fs.existsSync(file)) return [];
  const names = [];
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const s = line.trim(); if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('='); const k = s.slice(0, i).trim(); const v = s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (/^(VWORLD_|PUBLIC_DATA_)/.test(k) && !process.env[k]) { process.env[k] = v; names.push(k); }
  }
  return names;
}

const ALLOWED_OPS = new Map([['resolve_pnu', 'resolve_pnu'], ['pnu_parcel', 'pnu_parcel'], ['vworld_land', 'vworld_land'], ['parcel_map', 'parcel_map'], ['standard_lands', 'standard_lands'], ['standard_traits', 'standard_traits']]);
// 화면이 이 서버 코드의 기능을 확인하는 표지(구버전 서버 + 신버전 화면 조합을 화면에서 감지).
const SERVER_REV = 'field-server/v1.0-std-direct-records-1';
const CAPABILITIES = Object.freeze(['standard_lands', 'standard_traits', 'standard_traits_cache', 'consult_records']);
const traitsCache = createStandardTraitsCache();
const MAX_BODY = 8 * 1024;
const AERIAL = Object.freeze({ width: 1024, height: 768, minZoom: 12, maxZoom: 18, maxBytes: 6 * 1024 * 1024 });
const LIMITS = { bridge: 120, aerial: 60, records: 240 }; // 분당 요청 수(IP별)
const MAX_RECORD_BODY = 256 * 1024;
const BACKUP_INTERVAL_MS = Number(process.env.BSO_CONSULT_BACKUP_INTERVAL_MS || 6 * 3600_000);

const secret = () => process.env.VWORLD_API_KEY || '';
const referer = () => (process.env.VWORLD_DOMAIN || process.env.VWORLD_API_DOMAIN || '').trim();
const redact = (text) => { const k = secret(); let t = String(text || ''); if (k) t = t.split(k).join('[REDACTED]'); return t; };

function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
    ...extra,
  };
}
function sendJson(res, status, payload) {
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(redact(JSON.stringify(payload)));
}

// ── 접근 토큰(--require-token) ─────────────────────────────────────────────
const STATE_DIR = process.env.BSO_FIELD_STATE_DIR ? path.resolve(process.env.BSO_FIELD_STATE_DIR) : path.join(root, 'local-data', 'field-server');
const tokenFile = path.join(STATE_DIR, 'access-token.txt');
function accessToken() {
  if (!REQUIRE_TOKEN) return null;
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(24).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(tokenFile, 'utf8').trim();
}
const TOKEN = accessToken();

// ── 상담기록 로컬 DB(V1.0) ────────────────────────────────────────────────
const DB_FILE = path.resolve(arg('db', process.env.BSO_CONSULT_DB || path.join(STATE_DIR, 'consult-records.sqlite')));
let store = null;
function openStore() {
  if (store) return store;
  store = createConsultStore({ file: DB_FILE, log: (m) => console.log(m) });
  return store;
}
const storeStatus = () => (store && store.ok ? { ok: true, ...store.status() } : { ok: false, reason: store ? store.reason : 'NOT_STARTED' });
const clientCookie = (req) => (/(?:^|;\s*)bso_client=([A-Za-z0-9_-]{16,64})/.exec(req.headers.cookie || '') || [])[1] || null;
const cookieToken = (req) => (/(?:^|;\s*)bso_field=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '') || [])[1] || null;
const safeEqual = (a, b) => Boolean(a && b) && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ── 기기 페어링(--require-token): 휴대폰에서 긴 토큰 대신 PC에 표시된 6자리 코드 입력 ─────────────
// 1회용·10분 만료·실패 5회면 폐기. HTTPS(Serve) 요청에서만. 코드는 PC 로컬 파일에만 기록(채팅·로그 출력 없음).
const pairFile = path.join(STATE_DIR, 'pair-code.txt');
let pairing = null;
let lastPairIssued = 0;
function newPairCode() {
  if (!REQUIRE_TOKEN) return null;
  pairing = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'), expires: Date.now() + 10 * 60_000, failures: 0 };
  fs.mkdirSync(path.dirname(pairFile), { recursive: true });
  fs.writeFileSync(pairFile, `BSO 현장 서버 기기 페어링 코드: ${pairing.code}\n만료: ${new Date(pairing.expires).toLocaleString('ko-KR', { hour12: false })} (1회용)\n휴대폰에서 /pair 를 열고 입력하세요.\n`, { mode: 0o600 });
  return pairing;
}
const PAIR_PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BSO 현장 기기 연결</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;font-size:17px}input{font-size:28px;letter-spacing:.3em;width:8em;padding:8px}button{font-size:18px;padding:10px 18px;margin-top:12px}</style></head>
<body><h1>BSO 현장 기기 연결</h1><p>PC에 표시된 6자리 코드를 입력하세요(10분·1회용).</p>
<p style="font-size:14px;color:#555">접속 인증이 만료되면 이 화면으로 옵니다. 입력하던 상담은 이 기기에 임시 보관되어 연결 뒤 이어서 저장됩니다.<br>코드 위치: PC의 local-data\\field-server\\pair-code.txt</p>
<input id="c" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus><br><button id="b">연결</button><p id="m"></p>
<script>document.getElementById('b').onclick=async()=>{const r=await fetch('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value.trim()})});
const j=await r.json().catch(()=>({}));if(j.ok){location.replace('/');}else{document.getElementById('m').textContent=j.error_code==='PAIR_CODE_EXPIRED'?'코드가 만료되었습니다. 1분 뒤 이 화면을 새로고침하면 PC에 새 코드가 생깁니다.':'연결 실패: '+(j.error_code||r.status);}};</script></body></html>`;

// ── 속도 제한 ──────────────────────────────────────────────────────────────
const hits = new Map();
function limited(req, kind) {
  const key = `${kind}|${req.socket.remoteAddress}`; const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 60_000); arr.push(now); hits.set(key, arr);
  return arr.length > LIMITS[kind];
}

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    // 너무 크면 나머지는 버리면서 끝까지 읽고 413으로 답한다(연결을 끊지 않음).
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= max) chunks.push(c); });
    req.on('end', () => (size > max ? reject(new Error('REQUEST_TOO_LARGE')) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

// ── 항공영상 프록시: VWorld 정적 영상(PHOTO)만, 한국 범위 좌표·정해진 크기·줌만 ──────────────
function aerial(req, res, url) {
  const lon = Number(url.searchParams.get('lon')); const lat = Number(url.searchParams.get('lat')); const zoom = Number(url.searchParams.get('zoom'));
  if (!(lon >= 124 && lon <= 132 && lat >= 33 && lat <= 39.5) || !Number.isInteger(zoom) || zoom < AERIAL.minZoom || zoom > AERIAL.maxZoom) {
    return sendJson(res, 400, { ok: false, error_code: 'AERIAL_PARAMS_INVALID' });
  }
  if (!secret()) return sendJson(res, 503, { ok: false, error_code: 'VWORLD_API_KEY_MISSING' });
  const q = new URLSearchParams({ service: 'image', request: 'getmap', version: '2.0', format: 'png', basemap: 'PHOTO', crs: 'EPSG:4326',
    center: `${lon.toFixed(7)},${lat.toFixed(7)}`, zoom: String(zoom), size: `${AERIAL.width},${AERIAL.height}`, key: secret() });
  const upstream = https.get({ host: 'api.vworld.kr', path: `/req/image?${q}`, headers: { Referer: referer(), 'User-Agent': 'bso-field-server' }, timeout: 15_000 }, (up) => {
    const type = String(up.headers['content-type'] || '');
    if (up.statusCode !== 200 || !/^image\/(png|jpeg)/.test(type)) {
      up.resume();
      return sendJson(res, 502, { ok: false, error_code: 'AERIAL_UPSTREAM_REJECTED', upstream_status: up.statusCode, upstream_type: type.split(';')[0] || null });
    }
    const chunks = []; let size = 0;
    up.on('data', (c) => { size += c.length; if (size > AERIAL.maxBytes) { up.destroy(); } else chunks.push(c); });
    up.on('end', () => {
      if (size > AERIAL.maxBytes) return sendJson(res, 502, { ok: false, error_code: 'AERIAL_TOO_LARGE' });
      res.writeHead(200, securityHeaders({ 'Content-Type': type.split(';')[0], 'Content-Length': size, 'X-BSO-Aerial-Zoom': String(zoom) }));
      res.end(Buffer.concat(chunks));
    });
    up.on('error', () => sendJson(res, 502, { ok: false, error_code: 'AERIAL_UPSTREAM_ERROR' }));
  });
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => { if (!res.headersSent) sendJson(res, 504, { ok: false, error_code: 'AERIAL_UPSTREAM_TIMEOUT' }); });
  return undefined;
}

function servePage(req, res) {
  let html;
  try { html = fs.readFileSync(PAGE, 'utf8'); } catch (_e) { return sendJson(res, 500, { ok: false, error_code: 'FIELD_PAGE_MISSING' }); }
  // 이 서버를 거친 페이지에만 '전용 브리지' 표지를 넣는다(루프백이 아닌 호스트에서도 같은 출처 브리지 사용 허용).
  html = html.replace('<meta name="referrer" content="no-referrer">', '<meta name="referrer" content="no-referrer">\n  <meta name="bso-field-bridge" content="private">');
  // 기기 ID 쿠키(재접속 복원용 · 비밀 아님 · 상담 내용 없음). 없을 때만 새로 준다.
  const extra = clientCookie(req) ? {} : { 'Set-Cookie': `bso_client=${crypto.randomBytes(18).toString('base64url')}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${viaHttpsProxy(req) ? '; Secure' : ''}` };
  res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', ...extra }));
  res.end(html);
  return undefined;
}

// 루프백에서 온 요청만 프록시(Tailscale Serve) 헤더를 신뢰한다(서버가 루프백에만 바인딩되므로 모든 요청이 해당).
const isLoopbackPeer = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const viaHttpsProxy = (req) => isLoopbackPeer(req) && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
const tailnetLogin = (req) => (isLoopbackPeer(req) ? String(req.headers['tailscale-user-login'] || '').toLowerCase() || null : null);

// ── 상담기록 API ─────────────────────────────────────────────────────────
// GET  /__field/records?q=&limit=        목록·검색(최근 수정 순)
// GET  /__field/records/<id>             재열기(화면 상태 포함)
// PUT  /__field/records/<id>             자동저장 {base_rev, client_id, record}
// GET  /__field/records/export?format=csv|json[&id=]   내보내기(첨부 파일)
// POST /__field/records/backup           지금 백업(파일명만 응답, 경로·내용 없음)
// GET|PUT /__field/records/resume        이 기기(bso_client 쿠키)의 '지금 열린 상담' 조회·지정({id|null})
async function records(req, res, url) {
  const s = openStore();
  if (!s.ok) return sendJson(res, 503, { ok: false, error_code: 'CONSULT_STORE_UNAVAILABLE', reason: s.reason });
  const rest = url.pathname.slice('/__field/records'.length).replace(/^\//, '');
  const jsonBody = async () => {
    if (!/^application\/json/.test(String(req.headers['content-type'] || ''))) throw Object.assign(new Error('CONTENT_TYPE_JSON_REQUIRED'), { status: 415 });
    let raw; try { raw = await readBody(req, MAX_RECORD_BODY); } catch (e) { throw Object.assign(new Error(e.message), { status: 413 }); }
    try { const v = JSON.parse(raw || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('x'); return v; } catch (_e) { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); }
  };
  try {
    if (rest === '' && req.method === 'GET') return sendJson(res, 200, { ok: true, ...s.list({ q: url.searchParams.get('q') || '', limit: url.searchParams.get('limit') }) });
    if (rest === 'export' && req.method === 'GET') {
      const fmtName = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
      const id = url.searchParams.get('id');
      const list = id ? [s.get(id)].filter(Boolean) : s.all();
      if (id && !list.length) return sendJson(res, 404, { ok: false, error_code: 'RECORD_NOT_FOUND' });
      const day = new Date().toISOString().slice(0, 10);
      const name = id ? `상담기록_${id}.${fmtName}` : `상담기록_전체_${day}_${list.length}건.${fmtName}`;
      const body = fmtName === 'json' ? toJson(list) : toCsv(list);
      res.writeHead(200, securityHeaders({ 'Content-Type': fmtName === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="consult-records.${fmtName}"; filename*=UTF-8''${encodeURIComponent(name)}` }));
      return res.end(body);
    }
    if (rest === 'resume') {
      const cid = clientCookie(req);
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, client: Boolean(cid), record: cid ? s.getResume(cid) : null });
      if (req.method === 'PUT') { const body = await jsonBody(); if (!cid) return sendJson(res, 400, { ok: false, error_code: 'CLIENT_COOKIE_MISSING' }); const r = s.setResume(cid, body.id == null ? null : body.id); return sendJson(res, r.ok ? 200 : 400, r); }
      return sendJson(res, 405, { ok: false, error_code: 'METHOD_NOT_ALLOWED' });
    }
    if (rest === 'backup' && req.method === 'POST') {
      await jsonBody();
      const r = s.backup('manual');
      return sendJson(res, r.ok ? 200 : 500, r);
    }
    if (rest && rest !== 'export' && rest !== 'backup') {
      if (req.method === 'GET') { const r = s.get(rest); return r ? sendJson(res, 200, { ok: true, record: r, revisions: s.revisions(rest) }) : sendJson(res, 404, { ok: false, error_code: 'RECORD_NOT_FOUND' }); }
      if (req.method === 'PUT') {
        const body = await jsonBody();
        const r = s.save(rest, body.record, { baseRev: body.base_rev, clientId: clientCookie(req) });
        const { status, ...out } = r;
        return sendJson(res, status, out);
      }
    }
    return sendJson(res, 405, { ok: false, error_code: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    return sendJson(res, e.status || 500, { ok: false, error_code: e.status ? e.message : 'RECORD_ROUTE_FAILED' });
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://field.local');
  if (ALLOWED_LOGINS.length) {
    const login = tailnetLogin(req);
    if (!login || !ALLOWED_LOGINS.includes(login)) return sendJson(res, 403, { ok: false, error_code: 'FIELD_TAILNET_LOGIN_NOT_ALLOWED' });
  }
  if (REQUIRE_TOKEN && url.pathname === '/pair') {
    if (!viaHttpsProxy(req) && !ALLOW_HTTP_TOKEN) return sendJson(res, 403, { ok: false, error_code: 'FIELD_TOKEN_EXCHANGE_HTTPS_ONLY' });
    if (req.method === 'GET') {
      // 인증 만료로 넘어온 기기: 쓸 수 있는 코드가 없으면 새 코드를 PC 파일에만 쓴다(1분에 한 번까지).
      if ((!pairing || Date.now() > pairing.expires) && Date.now() - lastPairIssued > 60_000) { newPairCode(); lastPairIssued = Date.now(); }
      res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' })); return res.end(PAIR_PAGE);
    }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error_code: 'METHOD_NOT_ALLOWED' });
    if (limited(req, 'bridge')) return sendJson(res, 429, { ok: false, error_code: 'RATE_LIMITED' });
    let code = '';
    try { code = String(JSON.parse((await readBody(req)) || '{}').code || ''); } catch (_e) { return sendJson(res, 400, { ok: false, error_code: 'INVALID_JSON' }); }
    if (!pairing || Date.now() > pairing.expires) return sendJson(res, 410, { ok: false, error_code: 'PAIR_CODE_EXPIRED' });
    if (!/^\d{6}$/.test(code) || !safeEqual(code, pairing.code)) {
      pairing.failures += 1;
      if (pairing.failures >= 5) { pairing = null; try { fs.writeFileSync(pairFile, '페어링 코드 폐기(실패 5회). 서버를 다시 시작하면 새 코드가 생깁니다.\n'); } catch (_e) { /* ignore */ } }
      return sendJson(res, 401, { ok: false, error_code: 'PAIR_CODE_INVALID' });
    }
    pairing = null; // 1회용
    try { fs.writeFileSync(pairFile, '페어링 코드 사용됨. 다른 기기를 연결하려면 서버를 다시 시작하세요.\n'); } catch (_e) { /* ignore */ }
    res.writeHead(200, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `bso_field=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${viaHttpsProxy(req) ? '; Secure' : ''}` }));
    return res.end(JSON.stringify({ ok: true }));
  }
  if (REQUIRE_TOKEN) {
    const t = url.searchParams.get('t');
    if (url.pathname === '/' && t) {
      const https = viaHttpsProxy(req);
      if (!https && !ALLOW_HTTP_TOKEN) return sendJson(res, 403, { ok: false, error_code: 'FIELD_TOKEN_EXCHANGE_HTTPS_ONLY' });
      if (!safeEqual(t, TOKEN)) return sendJson(res, 401, { ok: false, error_code: 'FIELD_ACCESS_TOKEN_REQUIRED' });
      res.writeHead(303, securityHeaders({ Location: '/', 'Set-Cookie': `bso_field=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${https ? '; Secure' : ''}` }));
      return res.end();
    }
    if (!safeEqual(cookieToken(req), TOKEN)) {
      // 화면 요청(브라우저 주소창·새로고침)은 페어링 화면으로 자연스럽게 보낸다. API는 401 + pair 경로.
      const canPair = viaHttpsProxy(req) || ALLOW_HTTP_TOKEN;
      if (canPair && req.method === 'GET' && (url.pathname === '/' || url.pathname === '/field.html') && /text\/html/.test(String(req.headers.accept || ''))) {
        res.writeHead(303, securityHeaders({ Location: '/pair' })); return res.end();
      }
      return sendJson(res, 401, { ok: false, error_code: 'FIELD_ACCESS_TOKEN_REQUIRED', ...(canPair ? { pair: '/pair' } : {}) });
    }
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/field.html')) return servePage(req, res);
  if (req.method === 'GET' && url.pathname === '/__field/aerial') {
    if (limited(req, 'aerial')) return sendJson(res, 429, { ok: false, error_code: 'RATE_LIMITED' });
    return aerial(req, res, url);
  }
  if (url.pathname === '/__field/records' || url.pathname.startsWith('/__field/records/')) {
    if (limited(req, 'records')) return sendJson(res, 429, { ok: false, error_code: 'RATE_LIMITED' });
    return records(req, res, url);
  }
  if (url.pathname.startsWith('/__public_data_bridge/')) {
    if (limited(req, 'bridge')) return sendJson(res, 429, { ok: false, error_code: 'RATE_LIMITED' });
    const op = url.pathname.slice('/__public_data_bridge/'.length);
    if (op === 'status' && req.method === 'GET') {
      const r = await runWorker({ operation: 'status' });
      return sendJson(res, r.ok ? 200 : 503, { ok: Boolean(r.ok), vworld_configured: Boolean(r.vworld_configured), public_data_configured: Boolean(r.public_data_configured), aerial: Boolean(secret()), server: 'bso-field-minimal',
        server_rev: SERVER_REV, capabilities: CAPABILITIES.filter((c) => c !== 'consult_records' || storeStatus().ok), standard_traits_metrics: { ...traitsCache.metrics, cached: traitsCache.size() },
        consult_store: storeStatus().ok ? { ok: true, records: storeStatus().records, last_backup: storeStatus().last_backup, restored_from: storeStatus().restored_from } : { ok: false, reason: storeStatus().reason } });
    }
    if (!ALLOWED_OPS.has(op) || req.method !== 'POST') return sendJson(res, 404, { ok: false, error_code: 'FIELD_ROUTE_NOT_ALLOWED' });
    let payload;
    try { payload = JSON.parse((await readBody(req)) || '{}'); } catch (e) {
      return sendJson(res, e.message === 'REQUEST_TOO_LARGE' ? 413 : 400, { ok: false, error_code: e.message === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendJson(res, 400, { ok: false, error_code: 'INVALID_JSON' });
    if (op === 'standard_traits') { // 같은 PNU·연도 성공 응답은 서버 메모리 캐시로 재사용, 나머지만 워커로
      const r = await traitsCache.handle(payload, runWorker);
      return sendJson(res, r.ok ? 200 : 422, r);
    }
    const r = await runWorker({ ...payload, operation: ALLOWED_OPS.get(op) });
    return sendJson(res, r.ok ? 200 : 422, r);
  }
  return sendJson(res, 404, { ok: false, error_code: 'NOT_FOUND' });
}

function start() {
  const loaded = loadEnv(arg('env', path.join(root, '.env')));
  const s = openStore();
  if (s.ok) {
    const st0 = s.status();
    if (st0.records) { const b = s.backup('start'); console.log(`consult records: ${st0.records} · start backup ${b.ok ? b.file : `FAILED(${b.error_code})`}`); }
    else console.log('consult records: 0 (new DB)');
    if (st0.restored_from) console.log(`consult records: DB was damaged — auto-restored from ${st0.restored_from}`);
    const timer = setInterval(() => { try { const b = s.backupIfChanged('auto'); if (b.file) console.log(`consult records: auto backup ${b.file}`); } catch (_e) { console.log('consult records: auto backup FAILED'); } }, BACKUP_INTERVAL_MS);
    timer.unref();
    const stop = () => { try { const b = s.backupIfChanged('stop'); if (b.file) console.log(`consult records: stop backup ${b.file}`); } catch (_e) { /* ignore */ } s.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } else console.log(`consult records: UNAVAILABLE (${s.reason}) — Node 22.13+ 필요. 상담 화면은 자동저장 불가 경고를 표시합니다.`);
  const host = '127.0.0.1'; // 루프백 고정. 다른 기기는 Tailscale Serve로만.
  const server = http.createServer((req, res) => { route(req, res).catch(() => { if (!res.headersSent) sendJson(res, 500, { ok: false, error_code: 'FIELD_SERVER_INTERNAL' }); }); });
  server.listen(PORT, host, () => {
    console.log(`BSO field server: http://127.0.0.1:${PORT}/  (page: ${path.relative(root, PAGE)})`);
    if (s.ok) console.log(`consult DB: ${path.relative(root, DB_FILE) || DB_FILE} (local only · do not commit)`);
    console.log(`env vars loaded: ${loaded.length ? loaded.join(', ') : '(none, using process env)'} · values not printed`);
    if (REQUIRE_TOKEN) { newPairCode(); console.log(`device pairing: open /pair on the phone; 6-digit code in ${path.relative(root, pairFile)} (10 min, single use)`); }
    if (REQUIRE_TOKEN) console.log(`access token required (exchange over HTTPS only${ALLOW_HTTP_TOKEN ? '; local HTTP exchange allowed for testing' : ''}). Token file: ${path.relative(root, tokenFile)}`);
    if (ALLOWED_LOGINS.length) console.log(`tailnet login allowlist: ${ALLOWED_LOGINS.length} account(s)`);
  });
  return server;
}

if (require.main === module) start();
module.exports = { start, ALLOWED_OPS, AERIAL, SERVER_REV, CAPABILITIES };
