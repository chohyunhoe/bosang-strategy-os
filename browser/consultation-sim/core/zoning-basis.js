// 보상평가 검토용 용도지역 — '현재 용도지역(공적자료)'과 '보상평가에 적용할 용도지역(검토 후보)'을 분리한다.
// 근거
//  - 「토지보상법 시행규칙」 제23조 제2항: 해당 공익사업의 시행을 직접 목적으로 용도지역 등이 변경된 토지는
//    변경 전 용도지역 등을 기준으로 평가.
//  - 「감정평가 실무기준」 6.1.2(사용자 지정 근거 — 조항 문언은 원문 대조 필요).
// 원칙
//  - 사업 관련 변경이 '확인'되면 변경 전 용도지역을 검토 기준 후보로 표시.
//  - 사업과 무관한 변경이 '확인'되면 평가 기준시점의 용도지역(원칙)을 후보로 표시.
//  - 변경 이력 또는 사업 관련성이 확인되지 않으면 '확인 필요' — 임의 추정·자동 판정 없음.
//  - 사업 관련성 확인은 상담자가 근거 문서와 함께 직접 표시해야 하며, 그래도 '전문가 검증 전'이다.
export const ZONING_RULES = Object.freeze([
  { id: 'ENFORCEMENT_RULE_23_2', label: '「공익사업을 위한 토지 등의 취득 및 보상에 관한 법률 시행규칙」 제23조 제2항', note: '해당 공익사업을 직접 목적으로 변경된 용도지역 등은 변경 전 기준' },
  { id: 'APPRAISAL_PRACTICE_6_1_2', label: '「감정평가 실무기준」 6.1.2', note: '문언은 GPT가 국가법령정보센터에서 확인(2026-11-24) — 이 시스템에는 원문 미수록' },
]);

export const ZONING_STATUS = Object.freeze({
  NO_DATA: 'NO_DATA', // 용도지역 자료 없음
  NO_CHANGE_OBSERVED: 'NO_CHANGE_OBSERVED', // 조회한 연도 범위에서 변경 없음 — 그 이전 이력은 미확인
  CHANGE_UNCONFIRMED: 'CHANGE_UNCONFIRMED', // 변경 관찰, 사업 관련성 미확인
  NOTICE_PROJECT_REASON: 'NOTICE_PROJECT_REASON', // 사업 고시 사유서에 같은 변경(전→후)과 사업 관련 사유가 있음 — 필지별 도면 대조 전
  PROJECT_RELATED: 'PROJECT_RELATED', // 상담자가 근거와 함께 사업 관련 확인 표시
  UNRELATED: 'UNRELATED', // 상담자가 근거와 함께 사업 무관 확인 표시
});
export const ZONING_STATUS_LABEL = Object.freeze({
  NO_DATA: '확인 필요(용도지역 자료 없음)',
  NO_CHANGE_OBSERVED: '조회 범위 내 변경 없음 — 그 이전 변경 이력 확인 필요',
  CHANGE_UNCONFIRMED: '확인 필요(용도지역 변경 관찰 · 사업 관련성 미확인)',
  NOTICE_PROJECT_REASON: '고시 사유서상 사업 관련 변경 — 변경 전 용도지역이 평가 기준 후보(필지별 변경도면 대조 전 · 전문가 검증 전)',
  PROJECT_RELATED: '사업 관련 변경으로 상담자 확인 — 변경 전 용도지역이 검토 기준 후보(전문가 검증 전)',
  UNRELATED: '사업 무관 변경으로 상담자 확인 — 감정평가 기준시점의 용도지역이 원칙(기준시점 미확인 · 전문가 검증 전)',
});
export const RELATION_OPTIONS = Object.freeze([
  ['', '미확인(기본)'],
  ['PROJECT_RELATED', '해당 공익사업으로 인한 변경 — 근거 문서 확인함'],
  ['UNRELATED', '사업과 무관한 변경 — 근거 문서 확인함'],
]);

const clean = (v) => (v == null ? '' : String(v).trim());

