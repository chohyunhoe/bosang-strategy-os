'use strict';
// BSO 현장 상담 전용 최소 서버 — Fold8·PC가 같은 화면을 쓰되 API 키는 이 PC 프로세스 밖으로 나가지 않는다.
// - 제공: 현장 상담 HTML 1개 + 허용 목록 연산(status·resolve_pnu·pnu_parcel·vworld_land·parcel_map) + 항공영상 프록시(/__field/aerial).
// - 제공 안 함: Product v2·Release v1·다른 데이터 브리지(rtms·building 등)·파일 목록·정적 디렉터리.
// - 항상 루프백(127.0.0.1)에만 바인딩한다. 평문 HTTP LAN 바인딩은 없다(GPT 보안검수 2026-11-24).
//   Fold8 등 다른 기기는 Tailscale Serve(tailnet 전용 HTTPS → 127.0.0.1 프록시)로만 접속. Funnel(인터넷 공개)·포트포워딩·방화벽 변경 없음.
// - --require-token: 앱 자체 접근 토큰(이중 인증). 토큰 교환(/?t=)은 Serve를 거친 HTTPS 요청에서만 허용하고
//   쿠키는 Secure·HttpOnly·SameSite=Strict. (로컬 시험용 --allow-http-token은 루프백 직접 HTTP에서만.)
// - --allowed-login <tailnet 로그인>(반복 가능): Serve가 붙이는 Tailscale-User-Login 헤더가 목록에 없으면 403.
//   이 헤더는 루프백 프록시(Serve)를 거친 요청에서만 신뢰한다.
// - 응답: no-store·nosniff·no-referrer·CSP. 오류 메시지는 코드만. 키는 Referer와 함께 서버에서만 VWorld로 보낸다.
// 사용: node scripts/field_server.js --page <html> [--port 4190] [--require-token] [--allowed-login a@b] [--env <.env 경로>]
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runWorker } = require('./public_data_bridge.js');

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

