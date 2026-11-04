const PREFIX = '/__public_data_bridge';

async function post(path, payload = {}) {
  const response = await fetch(`${PREFIX}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({ ok:false, error_code:'INVALID_WORK_OP_RESPONSE' }));
  if (!response.ok || !data.ok) {
    const error = new Error(data.error_message || data.error_code || `HTTP_${response.status}`);
    error.code = data.error_code || `HTTP_${response.status}`;
    error.data = data;
    throw error;
  }
  return data;
}

export function runFieldCandidates(payload) { return post('/field_candidates', payload); }
export function runEarlySignals(payload) { return post('/early_signals', payload); }
export function runRtms(payload) { return post('/rtms', payload); }
export function runBuildingLedger(payload) { return post('/building', payload); }

function base64Bytes(value) {
  const binary = atob(String(value || '').replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function downloadCsv(base64, fileName = 'bso-export.csv') {
  if (!base64) return false;
  const blob = new Blob([base64Bytes(base64)], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export const WORK_OPS_CONTRACT = Object.freeze({
  field_candidates: 'REVIEW_ONLY_P1_P4_P5',
  early_signals: 'EARLY_SIGNAL_HUMAN_REVIEW',
  rtms: 'TRADE_CANDIDATE_ONLY',
  building: 'LEDGER_CROSSCHECK_SOURCE',
  auto_confirmed: false,
});
