import { buildIssueCandidates } from './issue-engine.js';
import { appraisalResultComplete } from './appraisal-coverage.js';
import { validateDocumentWorkflow } from './document-workflow.js';

const REVIEW_PENDING = new Set(['NEEDS_REVIEW', 'MISSING', 'LOW_CONFIDENCE', 'OCR_REQUIRED', 'PARSE_FAILED']);
const FILE_NAME_COMPANY_STOPWORDS = new Set(['감정평가서','평가서','감정평가','세부내역','산출근거','토지','지장물','영업','협의','보상','수용재결','이의재결','재결','수용','이의','초안','최종','사본','요약','검토용','원본','스캔','주','주식회사']);
const PURPOSE_PATTERNS = [
  ['보상(사업인정 후 협의)', /보상\s*\(\s*사업\s*인정\s*후\s*협의\s*\)/],
  ['보상(협의)', /보상\s*\(\s*협의\s*\)|협의\s*보상/],
  ['보상(수용재결)', /보상\s*\(\s*수용\s*재결\s*\)|수용\s*재결\s*목적/],
  ['보상(이의재결)', /보상\s*\(\s*이의\s*재결\s*\)|이의\s*재결\s*목적/],
];
const CASE_INFO_FIELDS = Object.freeze(['case_name','project_name','appraisal_purpose','base_date','price_date']);
const LAND_CATEGORY_ALIASES = Object.freeze({ 임:'임야', 과:'과수원', 목:'목장용지', 장:'공장용지', 학:'학교용지', 차:'주차장', 주:'주유소용지', 창:'창고용지', 도:'도로', 철:'철도용지', 제:'제방', 천:'하천', 구:'구거', 유:'유지', 양:'양어장', 수:'수도용지', 공:'공원', 체:'체육용지', 원:'유원지', 종:'종교용지', 사:'사적지', 묘:'묘지', 잡:'잡종지' });
function arr(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value == null ? '' : String(value).trim(); }
function numberKey(value) { const n = Number(value); return Number.isFinite(n) ? String(n) : ''; }
function categoryKey(value) { const token = text(value).replace(/\s+/g,''); return LAND_CATEGORY_ALIASES[token] || token; }
function parcelIdentity(value) {
  const normalized = text(value).replace(/산\s+(?=\d)/g,'산').replace(/\s+/g,' ');
  const lot = normalized.match(/(?:^|\s)((?:산)?\d{1,5}(?:-\d{1,5})?)(?:번지)?\s*$/);
  if (!lot) return normalized;
  const prefix = normalized.slice(0, lot.index).trim().split(/\s+/).filter(Boolean);
  return `${prefix.join(' ')}|${lot[1]}`;
}

function compatibleParcelLocation(left, right) {
  // A shared dong/ri name is not a unique location. Preserve explicit higher
  // jurisdictions and PNU disagreements instead of linking unrelated land rows.
  if (validPnu(left?.pnu) && validPnu(right?.pnu) && text(left.pnu) !== text(right.pnu)) return false;
  const b = parcelIdentity(right?.parcel_address).split('|');
  const addresses = [left?.parcel_address, ...arr(left?.parcel_address_variants)].filter(text);
  return addresses.length > 0 && addresses.every(address=>{
    const a = parcelIdentity(address).split('|');
    if (a.length !== 2 || b.length !== 2 || a[1] !== b[1] || !a[0] || !b[0]) return false;
    return a[0] === b[0] || a[0].endsWith(' ' + b[0]) || b[0].endsWith(' ' + a[0]);
  });
}
function compatibleLandEvidence(left, right) {
  return compatibleParcelLocation(left,right) && numberKey(left?.area)===numberKey(right?.area)
    && (categoryKey(left?.land_category)===categoryKey(right?.land_category) || !categoryKey(left?.land_category) || !categoryKey(right?.land_category));
}

function explicitMember(row) {
  return text(row.member_no) && row.member_no_origin === 'EXPLICIT_STATEMENT_HEADER'
    && row.member_no_evidence_version === 2 && arr(row.member_no_source_refs).length >= 2;
}
function hasMemberEvidence(row) { return Boolean(text(row.member_no) || text(row.ownership_identity_status)); }

const PARSE_HOLD_STATUS = 'PARSE_HOLD';

