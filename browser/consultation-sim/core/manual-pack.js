// BSO 내부 실무기본서 연결(코드만 공개). 본문은 사용자가 기기에서 선택한 JSON을 메모리에만 보유한다.
// API/네트워크/스토리지 접근 없음. 참고문헌 탐색만 수행하며 법률 결론 또는 보상금 산정에 사용하지 않는다.
export const MANUAL_SCHEMA = 'LK_BSO_PRIVATE_MANUAL_KNOWLEDGE_PACK/0.1';

const CODE_COUNTS = Object.freeze({ T:46, S:11, B:12, R:6, Y:12, N:10, L:9, H:9, P:83 });
const NEEDED = Object.freeze(['쟁점', '판단기준', '근거', '확인자료', '편람쪽']);
const normalize = (v) => String(v == null ? '' : v).normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
const compact = (s) => normalize(s).replace(/\s+/g, '');

export function validateManualPack(pack) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return { ok:false, code:'PACK_NOT_OBJECT' };
  if (pack.schema !== MANUAL_SCHEMA) return { ok:false, code:'PACK_SCHEMA_MISMATCH' };
  if (pack.classification !== 'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB') return { ok:false, code:'PACK_CLASSIFICATION_MISSING' };
  if (pack.source?.review_status !== 'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL') return { ok:false, code:'PACK_REVIEW_STATUS_MISSING' };
  if (!Array.isArray(pack.issue_codes) || pack.issue_codes.length !== 198) return { ok:false, code:'PACK_ISSUE_COUNT_INVALID' };
  if (!Array.isArray(pack.all_pages_text) || pack.all_pages_text.length !== 320) return { ok:false, code:'PACK_PAGE_COUNT_INVALID' };
  const codes = new Map();
  for (const entry of pack.issue_codes) {
    if (!entry || !/^[TSBRYNLHP]-\d{2}$/.test(entry.code || '') || codes.has(entry.code)) return { ok:false, code:'PACK_CODE_INVALID' };
    if (typeof entry.title !== 'string' || !entry.title || !entry.sections || NEEDED.some((key) => typeof entry.sections[key] !== 'string')) {
      return { ok:false, code:'PACK_SECTION_MISSING' };
    }
    if (!Number.isInteger(entry.pdf_page_start) || !Number.isInteger(entry.pdf_page_end) || entry.pdf_page_start < 1 || entry.pdf_page_end > 320 || entry.pdf_page_end < entry.pdf_page_start) {
      return { ok:false, code:'PACK_SOURCE_PAGE_INVALID' };
    }
    codes.set(entry.code, true);
  }
  for (const [prefix, count] of Object.entries(CODE_COUNTS)) {
    for (let i = 1; i <= count; i++) {
      if (!codes.has(`${prefix}-${String(i).padStart(2, '0')}`)) return { ok:false, code:'PACK_CODE_GAP' };
    }
  }
  return { ok:true, code:'VALID_PRIVATE_REFERENCE_PACK', issue_count:198, page_count:320,
    review_status:'INTERNAL_DRAFT', source_sha256:pack.source?.source_pdf_sha256 || null };
}

export function searchManualPack(pack, term, maxResults = 10) {
  if (!pack?.issue_codes || !normalize(term)) return [];
  const q = compact(term);
  const exact = q.match(/^([tsbrynlhp])-?(\d{1,2})$/);
  const code = exact ? `${exact[1].toUpperCase()}-${exact[2].padStart(2, '0')}` : null;
  return pack.issue_codes.map((entry) => {
    const title = compact(entry.title);
    const codeMatched = Boolean(code && entry.code === code);
    const titleMatched = title.includes(q);
    const corpus = compact([entry.sections['쟁점'],entry.sections['확인자료'],entry.sections['판단기준']].join(' '));
    const contentMatched = !code && !titleMatched && corpus.includes(q);
    const rank = codeMatched ? 0 : title === q ? 1 : titleMatched ? 2 : contentMatched ? 3 : 99;
    return { entry, rank };
  }).filter((v) => v.rank !== 99).sort((a,b) => a.rank - b.rank || a.entry.code.localeCompare(b.entry.code))
    .slice(0,Math.max(1,Math.min(20,Number(maxResults)||10))).map((v) => v.entry);
}

