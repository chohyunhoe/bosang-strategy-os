'use strict';

// 로컬 출력 브리지.
//
// 브라우저가 들고 있는 현재 사건 데이터를 받아 이미 구현된 문서 산출 계층으로 넘기고,
// 만들어진 DOCX 를 그대로 돌려준다. 사용자가 터미널 명령을 입력하지 않게 하는 배선이며
// 새 분석·새 판단을 추가하지 않는다.
//
// 경계
// - 127.0.0.1 서버에만 붙는다(serve_static.js 가 loopback 에만 bind 한다).
// - 외부로 아무것도 보내지 않는다. 네트워크 호출이 없다.
// - 입력은 읽기 전용으로 임시파일에 옮겼다가 응답 후 반드시 지운다.
// - 저장소 안에는 사건 데이터를 쓰지 않는다(OS 임시폴더만 사용).

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE_PREFIX = '/__output_bridge';
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const GENERATE_TIMEOUT_MS = 180000;

// 파이썬 산출 계층이 필요로 하는 것들. 하나라도 없으면 UI 에 "생성 불가"로 정직하게 보고한다.
const PYTHON_CANDIDATES = [
  ...[process.env.BSO_PYTHON, process.env.PYTHON, process.env.PYTHON3].filter(Boolean).map((command) => ({ command, args: [] })),
  { command: 'python', args: [] },
  { command: 'python3', args: [] },
  { command: 'py', args: ['-3'] },
];

let cachedInterpreter;

// 산출 형식마다 필요한 구성요소가 다르다. 하나가 빠졌다고 나머지 버튼까지 죽이지 않는다.
const CAPABILITY_PROBE = [
  'import json',
  'caps = {}',
  'try:',
  '    import pydantic',
  '    caps["core"] = True',
  'except Exception:',
  '    caps["core"] = False',
  'try:',
  '    import docx',
  '    caps["docx"] = True',
  'except Exception:',
  '    caps["docx"] = False',
  'try:',
  '    import openpyxl',
  '    caps["xlsx"] = True',
  'except Exception:',
  '    caps["xlsx"] = False',
  'print(json.dumps(caps))',
].join('\n');

function probeInterpreter(candidate) {
  const probe = spawnSync(
    candidate.command,
    [...candidate.args, '-c', CAPABILITY_PROBE],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  if (probe.status !== 0) return null;
  try {
    const capabilities = JSON.parse(String(probe.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop());
    return capabilities && capabilities.core ? { ...candidate, capabilities } : null;
  } catch (error) {
    return null;
  }
}

function resolveInterpreter() {
  if (cachedInterpreter !== undefined) return cachedInterpreter;
  cachedInterpreter = null;
  for (const candidate of PYTHON_CANDIDATES) {
    let resolved = null;
    try {
      resolved = probeInterpreter(candidate);
    } catch (error) {
      resolved = null;
    }
    if (resolved) {
      cachedInterpreter = resolved;
      break;
    }
  }
  return cachedInterpreter;
}

function bridgeStatus() {
  const interpreter = resolveInterpreter();
  const templateSource = fs.existsSync(path.join(ROOT, 'brief_output', 'docx_template.py'));
  if (!interpreter) {
    return {
      ok: false,
      available: false,
      formats: [],
      reason: 'LOCAL_REPORT_TOOL_UNAVAILABLE',
      message: '로컬 문서 생성 도구를 사용할 수 없습니다. BSO 실행기로 시작했는지 확인하세요.',
      // 기술 원인은 UI 에 노출하지 않는다. 실행 창·기록 확인용.
      technical_hint: 'Python 3 with pydantic was not found on PATH (set BSO_PYTHON to override).',
    };
  }
  const docx = Boolean(interpreter.capabilities.docx) && templateSource;
  const xlsx = Boolean(interpreter.capabilities.xlsx);
  const formats = [...(docx ? ['DOCX'] : []), ...(xlsx ? ['XLSX'] : []), 'CSV'];
  if (!docx) {
    return {
      ok: false,
      available: false,
      formats,
      reason: templateSource ? 'LOCAL_REPORT_TOOL_UNAVAILABLE' : 'REPORT_TEMPLATE_MISSING',
      message: '분석보고서 생성 구성요소를 사용할 수 없습니다. BSO 실행기로 시작했는지 확인하세요.',
      technical_hint: templateSource ? 'python-docx is not installed.' : 'brief_output/docx_template.py is missing.',
    };
  }
  return { ok: true, available: true, formats };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('INVALID_JSON'));
      }
    });
  });
}