// 승격 게이트는 parser/src/parse_sanity_gate.js 하나뿐이다. 브라우저 번들이 그것을 그대로 쓴다.
// 번들이 아직 없으면(구버전) 판정을 지어내지 않고 HOLD 로 둔다.
function evaluateDocumentSanity(parsed) {
  const gate = globalThis.window && globalThis.window.BosangParser && globalThis.window.BosangParser.evaluateParseSanity;
  if (typeof gate !== 'function') {
    return { status: PARSE_HOLD_STATUS, hold_codes: ['SANITY_GATE_UNAVAILABLE'], holds: [{ code: 'SANITY_GATE_UNAVAILABLE', detail: '승격 게이트를 불러오지 못해 판정할 수 없습니다.' }] };
  }
  const result = gate(parsed) || {};
  return { status: result.status || PARSE_HOLD_STATUS, hold_codes: arr(result.hold_codes), holds: arr(result.holds) };
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function nonEmptyObject(source) { const out = {}; Object.entries(source || {}).forEach(([key, value]) => { if (value !== null && value !== undefined && value !== '') out[key] = clone(value); }); return out; }
function recordStatus(row) { return text(row && (row.review_status_code || row.extraction_status || row.parse_status)).toUpperCase(); }
function needsExceptionReview(row) { return REVIEW_PENDING.has(recordStatus(row)) || text(row && row.confidence_level).toUpperCase() === 'LOW'; }
function validPnu(value) { return /^\d{19}$/.test(text(value)); }
function plausibleParcelAddress(value) {
  const normalized=text(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  return /(?:읍|면|동|리|\d가)\s+산?\d+(?:-\d+)?(?:\s|$)/.test(normalized);
}
function standardLandLocationReviewRequired(row) { return !validPnu(row?.pnu) && !plausibleParcelAddress(row?.parcel_address || row?.address); }
function issueSignature(rows) { return JSON.stringify(arr(rows).map((row) => [row.issue_id, row.issue_code, row.severity, row.description])); }
function sourceRefKey(ref) { return [ref?.appraisal_id,ref?.page_no,ref?.line_start,ref?.line_end,ref?.source_label,ref?.raw_text_excerpt].map(text).join('|'); }
function mergeSourceRefs(left, right) {
  const seen = new Set();
  return [...arr(left),...arr(right)].filter((ref) => { const key=sourceRefKey(ref); if(seen.has(key)) return false; seen.add(key); return true; }).map(clone);
}
const APPRAISAL_VALUE_FIELDS = Object.freeze(['standard_land_symbol','official_price','time_correction','regional_factor','individual_factor_total','other_factor','calculated_unit_price','unit_price','amount']);
function runtimeMissingAppraisalResult(land, appraisalId, appraisalCompany, index) {
  return {
    appraisal_result_id:`LAR_MISSING_RUNTIME_${appraisalId}_${String(index + 1).padStart(3,'0')}`,
    appraisal_id:appraisalId,
    appraisal_company:appraisalCompany,
    land_id:land.land_id,
    land_no:land.land_no || land.serial_no || '',
    subject_link_status:'MISSING_REVIEW_REQUIRED',
    parcel_address:land.parcel_address || '',
    land_category:land.land_category || '',
    area:land.area ?? null,
    standard_land_symbol:'', official_price:null, time_correction:null, regional_factor:null,
    individual_factor_total:null, other_factor:null, calculated_unit_price:null, unit_price:null, amount:null,
    missing_fields:[...APPRAISAL_VALUE_FIELDS],
    source_refs:arr(land.source_refs).map(clone), confidence_level:'LOW', review_status_code:'MISSING', auto_confirmed:false,
    action_required:'평가검토 화면의 원문·수정에서 평가서 기재 적용단가와 평가금액을 입력하거나 원본을 교체해 다시 추출하세요.',
    parser_notes:'편입토지는 있으나 연결된 평가행이 없습니다. 값을 만들지 않고 누락 검토행으로 표시했습니다.',
  };
}
function normalizeEditedAppraisalResult(row) {
  const missingFields=APPRAISAL_VALUE_FIELDS.filter((field)=>row[field]===null||row[field]===undefined||row[field]==='');
  const requiredReady=['unit_price','amount'].every((field)=>row[field]!==null&&row[field]!==''&&Number.isFinite(Number(row[field])));
  return {
    ...row,
    subject_link_status:requiredReady?'MANUALLY_LINKED_REVIEW_REQUIRED':'MISSING_REVIEW_REQUIRED',
    review_status_code:requiredReady?'NEEDS_REVIEW':'MISSING',
    missing_fields:missingFields,
    action_required:requiredReady?'':'평가서 기재 적용단가와 평가금액을 모두 입력해야 검수완료할 수 있습니다.',
    auto_confirmed:false,
  };
}
function deriveCompanyFromFileName(fileName) {
  const base = text(fileName).split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{1,6}$/, '');
  const candidates = [...base.matchAll(/[(（]([^()（）]{1,24})[)）]/g)]
    .map((match) => match[1].replace(/\s+/g, ''))
    .filter((value) => /^[가-힣A-Za-z0-9]{2,12}$/.test(value))
    .filter((value) => !/^\d+$/.test(value))
    .filter((value) => !/^\d+차$/.test(value))
    .filter((value) => !FILE_NAME_COMPANY_STOPWORDS.has(value));
  return candidates.length ? candidates[candidates.length - 1] : '';
}
function appraisalWithFileNameProvenance(row, fileName, appraisalId, documentId) {
  const copy = { ...clone(row), appraisal_id: appraisalId, document_id: documentId };
  if (text(copy.appraisal_company)) {
    copy.appraisal_company_origin = copy.appraisal_company_origin || 'PARSED_TEXT';
    return copy;
  }
  const candidate = deriveCompanyFromFileName(fileName);
  if (!candidate) return copy;
  copy.appraisal_company = candidate;
  copy.appraisal_company_origin = 'FILE_NAME';
  copy.appraisal_company_review_status = 'NEEDS_REVIEW';
  copy.review_status_code = 'NEEDS_REVIEW';
  copy.auto_confirmed = false;
  copy.appraisal_company_note = '원문에 평가법인명이 없어 파일명 괄호에서 얻은 후보입니다. 원문 또는 표지를 대조해 확정하세요.';
  return copy;
}
function derivePurposeFromPageModel(pageModel, appraisalId, fileName) {
  for (const page of arr(pageModel).slice(0, 4)) {
    const lines = String(page?.text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const [value, pattern] of PURPOSE_PATTERNS) {
        if (!pattern.test(line)) continue;
        return { value, source_ref:{ appraisal_id:appraisalId, file_name:fileName || null, page_no:Number(page?.page_no) || 1, line_start:index+1, line_end:index+1, source_label:'기본정보', raw_text_excerpt:line.replace(/\s+/g,' ').slice(0,140) } };
      }
    }
  }
  return null;
}
function canonicalCaseInfo(source, explicitPurpose = null) {
  const info = nonEmptyObject(source);
  if (!text(info.price_date) && text(info.base_date)) { info.price_date=info.base_date; info.price_date_origin='EXPLICIT_BASE_DATE_ALIAS'; }
  if (!text(info.appraisal_purpose) && explicitPurpose?.value) {
    info.appraisal_purpose=explicitPurpose.value; info.appraisal_purpose_origin='EXPLICIT_PAGE_TEXT'; info.review_status_code='NEEDS_REVIEW'; info.auto_confirmed=false;
    info.source_refs=[...arr(info.source_refs).map(clone),clone(explicitPurpose.source_ref)];
  }
  return info;
}
function mergeCaseInfo(existing, incoming) {
  const current = clone(existing || {});
  const next = clone(incoming || {});
  const merged = { ...current };
  const variants = clone(current.case_info_variants || {});
  for (const field of CASE_INFO_FIELDS) {
    const oldValue = text(current[field]);
    const newValue = text(next[field]);
    if (!oldValue && newValue) merged[field] = next[field];
    else if (oldValue && newValue && oldValue !== newValue) {
      variants[field] = [...new Set([...(arr(variants[field])), oldValue, newValue])];
    }
  }
  for (const [key,value] of Object.entries(next)) {
    if (CASE_INFO_FIELDS.includes(key) || ['source_refs','case_info_variants','case_info_conflicts'].includes(key)) continue;
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') merged[key] = clone(value);
  }
  merged.source_refs = mergeSourceRefs(current.source_refs, next.source_refs);
  const conflicts = Object.entries(variants)
    .filter(([,values]) => arr(values).length > 1)
    .map(([field,values]) => ({ field, values:[...new Set(arr(values).map(text).filter(Boolean))] }))
    .filter((row) => row.values.length > 1);
  if (Object.keys(variants).length) merged.case_info_variants = variants;
  if (conflicts.length) {
    merged.case_info_conflicts = conflicts;
    merged.review_status_code = 'NEEDS_REVIEW';
    merged.auto_confirmed = false;
  }
  return merged;
}
function hasCaseInfo(info) { return Boolean(text(info?.case_name)||text(info?.project_name)||text(info?.appraisal_purpose)||text(info?.base_date)||text(info?.price_date)||arr(info?.source_refs).length); }

