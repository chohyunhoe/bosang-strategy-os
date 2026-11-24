// 사업별 용도지역 변경 고시 역추적 · 변경 전(기정) 용도지역 복원 — 검토 후보만 만든다(확정 아님).
// 원칙
//  - 연속 2개 연도 비교에 그치지 않고, 조회한 전체 연도 이력의 변경 구간마다 '그 변경을 실제로 일으킨 고시'를 찾는다.
//  - 고시는 명칭(산업단지계획 승인·지구지정 등)만으로 추정하지 않는다. 고시 본문에 도시·군관리계획 용도지역
//    결정·변경(또는 의제)이 포함된 것이 확인된 경우(zoning_decision === 'INCLUDED')에만 변경 유발 고시로 연결한다.
//  - 사업 관련 사유가 원문으로 확인되지 않으면(project_related !== true) 해당 공익사업 직접 목적 변경으로 단정하지 않는다.
//  - 복원한 변경 전 용도지역은 '사업 영향 제외 평가 검토 후보'일 뿐이다. 필지·법률 전문가 검증 전 확정 금지.
//  - 증거등급 ①고시·첨부 필지별 결정도면 ②고시 직전 변경이력·토지이용계획 ③환경평가서 기존 현황(총괄) ④연도별 공적자료
//    를 서로 대조하고, 효력일·조사일·기준연도를 따로 적는다. 총괄 면적은 필지별 확정 증거로 쓰지 않는다.

export const EVIDENCE_GRADES = Object.freeze([
  { grade: 1, label: '① 고시·첨부 필지별 결정도면' },
  { grade: 2, label: '② 고시 직전 변경이력·토지이용계획' },
  { grade: 3, label: '③ 환경평가서 기존 토지이용 현황(총괄)' },
  { grade: 4, label: '④ 연도별 공적자료 보조 조회' },
]);
export const EVIDENCE_STATUS = Object.freeze({
  CONFIRMED: 'CONFIRMED', // 필지 단위로 대조함
  AGGREGATE_ONLY: 'AGGREGATE_ONLY', // 총괄 집계·사유서 — 필지 확정 근거 아님
  OBSERVED: 'OBSERVED', // 공적자료 조회값(보조)
  PENDING: 'PENDING', // 대조 전
  NOT_OBTAINED: 'NOT_OBTAINED', // 미확보
});
export const EVIDENCE_STATUS_LABEL = Object.freeze({
  CONFIRMED: '필지 대조함', AGGREGATE_ONLY: '총괄 자료(필지 확정 근거 아님)', OBSERVED: '공적자료 조회값(보조)', PENDING: '대조 전', NOT_OBTAINED: '미확보',
});
export const EVENT_MATCH = Object.freeze({
  TRIGGER: 'TRIGGER', // 시기·변경 전후·용도지역 결정 포함·사업 관련 사유 모두 확인
  RELATION_UNPROVEN: 'RELATION_UNPROVEN', // 결정은 포함되나 사업 관련 사유 미확인
  DECISION_UNVERIFIED: 'DECISION_UNVERIFIED', // 시기는 맞으나 용도지역 결정 포함 여부 미확인(명칭만으로 추정 금지)
  NO_DECISION: 'NO_DECISION', // 본문에 용도지역 결정 없음
  CHANGE_MISMATCH: 'CHANGE_MISMATCH', // 시기는 맞으나 변경 전후가 다름
  OUT_OF_WINDOW: 'OUT_OF_WINDOW', // 변경 구간 밖
});

const clean = (v) => (v == null ? '' : String(v).trim());
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null);