// 지번만으로 법률쟁점의 성립을 추정하지 않는다. 아래 추천은 원문을 찾아볼 위치만 안내한다.
export function suggestManualReferences(pack, draft) {
  if (!pack?.issue_codes || !draft) return [];
  const terms = [];
  if (['FOUND','NONE'].includes(draft.analysis?.standard?.status)) terms.push('비교표준지 선정');
  if (draft.analysis?.signals?.some((s) => s.kind === 'YEAR_CHANGE')) terms.push('판단시점');
  if (draft.map?.status === 'POINT_FALLBACK') terms.push('지적불부합');
  const used = new Set();
  const results = [];
  for (const term of terms) {
    const entry = searchManualPack(pack,term,3).find((v) => !used.has(v.code));
    if (!entry) continue;
    used.add(entry.code);
    results.push({ code:entry.code, title:entry.title, pdf_page:entry.pdf_page_start, role:'READING_REFERENCE_ONLY',
      reason:`관련 원문을 확인할 참고자료: ${term}` });
  }
  return results;
}

// ── 실무기본서 핵심 유형 증빙 게이트 (T-01·T-05·T-09·T-12) ─────────────────────────────
// - 기본서 항목의 판단기준(성립요건)·확인자료·근거·쪽수를 지식팩에서 그대로 연결한다. 요약을 새로 만들지 않는다.
// - 지식팩이 없거나 해당 섹션이 비어 있으면 추정하지 않고 '원본 확인 필요'로 판정을 보류한다.
// - 증빙요건 충족 = 필요한 자료가 확보되어 전문가가 대조할 수 있는 상태. 쟁점 성립·법률효과 판단이 아니다.
// - 기본서 '근거'는 기본서 기재 내용이며, 현행 법령·판례 공식 원문과의 대조 여부는 별도로 표시한다.
export const EVIDENCE_STATE = Object.freeze({
  SATISFIED: 'SATISFIED', NOT_SATISFIED: 'NOT_SATISFIED', HOLD: 'HOLD',
  READY_FOR_EXPERT: 'READY_FOR_EXPERT', NOT_TRIGGERED: 'NOT_TRIGGERED',
});
export const EVIDENCE_STATE_LABEL = Object.freeze({
  SATISFIED: '충족(자료 확보)', NOT_SATISFIED: '미충족(확보 불가)', HOLD: '판정 보류',
  READY_FOR_EXPERT: '증빙요건 충족 · 전문가 대조 단계', NOT_TRIGGERED: '검토 개시요건 없음',
});
// 상담자 입력값: 미확인(기본) / 확보 / 확보 불가
export const EVIDENCE_INPUT_OPTIONS = Object.freeze([['', '미확인'], ['SECURED', '확보'], ['UNAVAILABLE', '확보 불가']]);

export const EVIDENCE_GATE_PLAN = Object.freeze([
  { code: 'T-01', topic: '비교표준지 선정',
    hold_reason: '후보의 용도지역·조사용 이용상황·직선거리만으로 비교표준지 적정성을 판단하지 않음',
    requirements: [
      { id: 't01_public_standard', label: '비교표준지 후보 공적자료(용도지역·이용상황·공시지가)', auto: 'standard_public' },
      { id: 't01_actual_use_env', label: '대상·표준지 실제 이용상황·주위환경 확인자료(현장·지도)' },
      { id: 't01_appraisal_reason', label: '감정평가서 비교표준지 선정사유' },
      { id: 't01_dates', label: '표준지 공시기준일·가격시점 확인자료' },
    ] },
  { code: 'T-05', topic: '요인비교 시점·산정 근거',
    hold_reason: '비교표준지와 대상토지의 비교 기준시점이 같다고 가정하지 않음',
    requirements: [
      { id: 't05_recognition', label: '사업인정(의제) 고시문(고시일)' },
      { id: 't05_dates', label: '가격시점·공시기준일 기재자료' },
      { id: 't05_factor_table', label: '감정평가서 지역·개별요인 비교표' },
    ] },
  { code: 'T-09', topic: '지목과 현실 이용상황',
    hold_reason: '지목·조사용 이용상황의 명칭 차이는 현실 이용상황 불일치의 증거가 아님',
    trigger: { id: 't09_claim', label: '지목과 다른 현실 이용 주장·정황(고객 진술·현장 관찰)' },
    requirements: [
      { id: 't09_photos', label: '촬영시점이 확인되는 현장·항공사진' },
      { id: 't09_ledgers', label: '건축물·토지대장 등 독립 기록' },
      { id: 't09_appraisal', label: '감정평가서 현황 기재·품등비교' },
    ] },
  { code: 'T-12', topic: '현실적 이용상황 증거',
    hold_reason: '지번 조회값이나 소유자 진술만으로 실제 현황을 판단하지 않음',
    requirements: [
      { id: 't12_dated_photos', label: '촬영시점이 확인되는 현장·항공사진' },
      { id: 't12_permits', label: '인허가·건축물대장 등 독립 기록' },
      { id: 't12_appraisal', label: '감정평가서 관련 기재' },
    ] },
]);