function freshState() {
  return {status:'EMPTY',route:'home',error:null,sourceDocuments:[],documentWorkflow:[],caseInfo:{},appraisals:[],lands:[],standardLands:[],transactionCases:[],appraisalResults:[],appraisalTotals:[],subjectFactorDetails:[],subjectFactorTotals:[],standardToCompCaseFactors:[],otherFactors:[],comparisonSummaryByLand:[],obstacleRows:[],obstacleSummaries:[],landCharacteristics:[],landCharacteristicCrosscheck:[],publicLandCharacteristics:[],publicLandDataEnrichment:{},publicEnrichment:[],mapContext:null,issueCandidates:[],draftSentences:[],riskWarnings:[],reviewQueue:[],reviewDecisions:{},documentSanity:[],batchHasHold:false,capabilities:{parser:'AVAILABLE',publicData:'NOT_CONNECTED',map:'NOT_CONNECTED',outputCenter:'LOCAL_ONLY'}};
}

const COLLECTION_META = [
  ['appraisals','평가법인','case','사건','평가법인명과 평가기준일의 원문·파일명 근거를 확인합니다.'],
  ['lands','토지조서','lands','토지','토지조서 행과 현황 이용상황을 원문과 대조합니다.'],
  ['standardLands','비교표준지','lands','토지','표준지 기호·소재지·공시지가를 확인합니다.'],
  ['transactionCases','평가·거래사례','lands','토지','인근 평가·거래사례의 시점·단가·용도지역을 확인합니다.'],
  ['appraisalResults','필지별 평가결과','valuation','평가검토','표준지·시점수정·개별요인·그 밖의 요인·적용단가·금액을 확인합니다.'],
  ['subjectFactorTotals','개별요인 누계','valuation','평가검토','필지별 개별요인 누계와 세부복원 가능 여부를 확인합니다.'],
  ['otherFactors','그 밖의 요인 결정치','valuation','평가검토','표준지별 최종 결정치를 원문 결정표와 대조합니다.'],
  ['obstacleRows','지장물 세부내역','obstacles','지장물','지장물 행과 원문 기재 합계를 대조합니다.'],
  ['issueCandidates','쟁점 후보','outputs','쟁점·결과물','기계적으로 탐지된 불일치·누락·큰 계수차를 전문가가 검토합니다.'],
];

function reviewGroupContent(state, key) {
  // These companion rows are covered by the same manual review in the output.
  const extra = key === 'subjectFactorTotals' ? state.subjectFactorDetails : key === 'obstacleRows' ? state.obstacleSummaries : null;
  return JSON.stringify([state[key], extra]);
}
function confirmedGroupContents(state) {
  return new Map(['caseInfo', ...COLLECTION_META.map(([key])=>key)]
    .filter((key)=>state.reviewDecisions[`GROUP:${key}`]?.status==='CONFIRMED')
    .map((key)=>[key,reviewGroupContent(state,key)]));
}
function invalidateChangedGroups(state, before) {
  for(const [key,content] of before) {
    if(content!==reviewGroupContent(state,key))delete state.reviewDecisions[`GROUP:${key}`];
  }
}

export function validateCaseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('사건 백업 형식이 올바르지 않습니다.');
  const base = freshState();
  for (const [key, initial] of Object.entries(base)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
    const value = snapshot[key];
    if (Array.isArray(initial) && (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))) throw new Error('사건 백업의 ' + key + ' 목록 형식이 올바르지 않습니다.');
    if (initial && !Array.isArray(initial) && typeof initial === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('사건 백업의 ' + key + ' 형식이 올바르지 않습니다.');
  }
  validateDocumentWorkflow(snapshot.documentWorkflow === undefined ? [] : snapshot.documentWorkflow);
  return true;
}