export function normalizeHistory(history = []) {
  const byYear = new Map();
  for (const h of history) {
    const year = Number(h?.year); const zoning = clean(h?.zoning);
    if (Number.isInteger(year) && zoning && !byYear.has(year)) byYear.set(year, { year, zoning });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

// 같은 용도지역이 이어진 구간
export function zoningSegments(rows) {
  const segs = [];
  for (const r of rows) {
    const last = segs[segs.length - 1];
    if (last && last.zoning === r.zoning) { last.to_year = r.year; last.years.push(r.year); } else segs.push({ zoning: r.zoning, from_year: r.year, to_year: r.year, years: [r.year] });
  }
  return segs;
}

// 토지특성 기준연도 Y는 Y-01-01 기준 → 변경은 (from_year-01-01, to_year-01-01] 사이에 효력이 생긴 것
export function zoningChanges(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].zoning === rows[i - 1].zoning) continue;
    const a = rows[i - 1]; const b = rows[i];
    out.push({ from: a.zoning, to: b.zoning, from_year: a.year, to_year: b.year, window_start: `${a.year}-01-01`, window_end: `${b.year}-01-01`,
      gap_years: b.year - a.year - 1 });
  }
  return out;
}

// 효력일이 원문 확인되지 않으면 고시일로 달력 구간만 맞춰 본다 — 법적 변경일 확정이 아니므로 date_basis로 구별한다.
export const DATE_BASIS = Object.freeze({ EFFECTIVE_DATE: 'EFFECTIVE_DATE', NOTICE_DATE_PROVISIONAL: 'NOTICE_DATE_PROVISIONAL' });
const eventDate = (ev) => isoDate(ev.effective_date) || isoDate(ev.notice_date);
const dateBasis = (ev) => (isoDate(ev.effective_date) ? DATE_BASIS.EFFECTIVE_DATE : DATE_BASIS.NOTICE_DATE_PROVISIONAL);

export function classifyEvent(ev, change) {
  const date = eventDate(ev); const date_basis = dateBasis(ev);
  if (!date || !(date > change.window_start && date <= change.window_end)) return { match: EVENT_MATCH.OUT_OF_WINDOW, date, date_basis };
  if (ev.zoning_decision === 'NOT_INCLUDED') return { match: EVENT_MATCH.NO_DECISION, date, date_basis };
  if (ev.zoning_decision !== 'INCLUDED') return { match: EVENT_MATCH.DECISION_UNVERIFIED, date, date_basis };
  const decision = (ev.changes || []).find((d) => clean(d.from) === change.from && clean(d.to) === change.to) || null;
  if (!decision) return { match: EVENT_MATCH.CHANGE_MISMATCH, date, date_basis };
  if (ev.project_related !== true) return { match: EVENT_MATCH.RELATION_UNPROVEN, date, date_basis, decision };
  return { match: EVENT_MATCH.TRIGGER, date, date_basis, decision };
}

// 화면·카드 표기: 효력일 미확인이면 '변경 유발 고시'로 단정하지 않는다.
export function triggerHeading(trigger) {
  if (!trigger) return '변경 유발 고시';
  return trigger.date_basis === DATE_BASIS.EFFECTIVE_DATE ? '변경 유발 고시' : '사업 관련 변경 고시(효력일 확인 필요)';
}
export function triggerWindowNote(trigger) {
  if (!trigger) return null;
  return trigger.date_basis === DATE_BASIS.EFFECTIVE_DATE
    ? `효력일 ${trigger.date} 기준 변경 구간 안`
    : `고시일 ${trigger.date} 기준 달력 구간 적합(법적 변경일 확정 아님 — 효력일 원문 확인 후 재대조)`;
}

const eventRef = (ev) => ({ id: ev.id || null, notice_no: ev.notice_no || null, notice_date: isoDate(ev.notice_date), effective_date: isoDate(ev.effective_date),
  effective_basis: ev.effective_basis || null, kind: ev.kind || null, decision_verified: ev.decision_verified || null });

