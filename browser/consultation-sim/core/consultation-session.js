// ConsultationDraft 세션 컨트롤러 — 기존 CaseStore와 분리된 상담 전용 상태.
// - 요청 ID + PNU + 기준연도 바인딩. 바인딩이 바뀐 뒤 도착한 응답은 폐기한다.
// - 필드별 출처·기준연도·조회시각·상태·수동수정·검수여부를 기록한다.
// - 적정 비교표준지·보정률·보상금·증액 예상액은 산정하지 않는다.
import { validatePnu } from './pnu.js';

export const STATUS = Object.freeze({
  OK: 'OFFICIAL_OK', CANDIDATE: 'CANDIDATE', NOT_QUERIED: 'NOT_QUERIED', MISMATCH: 'MISMATCH',
  FIELD_CHECK: 'FIELD_CHECK', EXPERT_REVIEW: 'EXPERT_REVIEW', KEY_REQUIRED: 'KEY_REQUIRED',
});
export const STATUS_LABEL = Object.freeze({
  OFFICIAL_OK: '공식조회 성공', CANDIDATE: '후보', NOT_QUERIED: '미조회', MISMATCH: '불일치',
  FIELD_CHECK: '현장 확인', EXPERT_REVIEW: '전문가 검토', KEY_REQUIRED: 'API 키/권한 필요',
});

export const FIELD_DEFS = Object.freeze([
  { key: 'land_category', label: '지목', group: 'LEDGER', group_label: '공부(토지특성 기재)', api: 'characteristics' },
  { key: 'area_m2', label: '면적', unit: '㎡', group: 'LEDGER', group_label: '공부(토지특성 기재)', api: 'characteristics' },
  { key: 'zoning', label: '용도지역', group: 'ZONING', group_label: '용도지역·지구', api: 'characteristics' },
  { key: 'zoning_secondary', label: '용도지구·구역', group: 'ZONING', group_label: '용도지역·지구', api: 'characteristics', optional: true },
  { key: 'price_per_m2', label: '개별공시지가', unit: '원/㎡', group: 'PRICE', group_label: '개별공시지가', api: 'price' },
  { key: 'land_use', label: '이용상황', group: 'PRICE_CHARACTERISTIC', group_label: '공시지가 산정용 토지특성', api: 'characteristics' },
  { key: 'road_access', label: '도로접면', group: 'PRICE_CHARACTERISTIC', group_label: '공시지가 산정용 토지특성', api: 'characteristics' },
  { key: 'shape', label: '형상', group: 'PRICE_CHARACTERISTIC', group_label: '공시지가 산정용 토지특성', api: 'characteristics' },
  { key: 'elevation', label: '지세(고저)', group: 'PRICE_CHARACTERISTIC', group_label: '공시지가 산정용 토지특성', api: 'characteristics' },
]);

// 지번만으로 알 수 없는 사항 — 항상 미확인으로 표시
export const UNKNOWN_FROM_LOT = Object.freeze([
  '사업명', '사업인정(고시) 여부·일자', '보상계획 공고', '가격시점', '실제 이용상황(현황)', '보상 관련 법률효과',
]);

const KEY_REQUIRED_CODES = new Set(['MAP_KEY_REQUIRED', 'VWORLD_API_KEY_MISSING', 'PUBLIC_DATA_KEY_MISSING', 'MAP_LIVE_PENDING_TERMS_REVIEW', 'API_KEY_REQUIRED', 'BRIDGE_UNREACHABLE']);

const LAND_USE_EXPECT = Object.freeze({
  '대': /(주거|상업|업무|공업|주택|다세대|아파트|연립|나지)/,
  '전': /^(전|답|과수원|전기타)$/,
  '답': /^(전|답|답기타)$/,
  '임야': /(임야|자연림|조림|토지임야)/,
  '도로': /도로/,
});