export class CaseStore {
  constructor(){this.listeners=new Set();this.reset();}
  reset(){this.state=freshState();this.emit();}
  snapshot(){return clone(this.state);}
  restoreSnapshot(snapshot){
    validateCaseSnapshot(snapshot);
    const base=freshState();
    Object.keys(base).forEach((key)=>{if(Object.prototype.hasOwnProperty.call(snapshot,key))base[key]=clone(snapshot[key]);});
    // Previously saved matches predate ordered-header validation. Their original
    // rows cannot be safely reconstructed from a merged snapshot; require reimport.
    const legacyMembers = base.lands.filter(row => hasMemberEvidence(row) && !explicitMember(row)
      && arr(row.source_appraisal_ids).length > 1);
    if (legacyMembers.length) {
      const affected = new Set(legacyMembers.flatMap(row=>arr(row.source_appraisal_ids)));
      const code='OWNERSHIP_HEADER_REIMPORT_REQUIRED';
      const detail='이전 방식으로 연결한 소유자 자료입니다. 새 사건에서 원본 평가서 두 개를 다시 불러와 소유자별 매칭과 개별요인을 확인하세요.';
      for (const id of affected) {
        let doc=base.documentSanity.find(row=>row.appraisal_id===id);
        if(!doc){doc={appraisal_id:id,hold_codes:[],holds:[]};base.documentSanity.push(doc);}
        doc.status=PARSE_HOLD_STATUS;doc.hold_codes=[...new Set([...arr(doc.hold_codes),code])];
        doc.holds=[...arr(doc.holds).filter(row=>row.code!==code),{code,detail}];
      }
      for(const doc of base.sourceDocuments)if(affected.has(doc.appraisal_id)||arr(doc.appraisal_ids).some(id=>affected.has(id))){
        doc.sanity_status=PARSE_HOLD_STATUS;doc.hold_codes=[...new Set([...arr(doc.hold_codes),code])];
      }
      base.reviewDecisions={};
    }
    const hasContent=arr(base.sourceDocuments).length||arr(base.appraisals).length||arr(base.lands).length||arr(base.standardLands).length||arr(base.transactionCases).length;
    base.batchHasHold = Boolean(base.batchHasHold) || base.documentSanity.some((row) => row.status === PARSE_HOLD_STATUS) || snapshot.status === PARSE_HOLD_STATUS || snapshot.status === 'PROCESSING';
    base.status = base.batchHasHold ? PARSE_HOLD_STATUS : hasContent ? 'READY' : 'EMPTY';
    base.route='home';base.error=legacyMembers.length?'기존 소유자 매칭은 재검증이 필요합니다. 새 사건에서 원본 평가서 두 개를 다시 불러오세요.':base.batchHasHold?'보류 또는 처리 중 저장된 사건입니다. 원본과 추출 결과를 확인하세요.':null;
    base.capabilities={parser:'AVAILABLE',publicData:'NOT_CONNECTED',map:base.mapContext?'AVAILABLE':'NOT_CONNECTED',outputCenter:'LOCAL_ONLY'};
    if(!base.reviewDecisions||typeof base.reviewDecisions!=='object'||Array.isArray(base.reviewDecisions))base.reviewDecisions={};
    this.state=base;this.rebuildIssues();this.rebuildReviewQueue();this.emit();return true;
  }
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  emit(){this.listeners.forEach((listener)=>listener(this.state));}
  setStatus(status,error=null){this.state.status=status;this.state.error=error;this.emit();}
  setRoute(route){this.state.route=route;this.emit();}
  setCapability(name,status){if(name in this.state.capabilities){this.state.capabilities[name]=status;this.emit();}}
  setMapContext(preview){this.state.mapContext=clone(preview);this.state.capabilities.map=preview?'AVAILABLE':'NOT_CONNECTED';this.emit();}
  setPublicData(rows,enrichment=[]){this.state.publicLandCharacteristics=arr(rows).map(clone);this.state.publicEnrichment=arr(enrichment).map(clone);this.rebuildIssues();this.rebuildReviewQueue();this.emit();}