// history: [{ year, zoning }] (연도별 공적자료 용도지역, 기준시점은 각 연도 1.1. 기준 토지특성)
// project: { notice_no, notice_date, source_url, zoning_check, zoning_decisions:[{from,to,area_m2,reason,source,verified,parcel_level}] } (사업 프로필 — 없으면 사업 미지정)
// valuationDate: 감정평가 기준시점(가격시점). 조회 기준연도(토지특성 기준일)와 다르며, 모르면 null.
// confirmation: { relation:'PROJECT_RELATED'|'UNRELATED'|'', basis_doc, by } (상담자 입력)
export function evaluateZoningBasis({ history = [], project = null, confirmation = null, valuationDate = null } = {}) {
  const rows = history.filter((h) => Number.isInteger(Number(h.year)) && clean(h.zoning)).map((h) => ({ year: Number(h.year), zoning: clean(h.zoning) }))
    .sort((a, b) => a.year - b.year);
  const current = rows.length ? rows[rows.length - 1] : null;
  const base = {
    current_zoning: current?.zoning || null, current_year: current?.year || null, history: rows,
    project: project ? { notice_no: project.notice_no || null, notice_date: project.notice_date || null, source_url: project.source_url || null,
      zoning_check: project.zoning_check || null } : null,
    // 조회 기준연도(공적자료 토지특성 기준일)와 감정평가 기준시점(가격시점)은 별개
    query_basis: current ? { year: current.year, as_of: `${current.year}-01-01`, label: `조회 기준연도 ${current.year}(토지특성 기준일 ${current.year}-01-01)` } : null,
    valuation_date: clean(valuationDate) || null,
    valuation_date_label: clean(valuationDate) ? `감정평가 기준시점 ${clean(valuationDate)}(상담자 입력 · 문서 확인 필요)` : '감정평가 기준시점 미확인 — 조회 기준연도와 별개(협의·재결 등 가격시점 문서로 확인)',
    rules: ZONING_RULES.map((r) => ({ ...r })), verification: 'UNVERIFIED_BY_EXPERT', change: null, basis_zoning: null, basis_label: null, basis_reason: null, evidence: null, notes: [],
  };
  if (!current) return { ...base, status: ZONING_STATUS.NO_DATA, notes: ['공적자료에서 용도지역을 받지 못했습니다. 토지이용계획확인서로 확인하세요.'] };
  // 연속된 연도 사이 첫 변경과 마지막 변경(여러 번이면 모두 기록)
  const changes = [];
  for (let i = 1; i < rows.length; i += 1) if (rows[i].zoning !== rows[i - 1].zoning) changes.push({ from: rows[i - 1].zoning, to: rows[i].zoning, from_year: rows[i - 1].year, to_year: rows[i].year });
  if (!changes.length) {
    return { ...base, status: ZONING_STATUS.NO_CHANGE_OBSERVED, basis_zoning: null,
      notes: [`${rows[0].year}~${current.year}년 공적자료에서 용도지역 변경이 보이지 않습니다(${current.zoning}). 그 이전 변경 여부와 사업 관련성은 토지이용계획·도시관리계획 이력으로 확인 필요.`] };
  }
  const first = changes[0]; const last = changes[changes.length - 1];
  const change = { before: first.from, after: last.to, steps: changes, window: `${first.from_year}~${last.to_year}` };
  const notes = [];
  if (changes.length > 1) notes.push(`조회 범위에서 용도지역이 ${changes.length}번 바뀌었습니다 — 각 변경의 사유를 따로 확인하세요.`);
  const nd = clean(project?.notice_date);
  if (nd) {
    const y = Number(nd.slice(0, 4));
    // 토지특성 기준연도 Y는 Y.1.1. 기준 → 변경은 (from_year.1.1., to_year.1.1.] 사이
    const inWindow = changes.some((c) => y >= c.from_year && y < c.to_year);
    notes.push(inWindow ? `변경 시기(${change.window}년 기준 사이)에 사업 고시일(${nd})이 포함됩니다 — 사업 관련 가능성이 있으나 확정 아님. 고시의 도시관리계획 결정(변경) 내용으로 확인 필요.`
      : `변경 시기(${change.window}년 기준 사이)와 사업 고시일(${nd})이 겹치지 않습니다 — 그래도 사업 관련성은 원문으로 확인 필요.`);
  } else {
    notes.push('사업 고시가 지정되지 않아 사업 관련성을 확인할 수 없습니다.');
  }
  // 사업 고시 사유서에 관찰된 변경(전→후)과 같은 결정이 있으면 근거자료로 연결(필지 단위 확인은 아님)
  const decision = (project?.zoning_decisions || []).find((d) => clean(d.from) === change.before && clean(d.to) === change.after) || null;
  const evidence = decision ? { ...decision } : null;
  const rel = clean(confirmation?.relation); const doc = clean(confirmation?.basis_doc);
  const counselor = rel && doc ? { relation: rel, basis_doc: doc, by: clean(confirmation.by) || null } : null;
  const candidate = (z) => `${z}(평가 기준 후보)`;
  if (rel === 'PROJECT_RELATED' && doc) {
    return { ...base, change, evidence, status: ZONING_STATUS.PROJECT_RELATED, basis_zoning: change.before, basis_label: candidate(change.before), basis_reason: 'ENFORCEMENT_RULE_23_2',
      confirmation: counselor, verification: 'COUNSELOR_MARKED_UNVERIFIED_BY_EXPERT', notes };
  }
  if (rel === 'UNRELATED' && doc && !decision) {
    return { ...base, change, evidence, status: ZONING_STATUS.UNRELATED, basis_zoning: null, basis_reason: 'VALUATION_DATE_PRINCIPLE',
      basis_label: `감정평가 기준시점의 용도지역(${base.valuation_date ? `기준시점 ${base.valuation_date} — 해당 시점 용도지역 확인 필요` : '기준시점 미확인'}) · 현재 조회값 ${current.zoning}은 참고`,
      confirmation: counselor, verification: 'COUNSELOR_MARKED_UNVERIFIED_BY_EXPERT', notes };
  }
  if (rel === 'UNRELATED' && doc && decision) notes.push(`상담자의 '사업 무관' 표시가 고시 사유서(${decision.reason})와 상충합니다 — 반영하지 않고 전문가 확인 필요.`);
  if (rel && !doc) notes.push('사업 관련성 표시는 근거 문서를 함께 적어야 반영됩니다.');
  if (decision) {
    notes.push(`고시 사유서: ${decision.from} → ${decision.to}${decision.area_m2 ? ` ${Number(decision.area_m2).toLocaleString('ko-KR')}㎡` : ''} · ${decision.reason}. 이 필지가 변경 구역에 포함되는지는 ${decision.parcel_level || '필지별 변경도면 대조 필요'}.`);
    return { ...base, change, evidence, status: ZONING_STATUS.NOTICE_PROJECT_REASON, basis_zoning: change.before, basis_label: candidate(change.before), basis_reason: 'ENFORCEMENT_RULE_23_2',
      verification: 'NOTICE_REASON_CONFIRMED_PARCEL_MAP_PENDING_UNVERIFIED_BY_EXPERT', notes };
  }
  return { ...base, change, evidence, status: ZONING_STATUS.CHANGE_UNCONFIRMED, notes };
}

