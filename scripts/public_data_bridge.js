'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

const PREFIX = '/__public_data_bridge';
const MAX_BODY = 2 * 1024 * 1024;
const WORKER = path.resolve(__dirname, 'public_data_bridge.py');
const WORKER_TIMEOUT_MS = 120_000;
const WORKER_BUFFER_BYTES = 8 * 1024 * 1024;

const POST_OPERATIONS = new Map([
  [`${PREFIX}/legal_dong`, 'legal_dong'],
  [`${PREFIX}/resolve_pnu`, 'resolve_pnu'],
  [`${PREFIX}/vworld_land`, 'vworld_land'],
  [`${PREFIX}/field_candidates`, 'field_candidates'],
  [`${PREFIX}/early_signals`, 'early_signals'],
  [`${PREFIX}/rtms`, 'rtms'],
  [`${PREFIX}/building`, 'building'],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) {
        reject(new Error('REQUEST_TOO_LARGE'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function runWorker(payload) {
  return new Promise((resolve) => {
    const python = process.env.PYTHON || process.env.PYTHON3 || 'python';
    const child = execFile(python, [WORKER], {
      cwd: path.resolve(__dirname, '..'),
      timeout: WORKER_TIMEOUT_MS,
      maxBuffer: WORKER_BUFFER_BYTES,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      windowsHide: true,
    }, (error, stdout) => {
      const raw = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (_parseError) {
        resolve({
          ok: false,
          error_code: error?.killed ? 'PUBLIC_DATA_TIMEOUT' : 'PUBLIC_DATA_BRIDGE_FAILED',
        });
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function handle(request, response, pathname) {
  if (pathname === `${PREFIX}/status` && request.method === 'GET') {
    const result = await runWorker({ operation: 'status' });
    sendJson(response, result.ok ? 200 : 503, result);
    return;
  }

  const operation = POST_OPERATIONS.get(pathname) || '';
  if (!operation || request.method !== 'POST') {
    sendJson(response, 404, { ok: false, error_code: 'PUBLIC_DATA_ROUTE_NOT_FOUND' });
    return;
  }
  try {
    const raw = await readBody(request);
    const payload = raw ? JSON.parse(raw) : {};
    const result = await runWorker({ ...payload, operation });
    sendJson(response, result.ok ? 200 : 422, result);
  } catch (error) {
    const code = error?.message === 'REQUEST_TOO_LARGE' ? 413 : 400;
    sendJson(response, code, {
      ok: false,
      error_code: error?.message === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON',
    });
  }
}

function handlePublicDataBridgeRequest(request, response, pathname) {
  if (!String(pathname || '').startsWith(PREFIX)) return false;
  handle(request, response, pathname).catch(() => sendJson(response, 500, { ok: false, error_code: 'PUBLIC_DATA_BRIDGE_INTERNAL' }));
  return true;
}

module.exports = { PREFIX, POST_OPERATIONS, handlePublicDataBridgeRequest };