const PLACEHOLDER = /^(-+|—+|없음|미기재|해당\s*없음|요약\s*없음|todo|tbd|n\/?a|\?+|\(생략\)|\.+)$/i;
// 섹션 텍스트가 비었거나 자리표시뿐이면 '원본 확인 필요'. 길이로 내용의 질을 추정하지 않는다.
export function sectionStatus(value) {
  const t = Array.isArray(value) ? value.join('\n') : String(value == null ? '' : value);
  const c = t.normalize('NFKC').trim();
  // 줄마다 검사: 모든 비어 있지 않은 줄이 자리표시뿐이면('-\n-', 'TODO\nTODO') 내용 없음으로 본다.
  const lines = c.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!c || c.replace(/\s+/g, '').length < 2 || !lines.length || lines.every((l) => PLACEHOLDER.test(l))) return { ok: false, text: '', status: 'SOURCE_CHECK_REQUIRED' };
  return { ok: true, text: c, status: 'FROM_PACK' };
}

function autoRequirement(kind, draft) {
  if (kind !== 'standard_public') return null;
  const st = draft?.analysis?.standard || {};
  if (st.status === 'FOUND') {
    return draft.synthetic
      ? { state: EVIDENCE_STATE.HOLD, basis: '합성 시연자료 — 실제 공적자료 아님' }
      : { state: EVIDENCE_STATE.SATISFIED, basis: `공적자료 조회(${st.source || '표준지 공시지가'}) · 같은 범위 후보 ${(st.candidates || []).length}건` };
  }
  if (st.status === 'NONE') return { state: EVIDENCE_STATE.HOLD, basis: '조회 범위 내 유사 후보 없음 — 범위 확대는 전문가 판단' };
  if (st.status === 'LOADING') return { state: EVIDENCE_STATE.HOLD, basis: '표준지 조회 중' };
  return { state: EVIDENCE_STATE.HOLD, basis: `표준지 자료 미확보(${st.status || 'NOT_QUERIED'})` };
}

function requirementState(req, draft, inputs) {
  const auto = req.auto ? autoRequirement(req.auto, draft) : null;
  if (auto) return { id: req.id, label: req.label, ...auto, input: null, auto: true };
  const input = inputs?.[req.id] || '';
  const state = input === 'SECURED' ? EVIDENCE_STATE.SATISFIED : input === 'UNAVAILABLE' ? EVIDENCE_STATE.NOT_SATISFIED : EVIDENCE_STATE.HOLD;
  return { id: req.id, label: req.label, state, input, auto: false,
    basis: input === 'SECURED' ? '상담자 확보 표시(원본 대조 전)' : input === 'UNAVAILABLE' ? '상담자 확보 불가 표시' : '미확인' };
}