  ingestDocument({fileMeta,pageModel,parsed}){
    const previousGroups = confirmedGroupContents(this.state);
    const documentIndex=this.state.sourceDocuments.length+1;
    const appraisalId=text(parsed?.appraisals?.[0]?.appraisal_id)||`APP_${String(documentIndex).padStart(3,'0')}`;
    const documentId=`DOC_${String(documentIndex).padStart(3,'0')}`;
    const incomingIds=[...new Set(arr(parsed.appraisals).map(row=>text(row.appraisal_id)).filter(Boolean))];
    const multiple=incomingIds.length>1;
    const scopedId=row=>multiple&&incomingIds.includes(text(row?.appraisal_id))?text(row.appraisal_id):appraisalId;
    const landSources=row=>multiple?[...new Set([...arr(row.source_appraisal_ids),...arr(parsed.land_appraisal_results).filter(result=>result.land_id===row.land_id).map(result=>result.appraisal_id)].map(text).filter(id=>incomingIds.includes(id)))]:[appraisalId];
    const fileName=text(fileMeta?.name);
        // 문서 단위로 먼저 승격 여부를 본다. 한 문서가 PARSE_HOLD 여도 다른 문서가 READY 라는
    // 이유로 배치 전체를 READY 로 덮어쓰지 않는다.
    const sanity=evaluateDocumentSanity(parsed);
    this.state.sourceDocuments.push({document_id:documentId,appraisal_id:appraisalId,...(multiple?{appraisal_ids:incomingIds}:{}),file_name:fileName,file_size:Number(fileMeta?.size)||0,page_count:arr(pageModel).length,parse_status:text(parsed?.meta?.parse_status)||'TEXT_PARSED',page_model_retained:false,sanity_status:sanity.status,hold_codes:sanity.hold_codes,...(parsed.meta?.recognition_method?{recognition_report:{method:parsed.meta.recognition_method,rows:parsed.meta.recognition_rows,arithmetic_checked_rows:parsed.meta.recognition_checked_rows,location_unresolved_rows:parsed.meta.recognition_location_unresolved_rows||0,unresolved:clone(arr(parsed.meta.recognition_unresolved))}}:{})});
    for(const id of multiple?incomingIds:[appraisalId]){
      const scopedParsed=multiple?{...parsed,appraisals:arr(parsed.appraisals).filter(row=>row.appraisal_id===id),lands:arr(parsed.lands).filter(row=>landSources(row).includes(id)),land_appraisal_results:arr(parsed.land_appraisal_results).filter(row=>row.appraisal_id===id)}:parsed;
      const checked=multiple?evaluateDocumentSanity(scopedParsed):sanity;
      this.state.documentSanity.push({document_id:documentId,appraisal_id:id,file_name:fileName,status:checked.status,hold_codes:checked.hold_codes,holds:checked.holds});
    }
    this.state.batchHasHold=this.state.documentSanity.some((row)=>row.status===PARSE_HOLD_STATUS);
    const explicitPurpose=derivePurposeFromPageModel(pageModel,appraisalId,fileName);
    const incomingCaseInfo=canonicalCaseInfo(parsed.case,explicitPurpose);
    this.state.caseInfo=mergeCaseInfo(this.state.caseInfo,incomingCaseInfo);
    const incomingAppraisals=arr(parsed.appraisals).map((row)=>appraisalWithFileNameProvenance(row,fileName,scopedId(row),documentId));
    this.state.appraisals.push(...incomingAppraisals);
    const appraisalCompany=text(incomingAppraisals[0]?.appraisal_company);
    const scoped=(source)=>({...clone(source),appraisal_id:scopedId(source),appraisal_company:text(source?.appraisal_company)||text(incomingAppraisals.find(row=>row.appraisal_id===scopedId(source))?.appraisal_company)||appraisalCompany});

    const landIdMap=new Map();const incomingCanonicalLands=[];
    const incomingLands=arr(parsed.lands);
    const existingLands=[...this.state.lands];
    incomingLands.forEach((source)=>{
      const compatible=existingLands.filter(row=>compatibleParcelLocation(row,source)
        && numberKey(row.area)===numberKey(source.area)
        && (!text(row.member_no)||!text(source.member_no)||text(row.member_no)===text(source.member_no))
        // Equal areas can be separate ownership rows within one appraisal.
        // Distinct explicit row numbers must not collapse into one subject.
        && (!arr(row.source_appraisal_ids).includes(appraisalId)
          || !text(row.land_no || row.serial_no) || !text(source.land_no || source.serial_no)
          || text(row.land_no || row.serial_no)===text(source.land_no || source.serial_no))
        && (categoryKey(row.land_category)===categoryKey(source.land_category)
          || (Number(source.area)>0 && !arr(row.source_appraisal_ids).includes(appraisalId) && (!categoryKey(row.land_category)||!categoryKey(source.land_category))))
        // Look ahead within this PDF too: the first full address must not claim
        // an older abbreviated row when another incompatible full address fits it.
        && !incomingLands.some(other=>other!==source && compatibleLandEvidence(row,other)!==compatibleLandEvidence(source,other)));
      const samePnu=validPnu(source.pnu)?compatible.filter(row=>text(row.pnu)===text(source.pnu)):[];
      const duplicateMember=explicitMember(source)&&incomingLands.some(other=>other!==source&&explicitMember(other)&&text(other.member_no)===text(source.member_no)&&compatibleParcelLocation(other,source)&&numberKey(other.area)===numberKey(source.area));
      const memberMatches=explicitMember(source)?compatible.filter(row=>explicitMember(row)&&text(row.member_no)===text(source.member_no)):[];
      // A PNU identifies land, not an owner. Never fall back from missing,
      // conflicting or unverified member evidence to parcel/area similarity.
      const needsMember=hasMemberEvidence(source)||compatible.some(hasMemberEvidence);
      const repeatedIncoming=incomingLands.some(other=>other!==source&&compatibleLandEvidence(source,other));
      const candidates=duplicateMember?[]:needsMember?memberMatches:repeatedIncoming?[]:samePnu.length?samePnu:compatible;
      let canonical=candidates.length===1?candidates[0]:null;
      if(!canonical){
        canonical={...clone(source),land_id:`LAND_${String(this.state.lands.length+1).padStart(3,'0')}`,source_appraisal_ids:landSources(source).length?landSources(source):[appraisalId],parcel_address_variants:[text(source.parcel_address)].filter(Boolean)};
        this.state.lands.push(canonical);
      } else {
        if(explicitMember(source)&&explicitMember(canonical)&&text(source.member_no)===text(canonical.member_no)){
          canonical.ownership_match_method='EXPLICIT_MEMBER_NUMBER';
          canonical.member_no_source_refs=mergeSourceRefs(canonical.member_no_source_refs,source.member_no_source_refs);
        }
        if(!categoryKey(canonical.land_category)&&categoryKey(source.land_category)){canonical.land_category=source.land_category;canonical.land_category_origin_appraisal_id=appraisalId;}
        canonical.source_refs=mergeSourceRefs(canonical.source_refs,source.source_refs);
        canonical.source_appraisal_ids=[...new Set([...arr(canonical.source_appraisal_ids),...(landSources(source).length?landSources(source):[appraisalId])])];
        canonical.parcel_address_variants=[...new Set([...arr(canonical.parcel_address_variants),text(source.parcel_address)].filter(Boolean))];
        // Keep explicit location evidence even when the displayed address is abbreviated.
        if(!validPnu(canonical.pnu) && validPnu(source.pnu)) canonical.pnu=text(source.pnu);
        if(!text(canonical.appraisal_use_status) && text(source.appraisal_use_status)) canonical.appraisal_use_status=text(source.appraisal_use_status);
      }
      if(source.land_id) landIdMap.set(source.land_id,canonical.land_id);
      if(!incomingCanonicalLands.some((row)=>row.land_id===canonical.land_id)) incomingCanonicalLands.push(canonical);
    });

    const standardIdMap=new Map();const standardBySymbol=new Map();
    arr(parsed.standard_lands).forEach((source,index)=>{const id=`STD_${appraisalId}_${String(index+1).padStart(3,'0')}`;const row={...scoped(source),standard_land_id:id};this.state.standardLands.push(row);if(source.standard_land_id)standardIdMap.set(source.standard_land_id,id);if(source.standard_land_symbol)standardBySymbol.set(scopedId(source)+':'+String(source.standard_land_symbol),id);});
    const remapLand=(row)=>({...scoped(row),land_id:landIdMap.get(row.land_id)||row.land_id||'',standard_land_id:standardIdMap.get(row.standard_land_id)||standardBySymbol.get(scopedId(row)+':'+String(row.standard_land_symbol||''))||row.standard_land_id||''});
    const withAppraisal=(row)=>scoped(row);
    const incomingResults=arr(parsed.land_appraisal_results).map(remapLand);
    this.state.appraisalResults.push(...incomingResults);
    incomingCanonicalLands.forEach((land,index)=>{
      for(const id of multiple?incomingIds:[appraisalId]){
        if(multiple&&!arr(land.source_appraisal_ids).includes(id))continue;
        const linked=this.state.appraisalResults.some((row)=>text(row.appraisal_id)===id&&text(row.land_id)===text(land.land_id));
        if(!linked)this.state.appraisalResults.push(runtimeMissingAppraisalResult(land,id,text(incomingAppraisals.find(row=>row.appraisal_id===id)?.appraisal_company)||appraisalCompany,index));
      }
    });
    this.state.appraisalTotals.push(...arr(parsed.appraisal_totals).map(withAppraisal));
    this.state.subjectFactorDetails.push(...arr(parsed.subject_to_standard_factor_comparisons).map(remapLand));
    this.state.subjectFactorTotals.push(...arr(parsed.subject_factor_total_candidates).map(remapLand));
    this.state.standardToCompCaseFactors.push(...arr(parsed.standard_to_comp_case_factor_comparisons).map(withAppraisal));
    this.state.transactionCases.push(...arr(parsed.comp_cases).map(withAppraisal));
    this.state.otherFactors.push(...arr(parsed.other_factor_reviews).map((row)=>({...scoped(row),standard_land_id:standardIdMap.get(row.standard_land_id)||standardBySymbol.get(scopedId(row)+':'+String(row.standard_land_symbol||''))||row.standard_land_id||''})));
    this.state.comparisonSummaryByLand.push(...arr(parsed.comparison_summary_by_land).map(remapLand));
    this.state.obstacleRows.push(...arr(parsed.obstacle_appraisal_results_sample).map(withAppraisal));
    this.state.obstacleSummaries.push(...arr(parsed.obstacle_summary_by_appraisal).map(withAppraisal));
    this.state.landCharacteristics.push(...arr(parsed.land_characteristics).map(remapLand));
    this.state.landCharacteristicCrosscheck.push(...arr(parsed.land_characteristic_crosscheck).map(remapLand));
    this.state.publicLandCharacteristics.push(...arr(parsed.public_land_characteristics).map(remapLand));
    this.state.publicLandDataEnrichment={...this.state.publicLandDataEnrichment,...nonEmptyObject(parsed.public_land_data_enrichment)};
    this.state.draftSentences.push(...arr(parsed.draft_sentences).map(clone));this.state.riskWarnings.push(...arr(parsed.risk_warnings).map(clone));
    invalidateChangedGroups(this.state,previousGroups);
    const batchProcessing=this.state.status==='PROCESSING';this.state.status=batchProcessing?'PROCESSING':'READY';this.rebuildIssues();this.rebuildReviewQueue();this.emit();
  }

