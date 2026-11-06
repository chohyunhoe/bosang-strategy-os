'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const { loadLocalMapEnv, windowsQgisCandidates } = require('./local_map_runtime');
loadLocalMapEnv(ROOT);
const PREFIX = '/__map_bridge';
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_VWORLD_IMAGE_BYTES = 16 * 1024 * 1024;
const RUN_TIMEOUT_MS = 300_000;
let cachedQgis = undefined;

const { evaluateParseSanity, PARSE_HOLD } = require('../parser/src/parse_sanity_gate');

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('PAYLOAD_TOO_LARGE')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_error) { reject(new Error('INVALID_JSON')); }
    });
  });
}
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  response.end(`${JSON.stringify(payload)}\n`);
}
function validatedVworldImageUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_error) { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'api.vworld.kr' || url.pathname !== '/req/image' || url.username || url.password) return null;
  const service = String(url.searchParams.get('service') || '').toLowerCase();
  const request = String(url.searchParams.get('request') || '').toLowerCase();
  const format = String(url.searchParams.get('format') || '').toLowerCase();
  const basemap = String(url.searchParams.get('basemap') || '').toUpperCase();
  const key = String(url.searchParams.get('key') || '').trim();
  if (service !== 'image' || request !== 'getmap' || format !== 'png' || !['PHOTO','PHOTO_HYBRID'].includes(basemap) || !key) return null;
  return url;
}
async function proxyVworldImage(request, response) {
  let incoming;
  try { incoming = new URL(request.url || '', 'http://127.0.0.1'); } catch (_error) { sendJson(response,400,{ok:false,error_code:'VWORLD_IMAGE_PROXY_INVALID_REQUEST'}); return; }
  const target = validatedVworldImageUrl(incoming.searchParams.get('url'));
  if (!target) { sendJson(response,400,{ok:false,error_code:'VWORLD_IMAGE_PROXY_URL_REJECTED'}); return; }
  try {
    const upstream = await fetch(target, { redirect:'error', headers:{ Accept:'image/png' } });
    const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (!upstream.ok || !contentType.startsWith('image/png') || (declared && declared > MAX_VWORLD_IMAGE_BYTES)) { sendJson(response,502,{ok:false,error_code:'VWORLD_IMAGE_PROXY_UPSTREAM_REJECTED'}); return; }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_VWORLD_IMAGE_BYTES) { sendJson(response,502,{ok:false,error_code:'VWORLD_IMAGE_PROXY_SIZE_REJECTED'}); return; }
    response.writeHead(200, { 'Content-Type':'image/png', 'Content-Length':bytes.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' });
    response.end(bytes);
  } catch (_error) { sendJson(response,502,{ok:false,error_code:'VWORLD_IMAGE_PROXY_FAILED'}); }
}
function configuredArchive() {
  const value = String(process.env.BSO_GRAPHICS_CADASTRAL_ARCHIVE || '').trim();
  if (!value) return null;
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : null;
}
function configuredCrs() {
  const value = String(process.env.BSO_GRAPHICS_CRS || '').trim().toUpperCase();
  return /^EPSG:\d{4,6}$/.test(value) ? value : '';
}
function qgisCandidates() {
  const candidates = [];
  if (process.env.BSO_QGIS_PYTHON) candidates.push({ command:process.env.BSO_QGIS_PYTHON, args:[] });
  candidates.push(...windowsQgisCandidates());
  if (process.env.BSO_PYTHON) candidates.push({ command:process.env.BSO_PYTHON, args:[] });
  candidates.push({ command:'python', args:[] }, { command:'python3', args:[] }, { command:'py', args:['-3'] });
  return candidates;
}
function probeQgis() {
  if (cachedQgis !== undefined) return cachedQgis;
  cachedQgis = null;
  for (const candidate of qgisCandidates()) {
    try {
      const result = spawnSync(candidate.command, [...candidate.args, '-c', 'from qgis.core import QgsApplication; print("QGIS_OK")'], { cwd:ROOT, encoding:'utf8', timeout:30_000, windowsHide:true, env:candidate.env || process.env });
      if (result.status === 0 && String(result.stdout || '').includes('QGIS_OK')) { cachedQgis = candidate; break; }
    } catch (_error) {}
  }
  return cachedQgis;
}
function mapBridgeStatus() {
  const archive = configuredArchive();
  const crs = configuredCrs();
  const qgis = probeQgis();
  const vworld = Boolean(process.env.VWORLD_API_KEY);
  const codexNetworkDisabled = String(process.env.CODEX_SANDBOX_NETWORK_DISABLED || '').trim().toLowerCase() === 'true';
  const available = Boolean(archive && crs && qgis && vworld && !codexNetworkDisabled);
  const blockers = [];
  if (!archive) blockers.push('CADASTRAL_ARCHIVE_NOT_CONFIGURED');
  if (!crs) blockers.push('GRAPHICS_CRS_NOT_CONFIGURED');
  if (!qgis) blockers.push('QGIS_RUNTIME_UNAVAILABLE');
  if (!vworld) blockers.push('VWORLD_API_KEY_MISSING');
  if (codexNetworkDisabled) blockers.push('CODEX_NETWORK_ESCALATION_REQUIRED');
  return { ok:true, available, status:available ? 'AVAILABLE' : 'LOCAL_ONLY', archive_configured:Boolean(archive), crs_configured:Boolean(crs), qgis_available:Boolean(qgis), vworld_configured:vworld, transport_status:codexNetworkDisabled ? 'APPROVED_HOST_EXECUTION_REQUIRED' : 'DIRECT_LOCAL_NETWORK', blockers, review_required:true, secrets_exposed:false };
}
function validPnu(value) { return /^\d{19}$/.test(String(value || '').trim()); }
function list(value) { return Array.isArray(value) ? value : []; }
function safeText(value, max = 100) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function lotFromAddress(value) {
  const text = safeText(value, 180);
  const match = text.match(/(?:^|\s)((?:산\s*)?\d{1,5}(?:-\d{1,5})?)(?:번지)?(?:\s|$)/);
  return match ? match[1].replace(/\s+/g, '') : '';
}
function safeCaseId() { return `PV2_MAP_${Date.now().toString(36).toUpperCase()}`; }
function roleItem(row, role) { return { label:safeText(row.parcel_address || row.standard_land_symbol || role,80), role, pnu:String(row.pnu || '').trim(), expected_jibun:safeText(row.lot_number || lotFromAddress(row.parcel_address),40) }; }
function buildManifest(state, archive, crs) {
  const lands = list(state && state.lands);
  const standards = list(state && state.standardLands);
  const results = list(state && state.appraisalResults);
  if (!lands.length) throw Object.assign(new Error('subject lands missing'), { code:'SUBJECT_LANDS_MISSING' });
  const invalidSubjects = lands.filter((row) => !validPnu(row && row.pnu));
  if (invalidSubjects.length) throw Object.assign(new Error('subject PNU incomplete'), { code:'SUBJECT_PNU_INCOMPLETE', details:invalidSubjects.map((row)=>safeText(row && row.parcel_address,80)) });
  const referencedSymbols = new Set(results.map((row) => String(row && row.standard_land_symbol || '').trim()).filter(Boolean));
  const requiredStandards = referencedSymbols.size ? standards.filter((row) => referencedSymbols.has(String(row && row.standard_land_symbol || '').trim())) : standards;
  const validStandards = requiredStandards.filter((row) => validPnu(row && row.pnu));
  const missingStandards = requiredStandards.filter((row) => !validPnu(row && row.pnu));
  if (!validStandards.length || missingStandards.length) throw Object.assign(new Error('standard PNU incomplete'), { code:'STANDARD_PNU_INCOMPLETE', details:missingStandards.map((row)=>safeText(row && (row.standard_land_symbol || row.parcel_address),80)) });
  const subjectItems = lands.map((row) => roleItem(row,'subject'));
  const standardItems = validStandards.map((row) => roleItem(row,'standard'));
  const required = [...subjectItems,...standardItems];
  return {
    schema_version:'bso_graphics_v0.5', case_id:safeCaseId(),
    title:safeText(state && state.caseInfo && (state.caseInfo.project_name || state.caseInfo.case_name),80) || '보상전략 OS 검토지도',
    crs, output_formats:['png','pdf'], outputs:['subject_vs_standard'],
    output_disclaimer:'본 자료는 감정평가서 및 검토자료의 구조화 결과이며, 감정평가 판단을 대체하지 않습니다. 제출 전 전문가 검토가 필요합니다.',
    map_output_status:'DRAFT_UNTIL_PC_VISUAL_REVIEW',
    privacy:{ processing_mode:'LOCAL_WITH_EXTERNAL_MAP_TILES', raw_personal_data_in_output:false, external_map_request_note:'VWorld에는 지도 범위와 API 요청정보만 전송하며 원문 PDF·성명은 전송하지 않습니다.' },
    parcel_verification:{ enabled:true, expected_source_crs:crs, required_pnus:required, pairwise_constraints:[] },
    layers:[
      { role:'subject', label:'대상토지', label_prefix:'대상', archive, pnus:subjectItems.map((item)=>item.pnu) },
      { role:'standard', label:'비교표준지', label_prefix:'표준지', archive, pnus:standardItems.map((item)=>item.pnu) },
    ],
  };
}
function sanitizeMessage(value, workspace, archive) {
  let text = safeText(value,500);
  for (const secret of [workspace, archive, process.env.VWORLD_API_KEY]) if (secret) text = text.split(String(secret)).join('[REDACTED]');
  return text;
}
function runQgis(candidate, script, args, cwd) { return spawnSync(candidate.command, [...candidate.args, script, ...args], { cwd, encoding:'utf8', timeout:RUN_TIMEOUT_MS, windowsHide:true, env:candidate.env || {...process.env} }); }
function mapPreviewFromResult(result, crs, workspace, archive) {
  const layers = [];
  for (const file of list(result.selected_geometry)) {
    try {
      if (!file || !fs.existsSync(file)) continue;
      const role = path.basename(file,path.extname(file)).toUpperCase();
      const featureCollection = JSON.parse(fs.readFileSync(file,'utf8'));
      if (!featureCollection || featureCollection.type !== 'FeatureCollection') continue;
      layers.push({ role, feature_collection:featureCollection });
    } catch (_error) {}
  }
  return {
    schema_version:'0.1', artifact_type:'LK_MAP_PREVIEW', preview_id:`PV2_${Date.now().toString(36)}`,
    coordinate_space:{ crs, axis_order:'XY', dimensions:2, geometry_encoding:'GEOJSON_GEOMETRY_2D', rfc7946:false },
    style_profile:'LK_ROLE_STYLE_V1', view:{fit_mode:'ALL_RENDERABLE_ROLES'}, layers, omissions:[],
    warnings:list(result.issues).map((item)=>({ code:safeText(item && item.code,80), message:sanitizeMessage(item && item.message,workspace,archive) })),
    provenance:{ privacy_profile:'MINIMIZED_LOCAL', generator:'product_v2_map_bridge', background_source:safeText(result.background_source,80) },
  };
}
function findOutput(result,suffix) { return list(result.outputs).find((file)=>String(file || '').toLowerCase().endsWith(suffix.toLowerCase()) && fs.existsSync(file)); }
function buildLocalMap(state) {
  // 파싱이 신뢰할 수 없는 상태면 좌표 조회로 넘기지 않는다. 잘못된 지번·문장 조각이
  // VWorld 로 나가고 그 결과가 도면이 되는 것을 막는다(fail-closed).
  // 환경 가용성보다 먼저 본다. 그래야 차단 사유가 환경 문제로 바뀌지 않는다.
  const sanity = evaluateParseSanity(state);
  if (sanity.status === PARSE_HOLD) {
    return {
      ok:false,
      error_code:'PARSE_HOLD',
      status:PARSE_HOLD,
      holds:sanity.holds,
      hold_codes:sanity.hold_codes,
      message:'파싱 결과에 확인이 필요한 항목이 있어 지도를 생성하지 않았습니다. 원문 대조 후 다시 시도하세요.',
      review_required:true,
      auto_confirmed:false,
    };
  }
  const status = mapBridgeStatus();
  if (!status.available) return { ok:false, error_code:'MAP_BRIDGE_UNAVAILABLE', blockers:status.blockers };
  const archive = configuredArchive(); const crs = configuredCrs(); const qgis = probeQgis();
  let manifest;
  try { manifest = buildManifest(state,archive,crs); }
  catch (error) { return { ok:false, error_code:error.code || 'MAP_INPUT_INVALID', details:error.details || [] }; }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(),'bso-v2-map-'));
  try {
    const manifestPath = path.join(workspace,'manifest.json'); const outputRoot = path.join(workspace,'out');
    fs.writeFileSync(manifestPath,JSON.stringify(manifest),'utf8');
    const verify = runQgis(qgis,path.join(ROOT,'bso','run_parcel_verification.py'),[manifestPath,'--output-dir',outputRoot],path.join(ROOT,'bso'));
    if (verify.status !== 0) return { ok:false, error_code:'PARCEL_VERIFICATION_FAILED', message:sanitizeMessage(verify.stderr || verify.stdout,workspace,archive), review_required:true };
    const gate = runQgis(qgis,path.join(ROOT,'bso','run_graphics_gate.py'),[manifestPath,'--output-dir',outputRoot],path.join(ROOT,'bso'));
    const resultPath = path.join(outputRoot,manifest.case_id,'graphics_manifest_result.json');
    if (!fs.existsSync(resultPath)) return { ok:false, error_code:'GRAPHICS_RESULT_MISSING', message:sanitizeMessage(gate.stderr || gate.stdout,workspace,archive) };
    const result = JSON.parse(fs.readFileSync(resultPath,'utf8'));
    const preview = mapPreviewFromResult(result,crs,workspace,archive);
    const pngPath=findOutput(result,'subject_vs_standard.png'); const pdfPath=findOutput(result,'subject_vs_standard.pdf');
    const png=pngPath?fs.readFileSync(pngPath):null; const pdf=pdfPath?fs.readFileSync(pdfPath):null;
    return { ok:['COMPLETED','PARTIAL_REVIEW_REQUIRED'].includes(result.status), status:result.status, background_source:safeText(result.background_source,80), map_preview:preview, preview_png_base64:png&&png.length<=20*1024*1024?png.toString('base64'):'', map_pdf_base64:pdf&&pdf.length<=30*1024*1024?pdf.toString('base64'):'', issues:list(result.issues).map((item)=>({code:safeText(item&&item.code,80),message:sanitizeMessage(item&&item.message,workspace,archive)})), review_required:true, auto_confirmed:false, secrets_exposed:false };
  } finally { try { fs.rmSync(workspace,{recursive:true,force:true}); } catch (_error) {} }
}
function handleMapBridgeRequest(request,response,pathname) {
  if (!String(pathname || '').startsWith(PREFIX)) return false;
  if (request.method==='GET'&&pathname===`${PREFIX}/status`) { sendJson(response,200,mapBridgeStatus()); return true; }
  if (request.method==='GET'&&pathname===`${PREFIX}/vworld-image`) { proxyVworldImage(request,response); return true; }
  if (request.method==='POST'&&pathname===`${PREFIX}/build`) {
    readJsonBody(request).then((body)=>{ const result=buildLocalMap(body&&typeof body==='object'?body.case:null); sendJson(response,result.ok?200:422,result); }).catch((error)=>sendJson(response,400,{ok:false,error_code:String(error&&error.message||'BAD_REQUEST')}));
    return true;
  }
  sendJson(response,404,{ok:false,error_code:'UNKNOWN_MAP_BRIDGE_ROUTE'}); return true;
}
module.exports = { PREFIX, mapBridgeStatus, buildManifest, buildLocalMap, handleMapBridgeRequest, sanitizeMessage, validatedVworldImageUrl, evaluateParseSanity };
