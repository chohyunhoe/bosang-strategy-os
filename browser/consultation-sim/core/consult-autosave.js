// BSO 현장상담 V1.0 상담기록 자동저장(화면 쪽). 저장소는 현장 서버(ThinkPad)의 로컬 SQLite뿐 — 브라우저 저장소·외부 전송 없음.
// - 상담 ID는 화면이 만든다(C-YYYYMMDD-HHMMSS-xxxxxx). 같은 ID 재전송은 서버에서 같은 기록으로 처리(중복 생성 없음).
// - 한 번에 하나만 보낸다. 보내는 중 바뀐 내용은 끝난 뒤 한 번 더 보낸다. 같은 내용은 다시 보내지 않는다.
// - 실패: 상태 FAILED + 재시도(5s→15s→30s→60s). 다른 기기 수정(REV_CONFLICT): CONFLICT로 멈추고 상담자가 고른다.
// - 인증 만료(401 FIELD_ACCESS_TOKEN_REQUIRED): AUTH 상태 + onAuthExpired 콜백(화면이 페어링으로 안내).
export const SAVE_STATE = Object.freeze({ OFF: 'OFF', IDLE: 'IDLE', PENDING: 'PENDING', SAVING: 'SAVING', SAVED: 'SAVED', FAILED: 'FAILED', CONFLICT: 'CONFLICT', AUTH: 'AUTH', READONLY: 'READONLY' });
export const RECORDS_BASE = '/__field/records';
export const RECORD_ID_RE = /^C-\d{8}-\d{6}-[a-z0-9]{6}$/;
const RETRY_MS = [5000, 15000, 30000, 60000];

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function newRecordId(now = new Date(), rand = () => Math.random()) {
  const d = now;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let tail = '';
  for (let i = 0; i < 6; i += 1) tail += alphabet[Math.floor(rand() * alphabet.length) % alphabet.length];
  return `C-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${tail}`;
}

const jsonInit = (method, body, extra = {}) => ({ method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body), ...extra });
async function readJson(r) { try { return await r.json(); } catch (_e) { return null; } }