  rebuildIssues(){const before=issueSignature(this.state.issueCandidates);const next=buildIssueCandidates(this.state);this.state.issueCandidates=next;if(before!==issueSignature(next)&&this.state.reviewDecisions['GROUP:issueCandidates']?.status==='CONFIRMED')delete this.state.reviewDecisions['GROUP:issueCandidates'];}
  rebuildReviewQueue(){const decisions=this.state.reviewDecisions;const queue=[];if(hasCaseInfo(this.state.caseInfo)){const itemKey='GROUP:caseInfo';queue.push({review_id:itemKey,type:'GROUP',collection:'caseInfo',label:'사건 기본정보',route:'case',route_label:'사건',description:'사업명·사건명·평가목적·기준시점을 원문과 대조합니다.',row_count:1,exception_count:needsExceptionReview(this.state.caseInfo)?1:0,confirmable:true,status:decisions[itemKey]?.status||'NEEDS_REVIEW'});}COLLECTION_META.forEach(([key,label,route,routeLabel,description])=>{const rows=arr(this.state[key]);if(!rows.length)return;const itemKey=`GROUP:${key}`;const incompleteResults=key==='appraisalResults'?rows.filter((row)=>!appraisalResultComplete(row)):[];const invalidStandardLocations=key==='standardLands'?rows.filter(standardLandLocationReviewRequired):[];const invalidGridLocations=key==='lands'?rows.filter(row=>['UNRESOLVED','MANUAL_CANDIDATE'].includes(row.location_recognition_status)&&!validPnu(row.pnu)&&!plausibleParcelAddress(row.parcel_address)):[];const unresolvedGridRows=key==='appraisalResults'?this.state.sourceDocuments.reduce((sum,doc)=>sum+arr(doc.recognition_report?.unresolved).length,0):0;const confirmable=incompleteResults.length===0&&invalidStandardLocations.length===0&&unresolvedGridRows===0&&invalidGridLocations.length===0;const missingLabels=incompleteResults.slice(0,3).map((row)=>text(row.parcel_address)||text(row.land_id)).filter(Boolean);const invalidLocationLabels=invalidStandardLocations.slice(0,3).map((row)=>text(row.standard_land_symbol)||text(row.standard_land_id)||'표준지').filter(Boolean);let blockedReason='';if(invalidGridLocations.length)blockedReason=`주소 재인식 필요 ${invalidGridLocations.length}필지. 원문·수정에서 소재지 또는 검증된 PNU를 확인해야 완료할 수 있습니다.`;else if(unresolvedGridRows)blockedReason=`자동 표 인식 미해결 ${unresolvedGridRows}행. 원본 교체·재추출로 해결해야 완료할 수 있습니다.`;else if(incompleteResults.length)blockedReason=`평가결과 누락 ${incompleteResults.length}필지${missingLabels.length?` (${missingLabels.join(', ')})`:''}. 적용단가와 평가금액을 원문에서 입력해야 완료할 수 있습니다.`;else if(invalidStandardLocations.length)blockedReason=`비교표준지 위치 확인 필요 ${invalidStandardLocations.length}건${invalidLocationLabels.length?` (${invalidLocationLabels.join(', ')})`:''}. 원문·수정에서 실제 소재지 또는 검증된 19자리 PNU를 입력해야 완료할 수 있습니다.`;queue.push({review_id:itemKey,type:'GROUP',collection:key,label,route,route_label:routeLabel,description:blockedReason||description,blocked_reason:blockedReason,confirmable,row_count:rows.length,exception_count:rows.filter(needsExceptionReview).length+invalidStandardLocations.length+invalidGridLocations.filter(row=>!needsExceptionReview(row)).length,status:confirmable?(decisions[itemKey]?.status||'NEEDS_REVIEW'):'NEEDS_REVIEW'});});this.state.obstacleSummaries.forEach((summary,index)=>{if(summary.total_crosscheck_status!=='MISMATCH')return;const itemKey=`EXCEPTION:obstacleSummary:${index}`;queue.unshift({review_id:itemKey,type:'EXCEPTION',collection:'obstacleSummaries',label:'지장물 합계 불일치',route:'obstacles',route_label:'지장물',description:'원문 기재 합계와 추출 행 합계가 다릅니다.',row_count:1,exception_count:1,confirmable:true,status:decisions[itemKey]?.status||'NEEDS_REVIEW'});});this.state.reviewQueue=queue;}
  decide(reviewId,status,note=''){const item=this.state.reviewQueue.find((row)=>row.review_id===reviewId);if(status==='CONFIRMED'&&item?.confirmable===false){return{ok:false,reason:item.blocked_reason||'필수값 누락으로 검수완료할 수 없습니다.'};}this.state.reviewDecisions[reviewId]={status,note,reviewed_at:new Date().toISOString()};this.rebuildReviewQueue();this.emit();return{ok:true};}
  updateCaseInfo(changes){this.state.caseInfo={...this.state.caseInfo,...clone(changes),review_status_code:'NEEDS_REVIEW',auto_confirmed:false,reviewed_at:null};delete this.state.reviewDecisions['GROUP:caseInfo'];this.rebuildIssues();this.rebuildReviewQueue();this.emit();return true;}
  updateRecord(collection,matcher,changes){
    const previousGroups=confirmedGroupContents(this.state);
    const rows=arr(this.state[collection]);const index=rows.findIndex(matcher);if(index<0)return false;
    const original=rows[index];
    const edited={...original,...clone(changes),review_status_code:'NEEDS_REVIEW',auto_confirmed:false,reviewed_at:null};
    if(collection==='lands' && Object.prototype.hasOwnProperty.call(changes,'parcel_address') && text(changes.parcel_address)!==text(original.parcel_address)){
      if(original.location_recognition_status)edited.location_recognition_status='MANUAL_CANDIDATE';
      edited.parcel_address_history=[...new Set([...arr(original.parcel_address_history),...arr(original.parcel_address_variants),text(original.parcel_address)].filter(Boolean))];
      edited.parcel_address_variants=[text(edited.parcel_address)].filter(Boolean);
    }
    rows[index]=collection==='appraisalResults'?normalizeEditedAppraisalResult(edited):edited;
    delete this.state.reviewDecisions[`GROUP:${collection}`];
    if(collection==='appraisals' && Object.prototype.hasOwnProperty.call(changes,'appraisal_company'))this.updateCompanyIdentity(rows[index].appraisal_id);
    invalidateChangedGroups(this.state,previousGroups);this.rebuildIssues();this.rebuildReviewQueue();this.emit();return true;
  }

