let sessionKey = '';
const sessionGeometryCache = new Map();

const API = 'https://api.vworld.kr';
const CADASTRAL_LAYERS = 'lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun';
const CADASTRAL_DATA = 'LP_PA_CBND_BUBUN';
const MAP_WIDTH = 1024;
const MAP_HEIGHT = 768;

function text(value) { return String(value == null ? '' : value).trim(); }
function arr(value) { return Array.isArray(value) ? value : []; }
function validPnu(value) { return /^\d{19}$/.test(text(value)); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

export function setSessionVworldKey(value) {
  const next = text(value);
  if (next !== sessionKey) sessionGeometryCache.clear();
  sessionKey = next;
  return Boolean(sessionKey);
}
export function hasSessionVworldKey() { return Boolean(sessionKey); }
export function clearSessionVworldKey() { sessionKey = ''; sessionGeometryCache.clear(); }

function domainValue() {
  try {
    if (['127.0.0.1','localhost'].includes(window.location.hostname)) return `${window.location.protocol}//localhost`;
    return window.location.origin;
  } catch (_error) { return ''; }
}

function jsonp(path, params, timeoutMs = 15000) {
  if (!sessionKey) return Promise.reject(Object.assign(new Error('VWORLD_KEY_REQUIRED'), { code:'VWORLD_KEY_REQUIRED' }));
  return new Promise((resolve, reject) => {
    const callback = `__bsoVworld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const url = new URL(`${API}${path}`);
    const values = { ...params, key:sessionKey, domain:domainValue(), callback };
    Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value)); });
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => { try { delete window[callback]; } catch (_error) { window[callback] = undefined; } script.remove(); };
    const fail = (code) => { if (settled) return; settled = true; cleanup(); reject(Object.assign(new Error(code), { code })); };
    const timer = setTimeout(() => fail('VWORLD_TIMEOUT'), timeoutMs);
    window[callback] = (payload) => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); resolve(payload); };
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = url.toString();
    script.onerror = () => { clearTimeout(timer); fail('VWORLD_REQUEST_FAILED'); };
    document.head.appendChild(script);
  });
}

function featureCollection(payload) { return payload?.response?.result?.featureCollection || payload?.response?.result || null; }
function featurePnu(feature) { return text(feature?.properties?.pnu || feature?.properties?.PNU); }
function geometryPoints(geometry) {
  const pairs = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) { pairs.push([Number(node[0]), Number(node[1])]); return; }
    node.forEach(walk);
  };
  walk(geometry && geometry.coordinates);
  return pairs;
}
function usableGeometry(geometry) { return ['Polygon','MultiPolygon'].includes(text(geometry?.type)) && geometryPoints(geometry).length >= 3; }
function geometryCenter(geometry) {
  const pairs = geometryPoints(geometry);
  if (!pairs.length) return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  pairs.forEach(([x,y]) => { minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); });
  return { x:(minX+maxX)/2, y:(minY+maxY)/2 };
}

async function dataFeature(params) {
  const payload = await jsonp('/req/data', {
    service:'data', version:'2.0', request:'GetFeature', format:'json', size:10, page:1,
    geometry:true, attribute:true, crs:'EPSG:4326', data:CADASTRAL_DATA, ...params,
  });
  const status = text(payload?.response?.status).toUpperCase();
  if (status && status !== 'OK') throw Object.assign(new Error('VWORLD_DATA_API_REJECTED'), { code:'VWORLD_DATA_API_REJECTED', response_status:status });
  return arr(featureCollection(payload)?.features).filter((feature) => usableGeometry(feature?.geometry));
}
async function featureFromPnu(pnu) {
  const requestedPnu = text(pnu);
  if (!validPnu(requestedPnu)) throw Object.assign(new Error('PNU_19_DIGITS_REQUIRED'), { code:'PNU_19_DIGITS_REQUIRED' });
  if (sessionGeometryCache.has(requestedPnu)) return { feature:clone(sessionGeometryCache.get(requestedPnu)), cache_hit:true };
  const features = await dataFeature({ attrFilter:`pnu:=:${requestedPnu}` });
  const exact = features.filter((feature) => featurePnu(feature) === requestedPnu);
  if (!exact.length) {
    const code = features.length ? 'VWORLD_PNU_GEOMETRY_MISMATCH' : 'VWORLD_PNU_GEOMETRY_NOT_FOUND';
    throw Object.assign(new Error(code), { code, requested_pnu:requestedPnu, returned_count:features.length });
  }
  if (exact.length !== 1) {
    throw Object.assign(new Error('VWORLD_PNU_GEOMETRY_NOT_UNIQUE'), { code:'VWORLD_PNU_GEOMETRY_NOT_UNIQUE', requested_pnu:requestedPnu, exact_count:exact.length });
  }
  sessionGeometryCache.set(requestedPnu, clone(exact[0]));
  return { feature:clone(exact[0]), cache_hit:false };
}
function normalizeParcel(value) { return text(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function plausibleParcelAddress(value) {
  const normalized = normalizeParcel(value);
  return /(?:읍|면|동|리)\s+산?\d+(?:-\d+)?(?:\s|$)/.test(normalized);
}
function searchItems(payload) {
  const response = payload?.response;
  if (!response || text(response.status).toUpperCase() !== 'OK') return [];
  return arr(response?.result?.items);
}
function searchCandidate(item) {
  const pnu = text(item?.id || item?.pnu);
  const parcel = normalizeParcel(item?.address?.parcel || item?.title);
  const x = Number(item?.point?.x); const y = Number(item?.point?.y);
  if (!validPnu(pnu) || !parcel || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { pnu, parcel_address:parcel, x, y };
}
function administrativeTokens(address) {
  return normalizeParcel(address).split(/\s+/).filter((token)=>/(?:특별자치시|특별자치도|광역시|도|시|군|구|읍|면|동|리)$/.test(token));
}
function hintScore(candidate, contextHint) {
  const compact=text(contextHint).replace(/\s+/g,'');
  if(!compact)return 0;
  return administrativeTokens(candidate.parcel_address).reduce((score,token)=>{
    const stem=token.replace(/(?:특별자치시|특별자치도|광역시|도|시|군|구|읍|면|동|리)$/,'');
    return score + (stem.length>=2 && compact.includes(stem) ? 1 : 0);
  },0);
}
async function exactParcelFromSearch(address, contextHint = '') {
  const payload = await jsonp('/req/search', {
    service:'search', request:'search', version:'2.0', crs:'EPSG:4326',
    size:10, page:1, query:address, type:'address', category:'parcel', format:'json',
  });
  const candidates = searchItems(payload).map(searchCandidate).filter(Boolean);
  const query = normalizeParcel(address);
  const suffix = candidates.filter((candidate) => candidate.parcel_address === query || candidate.parcel_address.endsWith(` ${query}`));
  if (suffix.length === 1) return suffix[0];
  if(suffix.length>1 && text(contextHint)){
    const scored=suffix.map((candidate)=>({candidate,score:hintScore(candidate,contextHint)}));
    const best=Math.max(...scored.map((row)=>row.score));
    const winners=scored.filter((row)=>row.score===best && best>0);
    if(winners.length===1)return {...winners[0].candidate,context_match_score:best};
  }
  if (!suffix.length && candidates.length === 1) return candidates[0];
  const code = candidates.length ? 'VWORLD_ADDRESS_AMBIGUOUS' : 'VWORLD_ADDRESS_NOT_FOUND';
  throw Object.assign(new Error(code), { code, candidate_count:candidates.length });
}

export async function resolveVworldLocation(row) {
  const pnu = text(row?.pnu);
  const address = text(row?.parcel_address || row?.address);
  let exactPnuError = '';
  if (validPnu(pnu)) {
    try {
      const verified = await featureFromPnu(pnu);
      const feature = verified.feature;
      const center = feature && geometryCenter(feature.geometry);
      if (feature && center) return { ...center, feature, pnu, address, source:'VWORLD_DATA_API_PNU', geometry_status:'POLYGON_EXACT_PNU', geometry_verification_status:'EXACT_ONE', geometry_cache_hit:verified.cache_hit };
      exactPnuError = 'VWORLD_PNU_GEOMETRY_INVALID';
    } catch (error) { exactPnuError = error?.code || 'PNU_EXACT_GEOMETRY_FAILED'; }
  }
  if (!address) throw Object.assign(new Error('ADDRESS_REQUIRED'), { code:'ADDRESS_REQUIRED' });
  const searched = await exactParcelFromSearch(address,row?.context_hint);
  if (validPnu(pnu) && searched.pnu !== pnu) {
    throw Object.assign(new Error('VWORLD_PNU_ADDRESS_MISMATCH'), { code:'VWORLD_PNU_ADDRESS_MISMATCH', requested_pnu:pnu, searched_pnu:searched.pnu });
  }
  if (validPnu(pnu)) {
    return { x:searched.x, y:searched.y, pnu, address:searched.parcel_address, source:'VWORLD_SEARCH_API', geometry_status:'POINT_FALLBACK', geometry_verification_status:'FALLBACK_POINT_ONLY', geometry_note:exactPnuError || 'PARCEL_GEOMETRY_UNAVAILABLE' };
  }
  try {
    const verified = await featureFromPnu(searched.pnu);
    const feature = verified.feature;
    const center = feature && geometryCenter(feature.geometry);
    if (feature && center) return { ...center, feature, pnu:searched.pnu, address:searched.parcel_address, source:'VWORLD_SEARCH_PNU_DATA_API', geometry_status:'POLYGON_EXACT_SEARCH_PNU', geometry_verification_status:'EXACT_ONE', geometry_cache_hit:verified.cache_hit, geometry_note:exactPnuError };
  } catch (error) { exactPnuError = error?.code || exactPnuError || 'PARCEL_GEOMETRY_UNAVAILABLE'; }
  return { x:searched.x, y:searched.y, pnu:searched.pnu, address:searched.parcel_address, source:'VWORLD_SEARCH_API', geometry_status:'POINT_FALLBACK', geometry_verification_status:'FALLBACK_POINT_ONLY', geometry_note:exactPnuError || 'PARCEL_GEOMETRY_UNAVAILABLE' };
}

export async function resolveVworldPoint(row) { return resolveVworldLocation(row); }

export function buildStaticMapUrl({ key = sessionKey, x, y, basemap = 'PHOTO', zoom = 18, size = `${MAP_WIDTH},${MAP_HEIGHT}`, label = '', layers = '' }) {
  if (!text(key)) throw Object.assign(new Error('VWORLD_KEY_REQUIRED'), { code:'VWORLD_KEY_REQUIRED' });
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) throw Object.assign(new Error('MAP_CENTER_REQUIRED'), { code:'MAP_CENTER_REQUIRED' });
  const url = new URL(`${API}/req/image`);
  const params = { service:'image', version:'2.0', request:'getmap', format:'png', basemap, crs:'EPSG:4326', zoom, size, key:text(key), domain:domainValue(), center:`${Number(x)},${Number(y)}` };
  if (text(label)) params.marker = `label:${String(label).slice(0,3)}|color:red|point:${Number(x)} ${Number(y)}`;
  if (layers) params.layers = layers;
  Object.entries(params).forEach(([name,value]) => url.searchParams.set(name,String(value)));
  return url.toString();
}

function normalizedAddress(value) { return text(value).replace(/\s+/g,' '); }
function symbolKey(value) { return text(value).replace(/[^0-9A-Za-z가-힣]/g,'').toUpperCase(); }
function publicPnuForLand(state, row) {
  if (validPnu(row?.pnu)) return text(row.pnu);
  const landId = text(row?.land_id); const address = normalizedAddress(row?.parcel_address);
  const matches = arr(state?.publicLandCharacteristics).filter((candidate) => (
    (landId && text(candidate?.land_id) === landId) || (address && normalizedAddress(candidate?.parcel_address || candidate?.address) === address)
  )).filter((candidate) => validPnu(candidate?.pnu));
  return matches.length === 1 ? text(matches[0].pnu) : '';
}

function quickRows(state) {
  const raw = [];
  const contextHint=text(state?.caseInfo?.case_name || state?.caseInfo?.project_name);
  const push = (role, row) => {
    const parcelAddress = text(row?.parcel_address || row?.address);
    const pnu = role === 'TARGET' ? publicPnuForLand(state, row) : text(row?.pnu);
    if (!parcelAddress && !validPnu(pnu)) return;
    raw.push({
      role, pnu, parcel_address:parcelAddress, context_hint:contextHint,
      source_id:text(row?.land_id || row?.standard_land_id || row?.comp_case_id || row?.case_id || row?.transaction_case_id),
      source_symbol:symbolKey(row?.standard_land_symbol || row?.case_symbol),
      map_aliases:[{
        source_id:text(row?.land_id || row?.standard_land_id || row?.comp_case_id || row?.case_id || row?.transaction_case_id),
        source_symbol:symbolKey(row?.standard_land_symbol || row?.case_symbol),
        appraisal_id:text(row?.appraisal_id),
      }],
    });
  };
  arr(state?.lands).forEach((row) => push('TARGET', row));
  arr(state?.standardLands).forEach((row) => push('STANDARD', row));
  arr(state?.transactionCases).forEach((row) => push('CASE', row));
  const grouped = new Map(); const counts = { TARGET:0, STANDARD:0, CASE:0 };
  raw.forEach((row) => {
    const key=`${row.role}|${row.pnu || row.parcel_address}`;
    const current=grouped.get(key);
    if(!current){grouped.set(key,row);return;}
    const aliases=[...arr(current.map_aliases),...arr(row.map_aliases)];const aliasSeen=new Set();
    current.map_aliases=aliases.filter((alias)=>{const aliasKey=[alias.source_id,alias.source_symbol,alias.appraisal_id].map(text).join('|');if(aliasSeen.has(aliasKey))return false;aliasSeen.add(aliasKey);return true;});
  });
  return [...grouped.values()]
    .slice(0,36)
    .map((row) => { counts[row.role] += 1; const prefix = row.role === 'TARGET' ? 'T' : row.role === 'STANDARD' ? 'S' : 'C'; return { ...row, label:`${prefix}${counts[row.role]}` }; });
}

function mapRowKey(row) { return `${row.role}|${row.source_id || ''}|${row.pnu || row.parcel_address}`; }
function aliasRows(row) { return arr(row?.map_aliases).length ? arr(row.map_aliases) : [{source_id:row?.source_id,source_symbol:row?.source_symbol,appraisal_id:row?.appraisal_id}]; }
function hasAliasId(row,id) { const wanted=text(id);return Boolean(wanted)&&aliasRows(row).some((alias)=>text(alias?.source_id)===wanted); }
function hasAliasSymbol(row,symbol,appraisalId='') {
  const wanted=symbolKey(symbol);const appraisal=text(appraisalId);
  return Boolean(wanted)&&aliasRows(row).some((alias)=>symbolKey(alias?.source_symbol)===wanted&&(!appraisal||text(alias?.appraisal_id)===appraisal));
}
function firstMap(maps, role, ids = [], symbols = []) {
  const wantedIds = new Set(ids.map(text).filter(Boolean));
  const wantedSymbols = new Set(symbols.map(text).filter(Boolean));
  return maps.find((row) => row.role === role && (
    (wantedIds.size && wantedIds.has(text(row.source_id))) ||
    (wantedSymbols.size && wantedSymbols.has(text(row.source_symbol)))
  ));
}
function uniqueMap(candidates) { return candidates.length === 1 ? candidates[0] : null; }
function targetForLink(maps, state, link) {
  const byId=maps.filter((row)=>row.role==='TARGET' && hasAliasId(row,link?.land_id));
  if(byId.length===1)return byId[0];
  const land=arr(state?.lands).find((row)=>text(row?.land_id)===text(link?.land_id));
  const address=normalizedAddress(link?.parcel_address || land?.parcel_address);
  return address ? uniqueMap(maps.filter((row)=>row.role==='TARGET' && normalizedAddress(row.parcel_address)===address)) : null;
}
function standardForLink(maps, state, link) {
  const id=text(link?.standard_land_id); const symbol=symbolKey(link?.standard_land_symbol);
  const address=normalizedAddress(link?.standard_parcel_address);
  let candidates=maps.filter((row)=>row.role==='STANDARD');
  if(id){const found=candidates.filter((row)=>hasAliasId(row,id));if(found.length===1)return found[0];}
  if(address){const found=candidates.filter((row)=>normalizedAddress(row.parcel_address)===address);if(found.length===1)return found[0];}
  if(symbol){
    const found=candidates.filter((row)=>hasAliasSymbol(row,symbol));
    if(found.length===1)return found[0];
    const scoped=found.filter((row)=>hasAliasSymbol(row,symbol,link?.appraisal_id));
    if(scoped.length===1)return scoped[0];
  }
  return null;
}
function caseForLink(maps, link) {
  const ids=[link?.comp_case_id,link?.case_id,link?.transaction_case_id].map(text).filter(Boolean);
  if(ids.length){const found=maps.filter((row)=>row.role==='CASE' && ids.some((id)=>hasAliasId(row,id)));if(found.length===1)return found[0];}
  const symbol=symbolKey(link?.comparison_case_symbol || link?.case_symbol);
  if(symbol){const found=maps.filter((row)=>row.role==='CASE' && hasAliasSymbol(row,symbol,link?.appraisal_id));if(found.length===1)return found[0];}
  const address=normalizedAddress(link?.comp_case_parcel_address || link?.case_parcel_address);
  return address ? uniqueMap(maps.filter((row)=>row.role==='CASE' && normalizedAddress(row.parcel_address)===address)) : null;
}
function comparisonSpecs(state, maps, inputRows=maps) {
  const verifiedMaps = maps.filter((row) => row.geometry_verification_status === 'EXACT_ONE' && usableGeometry(row.geometry));
  const standards = arr(state?.standardLands);
  const cases = arr(state?.transactionCases);
  const specs = []; const seen = new Set(); const rejected=[]; const rejectedSeen=new Set();
  const reject = (row) => {
    const key=[row.kind,row.item_ref||row.parcel_address||row.land_id,row.standard_land_id,row.standard_land_symbol,row.comp_case_id,row.reason].map(text).join('|');
    if(rejectedSeen.has(key))return;rejectedSeen.add(key);rejected.push(row);
  };
  const add = (kind, left, right, source) => {
    if (!left || !right) return;
    const key = `${kind}|${mapRowKey(left)}|${mapRowKey(right)}`;
    if (seen.has(key)) return; seen.add(key);
    const number = specs.filter((row) => row.kind === kind).length + 1;
    specs.push({ kind, number, rows:[left,right], source });
  };
  const subjectLinks = [
    ...arr(state?.subjectFactorDetails),
    ...arr(state?.subjectFactorTotals),
    ...arr(state?.comparisonSummaryByLand),
    ...arr(state?.appraisalResults),
  ];
  subjectLinks.forEach((link) => {
    const land = targetForLink(verifiedMaps,state,link);
    const standard = standardForLink(verifiedMaps,state,link);
    const targetInput=targetForLink(inputRows,state,link);const standardInput=standardForLink(inputRows,state,link);
    const sourceLand=arr(state?.lands).find((row)=>text(row?.land_id)===text(link?.land_id));
    if(!land||!standard)reject({kind:'SUBJECT_STANDARD',item_ref:!land?text(targetInput?.label):text(standardInput?.label),land_id:text(link?.land_id),parcel_address:text(link?.parcel_address||sourceLand?.parcel_address),standard_land_id:text(link?.standard_land_id),standard_land_symbol:text(link?.standard_land_symbol),reason:!land?'TARGET_EXACT_POLYGON_NOT_MATCHED':'STANDARD_EXACT_POLYGON_NOT_MATCHED'});
    add('SUBJECT_STANDARD', land, standard, link);
  });
  const standardCaseLinks=[
    ...arr(state?.standardToCompCaseFactors),
    ...arr(state?.otherFactors).filter((row)=>text(row?.comp_case_id || row?.case_id || row?.comparison_case_symbol || row?.comp_case_parcel_address)),
  ];
  standardCaseLinks.forEach((link) => {
    const standard = standardForLink(verifiedMaps,state,link);
    const compCase = caseForLink(verifiedMaps,link);
    const standardInput=standardForLink(inputRows,state,link);const caseInput=caseForLink(inputRows,link);
    if(!standard||!compCase)reject({kind:'STANDARD_CASE',item_ref:!standard?text(standardInput?.label):text(caseInput?.label),standard_land_id:text(link?.standard_land_id),standard_land_symbol:text(link?.standard_land_symbol),comp_case_id:text(link?.comp_case_id || link?.case_id),reason:!standard?'STANDARD_EXACT_POLYGON_NOT_MATCHED':'CASE_EXACT_POLYGON_NOT_MATCHED'});
    add('STANDARD_CASE', standard, compCase, link);
  });
  return {specs,rejected};
}

function mercatorNormalized([lon, lat]) {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const sin = Math.sin(safeLat * Math.PI / 180);
  return [(Number(lon) + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}
function inverseMercator([x, y]) {
  const lon = x * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  return [lon, lat];
}
function fitStaticView(maps, options = {}) {
  const points = maps.flatMap((row) => geometryPoints(row.geometry));
  if (!points.length) throw Object.assign(new Error('MAP_LOCATION_INPUT_MISSING'), { code:'MAP_LOCATION_INPUT_MISSING' });
  const projected = points.map(mercatorNormalized);
  const xs = projected.map((point) => point[0]); const ys = projected.map((point) => point[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const center=inverseMercator([(minX+maxX)/2,(minY+maxY)/2]);
  const spanX=Math.max(1e-12,maxX-minX); const spanY=Math.max(1e-12,maxY-minY);
  const padding=Math.max(36,Number(options.padding)||100);let zoom=Math.min(18,Number(options.maxZoom)||18);
  for (; zoom>6; zoom-=1) {
    const scale=256*(2**zoom);
    if (spanX*scale<=MAP_WIDTH-padding && spanY*scale<=MAP_HEIGHT-padding) break;
  }
  return { center, zoom, width:MAP_WIDTH, height:MAP_HEIGHT };
}

function previewFromMaps(maps, failures, view, caseName, basemap, meta = {}) {
  const roles = ['TARGET','STANDARD','CASE'];
  const layers = roles.map((role) => {
    const features = maps.filter((row)=>row.role===role).map((row)=>({
      type:'Feature', id:`${role}_${row.label}`,
      geometry:clone(row.geometry),
      properties:{ role, display_label:row.label, label:row.label, parcel_address:row.parcel_address, pnu:row.pnu || '', coordinate_source:row.coordinate_source, geometry_status:row.geometry_status, geometry_verification_status:row.geometry_verification_status || '', geometry_note:row.geometry_note || '', review_required:true, auto_confirmed:false },
    }));
    return features.length ? { role, feature_collection:{ type:'FeatureCollection', features } } : null;
  }).filter(Boolean);
  const pointFallbacks = maps.filter((row)=>row.geometry_status==='POINT_FALLBACK');
  return {
    schema_version:'0.2', artifact_type:'LK_MAP_PREVIEW', preview_id:`VWORLD_API_${Date.now().toString(36)}`,
    title:meta.title || `${caseName || '현재 사건'} · 전체 위치도`,
    map_scope:meta.scope || 'OVERVIEW', comparison_index:meta.index || null,
    coordinate_space:{ crs:'EPSG:4326', axis_order:'XY', dimensions:2, geometry_encoding:'GEOJSON_GEOMETRY_2D', rfc7946:true },
    style_profile:'LK_ROLE_STYLE_V2',
    view:{ fit_mode:'VWORLD_STATIC_IMAGE', background:{ basemap, center:view.center, zoom:view.zoom, size:[view.width,view.height], projection:'WEB_MERCATOR_TILE_256' } },
    presentation:{ report_graphic:Boolean(meta.reportGraphic), insets:meta.insets!==false },
    layers,
    omissions:failures.map((row)=>({ role:row.role, label:row.label, reason:row.error_code })),
    warnings:pointFallbacks.map((row)=>({ code:'PARCEL_POLYGON_UNAVAILABLE', label:row.label, message:'PNU 폴리곤을 확인하지 못해 주소 좌표를 라벨 점으로 표시했습니다.' })),
    provenance:{ privacy_profile:'MINIMIZED_BROWSER_API', generator:'vworld_api_quick_map', background_source:'VWORLD_STATIC_MAP_API', cadastral_source:CADASTRAL_DATA, geometry_verification:'PNU_EXACT_ONE', api_values_status:'REVIEW_REQUIRED', key_persisted:false, api_response_persisted:false },
    review_required:true, auto_confirmed:false,
  };
}

export async function buildQuickMaps(state, onProgress = () => {}, options = {}) {
  if (!sessionKey) throw Object.assign(new Error('VWORLD_KEY_REQUIRED'), { code:'VWORLD_KEY_REQUIRED' });
  const basemap = options?.basemap === 'PHOTO_HYBRID' ? 'PHOTO_HYBRID' : 'PHOTO';
  const rows = quickRows(state);
  if (!rows.length) throw Object.assign(new Error('MAP_LOCATION_INPUT_MISSING'), { code:'MAP_LOCATION_INPUT_MISSING' });
  const maps = []; const failures = [];
  for (let index=0; index<rows.length; index += 1) {
    const row = rows[index];
    onProgress({ index:index+1, total:rows.length, label:row.label });
    try {
      if(!validPnu(row.pnu)&&!plausibleParcelAddress(row.parcel_address))throw Object.assign(new Error('PARCEL_ADDRESS_REVIEW_REQUIRED'),{code:'PARCEL_ADDRESS_REVIEW_REQUIRED'});
      const location = await resolveVworldLocation(row);
      const geometry = usableGeometry(location.feature?.geometry) ? clone(location.feature.geometry) : { type:'Point', coordinates:[location.x,location.y] };
      maps.push({ ...row, pnu:location.pnu || row.pnu, center:{ x:location.x, y:location.y }, geometry, geometry_status:location.geometry_status, geometry_verification_status:location.geometry_verification_status || 'FALLBACK_POINT_ONLY', geometry_cache_hit:Boolean(location.geometry_cache_hit), geometry_note:location.geometry_note || '', coordinate_source:location.source, review_required:true, auto_confirmed:false });
    } catch (error) {
      failures.push({ role:row.role, label:row.label, parcel_address:row.parcel_address, error_code:error?.code || 'VWORLD_MAP_FAILED' });
    }
  }
  if (!maps.length) throw Object.assign(new Error('VWORLD_MAP_ALL_FAILED'), { code:'VWORLD_MAP_ALL_FAILED', details:failures.map((row)=>`${row.label}:${row.error_code}`) });
  const view=fitStaticView(maps,{padding:64,maxZoom:18});
  const mapPreview=previewFromMaps(maps,failures,view,text(state?.caseInfo?.case_name || state?.caseInfo?.project_name),basemap);
  const backgroundUrl=buildStaticMapUrl({ x:view.center[0], y:view.center[1], basemap, zoom:view.zoom, size:`${view.width},${view.height}`, label:'' });
  const renderPreview=clone(mapPreview);
  renderPreview.view.background.url=backgroundUrl;
  const caseName=text(state?.caseInfo?.case_name || state?.caseInfo?.project_name) || '현재 사건';
  const comparisonMatch=comparisonSpecs(state,maps,rows);
  const comparisonPreviews=comparisonMatch.specs.map((spec) => {
    const pairView=fitStaticView(spec.rows,{padding:40,maxZoom:18});
    const subjectStandard=spec.kind==='SUBJECT_STANDARD';
    const title=subjectStandard
      ? `${caseName} · 편입토지–비교표준지 ${spec.number}`
      : `${caseName} · 비교표준지–평가·거래사례 ${spec.number}`;
    const preview=previewFromMaps(spec.rows,[],pairView,caseName,basemap,{title,scope:spec.kind,index:spec.number,reportGraphic:true,insets:true});
    preview.match_reference={
      comparison_id:text(spec.source?.comparison_id || spec.source?.appraisal_result_id),
      appraisal_id:text(spec.source?.appraisal_id), review_required:true,
    };
    const rendered=clone(preview);
    rendered.view.background.url=buildStaticMapUrl({ x:pairView.center[0], y:pairView.center[1], basemap, zoom:pairView.zoom, size:`${pairView.width},${pairView.height}`, label:'' });
    return rendered;
  });
  return {
    ok:true, maps, failures, map_preview:mapPreview, render_preview:renderPreview,
    render_previews:[renderPreview,...comparisonPreviews],
    comparison_previews:comparisonPreviews,
    comparison_counts:{
      subject_standard:comparisonPreviews.filter((row)=>row.map_scope==='SUBJECT_STANDARD').length,
      standard_case:comparisonPreviews.filter((row)=>row.map_scope==='STANDARD_CASE').length,
    },
    match_inputs:{
      subject_standard:[...arr(state?.subjectFactorDetails),...arr(state?.subjectFactorTotals),...arr(state?.comparisonSummaryByLand),...arr(state?.appraisalResults)].length,
      standard_case:[...arr(state?.standardToCompCaseFactors),...arr(state?.otherFactors).filter((row)=>text(row?.comp_case_id || row?.case_id || row?.comparison_case_symbol || row?.comp_case_parcel_address))].length,
    },
    match_rejections:comparisonMatch.rejected,
    polygon_count:maps.filter((row)=>row.geometry_status!=='POINT_FALLBACK').length,
    point_count:maps.filter((row)=>row.geometry_status==='POINT_FALLBACK').length,
    exact_one_count:maps.filter((row)=>row.geometry_verification_status==='EXACT_ONE').length,
    cache_hit_count:maps.filter((row)=>row.geometry_cache_hit).length,
    point_fallbacks:maps.filter((row)=>row.geometry_status==='POINT_FALLBACK').map((row)=>({ role:row.role, label:row.label, pnu:row.pnu, parcel_address:row.parcel_address, reason:row.geometry_note || 'PARCEL_GEOMETRY_UNAVAILABLE' })),
    review_required:true, auto_confirmed:false, key_persisted:false, api_response_persisted:false,
  };
}

export const VWORLD_API_MAP_CONTRACT = Object.freeze({
  mode:'API_ONLY_QUICK_MAP', local_cadastral_archive_required:false, qgis_required:false,
  browser_session_key_only:true, registered_domain_localhost_compatible:true,
  layers:['TARGET','STANDARD','CASE'], labels:['T1','S1','C1'],
  colors:{ TARGET:'YELLOW', STANDARD:'RED', CASE:'BLUE' },
  geometry:'PNU_EXACT_ONE_POLYGON_WITH_LABELED_POINT_FALLBACK', address_resolution:'VWORLD_SEARCH_UNIQUE_PARCEL_TO_EXACT_PNU', report_geometry_gate:'EXACT_ONE_POLYGON_ONLY', session_geometry_cache_only:true, api_response_persisted:false, legend:true, title:true, png_export:true,
  outputs:['OVERVIEW','SUBJECT_STANDARD_PER_MATCH','STANDARD_CASE_PER_MATCH'], pair_scale:'FIT_EACH_EXPLICIT_MATCH', pair_detail:'CONDITIONAL_AERIAL_INSETS_FOR_SMALL_PARCELS',
  default_basemap:'PHOTO', basemaps:['PHOTO','PHOTO_HYBRID'], cadastral_source:'VWORLD_API_LP_PA_CBND_BUBUN',
});