const ALLOWED_OPS = new Map([['resolve_pnu', 'resolve_pnu'], ['pnu_parcel', 'pnu_parcel'], ['vworld_land', 'vworld_land'], ['parcel_map', 'parcel_map']]);
const MAX_BODY = 8 * 1024;
const AERIAL = Object.freeze({ width: 1024, height: 768, minZoom: 12, maxZoom: 18, maxBytes: 6 * 1024 * 1024 });
const LIMITS = { bridge: 120, aerial: 60 }; // 분당 요청 수(IP별)

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
const cookieToken = (req) => (/(?:^|;\s*)bso_field=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '') || [])[1] || null;
const safeEqual = (a, b) => Boolean(a && b) && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ── 기기 페어링(--require-token): 휴대폰에서 긴 토큰 대신 PC에 표시된 6자리 코드 입력 ─────────────
// 1회용·10분 만료·실패 5회면 폐기. HTTPS(Serve) 요청에서만. 코드는 PC 로컬 파일에만 기록(채팅·로그 출력 없음).
const pairFile = path.join(STATE_DIR, 'pair-code.txt');
let pairing = null;
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
<input id="c" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus><br><button id="b">연결</button><p id="m"></p>
<script>document.getElementById('b').onclick=async()=>{const r=await fetch('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value.trim()})});
const j=await r.json().catch(()=>({}));if(j.ok){location.replace('/');}else{document.getElementById('m').textContent='연결 실패: '+(j.error_code||r.status);}};</script></body></html>`;

// ── 속도 제한 ──────────────────────────────────────────────────────────────
const hits = new Map();
function limited(req, kind) {
  const key = `${kind}|${req.socket.remoteAddress}`; const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 60_000); arr.push(now); hits.set(key, arr);
  return arr.length > LIMITS[kind];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // 너무 크면 나머지는 버리면서 끝까지 읽고 413으로 답한다(연결을 끊지 않음).
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
    req.on('end', () => (size > MAX_BODY ? reject(new Error('REQUEST_TOO_LARGE')) : resolve(Buffer.concat(chunks).toString('utf8'))));
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

function servePage(res) {
  let html;
  try { html = fs.readFileSync(PAGE, 'utf8'); } catch (_e) { return sendJson(res, 500, { ok: false, error_code: 'FIELD_PAGE_MISSING' }); }
  // 이 서버를 거친 페이지에만 '전용 브리지' 표지를 넣는다(루프백이 아닌 호스트에서도 같은 출처 브리지 사용 허용).
  html = html.replace('<meta name="referrer" content="no-referrer">', '<meta name="referrer" content="no-referrer">\n  <meta name="bso-field-bridge" content="private">');
  res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
  res.end(html);
  return undefined;
}

// 루프백에서 온 요청만 프록시(Tailscale Serve) 헤더를 신뢰한다(서버가 루프백에만 바인딩되므로 모든 요청이 해당).
const isLoopbackPeer = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const viaHttpsProxy = (req) => isLoopbackPeer(req) && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
const tailnetLogin = (req) => (isLoopbackPeer(req) ? String(req.headers['tailscale-user-login'] || '').toLowerCase() || null : null);

async function route(req, res) {
  const url = new URL(req.url, 'http://field.local');
  if (ALLOWED_LOGINS.length) {
    const login = tailnetLogin(req);
    if (!login || !ALLOWED_LOGINS.includes(login)) return sendJson(res, 403, { ok: false, error_code: 'FIELD_TAILNET_LOGIN_NOT_ALLOWED' });
  }
  if (REQUIRE_TOKEN && url.pathname === '/pair') {
    if (!viaHttpsProxy(req) && !ALLOW_HTTP_TOKEN) return sendJson(res, 403, { ok: false, error_code: 'FIELD_TOKEN_EXCHANGE_HTTPS_ONLY' });
    if (req.method === 'GET') { res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' })); return res.end(PAIR_PAGE); }
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
    if (!safeEqual(cookieToken(req), TOKEN)) return sendJson(res, 401, { ok: false, error_code: 'FIELD_ACCESS_TOKEN_REQUIRED' });
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/field.html')) return servePage(res);
  if (req.method === 'GET' && url.pathname === '/__field/aerial') {
    if (limited(req, 'aerial')) return sendJson(res, 429, { ok: false, error_code: 'RATE_LIMITED' });
    return aerial(req, res, url);
  }
  if (url.pathname.startsWith('/__public_data_bridge/')) {
    if (limited(req, 'bridge')) return sendJson(res, 429, { ok: false, error_code: 'RATE_LIMITED' });
    const op = url.pathname.slice('/__public_data_bridge/'.length);
    if (op === 'status' && req.method === 'GET') {
      const r = await runWorker({ operation: 'status' });
      return sendJson(res, r.ok ? 200 : 503, { ok: Boolean(r.ok), vworld_configured: Boolean(r.vworld_configured), public_data_configured: Boolean(r.public_data_configured), aerial: Boolean(secret()), server: 'bso-field-minimal' });
    }
    if (!ALLOWED_OPS.has(op) || req.method !== 'POST') return sendJson(res, 404, { ok: false, error_code: 'FIELD_ROUTE_NOT_ALLOWED' });
    let payload;
    try { payload = JSON.parse((await readBody(req)) || '{}'); } catch (e) {
      return sendJson(res, e.message === 'REQUEST_TOO_LARGE' ? 413 : 400, { ok: false, error_code: e.message === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendJson(res, 400, { ok: false, error_code: 'INVALID_JSON' });
    const r = await runWorker({ ...payload, operation: ALLOWED_OPS.get(op) });
    return sendJson(res, r.ok ? 200 : 422, r);
  }
  return sendJson(res, 404, { ok: false, error_code: 'NOT_FOUND' });
}

function start() {
  const loaded = loadEnv(arg('env', path.join(root, '.env')));
  const host = '127.0.0.1'; // 루프백 고정. 다른 기기는 Tailscale Serve로만.
  const server = http.createServer((req, res) => { route(req, res).catch(() => { if (!res.headersSent) sendJson(res, 500, { ok: false, error_code: 'FIELD_SERVER_INTERNAL' }); }); });
  server.listen(PORT, host, () => {
    console.log(`BSO field server: http://127.0.0.1:${PORT}/  (page: ${path.relative(root, PAGE)})`);
    console.log(`env vars loaded: ${loaded.length ? loaded.join(', ') : '(none, using process env)'} · values not printed`);
    if (REQUIRE_TOKEN) { newPairCode(); console.log(`device pairing: open /pair on the phone; 6-digit code in ${path.relative(root, pairFile)} (10 min, single use)`); }
    if (REQUIRE_TOKEN) console.log(`access token required (exchange over HTTPS only${ALLOW_HTTP_TOKEN ? '; local HTTP exchange allowed for testing' : ''}). Token file: ${path.relative(root, tokenFile)}`);
    if (ALLOWED_LOGINS.length) console.log(`tailnet login allowlist: ${ALLOWED_LOGINS.length} account(s)`);
  });
  return server;
}

if (require.main === module) start();
module.exports = { start, ALLOWED_OPS, AERIAL };
