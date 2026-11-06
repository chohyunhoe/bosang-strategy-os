'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { handleOutputBridgeRequest } = require('./output_bridge.js');
const { handlePublicDataBridgeRequest } = require('./public_data_bridge.js');
const { handleMapBridgeRequest } = require('./map_bridge.js');
const { handleBsoTransportRequest } = require('./bso_transport_bridge.js');

const root = path.resolve(process.argv[2] || 'dist/product-v2-candidate');
const port = Number(process.argv[3] || process.env.BSO_V2_PORT || 4174);
const host = '127.0.0.1';
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.gz': 'application/gzip',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

function staticRequest(request, response, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch (_) { response.writeHead(400); response.end('bad request'); return; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('forbidden'); return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('not found'); return;
  }
  response.writeHead(200, {
    'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  let url;
  try { url = new URL(request.url || '/', `http://${host}:${port}`); }
  catch (_error) { response.writeHead(400); response.end('bad request'); return; }
  if (handleOutputBridgeRequest(request, response, url.pathname)) return;
  if (handlePublicDataBridgeRequest(request, response, url.pathname)) return;
  if (handleMapBridgeRequest(request, response, url.pathname)) return;
  if (handleBsoTransportRequest(request, response, url.pathname)) return;
  if (!['GET','HEAD'].includes(request.method || 'GET')) { response.writeHead(405); response.end('method not allowed'); return; }
  staticRequest(request, response, url.pathname);
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? 'BSO port is already in use. Close the previous BSO window or start with -Port 4175.' : 'BSO server could not start: ' + error.code);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  if (process.env.BSO_OPEN_BROWSER === '1' && process.platform === 'win32') {
    require('node:child_process').execFile('rundll32.exe', ['url.dll,FileProtocolHandler', 'http://' + host + ':' + port + '/'], { windowsHide:true }, () => {});
  }
  console.log(`Product v2 local server: http://${host}:${port}`);
  console.log('Loopback only. API keys, local cadastral archives, QGIS paths, and case source documents are never bundled into the browser candidate.');
});