// 상담카드용 한 줄 요약(용도지역 값은 공적자료라 넣지 않는다 — 상태·근거·상담자 표시만)
export function zoningCardLines(result) {
  if (!result) return ['용도지역 보상평가 기준: 공적자료 미조회 — 확인 필요'];
  const lines = [`용도지역 보상평가 기준(검토 후보): ${ZONING_STATUS_LABEL[result.status]}`];
  // 고시 사유서에 근거한 후보는 고시 기재값이라 카드에 적는다(공적자료 API 값은 적지 않음).
  if (result.status === ZONING_STATUS.NOTICE_PROJECT_REASON && result.evidence) {
    lines.push(`평가 기준 후보: ${result.evidence.from}(평가 기준 후보) — 근거: ${result.evidence.source} · ${result.evidence.reason} · ${result.evidence.parcel_level} · 전문가 검증 전`);
  }
  if (result.query_basis) lines.push(`${result.query_basis.label} / ${result.valuation_date_label}`);
  if (result.change) lines.push(`용도지역 변경 관찰: ${result.change.window}년 기준 사이(변경 전·후 값은 공적자료 화면 열람)`);
  if (result.project?.notice_no) lines.push(`확인 대상: ${result.project.notice_no}(${result.project.notice_date || '고시일 미상'}) 도시관리계획 결정(변경)`);
  if (result.confirmation) lines.push(`상담자 표시 근거: ${result.confirmation.basis_doc}${result.confirmation.by ? ` · ${result.confirmation.by}` : ''} — 전문가 검증 전`);
  lines.push(`적용 근거: ${ZONING_RULES.map((r) => r.label).join(' · ')}`);
  return lines;
}
