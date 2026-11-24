'use strict';
// BSO 현장 상담 전용 최소 서버 — Fold8·PC가 같은 화면을 쓰되 API 키는 이 PC 프로세스 밖으로 나가지 않는다.
// - 제공: 현장 상담 HTML 1개 + 허용 목록 연산(status·resolve_pnu·pnu_parcel·vworld_land·parcel_map) + 항공영상 프록시(/__field/aerial).
// - 제공 안 함: Product v2·Release v1·다른 데이터 브리지(rtms·building 등)·파일 목록·정적 디렉터리.
// - 기본은 127.0.0.1 전용. --lan이면 같은 네트워크 기기(Fold8)가 접속할 수 있고, 이때는 접근 토큰 쿠키가 필수.
//   (공개 터널·포트포워딩·방화벽 변경은 하지 않는다. 사외 접속은 승인 후 Tailscale Serve(비공개) 같은 별도 경로로.)
// - 응답: no-store·nosniff·no-referrer·CSP. 오류 메시지는 코드만. 키는 Referer와 함께 서버에서만 VWorld로 보낸다.
// 사용: node scripts/field_server.js --page dist/notice-field/field-empty.html [--port 4190] [--lan] [--env <.env 경로>]
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runWorker } = require('./public_data_bridge.js');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const LAN = process.argv.includes('--lan');
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

// ── 접근 토큰(LAN 모드) ──────────────────────────────────────────────────────
const tokenFile = path.join(root, 'local-data', 'field-server', 'access-token.txt');
function accessToken() {
  if (!LAN) return null;
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(24).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(tokenFile, 'utf8').trim();
}
const TOKEN = accessToken();
const cookieToken = (req) => (/(?:^|;\s*)bso_field=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '') || [])[1] || null;
const safeEqual = (a, b) => Boolean(a && b) && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

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

async function route(req, res) {
  const url = new URL(req.url, 'http://field.local');
  if (LAN) {
    const t = url.searchParams.get('t');
    if (url.pathname === '/' && t && safeEqual(t, TOKEN)) {
      res.writeHead(303, securityHeaders({ Location: '/', 'Set-Cookie': `bso_field=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` }));
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
  // --bind로 주소를 고정할 수 있다(테스트: --lan --bind 127.0.0.1 → 토큰 검사만 켜고 외부 노출 없음).
  const host = arg('bind', LAN ? '0.0.0.0' : '127.0.0.1');
  const server = http.createServer((req, res) => { route(req, res).catch(() => { if (!res.headersSent) sendJson(res, 500, { ok: false, error_code: 'FIELD_SERVER_INTERNAL' }); }); });
  server.listen(PORT, host, () => {
    console.log(`BSO field server: http://${LAN ? '<이 PC의 LAN 주소>' : '127.0.0.1'}:${PORT}/  (page: ${path.relative(root, PAGE)})`);
    console.log(`env vars loaded: ${loaded.length ? loaded.join(', ') : '(none, using process env)'} · values not printed`);
    if (LAN) console.log(`LAN mode: access token required. Open http://<LAN 주소>:${PORT}/?t=<token> once on Fold8. Token file: ${path.relative(root, tokenFile)}`);
  });
  return server;
}

if (require.main === module) start();
module.exports = { start, ALLOWED_OPS, AERIAL };