// events: 사업별 고시 [{ id, notice_no, notice_date, effective_date?, effective_basis?, kind, zoning_decision:'INCLUDED'|'NOT_INCLUDED'|'UNVERIFIED',
//          project_related:true|false|null, decision_verified, changes:[{from,to,area_m2,reason,source,verified,parcel_level}] }]
// priorDesignations: 기정 용도지역 결정 고시 [{ id, notice_no, notice_date, short, kind }]
// supportingDocs: 환경평가서 등 [{ id, title, document_date, survey_basis, project_area_m2, zoning_composition:[{zoning,area_m2}], scope_note, use_limit, held }]
// parcelEvidence: 이 필지에 대해 실제 대조한 기록 [{ grade, ref, label, short, document, finding, zoning_after?, zoning_before?, status, checked, caution }]
export function traceZoningOrigin({ history = [], events = [], priorDesignations = [], supportingDocs = [], parcelEvidence = [] } = {}) {
  const rows = normalizeHistory(history);
  const segments = zoningSegments(rows);
  const changes = zoningChanges(rows).map((c) => ({ ...c, matches: events.map((ev) => ({ event: eventRef(ev), ...classifyEvent(ev, c) })) }));
  const triggers = changes.filter((c) => c.matches.some((m) => m.match === EVENT_MATCH.TRIGGER));
  const first = triggers[0] || null;
  const trigger = first ? { change: { from: first.from, to: first.to, from_year: first.from_year, to_year: first.to_year, window_start: first.window_start, window_end: first.window_end },
    ...first.matches.find((m) => m.match === EVENT_MATCH.TRIGGER) } : null;
  // 변경 전 상태: 첫 사업 유발 변경 직전 구간
  let pastBasis = null;
  if (first) {
    const seg = segments.find((s) => s.to_year === first.from_year);
    const from = seg ? seg.from_year : first.from_year;
    // 구간 안에 응답이 없던 연도(자료 없음·조회 실패)는 '연속 관찰'로 부르지 않는다
    const missing = []; for (let y = from + 1; y < first.from_year; y += 1) if (!rows.some((r) => r.year === y)) missing.push(y);
    pastBasis = { zoning: first.from, observed_from_year: from, observed_to_year: first.from_year, as_of: `${first.from_year}-01-01`, missing_years: missing,
      label: `${first.from_year}-01-01 기준(조회 ${from}~${first.from_year}년 ${missing.length ? `관찰 · ${missing.join('·')}년 미확인` : '연속 관찰'}${rows[0].year === from ? ' · 조회 시작연도 이전은 미확인' : ''})` };
  }
  const candidateEvents = [];
  for (const c of changes) for (const m of c.matches) {
    if ([EVENT_MATCH.DECISION_UNVERIFIED, EVENT_MATCH.RELATION_UNPROVEN].includes(m.match)) candidateEvents.push({ ...m.event, match: m.match, change: `${c.from} → ${c.to}` });
  }
  const otherChanges = changes.filter((c) => !c.matches.some((m) => m.match === EVENT_MATCH.TRIGGER))
    .map((c) => ({ from: c.from, to: c.to, window: `${c.from_year}~${c.to_year}`, before_trigger: first ? c.to_year <= first.from_year : null }));

  // 증거 대조표
  const pe = (parcelEvidence || []).filter(Boolean);
  const evidence = [];
  if (trigger) {
    evidence.push({ grade: 1, title: trigger.decision.source || `${trigger.event.notice_no} 용도지역 결정(변경) 사유`, status: EVIDENCE_STATUS.AGGREGATE_ONLY,
      finding: `${trigger.decision.from} → ${trigger.decision.to}${trigger.decision.area_m2 ? ` ${Number(trigger.decision.area_m2).toLocaleString('ko-KR')}㎡(변경 유형 총량 — 이 필지 면적 아님)` : ''} · ${trigger.decision.reason || '사유 미기재'}`,
      dates: { notice_date: trigger.event.notice_date, effective_date: trigger.event.effective_date }, checked: trigger.decision.verified || null });
  }
  const map1 = pe.filter((e) => Number(e.grade) === 1);
  for (const e of map1) {
    const consistent = trigger && e.zoning_after ? e.zoning_after === trigger.change.to : null;
    evidence.push({ grade: 1, title: e.document || e.label, status: e.status || EVIDENCE_STATUS.PENDING, finding: e.finding || null, checked: e.checked || null, caution: e.caution || null,
      consistent_with_trigger: consistent });
  }
  if (trigger && !map1.some((e) => e.status === EVIDENCE_STATUS.CONFIRMED)) {
    evidence.push({ grade: 1, title: `${trigger.event.notice_no} 첨부 필지별 변경도면`, status: EVIDENCE_STATUS.PENDING, finding: '필지별 변경도면 대조 전' });
  }
  const g2 = pe.filter((e) => Number(e.grade) === 2);
  for (const d of priorDesignations || []) {
    const hit = g2.find((e) => e.ref === d.id);
    evidence.push({ grade: 2, title: `${d.notice_no}(${d.notice_date || '고시일 미상'}) ${d.kind || '기정 용도지역 결정도면'}`, status: hit?.status || EVIDENCE_STATUS.PENDING,
      finding: hit?.finding || '개별필지 대조 미완료', checked: hit?.checked || null, dates: { notice_date: isoDate(d.notice_date) } });
  }
  for (const e of g2.filter((x) => !(priorDesignations || []).some((d) => d.id === x.ref))) {
    evidence.push({ grade: 2, title: e.document || e.label, status: e.status || EVIDENCE_STATUS.PENDING, finding: e.finding || null, checked: e.checked || null });
  }
  if (!g2.some((e) => e.ref === 'eum-history')) {
    evidence.push({ grade: 2, title: '토지이음 토지이용계획 지정·변경이력(필지)', status: EVIDENCE_STATUS.NOT_OBTAINED,
      finding: '열람 결과는 법적 효력 없음 — 화면 등록일과 법적 효력일을 구별하고 결정고시·첨부도면과 대조' });
  }
  for (const s of supportingDocs || []) {
    const comp = (s.zoning_composition || []).map((z) => `${z.zoning} ${Number(z.area_m2).toLocaleString('ko-KR')}㎡`).join(' · ');
    evidence.push({ grade: 3, title: s.title, status: EVIDENCE_STATUS.AGGREGATE_ONLY,
      finding: `${s.project_area_m2 ? `당시 사업면적 ${Number(s.project_area_m2).toLocaleString('ko-KR')}㎡ — ` : ''}${comp}${s.scope_note ? ` · ${s.scope_note}` : ''}`,
      dates: { document_date: s.document_date || null, survey_basis: s.survey_basis || null }, caution: s.use_limit || '총괄 집계 — 필지별 확정 근거로 쓰지 않음',
      includes_restored: pastBasis ? (s.zoning_composition || []).some((z) => z.zoning === pastBasis.zoning) : null });
  }
  if (rows.length) {
    evidence.push({ grade: 4, title: 'VWorld 국가중점데이터 토지특성(연도별)', status: EVIDENCE_STATUS.OBSERVED,
      finding: `${rows[0].year}~${rows[rows.length - 1].year}년 ${rows.length}개 연도 조회 · 변경 ${changes.length}회`, dates: { base_year: `${rows[0].year}~${rows[rows.length - 1].year}(각 연도 1.1. 기준)` } });
  }

  // 교차 대조
  const crossCheck = [];
  if (trigger) {
    crossCheck.push(`④ 조회 이력의 변경(${trigger.change.from} → ${trigger.change.to}, ${trigger.change.from_year}~${trigger.change.to_year}년 기준 사이)과 ① 고시 사유서의 변경 유형 일치 · 고시일 ${trigger.event.notice_date || '미상'}이 그 구간 안`);
    for (const e of evidence.filter((x) => x.grade === 1 && x.consistent_with_trigger != null)) {
      crossCheck.push(e.consistent_with_trigger ? `① 필지별 도면(${e.title})의 변경 후 용도지역 = ④ 조회 변경 후 값` : `① 필지별 도면(${e.title})과 ④ 조회값 불일치 — 전문가 확인 필요`);
    }
    for (const e of evidence.filter((x) => x.grade === 3 && x.includes_restored != null)) {
      crossCheck.push(e.includes_restored ? `③ 총괄 기존 현황에 ${pastBasis.zoning} 포함(사업 범위·작성 시점 다름 — 필지 확정 아님)` : `③ 총괄 기존 현황에 ${pastBasis.zoning} 없음 — 범위 차이 또는 불일치, 확인 필요`);
    }
  }

  // 미확인
  const unverified = [];
  if (!trigger && changes.length) unverified.push('변경을 일으킨 고시(용도지역 결정·변경 포함 여부와 사업 관련 사유) 미확인');
  if (trigger && !evidence.some((e) => e.grade === 1 && e.status === EVIDENCE_STATUS.CONFIRMED)) unverified.push('이 필지가 변경 구역에 포함되는지(필지별 변경도면 대조)');
  for (const e of evidence.filter((x) => x.grade === 2 && x.status !== EVIDENCE_STATUS.CONFIRMED)) unverified.push(`${e.title} — ${EVIDENCE_STATUS_LABEL[e.status]}`);
  if (trigger && !trigger.event.effective_date) unverified.push(`${trigger.event.notice_no}의 효력 기준일(${trigger.event.effective_basis || '고시일과 효력발생일 구별 — 원문 확인'})`);
  if (pastBasis?.missing_years.length) unverified.push(`${pastBasis.missing_years.join('·')}년 용도지역(조회 응답 없음·실패)`);
  if (rows.length && pastBasis && rows[0].year === pastBasis.observed_from_year) unverified.push(`${rows[0].year}년 이전 용도지역 이력(조회 범위 밖)`);
  for (const c of otherChanges) unverified.push(`${c.window}년 기준 사이 ${c.from} → ${c.to} 변경의 원인 고시`);
  for (const c of candidateEvents) unverified.push(`${c.notice_no}: ${c.match === EVENT_MATCH.DECISION_UNVERIFIED ? '용도지역 결정·의제 포함 여부' : '사업 관련 사유'} 원문 확인`);
  unverified.push('필지·법률 전문가 검증');

  // 검증 상태 문구: 확인한 것 · 대조 전인 것 · 전문가 검증 전
  const confirmed = pe.filter((e) => e.status === EVIDENCE_STATUS.CONFIRMED && e.short).map((e) => `${e.short} 확인`);
  const pendingPrior = (priorDesignations || []).filter((d) => !g2.some((e) => e.ref === d.id && e.status === EVIDENCE_STATUS.CONFIRMED)).map((d) => `${d.short || d.notice_no} 대조 전`);
  const parcelMapConfirmed = map1.some((e) => e.status === EVIDENCE_STATUS.CONFIRMED);
  const verificationLabel = trigger
    ? [...(confirmed.length ? confirmed : ['고시 사유서 확인']), ...(parcelMapConfirmed ? [] : ['필지별 변경도면 대조 전']), ...pendingPrior, '전문가 검증 전'].join(' · ')
    : null;

  return {
    rows, segments, changes, trigger, past_basis: pastBasis, restored_zoning: pastBasis?.zoning || null, candidate_events: candidateEvents,
    other_changes: otherChanges, evidence, cross_check: crossCheck, unverified, parcel_map_confirmed: parcelMapConfirmed, verification_label: verificationLabel,
    effective_date_confirmed: trigger ? trigger.date_basis === DATE_BASIS.EFFECTIVE_DATE : null,
    trigger_heading: triggerHeading(trigger), trigger_window_note: triggerWindowNote(trigger),
  };
}
