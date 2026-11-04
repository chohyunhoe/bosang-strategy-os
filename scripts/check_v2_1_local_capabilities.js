'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { bridgeStatus } = require('./output_bridge.js');
const { mapBridgeStatus, sanitizeMessage } = require('./map_bridge.js');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_WORKER = path.join(__dirname, 'public_data_bridge.py');

function publicDataStatus() {
  const candidates = [process.env.PYTHON, process.env.PYTHON3, 'python', 'python3', 'py'].filter(Boolean);
  for (const command of candidates) {
    const args = command === 'py' ? ['-3', PUBLIC_WORKER] : [PUBLIC_WORKER];
    try {
      const run = spawnSync(command, args, {
        cwd: ROOT,
        input: JSON.stringify({ operation:'status' }),
        encoding:'utf8',
        timeout:30_000,
        windowsHide:true,
        env:{...process.env},
      });
      if (run.error || run.status === null) continue;
      const line = String(run.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
      if (!line) continue;
      const payload = JSON.parse(line);
      return { runtime:command, ...payload };
    } catch (_error) {}
  }
  return { ok:false, status:'LOCAL_ONLY', error_code:'PYTHON_RUNTIME_UNAVAILABLE', capabilities:{}, secrets_exposed:false };
}

function containsSecret(payload, secret) {
  return Boolean(secret) && JSON.stringify(payload).includes(String(secret));
}

function securityCheck(outputStatus, publicStatus, mapStatus) {
  const sentinelWorkspace = process.platform === 'win32' ? 'C:\\Temp\\bso-secret-workspace' : '/tmp/bso-secret-workspace';
  const sentinelArchive = process.platform === 'win32' ? 'D:\\private\\cadastral-secret.zip' : '/private/cadastral-secret.zip';
  const priorVworld = process.env.VWORLD_API_KEY;
  process.env.VWORLD_API_KEY = priorVworld || 'BSO_SELF_CHECK_VWORLD_SENTINEL';
  let redacted;
  try {
    redacted = sanitizeMessage(`workspace=${sentinelWorkspace} archive=${sentinelArchive} key=${process.env.VWORLD_API_KEY}`, sentinelWorkspace, sentinelArchive);
  } finally {
    if (priorVworld === undefined) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = priorVworld;
  }

  const exposures = [];
  for (const [name, payload] of [['output',outputStatus],['public',publicStatus],['precision_map',mapStatus]]) {
    for (const secret of [process.env.PUBLIC_DATA_API_KEY, process.env.VWORLD_API_KEY, process.env.BSO_GRAPHICS_CADASTRAL_ARCHIVE]) {
      if (containsSecret(payload, secret)) exposures.push(`${name}:SECRET_EXPOSED`);
    }
  }
  if (redacted.includes(sentinelWorkspace) || redacted.includes(sentinelArchive) || /BSO_SELF_CHECK_VWORLD_SENTINEL/.test(redacted)) exposures.push('precision_map:REDACTION_FAILED');
  return { ok:exposures.length === 0, exposures };
}

function main() {
  const output = bridgeStatus();
  const publicData = publicDataStatus();
  const precisionMap = mapBridgeStatus();
  const security = securityCheck(output, publicData, precisionMap);
  const publicCaps = publicData.capabilities || {};
  const report = {
    schema_version:'bso-v2.1-local-self-check/1.1',
    core:{ pdf_ocr:true, review_workbench:true, multi_case:true },
    output_center:{ available:Boolean(output.available), formats:output.formats || [], reason:output.reason || null },
    public_data:{
      available:Boolean(publicData.public_data_configured || publicData.ok),
      public_data_configured:Boolean(publicData.public_data_configured),
      vworld_land_configured:Boolean(publicData.vworld_configured),
      field_candidates:Boolean(publicCaps.FIELD_CANDIDATES),
      early_signal:Boolean(publicCaps.EARLY_SIGNAL),
      rtms:Boolean(publicCaps.RTMS),
      building_ledger:Boolean(publicCaps.BUILDING_LEDGER),
      pnu_resolver:Boolean(publicCaps.PNU_RESOLVER),
      error_code:publicData.error_code || null,
    },
    api_quick_map:{
      available:true,
      authentication:'BROWSER_SESSION_VWORLD_KEY',
      local_cadastral_archive_required:false,
      qgis_required:false,
    },
    precision_map:{
      available:Boolean(precisionMap.available), status:precisionMap.status, blockers:precisionMap.blockers || [],
      qgis_available:Boolean(precisionMap.qgis_available), archive_configured:Boolean(precisionMap.archive_configured),
      crs_configured:Boolean(precisionMap.crs_configured), vworld_configured:Boolean(precisionMap.vworld_configured),
    },
    security:{ ok:security.ok, exposures:security.exposures },
    note:'Unavailable optional/local capabilities are BLOCKED/LOCAL_ONLY, not a BSO startup failure. Security exposure is a hard failure.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (!security.ok) process.exitCode = 1;
}

main();