export function createAutosave({ fetchImpl, debounceMs = 700, onState = () => {}, onAuthExpired = () => {}, onFinalFail = () => {}, now = () => new Date(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t), rand } = {}) {
  const s = { status: SAVE_STATE.OFF, id: null, rev: 0, consultedAt: null, savedAt: null, error: null, remoteRev: null, readOnly: false };
  let producer = null; let timer = null; let retryTimer = null; let retryN = 0;
  let inflight = null; let again = false; let lastSent = null; let lastBuilt = null; let enabled = false;
  const revs = new Map(); // 상담 ID → 서버가 확인한 최신 수정차수(닫은 기록의 마지막 저장에 사용)

  const putResume = (id) => fetchImpl(`${RECORDS_BASE}/resume`, jsonInit('PUT', { id }, { keepalive: true })).catch(() => {});
  const emit = () => onState({ ...s, dirty: dirty() });
  const set = (patch) => { Object.assign(s, patch); emit(); };
  const dirty = () => lastBuilt != null && lastBuilt !== lastSent;

  function build() {
    if (!producer) return null;
    const rec = producer({ consultedAt: s.consultedAt });
    if (!rec) return null;
    return rec;
  }
  function stamp(rec) {
    if (!s.id) { s.id = newRecordId(now(), rand); s.rev = 0; s.consultedAt = now().toISOString(); }
    return { ...rec, consulted_at: s.consultedAt };
  }
  async function send({ keepalive = false } = {}) {
    if (!enabled || s.readOnly || s.status === SAVE_STATE.CONFLICT || s.status === SAVE_STATE.AUTH) return;
    if (inflight) { again = true; return inflight; }
    const rec = build();
    if (!rec) { lastBuilt = null; if (!s.id) set({ status: SAVE_STATE.IDLE }); return undefined; }
    const body = stamp(rec);
    const json = JSON.stringify(body); lastBuilt = json;
    if (json === lastSent) { if (s.status !== SAVE_STATE.SAVED) set({ status: SAVE_STATE.SAVED }); return undefined; }
    const id = s.id; const baseRev = s.rev;
    set({ status: SAVE_STATE.SAVING, error: null });
    inflight = (async () => {
      let r; let j;
      try { r = await fetchImpl(`${RECORDS_BASE}/${encodeURIComponent(id)}`, jsonInit('PUT', { base_rev: baseRev, record: body }, keepalive ? { keepalive: true } : {})); j = await readJson(r); } catch (_e) { r = null; }
      inflight = null;
      if (id !== s.id) return; // 그사이 새 상담으로 바뀜(이전 기록은 이미 보낸 상태)
      if (r && r.ok && j && j.ok) {
        s.rev = j.rev; lastSent = json; retryN = 0; revs.set(id, { rev: j.rev, json });
        if (j.created) putResume(id); // 이 기기에서 '지금 열린 상담'으로 지정(재접속 복원)
        set({ status: SAVE_STATE.SAVED, savedAt: j.updated_at || now().toISOString(), error: null });
      } else if (r && r.status === 401) {
        set({ status: SAVE_STATE.AUTH, error: j?.error_code || 'HTTP_401' }); onAuthExpired(j || {});
        return;
      } else if (r && r.status === 409) {
        set({ status: SAVE_STATE.CONFLICT, remoteRev: j?.rev ?? null, error: j?.error_code || 'REV_CONFLICT' });
        return;
      } else {
        set({ status: SAVE_STATE.FAILED, error: j?.error_code || (r ? `HTTP_${r.status}` : 'NETWORK') });
        const wait = RETRY_MS[Math.min(retryN, RETRY_MS.length - 1)]; retryN += 1;
        clearTimer(retryTimer); retryTimer = setTimer(() => { retryTimer = null; send(); }, wait);
        return;
      }
      if (again) { again = false; await send(); }
    })();
    return inflight;
  }

  return {
    state: () => ({ ...s, dirty: dirty() }),
    enable(on = true) { enabled = Boolean(on); set({ status: enabled ? (s.id ? s.status : SAVE_STATE.IDLE) : SAVE_STATE.OFF }); },
    get enabled() { return enabled; },
    setProducer(fn) { producer = fn; },
    // 화면 상태가 바뀔 때마다 부른다. 내용 계산·전송은 잠시 모아서 한 번.
    touch() {
      if (!enabled || s.readOnly || s.status === SAVE_STATE.CONFLICT || s.status === SAVE_STATE.AUTH) return;
      clearTimer(timer);
      timer = setTimer(() => { timer = null; send(); }, debounceMs);
      if (s.status === SAVE_STATE.SAVED || s.status === SAVE_STATE.IDLE) { const rec = build(); if (rec) { const json = JSON.stringify(stamp(rec)); lastBuilt = json; if (json !== lastSent) set({ status: SAVE_STATE.PENDING }); } }
    },
    // 기록 닫기 직전(새 상담·다른 기록 열기): 지금 화면 내용을 같은 ID로 마지막 저장. 보내는 중인 저장이 있으면 끝난 뒤 이어서 보낸다.
    // 부른 쪽은 바로 detach()해도 된다(내용·ID를 여기서 미리 잡는다). 실패하면 onFinalFail(id, code).
    finalize() {
      clearTimer(timer); timer = null;
      if (!enabled || s.readOnly || !s.id || s.status === SAVE_STATE.CONFLICT) return Promise.resolve();
      const built = build(); if (!built) return Promise.resolve();
      const body = stamp(built); const json = JSON.stringify(body); const id = s.id; const pending = inflight; const startRev = s.rev;
      if (json === lastSent && !pending) return Promise.resolve();
      return (async () => {
        if (pending) { try { await pending; } catch (_e) { /* 아래에서 다시 보냄 */ } }
        const known = revs.get(id);
        if (known && known.json === json) return;
        try {
          const r = await fetchImpl(`${RECORDS_BASE}/${encodeURIComponent(id)}`, jsonInit('PUT', { base_rev: known ? known.rev : startRev, record: body }, { keepalive: true }));
          const j = await readJson(r);
          if (r.ok && j && j.ok) revs.set(id, { rev: j.rev, json }); else { if (r.status === 401) onAuthExpired(j || {}); onFinalFail(id, j?.error_code || `HTTP_${r.status}`); }
        } catch (_e) { onFinalFail(id, 'NETWORK'); }
      })();
    },
    // 즉시 저장(화면 숨김·창 닫기)
    async flush({ keepalive = false } = {}) { clearTimer(timer); timer = null; if (inflight) { again = true; await inflight; } return send({ keepalive }); },
    retry() { if (s.status === SAVE_STATE.FAILED || s.status === SAVE_STATE.AUTH) { clearTimer(retryTimer); s.status = SAVE_STATE.PENDING; return send(); } return undefined; },
    // 새 상담: 현재 기록을 닫는다(다음 입력부터 새 ID).
    detach() { clearTimer(timer); clearTimer(retryTimer); timer = null; retryTimer = null; again = false; lastSent = null; lastBuilt = null; retryN = 0;
      Object.assign(s, { id: null, rev: 0, consultedAt: null, savedAt: null, error: null, remoteRev: null, readOnly: false }); set({ status: enabled ? SAVE_STATE.IDLE : SAVE_STATE.OFF }); },
    // 저장된 기록을 다시 열었을 때: 그 ID·수정차수에 이어서 저장(수정). readOnly면 저장하지 않음.
    attach({ id, rev, consulted_at, updated_at = null, readOnly = false }) {
      this.detach(); Object.assign(s, { id, rev, consultedAt: consulted_at, savedAt: updated_at, readOnly });
      if (!readOnly && producer) { const rec = build(); if (rec) { lastSent = JSON.stringify(stamp(rec)); lastBuilt = lastSent; } }
      set({ status: readOnly ? SAVE_STATE.READONLY : SAVE_STATE.SAVED });
    },
    // 충돌 해결: overwrite = 이 기기 내용으로 저장(서버 최신 차수 기준), reload는 화면이 기록을 다시 연다.
    overwrite() { if (s.status !== SAVE_STATE.CONFLICT) return undefined; s.rev = s.remoteRev ?? s.rev; s.status = SAVE_STATE.PENDING; return send(); },
    authRestored() { if (s.status === SAVE_STATE.AUTH) { s.status = SAVE_STATE.PENDING; return send(); } return undefined; },
    // 서버 API(같은 인증 뒤)
    async list(q = '', limit = 50) { const r = await fetchImpl(`${RECORDS_BASE}?q=${encodeURIComponent(q)}&limit=${limit}`, { credentials: 'same-origin' }); const j = await readJson(r); if (r.status === 401) onAuthExpired(j || {}); return r.ok && j?.ok ? j : { ok: false, error_code: j?.error_code || `HTTP_${r.status}`, items: [] }; },
    async get(id) { const r = await fetchImpl(`${RECORDS_BASE}/${encodeURIComponent(id)}`, { credentials: 'same-origin' }); const j = await readJson(r); if (r.status === 401) onAuthExpired(j || {}); return r.ok && j?.ok ? j.record : null; },
    async resume() { try { const r = await fetchImpl(`${RECORDS_BASE}/resume`, { credentials: 'same-origin' }); const j = await readJson(r); return r.ok && j?.ok ? j.record : null; } catch (_e) { return null; } },
    async setResume(id) { await putResume(id); },
    async backup() { const r = await fetchImpl(`${RECORDS_BASE}/backup`, jsonInit('POST', {})); const j = await readJson(r); return j || { ok: false, error_code: `HTTP_${r.status}` }; },
    exportUrl: (format = 'csv', id = null) => `${RECORDS_BASE}/export?format=${format === 'json' ? 'json' : 'csv'}${id ? `&id=${encodeURIComponent(id)}` : ''}`,
  };
}