function text(value) { return value == null ? '' : String(value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

let requestSeq = 0;
function nextRequestId() { requestSeq += 1; return `REQ-${Date.now().toString(36)}-${requestSeq}`; }

export function evaluateGeometry(requestedPnu, response) {
  if (!response) return { status: 'NOT_QUERIED', code: 'MAP_NOT_REQUESTED' };
  if (!response.ok) return { status: KEY_REQUIRED_CODES.has(response.code) ? 'KEY_REQUIRED' : 'FAILED', code: response.code || 'MAP_FAILED' };
  const features = Array.isArray(response.features) ? response.features : [];
  const exact = features.filter((feature) => text(feature?.pnu) === requestedPnu);
  if (!exact.length) return { status: 'POINT_FALLBACK', code: features.length ? 'VWORLD_PNU_GEOMETRY_MISMATCH' : 'VWORLD_PNU_GEOMETRY_NOT_FOUND', returned_count: features.length };
  if (exact.length !== 1) return { status: 'POINT_FALLBACK', code: 'VWORLD_PNU_GEOMETRY_NOT_UNIQUE', exact_count: exact.length };
  return { status: 'EXACT_ONE', code: 'EXACT_ONE', geometry: exact[0].geometry };
}

function emptyField(def) {
  return {
    key: def.key, label: def.label, unit: def.unit || '', group: def.group, group_label: def.group_label,
    value: null, source: null, base_year: null, fetched_at: null, status: STATUS.NOT_QUERIED, note: '',
    override: null, reviewed: false,
  };
}

export function createDraft({ dataMode, input, candidate, baseYear, requestId }) {
  return {
    schema: 'bso-consultation-draft/0.1',
    draft_id: `CD-${Date.now().toString(36)}`,
    created_at: new Date().toISOString(),
    data_mode: dataMode,
    synthetic: dataMode === 'SYNTHETIC',
    binding: { request_id: requestId, pnu: candidate.pnu, base_year: Number(baseYear) },
    input: { context: text(input.context), lot_text: text(input.lotText) },
    parcel: { pnu: candidate.pnu, legal_dong_name: candidate.legal_dong_name, lot_label: candidate.lot_label, mountain: Boolean(candidate.mountain), region_status: candidate.region_status },
    fields: Object.fromEntries(FIELD_DEFS.map((def) => [def.key, emptyField(def)])),
    previous_year: { base_year: Number(baseYear) - 1, status: 'NOT_QUERIED', record: null },
    map: { status: 'NOT_QUERIED', code: 'MAP_NOT_REQUESTED', source: null, basemap_source: null, capture_date: null, crs: null, geometry: null, point: null, neighbors: [] },
    analysis: {
      standard_candidates: { status: 'NOT_QUERIED', items: [], reason: '표준지 후보 원천(반경조회·지역별 파일) 검증 전 — PR-2에서 연결' },
      unknowns: UNKNOWN_FROM_LOT.map((label) => ({ label, status: 'NOT_QUERIED', note: '지번만으로 확인 불가' })),
      signals: [],
    },
    review: { reviewed_by_user: false },
    saved: false,
  };
}

function applyCharacteristics(draft, response) {
  FIELD_DEFS.filter((def) => def.api === 'characteristics').forEach((def) => {
    const field = draft.fields[def.key];
    field.fetched_at = response.fetched_at || null;
    if (!response.ok) {
      field.status = KEY_REQUIRED_CODES.has(response.code) ? STATUS.KEY_REQUIRED : STATUS.NOT_QUERIED;
      field.note = `조회 실패: ${response.code}`;
      return;
    }
    field.source = response.source;
    if (response.status !== 'OK' || !response.record) {
      field.status = STATUS.NOT_QUERIED;
      field.note = response.status === 'NO_DATA_FOR_YEAR'
        ? `기준연도 자료 없음${response.available_years?.length ? ` (보유연도 ${response.available_years.join('·')} — 자동 대체하지 않음)` : ''}`
        : '해당 PNU 자료 없음';
      return;
    }
    const value = response.record[def.key];
    field.base_year = response.base_year;
    if (value == null || value === '') {
      field.status = def.optional ? STATUS.OK : STATUS.NOT_QUERIED;
      field.value = null;
      field.note = def.optional ? '해당 없음(응답상 공란)' : (response.missing_reason?.[def.key] ? `응답에 항목 없음 (${response.missing_reason[def.key]})` : '응답상 공란 — 추가 확보 필요');
      return;
    }
    field.value = value;
    field.status = STATUS.OK;
    if (def.group === 'PRICE_CHARACTERISTIC') field.note = '공시지가 산정용 표기 · 실제 현황과 다를 수 있음';
  });
}

function applyPrice(draft, response) {
  const field = draft.fields.price_per_m2;
  field.fetched_at = response.fetched_at || null;
  if (!response.ok) {
    field.status = KEY_REQUIRED_CODES.has(response.code) ? STATUS.KEY_REQUIRED : STATUS.NOT_QUERIED;
    field.note = `조회 실패: ${response.code}`;
    return;
  }
  field.source = response.source;
  if (!response.record) {
    field.status = STATUS.NOT_QUERIED;
    field.note = `기준연도 ${draft.binding.base_year} 공시지가 자료 없음${response.available_years?.length ? ` (보유연도 ${response.available_years.join('·')} — 자동 대체하지 않음)` : ''}`;
    return;
  }
  field.value = response.record.price_per_m2;
  field.base_year = response.base_year;
  if (response.status === 'YEAR_MISMATCH') {
    field.status = STATUS.MISMATCH;
    field.note = `요청 기준연도 ${draft.binding.base_year} ≠ 응답 기준연도 ${response.base_year}`;
  } else {
    field.status = STATUS.OK;
  }
}

function applyMap(draft, geometryResponse, neighborhood) {
  const gate = evaluateGeometry(draft.binding.pnu, geometryResponse);
  draft.map = {
    status: gate.status, code: gate.code,
    source: geometryResponse?.source || null, basemap_source: geometryResponse?.basemap_source || null,
    capture_date: geometryResponse?.capture_date || null, crs: geometryResponse?.crs || null,
    geometry: gate.status === 'EXACT_ONE' ? gate.geometry : null,
    point: gate.status === 'POINT_FALLBACK' ? (geometryResponse?.point || null) : null,
    neighbors: neighborhood?.ok ? neighborhood.parcels : [],
    synthetic: Boolean(geometryResponse?.synthetic),
  };
}

export function computeSignals(draft) {
  const signals = [];
  const f = draft.fields;
  const category = f.land_category.value;
  const use = f.land_use.value;
  if (category && use && LAND_USE_EXPECT[category] && !LAND_USE_EXPECT[category].test(use)) {
    signals.push({ kind: 'CATEGORY_USE_DIFF', status: STATUS.FIELD_CHECK, title: '지목과 공시지가 이용상황 표기 상이',
      detail: `지목 '${category}' · 이용상황 '${use}' — 실제 현황은 현장 확인 필요`, fields: ['land_category', 'land_use'] });
    f.land_use.status = f.land_use.status === STATUS.OK ? STATUS.FIELD_CHECK : f.land_use.status;
  }
  const prev = draft.previous_year;
  if (prev.status === 'OK' && prev.record) {
    ['land_category', 'land_use', 'road_access', 'zoning', 'shape', 'elevation'].forEach((key) => {
      const now = f[key].value; const before = prev.record[key];
      if (now != null && before != null && now !== before) {
        signals.push({ kind: 'YEAR_CHANGE', status: STATUS.MISMATCH, title: `${f[key].label} 연도 간 변경`,
          detail: `${prev.base_year}년 '${before}' → ${draft.binding.base_year}년 '${now}' — 변경 사유 확인 필요`, fields: [key] });
        if (f[key].status === STATUS.OK) f[key].status = STATUS.MISMATCH;
        f[key].note = `${prev.base_year}년 '${before}'에서 변경`;
      }
    });
  }
  Object.values(f).forEach((field) => {
    if (field.status === STATUS.NOT_QUERIED && !field.note.startsWith('조회 실패')) {
      signals.push({ kind: 'MISSING', status: STATUS.NOT_QUERIED, title: `${field.label} 미확보`, detail: field.note || '자료 없음', fields: [field.key] });
    }
  });
  if (draft.map.status === 'POINT_FALLBACK') {
    signals.push({ kind: 'MAP_GATE', status: STATUS.MISMATCH, title: '지적 도형 미확정', detail: `${draft.map.code} — 좌표 점으로만 표시, 경계 확인 필요`, fields: [] });
  }
  return signals;
}

export function createConsultationSession({ adapter, onChange = () => {} }) {
  const state = {
    phase: 'IDLE', input: null, resolution: null, draft: null, error: null,
    discarded_responses: 0, saved_drafts: [], events: [],
  };
  let binding = null;
  const notify = () => onChange(state);
  const log = (type, detail = {}) => { state.events.push({ at: new Date().toISOString(), type, ...detail }); if (state.events.length > 50) state.events.shift(); };

  function isCurrent(token) {
    return Boolean(binding && token && binding.request_id === token.request_id && binding.pnu === token.pnu && binding.base_year === token.base_year);
  }
  function guard(token, apply) {
    return (response) => {
      if (!isCurrent(token)) { state.discarded_responses += 1; log('LATE_RESPONSE_DISCARDED', { request_id: token.request_id }); notify(); return false; }
      apply(response); return true;
    };
  }

  function reset() { binding = null; state.phase = 'IDLE'; state.resolution = null; state.draft = null; state.error = null; notify(); }

  async function lookup({ context = '', lotText = '', baseYear }) {
    binding = null; // 입력 전환 즉시 이전 요청 무효화
    state.input = { context, lotText, baseYear: Number(baseYear) };
    state.phase = 'RESOLVING'; state.draft = null; state.error = null; state.resolution = null; notify();
    const token = { request_id: nextRequestId() };
    const pending = token.request_id;
    state.pending_resolve = pending;
    const resolution = await adapter.resolveParcel({ context, lotText });
    if (state.pending_resolve !== pending) { state.discarded_responses += 1; notify(); return state; }
    state.resolution = resolution;
    if (resolution.ok && resolution.auto_selectable && resolution.candidates.length === 1 && resolution.candidates[0].pnu) {
      return selectCandidate(resolution.candidates[0].pnu);
    }
    state.phase = resolution.candidates.some((c) => c.pnu) && !resolution.ok ? 'CHOOSE_CANDIDATE' : 'RESOLVE_FAILED';
    state.error = resolution.ok ? null : { code: resolution.code, message: resolution.message };
    notify();
    return state;
  }

  async function selectCandidate(pnu) {
    const candidate = state.resolution?.candidates?.find((c) => c.pnu === pnu);
    if (!candidate || !validatePnu(pnu).ok) { state.error = { code: 'CANDIDATE_INVALID', message: '선택한 후보가 유효하지 않습니다.' }; notify(); return state; }
    const baseYear = Number(state.input.baseYear);
    const token = { request_id: nextRequestId(), pnu, base_year: baseYear };
    binding = token;
    state.pending_resolve = null;
    state.phase = 'LOADING'; state.error = null;
    state.draft = createDraft({ dataMode: adapter.describe().mode, input: state.input, candidate, baseYear, requestId: token.request_id });
    log('LOOKUP_START', { request_id: token.request_id });
    notify();

    const tasks = [
      adapter.getLandCharacteristics(pnu, baseYear).then(guard(token, (res) => { applyCharacteristics(state.draft, res); notify(); })),
      adapter.getIndividualPrice(pnu, baseYear).then(guard(token, (res) => { applyPrice(state.draft, res); notify(); })),
      adapter.getLandCharacteristics(pnu, baseYear - 1).then(guard(token, (res) => {
        state.draft.previous_year = { base_year: baseYear - 1, status: res.ok && res.status === 'OK' ? 'OK' : 'NOT_QUERIED', record: res.ok ? res.record : null };
      })),
      Promise.all([adapter.getCadastralGeometry(pnu), adapter.getNeighborhood(pnu)]).then(guard(token, ([geo, hood]) => { applyMap(state.draft, geo, hood); notify(); })),
    ];
    await Promise.all(tasks.map((task) => task.catch(() => null)));
    if (!isCurrent(token)) return state;
    if (state.draft.map.status === 'NOT_QUERIED') state.draft.map = { ...state.draft.map, status: 'FAILED', code: 'MAP_REQUEST_FAILED' };
    state.draft.analysis.signals = computeSignals(state.draft);
    state.phase = 'READY';
    log('LOOKUP_DONE', { request_id: token.request_id });
    notify();
    return state;
  }

  function overrideField(key, { value, by, reason = '' }) {
    const field = state.draft?.fields?.[key];
    if (!field) return false;
    const by_ = text(by);
    if (!by_) return false;
    field.override = { value: text(value), by: by_, reason: text(reason), at: new Date().toISOString() };
    field.reviewed = false;
    notify();
    return true;
  }
  function clearOverride(key) { const field = state.draft?.fields?.[key]; if (field) { field.override = null; notify(); } }
  function markReviewed(key, reviewed = true) { const field = state.draft?.fields?.[key]; if (field) { field.reviewed = Boolean(reviewed); notify(); } }

  function saveExplicit({ confirmedByUser }) {
    if (!confirmedByUser) return { ok: false, code: 'EXPLICIT_CONFIRMATION_REQUIRED' };
    if (!state.draft || state.phase !== 'READY') return { ok: false, code: 'NOTHING_TO_SAVE' };
    const payload = buildSavePayload(state.draft);
    state.saved_drafts.push(payload);
    state.draft.saved = true;
    log('DRAFT_SAVED', { draft_id: payload.draft_id });
    notify();
    return { ok: true, payload };
  }

  return { state, lookup, selectCandidate, reset, overrideField, clearOverride, markReviewed, saveExplicit, isCurrent: () => binding };
}

const SECRET_KEY = /(api[_-]?key|service[_-]?key|servicekey|secret|token|authorization|password|^key$)/i;
const SECRET_VALUE = /([?&](key|serviceKey|apiKey)=)[^&\s"]+/gi;

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => [k, scrub(v)]));
  }
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '$1[REDACTED]');
  return value;
}

// 저장 페이로드: 지도 원본 좌표·도형·이웃 필지·조회 이벤트는 저장하지 않는다 (출처 메타와 해석값만).
export function buildSavePayload(draft) {
  const copy = clone(draft);
  copy.map = {
    status: copy.map.status, code: copy.map.code, source: copy.map.source, basemap_source: copy.map.basemap_source,
    capture_date: copy.map.capture_date || '미확인', geometry_persisted: false, raw_map_persisted: false,
  };
  delete copy.previous_year.record;
  copy.saved = true;
  copy.saved_at = new Date().toISOString();
  copy.bso_handoff = { status: 'NOT_SENT', note: 'BSO 사건 초안 전달은 PR-3에서 사용자 명시 동작으로만 수행' };
  copy.storage = 'SESSION_MEMORY_AND_USER_DOWNLOAD_ONLY';
  return scrub(copy);
}

export function effectiveValue(field) { return field.override ? field.override.value : field.value; }