function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    // 임시파일 정리 실패가 응답을 막지 않게 한다. 다음 실행에서 새 폴더를 쓴다.
  }
}

// 사건 데이터가 담긴 임시 폴더. 성공·실패·예외 어느 경로로 끝나도 반드시 지운다.
function withTemporaryWorkspace(handler) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bso-output-bridge-'));
  try {
    return handler(workspace);
  } finally {
    removeQuietly(workspace);
  }
}

function generateAnalysisReport(caseData) {
  const interpreter = resolveInterpreter();
  if (!interpreter) return { ok: false, error_code: 'LOCAL_REPORT_TOOL_UNAVAILABLE' };
  if (!caseData || typeof caseData !== 'object' || Array.isArray(caseData)) {
    return { ok: false, error_code: 'INVALID_CASE_DATA' };
  }

  return withTemporaryWorkspace((workspace) => {
    const casePath = path.join(workspace, 'case.json');
    const outDir = path.join(workspace, 'out');
    fs.writeFileSync(casePath, JSON.stringify(caseData), 'utf8');

    const result = spawnSync(
      interpreter.command,
      [...interpreter.args, '-X', 'utf8', '-m', 'brief_output.bridge_entry', casePath, outDir],
      { cwd: ROOT, encoding: 'utf8', timeout: GENERATE_TIMEOUT_MS, windowsHide: true },
    );

    const lastLine = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
    let summary = null;
    try {
      summary = lastLine ? JSON.parse(lastLine) : null;
    } catch (error) {
      summary = null;
    }
    if (!summary) {
      return { ok: false, error_code: 'GENERATION_FAILED', message: '문서 생성 도구가 결과를 반환하지 않았습니다.' };
    }
    if (!summary.ok) return summary;

    const docxPath = String(summary.docx_path || '');
    if (!docxPath || !fs.existsSync(docxPath)) {
      return { ok: false, error_code: 'GENERATION_FAILED', message: '생성된 문서 파일을 찾지 못했습니다.' };
    }
    const bytes = fs.readFileSync(docxPath);
    const { docx_path: _discarded, ...rest } = summary;
    return {
      ...rest,
      file_name: `${summary.file_stem || 'analysis-report'}.docx`,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byte_length: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      docx_base64: bytes.toString('base64'),
    };
  });
}

