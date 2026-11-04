const PREFIX = '/__map_bridge';

async function request(path, options = {}) {
  const response = await fetch(`${PREFIX}${path}`, { cache:'no-store', ...options });
  const data = await response.json().catch(() => ({ ok:false, error_code:'INVALID_MAP_BRIDGE_RESPONSE' }));
  return { response, data };
}

export async function probeLocalMapBridge() {
  try {
    const { response, data } = await request('/status');
    if (!response.ok) return { available:false, status:'LOCAL_ONLY', blockers:['MAP_BRIDGE_UNAVAILABLE'] };
    return {
      available:Boolean(data.available),
      status:data.available ? 'AVAILABLE' : 'LOCAL_ONLY',
      blockers:Array.isArray(data.blockers) ? data.blockers : [],
      detail:data,
    };
  } catch (error) {
    return { available:false, status:'LOCAL_ONLY', blockers:['MAP_BRIDGE_UNREACHABLE'], error:String(error?.message || error) };
  }
}

export async function buildLocalMap(state) {
  const { response, data } = await request('/build', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ case:state }),
  });
  if (!response.ok || !data.ok) {
    const error = new Error(data.message || data.error_code || `MAP_BRIDGE_${response.status}`);
    error.code = data.error_code || `HTTP_${response.status}`;
    error.details = data.details || data.blockers || [];
    throw error;
  }
  return data;
}

function base64Bytes(value) {
  const binary = atob(String(value || '').replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function downloadMapPdf(base64, fileName = 'bso-map.pdf') {
  const blob = new Blob([base64Bytes(base64)], { type:'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
