const PREFIX = '/__public_data_bridge';

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${PREFIX}${path}`, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({ ok: false, error_code: 'INVALID_BRIDGE_RESPONSE' }));
  if (!response.ok && !data.error_code) data.error_code = `HTTP_${response.status}`;
  return data;
}

export async function probePublicDataBridge() {
  try {
    const data = await jsonRequest('/status');
    return {
      available: Boolean(data.ok && (data.vworld_configured || data.public_data_configured)),
      vworld: Boolean(data.vworld_configured),
      publicData: Boolean(data.public_data_configured),
      keyForm: data.public_data_key_form || 'MISSING',
      secretsExposed: Boolean(data.secrets_exposed),
      raw: data,
    };
  } catch (error) {
    return { available: false, vworld: false, publicData: false, error: String(error?.message || error) };
  }
}

export async function searchLegalDong(addressName) {
  return jsonRequest('/legal_dong', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address_name: String(addressName || '').trim() }),
  });
}

export async function resolvePnuCandidate(parcelAddress, addressContext = '') {
  return jsonRequest('/resolve_pnu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parcel_address: String(parcelAddress || '').trim(), address_context:String(addressContext || '').trim() }),
  });
}

export async function resolvePnuCandidates(lands, onProgress = () => {}) {
  const candidates = [];
  const failures = [];
  const source = Array.isArray(lands) ? lands : [];
  for (let index = 0; index < source.length; index += 1) {
    const land = source[index] || {};
    const existing = String(land.pnu || '').trim();
    if (/^\d{19}$/.test(existing)) {
      onProgress({ index:index + 1, total:source.length, status:'PNU_ALREADY_PRESENT' });
      continue;
    }
    const result = await resolvePnuCandidate(land.parcel_address || '');
    if (!result.ok || !result.candidate) {
      failures.push({
        land_id: land.land_id || '',
        parcel_address: land.parcel_address || '',
        error_code: result.error_code || 'PNU_RESOLVE_FAILED',
      });
      onProgress({ index:index + 1, total:source.length, status:result.error_code || 'PNU_RESOLVE_FAILED' });
      continue;
    }
    candidates.push({
      land_id: land.land_id || '',
      parcel_address: land.parcel_address || '',
      ...result.candidate,
      review_required: true,
      auto_confirmed: false,
    });
    onProgress({ index:index + 1, total:source.length, status:'CANDIDATE_REVIEW_REQUIRED' });
  }
  return { candidates, failures };
}

export async function lookupVWorldLand(pnu, standardYear = null) {
  return jsonRequest('/vworld_land', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pnu: String(pnu || '').trim(), standard_year: standardYear }),
  });
}

export async function enrichPnuLands(lands, standardYear = null, onProgress = () => {}) {
  const rows = [];
  const failures = [];
  const source = Array.isArray(lands) ? lands : [];
  for (let index = 0; index < source.length; index += 1) {
    const land = source[index] || {};
    const pnu = String(land.pnu || '').trim();
    if (!/^\d{19}$/.test(pnu)) {
      failures.push({ land_id: land.land_id || '', parcel_address: land.parcel_address || '', error_code: 'PNU_REQUIRED' });
      onProgress({ index: index + 1, total: source.length, status: 'PNU_REQUIRED' });
      continue;
    }
    const result = await lookupVWorldLand(pnu, standardYear);
    if (!result.ok || !result.record) {
      failures.push({ land_id: land.land_id || '', parcel_address: land.parcel_address || '', pnu, error_code: result.error_code || result.status || 'NO_DATA' });
      onProgress({ index: index + 1, total: source.length, status: result.error_code || result.status || 'NO_DATA' });
      continue;
    }
    rows.push({
      land_id: land.land_id || '',
      parcel_address: land.parcel_address || '',
      ...result.record,
      review_required: true,
      auto_confirmed: false,
      source_provider: 'VWorld',
    });
    onProgress({ index: index + 1, total: source.length, status: 'SUCCESS_REVIEW_REQUIRED' });
  }
  return { rows, failures };
}