// 수치 비교표. 분석보고서와 같은 어댑터·QA 계층을 지나온 결과를 표 파일로 받는다.
function generateNumericTable(caseData, requestedFormats) {
  const interpreter = resolveInterpreter();
  if (!interpreter) return { ok: false, error_code: 'LOCAL_REPORT_TOOL_UNAVAILABLE' };
  if (!caseData || typeof caseData !== 'object' || Array.isArray(caseData)) {
    return { ok: false, error_code: 'INVALID_CASE_DATA' };
  }

  const asked = Array.isArray(requestedFormats) && requestedFormats.length
    ? requestedFormats.map((item) => String(item).toLowerCase())
    : ['xlsx', 'csv'];
  const formats = asked.filter((item) => (item === 'xlsx' ? Boolean(interpreter.capabilities.xlsx) : item === 'csv'));
  if (!formats.length) {
    return { ok: false, error_code: 'FORMAT_UNAVAILABLE', message: '요청한 파일 형식을 이 환경에서 만들 수 없습니다.' };
  }

  return withTemporaryWorkspace((workspace) => {
    const casePath = path.join(workspace, 'case.json');
    const outDir = path.join(workspace, 'out');
    fs.writeFileSync(casePath, JSON.stringify(caseData), 'utf8');

    const result = spawnSync(
      interpreter.command,
      [...interpreter.args, '-X', 'utf8', '-m', 'brief_output.numeric_table_entry', casePath, outDir, formats.join(',')],
      { cwd: ROOT, encoding: 'utf8', timeout: GENERATE_TIMEOUT_MS, windowsHide: true },
    );

    const lastLine = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
    let summary = null;
    try {
      summary = lastLine ? JSON.parse(lastLine) : null;
    } catch (error) {
      summary = null;
    }
    if (!summary) {
      return { ok: false, error_code: 'GENERATION_FAILED', message: '표 생성 도구가 결과를 반환하지 않았습니다.' };
    }
    if (!summary.ok) return summary;

    // 임시 경로는 브라우저로 넘기지 않는다.
    const { xlsx_path: xlsxPath, csv_path: csvPath, ...rest } = summary;
    const payload = { ...rest, files: [] };
    for (const [format, filePath, contentType] of [
      ['xlsx', xlsxPath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['csv', csvPath, 'text/csv; charset=utf-8'],
    ]) {
      if (!filePath || !fs.existsSync(filePath)) continue;
      const bytes = fs.readFileSync(filePath);
      payload.files.push({
        format: format.toUpperCase(),
        file_name: `${summary.file_stem || 'numeric-table'}.${format}`,
        content_type: contentType,
        byte_length: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        base64: bytes.toString('base64'),
      });
    }
    if (!payload.files.length) {
      return { ok: false, error_code: 'GENERATION_FAILED', message: '생성된 표 파일을 찾지 못했습니다.' };
    }
    return payload;
  });
}

// 재결·이의 의견서 작성자료. 지도는 브라우저가 이미 만든 이미지를 그대로 받아 넣는다.
function generateOpinionPackage(caseData, mapPngBase64, mapPngItems = []) {
  const interpreter = resolveInterpreter();
  if (!interpreter) return { ok: false, error_code: 'LOCAL_REPORT_TOOL_UNAVAILABLE' };
  if (!interpreter.capabilities.docx) return { ok: false, error_code: 'FORMAT_UNAVAILABLE' };
  if (!caseData || typeof caseData !== 'object' || Array.isArray(caseData)) {
    return { ok: false, error_code: 'INVALID_CASE_DATA' };
  }

  return withTemporaryWorkspace((workspace) => {
    const casePath = path.join(workspace, 'case.json');
    const outDir = path.join(workspace, 'out');
    fs.writeFileSync(casePath, JSON.stringify(caseData), 'utf8');

    // 지도 이미지는 PNG 만 받는다. 서명이 맞지 않으면 넣지 않고 "지도 데이터 필요"로 간다.
    let mapPath = '';
    const mapManifest = [];
    const safeMapItems = Array.isArray(mapPngItems) ? mapPngItems.slice(0, 12) : [];
    for (let index = 0; index < safeMapItems.length; index += 1) {
      const item = safeMapItems[index] || {};
      const encoded = typeof item.png_base64 === 'string' ? item.png_base64 : '';
      if (!encoded || encoded.length > MAX_BODY_BYTES) continue;
      try {
        const bytes = Buffer.from(encoded.replace(/^data:image\/png;base64,/, ''), 'base64');
        if (bytes.length <= 8 || bytes.subarray(1, 4).toString('latin1') !== 'PNG') continue;
        const itemPath = path.join(workspace, `map-${String(index + 1).padStart(2, '0')}.png`);
        fs.writeFileSync(itemPath, bytes);
        mapManifest.push({ path: itemPath, title: String(item.title || `지도 ${index + 1}`).slice(0, 120) });
      } catch (error) {
        // 손상된 개별 도면은 건너뛰고 나머지 검증된 PNG를 사용한다.
      }
    }
    if (typeof mapPngBase64 === 'string' && mapPngBase64.length > 0 && mapPngBase64.length <= MAX_BODY_BYTES) {
      try {
        const bytes = Buffer.from(mapPngBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
        if (bytes.length > 8 && bytes.subarray(1, 4).toString('latin1') === 'PNG') {
          mapPath = path.join(workspace, 'map.png');
          fs.writeFileSync(mapPath, bytes);
        }
      } catch (error) {
        mapPath = '';
      }
    }

    const args = [...interpreter.args, '-X', 'utf8', '-m', 'brief_output.opinion_package_entry', casePath, outDir];
    if (mapManifest.length) {
      const manifestPath = path.join(workspace, 'map-manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(mapManifest), 'utf8');
      args.push(manifestPath);
    } else if (mapPath) args.push(mapPath);
    const result = spawnSync(interpreter.command, args, {
      cwd: ROOT, encoding: 'utf8', timeout: GENERATE_TIMEOUT_MS, windowsHide: true,
    });

    const lastLine = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
    let summary = null;
    try {
      summary = lastLine ? JSON.parse(lastLine) : null;
    } catch (error) {
      summary = null;
    }
    if (!summary) {
      return { ok: false, error_code: 'GENERATION_FAILED', message: '작성자료 생성 도구가 결과를 반환하지 않았습니다.' };
    }
    if (!summary.ok) return summary;

    const docxPath = String(summary.docx_path || '');
    if (!docxPath || !fs.existsSync(docxPath)) {
      return { ok: false, error_code: 'GENERATION_FAILED', message: '생성된 문서 파일을 찾지 못했습니다.' };
    }
    const bytes = fs.readFileSync(docxPath);
    const { docx_path: _discarded, ...rest } = summary;
    return {
      ...rest,
      file_name: `${summary.file_stem || 'opinion-package'}.docx`,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byte_length: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      docx_base64: bytes.toString('base64'),
    };
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

// serve_static.js 가 이 핸들러를 먼저 호출한다. 처리했으면 true 를 돌려준다.
function handleOutputBridgeRequest(request, response, pathname) {
  if (!String(pathname || '').startsWith(BRIDGE_PREFIX)) return false;

  if (request.method === 'GET' && pathname === `${BRIDGE_PREFIX}/status`) {
    sendJson(response, 200, bridgeStatus());
    return true;
  }

  if (request.method === 'POST' && pathname === `${BRIDGE_PREFIX}/analysis_report`) {
    readJsonBody(request)
      .then((body) => {
        const caseData = body && typeof body === 'object' ? body.case : null;
        const result = generateAnalysisReport(caseData);
        sendJson(response, result.ok ? 200 : 422, result);
      })
      .catch((error) => {
        sendJson(response, 400, { ok: false, error_code: String(error && error.message) || 'BAD_REQUEST' });
      });
    return true;
  }

  if (request.method === 'POST' && pathname === `${BRIDGE_PREFIX}/numeric_table`) {
    readJsonBody(request)
      .then((body) => {
        const caseData = body && typeof body === 'object' ? body.case : null;
        const formats = body && Array.isArray(body.formats) ? body.formats : null;
        const result = generateNumericTable(caseData, formats);
        sendJson(response, result.ok ? 200 : 422, result);
      })
      .catch((error) => {
        sendJson(response, 400, { ok: false, error_code: String(error && error.message) || 'BAD_REQUEST' });
      });
    return true;
  }

  if (request.method === 'POST' && pathname === `${BRIDGE_PREFIX}/opinion_package`) {
    readJsonBody(request)
      .then((body) => {
        const caseData = body && typeof body === 'object' ? body.case : null;
        const mapPng = body && typeof body.map_png_base64 === 'string' ? body.map_png_base64 : '';
        const mapItems = body && Array.isArray(body.map_png_items) ? body.map_png_items : [];
        const result = generateOpinionPackage(caseData, mapPng, mapItems);
        sendJson(response, result.ok ? 200 : 422, result);
      })
      .catch((error) => {
        sendJson(response, 400, { ok: false, error_code: String(error && error.message) || 'BAD_REQUEST' });
      });
    return true;
  }

  sendJson(response, 404, { ok: false, error_code: 'UNKNOWN_BRIDGE_ROUTE' });
  return true;
}

module.exports = {
  BRIDGE_PREFIX,
  bridgeStatus,
  generateAnalysisReport,
  generateNumericTable,
  generateOpinionPackage,
  handleOutputBridgeRequest,
};