  updateCompanyIdentity(appraisalId) {
    const company = text(this.state.appraisals.find((row) => row.appraisal_id === appraisalId)?.appraisal_company);
    const document = this.state.documentSanity.find((row) => row.appraisal_id === appraisalId);
    if (!document) return;
    const code = 'APPRAISAL_COMPANY_UNIDENTIFIED';
    document.holds = arr(document.holds).filter((row) => row.code !== code);
    document.hold_codes = arr(document.hold_codes).filter((value) => value !== code);
    if (!company) {
      document.holds.push({code,detail:'원문에서 평가법인명을 확인한 뒤 원문·수정에 입력하세요.'});
      document.hold_codes.push(code);
    }
    document.status = document.hold_codes.length ? PARSE_HOLD_STATUS : 'READY';
    document.manual_company_correction = true;
    for (const source of this.state.sourceDocuments.filter((row) => row.appraisal_id === appraisalId || arr(row.appraisal_ids).includes(appraisalId))) {
      const related=this.state.documentSanity.filter(row=>row.document_id===source.document_id);source.sanity_status=related.some(row=>row.status===PARSE_HOLD_STATUS)?PARSE_HOLD_STATUS:'READY';source.hold_codes=[...new Set(related.flatMap(row=>arr(row.hold_codes)))];
    }
    for (const key of ['standardLands','transactionCases','appraisalResults','subjectFactorDetails','subjectFactorTotals','standardToCompCaseFactors','otherFactors','obstacleRows','obstacleSummaries']) {
      for (const row of this.state[key].filter((row) => row.appraisal_id === appraisalId)) row.appraisal_company = company;
    }
    this.state.batchHasHold = this.state.documentSanity.some((row) => row.status === PARSE_HOLD_STATUS);
    if (this.state.status !== 'PROCESSING') this.state.status = this.batchStatus();
    if (!this.state.batchHasHold) this.state.error = null;
  }