// evidence: { [requirement id]: '' | 'SECURED' | 'UNAVAILABLE' }
export function buildEvidenceGates({ pack = null, draft = null, evidence = {} } = {}) {
  if (!draft) return [];
  const byCode = new Map((pack?.issue_codes || []).map((x) => [x.code, x]));
  return EVIDENCE_GATE_PLAN.map((plan) => {
    const entry = pack ? byCode.get(plan.code) || null : null;
    const criteria = sectionStatus(entry?.sections?.['판단기준']);
    const materials = sectionStatus(entry?.sections?.['확인자료']);
    const grounds = sectionStatus(entry?.sections?.['근거']);
    const handbook = sectionStatus(entry?.sections?.['편람쪽']);
    const source = {
      pack_connected: Boolean(pack),
      entry_found: Boolean(entry),
      title: entry?.title || null,
      book_page: Number.isInteger(entry?.book_page_start) ? entry.book_page_start : null,
      pdf_page_start: Number.isInteger(entry?.pdf_page_start) ? entry.pdf_page_start : null,
      pdf_page_end: Number.isInteger(entry?.pdf_page_end) ? entry.pdf_page_end : null,
      criteria, materials, grounds, handbook,
      // 기본서 '근거'(법령·판례 기재)는 기본서 제1판 검토본의 내용이며 현행 공식 원문과 대조하지 않았다.
      official_text_status: 'NOT_VERIFIED_AGAINST_CURRENT_OFFICIAL_TEXT',
    };
    const sourceIssue = !pack ? '실무기본서 지식팩 미연결 — 원문 위치·판단기준 확인 불가'
      : !entry ? `지식팩에 ${plan.code} 항목 없음 — 원본 확인 필요`
        : !criteria.ok ? '기본서 판단기준(성립요건) 원문·요약 부족 — 원본 확인 필요'
          : !materials.ok ? '기본서 확인자료 원문·요약 부족 — 원본 확인 필요' : null;

    const trigger = plan.trigger ? requirementState(plan.trigger, draft, evidence) : null;
    const requirements = plan.requirements.map((r) => requirementState(r, draft, evidence));
    let state; let reason;
    if (trigger && trigger.state !== EVIDENCE_STATE.SATISFIED) {
      state = EVIDENCE_STATE.NOT_TRIGGERED;
      reason = `${plan.hold_reason} — 지목·조사용 이용상황 명칭만으로 쟁점 성립하지 않음(현황 주장·정황 미확인)`;
    } else if (sourceIssue) {
      state = EVIDENCE_STATE.HOLD; reason = sourceIssue;
    } else if (requirements.some((r) => r.state === EVIDENCE_STATE.NOT_SATISFIED)) {
      state = EVIDENCE_STATE.NOT_SATISFIED;
      reason = `확보 불가 자료: ${requirements.filter((r) => r.state === EVIDENCE_STATE.NOT_SATISFIED).map((r) => r.label).join(', ')} — 대체 증빙 여부 전문가 검토`;
    } else if (requirements.every((r) => r.state === EVIDENCE_STATE.SATISFIED)) {
      state = EVIDENCE_STATE.READY_FOR_EXPERT;
      reason = '필요 자료 확보 표시 완료 — 원본 대조와 쟁점 성립 판단은 전문가 검토 필요';
    } else {
      state = EVIDENCE_STATE.HOLD;
      reason = `${plan.hold_reason} · 미확인: ${requirements.filter((r) => r.state === EVIDENCE_STATE.HOLD).map((r) => r.label).join(', ')}`;
    }
    return {
      code: plan.code, topic: plan.topic, state, state_label: EVIDENCE_STATE_LABEL[state], reason,
      trigger, requirements, source, source_issue: sourceIssue,
      missing: requirements.filter((r) => r.state !== EVIDENCE_STATE.SATISFIED).map((r) => r.label),
      role: 'REFERENCE_CHECKLIST_ONLY', automatic_legal_conclusion: false,
    };
  });
}

// 하위호환: 지식팩이 연결된 경우의 요약형 게이트(기존 호출부·테스트용)
const LEGACY_LABEL = Object.freeze({
  'T-01': '비교표준지 선정 적정성 판단 보류', 'T-05': '요인비교 시점·산정 근거 확인 필요',
  'T-09': '지목·조사용 이용상황 명칭만으로 쟁점 성립하지 않음', 'T-12': '현실적 이용상황 객관적 증거 확인 필요',
});
export function getManualEvidenceGates(pack, draft, evidence = {}) {
  if (!pack?.issue_codes || !draft) return [];
  return buildEvidenceGates({ pack, draft, evidence }).filter((g) => g.source.entry_found).map((g) => ({
    code: g.code, state: g.state === EVIDENCE_STATE.NOT_TRIGGERED ? 'NOT_TRIGGERED' : 'HOLD',
    state_label: g.state === EVIDENCE_STATE.NOT_TRIGGERED ? LEGACY_LABEL[g.code] : `${LEGACY_LABEL[g.code]} · ${g.state_label}`,
    requires: g.requirements.map((r) => r.label), memo: g.reason,
    title: g.source.title, pdf_page: g.source.pdf_page_start,
    role: g.role, automatic_legal_conclusion: false,
  }));
}