// 저장 상태 → 화면 문구(배지·경고). 짧게, 상태마다 하나.
export function saveStateText(st, { fmtTime = (iso) => iso } = {}) {
  switch (st.status) {
    case SAVE_STATE.OFF: return { tone: 'warn', badge: '자동저장 꺼짐', alert: null };
    case SAVE_STATE.IDLE: return { tone: '', badge: '자동저장 대기', alert: null };
    case SAVE_STATE.PENDING: case SAVE_STATE.SAVING: return { tone: '', badge: '저장 중…', alert: null };
    case SAVE_STATE.SAVED: return { tone: 'ok', badge: `저장됨 ${st.savedAt ? fmtTime(st.savedAt) : ''}`.trim(), alert: null };
    case SAVE_STATE.FAILED: return { tone: 'bad', badge: '⚠ 자동저장 실패', alert: `자동저장 실패(${st.error || '오류'}) — 입력은 이 화면에 남아 있고 자동으로 다시 시도합니다. 창을 닫거나 새로고침하지 마세요.` };
    case SAVE_STATE.CONFLICT: return { tone: 'bad', badge: '⚠ 저장 보류(충돌)', alert: '다른 기기에서 이 상담기록을 먼저 수정했습니다. 덮어쓸지, 저장본을 다시 열지 고르세요.' };
    case SAVE_STATE.AUTH: return { tone: 'bad', badge: '⚠ 인증 만료', alert: '접속 인증이 만료되어 저장하지 못했습니다. 기기를 다시 연결하면 이어서 저장합니다.' };
    case SAVE_STATE.READONLY: return { tone: 'warn', badge: '읽기 전용', alert: '현재 색인에서 일부 필지를 찾지 못해 이 기록은 읽기 전용으로 열었습니다(수정 저장 안 함 · 내보내기로 원본 확인).' };
    default: return { tone: '', badge: '', alert: null };
  }
}