  // 배치 전체 상태. 한 문서라도 HOLD 면 배치는 READY 가 아니다.
  batchStatus(){ return this.state.batchHasHold ? PARSE_HOLD_STATUS : 'READY'; }

  holdAppraisalIds(){ return new Set(arr(this.state.documentSanity).filter((row)=>row.status===PARSE_HOLD_STATUS).map((row)=>text(row.appraisal_id)).filter(Boolean)); }

  // 지도 입력에서 HOLD 문서에서 온 행을 뺀다. 정규화된 편입토지는 출처가 섞일 수 있으므로,
  // 출처에 HOLD 문서가 하나라도 있으면 제외한다(섞어서 그리지 않는다).
  mapInputState(){
    const hold=this.holdAppraisalIds();
    if(hold.size===0) return this.state;
    const fromHold=(row)=>{
      const sources=arr(row&&row.source_appraisal_ids).map(text).filter(Boolean);
      if(sources.length) return sources.some((id)=>hold.has(id));
      return hold.has(text(row&&row.appraisal_id));
    };
    const keep=(rows)=>arr(rows).filter((row)=>!fromHold(row));
    return {...this.state,
      lands:keep(this.state.lands),standardLands:keep(this.state.standardLands),
      transactionCases:keep(this.state.transactionCases),appraisalResults:keep(this.state.appraisalResults),
      subjectFactorDetails:keep(this.state.subjectFactorDetails),
      standardToCompCaseFactors:keep(this.state.standardToCompCaseFactors),
      appraisals:keep(this.state.appraisals)};
  }

  // 지도 허용 여부. READY 문서만으로 그릴 수 있으면 허용하고, 두 문서를 섞어야
  // 완성되는 도면이면 차단한다.
  mapEligibility(){
    const hold=this.holdAppraisalIds();
    const excluded=[...hold];
    if(this.state.status==='PROCESSING') return {allowed:false,reason:'BATCH_IN_PROGRESS',excluded_appraisal_ids:excluded};
    const input=this.mapInputState();
    const usableLands=arr(input.lands).filter((row)=>plausibleParcelAddress(row&&row.parcel_address)||validPnu(row&&row.pnu));
    const usableStandards=arr(input.standardLands).filter((row)=>plausibleParcelAddress(row&&row.parcel_address)||validPnu(row&&row.pnu));
    if(usableLands.length===0&&usableStandards.length===0){
      return {allowed:false,reason:hold.size?'ONLY_HOLD_DOCUMENTS_HAVE_MAP_DATA':'NO_MAPPABLE_PARCEL',excluded_appraisal_ids:excluded};
    }
    // 남은 관계가 제외된 문서의 비교표준지를 가리키면 도면이 두 문서를 섞어야 완성되는 것이다.
    // 내부 id 는 문서마다 다시 매겨지므로 평가서 안에서 안정적인 기호로 확인한다.
    const symbolsByAppraisal=new Map();
    arr(input.standardLands).forEach((row)=>{
      const key=text(row.appraisal_id);const symbol=text(row.standard_land_symbol);
      if(!symbol) return;
      if(!symbolsByAppraisal.has(key)) symbolsByAppraisal.set(key,new Set());
      symbolsByAppraisal.get(key).add(symbol);
    });
    const missingStandard=(row)=>{
      const symbol=text(row&&row.standard_land_symbol);
      if(!symbol) return false;
      const known=symbolsByAppraisal.get(text(row&&row.appraisal_id));
      return !known||!known.has(symbol);
    };
    const danglingRelation=arr(input.subjectFactorDetails).some(missingStandard)
      ||arr(input.standardToCompCaseFactors).some(missingStandard);
    if(danglingRelation) return {allowed:false,reason:'RELATION_SPANS_HELD_DOCUMENT',excluded_appraisal_ids:excluded};
    return {allowed:true,reason:hold.size?'READY_DOCUMENTS_ONLY':'ALL_DOCUMENTS_READY',excluded_appraisal_ids:excluded};
  }

  stats(){return{documents:this.state.sourceDocuments.length,appraisals:this.state.appraisals.length,lands:this.state.lands.length,standards:this.state.standardLands.length,cases:this.state.transactionCases.length,appraisalResults:this.state.appraisalResults.length,otherFactors:this.state.otherFactors.length,obstacles:this.state.obstacleRows.length,reviewPending:this.state.reviewQueue.filter((item)=>item.status!=='CONFIRMED').length};}
}
