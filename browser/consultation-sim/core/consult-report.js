// 1차 상담 검토서 생성 (결정론 · 네트워크 없음 · LLM 없음)
// 출력 순서(고정): 1 확인된 사실과 출처 → 2 표준지 검토 및 미확인 사항 → 3 기본서 쟁점 코드·원문 위치
//                → 4 증빙요건 충족·미충족·판정 보류 → 5 현재 절차와 다음 조치 → 6 정밀검토 과업 및 확보자료
// - 보상금·보정률·법정기한을 계산하지 않는다. 쟁점 성립·법률효과를 판단하지 않는다.
// - 기본서 발췌는 지식팩 원문을 그대로 줄여 옮기며(요약 생성 없음), 부족하면 '원본 확인 필요'로 표시한다.
import { STATUS, STATUS_LABEL, scrubSecrets } from './consultation-session.js';
import { recordMatches } from './consult-record.js';
import { evaluateIntake, nextActionsFor, INTAKE_STATUS_LABEL } from './consult-intake.js';
import { buildEvidenceGates, EVIDENCE_STATE, EVIDENCE_STATE_LABEL } from './manual-pack.js';
import { FORBIDDEN_PHRASES } from './consult-opinion.js';
import { REVIEW_REQUIREMENT_STATUS } from './standard-land-engine.js';

export const REPORT_SECTIONS = Object.freeze([
  '확인된 사실과 출처',
  '표준지 검토 및 미확인 사항',
  '기본서 쟁점 코드·원문 위치',
  '증빙요건 충족·미충족·판정 보류',
  '현재 절차와 다음 조치',
  '정밀검토 과업 및 확보자료',
]);
const EXCERPT_MAX = 160;
const fmtNumber = (v) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : v);
const excerpt = (s) => (s.length > EXCERPT_MAX ? `${s.slice(0, EXCERPT_MAX).replace(/\s+\S*$/, '')}…` : s).replace(/\s*\n\s*/g, ' / ');
const pageText = (src) => {
  if (!src.entry_found) return '원문 위치 미확인';
  const pdf = src.pdf_page_start == null ? 'PDF 쪽 미기재'
    : src.pdf_page_end && src.pdf_page_end !== src.pdf_page_start ? `PDF ${src.pdf_page_start}–${src.pdf_page_end}쪽` : `PDF ${src.pdf_page_start}쪽`;
  return `${src.book_page != null ? `책 ${src.book_page}쪽 · ` : ''}${pdf}`;
};

// 의견 쟁점 후보 → 기본서 코드. 근거가 분명한 연결만 둔다(나머지는 '미연결 — 원본 확인 필요').
const ISSUE_CODE = Object.freeze({ '비교표준지 선정 적정성': 'T-01' });

function factLines(d) {
  const lines = [d.synthetic ? '■ 합성 시연자료(실제 공적자료 아님)' : '■ 확인된 공적자료(검토 보조)'];
  const facts = Object.values(d.fields).filter((f) => f.value != null && f.status !== STATUS.NOT_QUERIED && (d.synthetic || f.source));
  if (!facts.length) lines.push('- 확인된 항목 없음(조회 실패 또는 자료 없음)');
  facts.forEach((f) => {
    lines.push(`- ${f.label}: ${fmtNumber(f.value)}${f.unit ? ` ${f.unit}` : ''} [${STATUS_LABEL[f.status]}${d.synthetic && f.status === STATUS.OK ? '(합성)' : ''} · ${f.source} · ${f.base_year || '-'}]`);
  });
  const overrides = Object.values(d.fields).filter((f) => f.override);
  if (overrides.length) {
    lines.push('■ 상담자 수정·입력값(공적자료 아님 · 검수 전)');
    overrides.forEach((f) => lines.push(`- ${f.label}: ${f.override.value}${f.unit ? ` ${f.unit}` : ''} (입력 ${f.override.by}${f.override.reason ? ` · 근거 ${f.override.reason}` : ''}${f.reviewed ? ' · 검수완료' : ''}) / 공적자료: ${f.value == null ? '미확보' : fmtNumber(f.value)}`));
  }
  return lines;
}

function standardLines(d, opinion) {
  const lines = ['■ 비교표준지 검토(후보 · 확정 아님)'];
  (opinion?.standard || [{ text: '표준지 검토 전' }]).forEach((x) => lines.push(`- ${x.text}`));
  const st = d.analysis?.standard;
  const unverified = new Set();
  if (st?.status === 'FOUND') {
    lines.push('■ 표준지 검토요건(공법상 제한·실제 이용상황·주위환경·거리)');
    st.candidates.forEach((c) => {
      const reqs = c.review_requirements || [];
      lines.push(`- 후보 ${c.rank}(검토 순서 · 적정성 순위 아님) ${c.row.label || c.row.pnu}: ${reqs.map((r) => `${r.label}[${REVIEW_REQUIREMENT_STATUS[r.status]}]`).join(' · ')}`);
      reqs.forEach((r) => r.unverified.forEach((u) => unverified.add(`${r.label}: ${u}`)));
    });
  }
  lines.push('■ 표준지 관련 미확인 사항');
  if (unverified.size) [...unverified].forEach((u) => lines.push(`- ${u}`));
  else lines.push('- 후보가 없어 요건별 확인 대상 없음 — 비교표준지 선정사유는 감정평가서로 확인');
  lines.push('■ 지번만으로 미확인', ...d.analysis.unknowns.map((u) => `- ${u.label}`));
  lines.push('※ 비교표준지는 조회 범위 내 검토 후보만 추출하였으며, 최종 비교표준지 선정·보정률·보상금 산정은 수행하지 않았습니다. 감정평가서·현장자료 없이 형상·도로조건만으로 우열을 판단하지 않았습니다.');
  return lines;
}

function manualLines(gates, opinion, pack) {
  const lines = [];
  if (pack) lines.push('[내부 전용 · 외부 제공 금지] 아래 발췌는 LK 실무기본서 제1판 검토본(비공개 지식팩) 기재이며 승인 확정본이 아닙니다.');
  else lines.push('- 비공개 지식팩 미연결: 기본서 T-01·T-05·T-09·T-12의 원문 위치·판단기준이 이 검토서에 반영되지 않았습니다(원본 확인 필요).');
  gates.forEach((g) => {
    const s = g.source;
    lines.push(`- ${g.code} ${s.title || `${g.topic}(기본서 제목 미연결)`} · ${pageText(s)}`);
    if (!pack) return;
    if (!s.entry_found) { lines.push('  · 지식팩에 해당 코드 없음 — 원본 확인 필요'); return; }
    lines.push(`  · 성립요건(기본서 판단기준): ${s.criteria.ok ? excerpt(s.criteria.text) : '원문·요약 부족 — 원본 확인 필요'}`);
    lines.push(`  · 확인자료(기본서): ${s.materials.ok ? excerpt(s.materials.text) : '원문·요약 부족 — 원본 확인 필요'}`);
    lines.push(`  · 근거(기본서 기재 · 현행 법령·판례 공식 원문 미대조): ${s.grounds.ok ? excerpt(s.grounds.text) : '기재 없음 — 원본 확인 필요'}`);
  });
  lines.push('■ 향후 주장 가능 쟁점(후보)');
  const issues = opinion?.issues || [];
  if (!issues.length) lines.push('- 공적자료만으로 제시할 쟁점 후보 없음');
  issues.forEach((x) => lines.push(`- [${x.title}] ${x.text} · 기본서 코드: ${ISSUE_CODE[x.title] || '미연결 — 원본 확인 필요'}`));
  return lines;
}

function evidenceLines(gates) {
  const lines = ['※ 충족 = 필요한 자료가 확보되어 전문가가 대조할 수 있는 상태. 쟁점 성립·법률효과를 판단한 것이 아닙니다.'];
  gates.forEach((g) => {
    lines.push(`- ${g.code} ${g.topic}: ${g.state_label} — ${g.reason}`);
    if (g.trigger) lines.push(`  · [개시요건 ${EVIDENCE_STATE_LABEL[g.trigger.state]}] ${g.trigger.label} (${g.trigger.basis})`);
    if (g.state === EVIDENCE_STATE.NOT_TRIGGERED) return;
    g.requirements.forEach((r) => lines.push(`  · [${EVIDENCE_STATE_LABEL[r.state]}] ${r.label} (${r.basis})`));
  });
  const count = (s) => gates.filter((g) => g.state === s).length;
  lines.push(`- 집계: 전문가 대조 단계 ${count(EVIDENCE_STATE.READY_FOR_EXPERT)} · 미충족 ${count(EVIDENCE_STATE.NOT_SATISFIED)} · 판정 보류 ${count(EVIDENCE_STATE.HOLD)} · 개시요건 없음 ${count(EVIDENCE_STATE.NOT_TRIGGERED)}`);
  return lines;
}

const TASK_TITLE = Object.freeze({
  'T-01': '비교표준지 선정 적정성 검토', 'T-05': '요인비교 기준시점·산정 근거 검토',
  'T-09': '지목과 현실 이용상황 검토', 'T-12': '현실적 이용상황 증거 정리',
});
const LITIGATION_GOALS = new Set(['ADJUDICATION', 'OBJECTION', 'LITIGATION']);

export function buildTasks({ gates, opinion, intakeEval }) {
  const tasks = [];
  gates.forEach((g) => {
    if (g.state === EVIDENCE_STATE.NOT_TRIGGERED) return;
    const ready = g.state === EVIDENCE_STATE.READY_FOR_EXPERT;
    tasks.push({ title: TASK_TITLE[g.code], code: g.code, status: ready ? 'READY' : 'BLOCKED',
      prerequisites: ready ? [] : [...(g.source_issue ? [g.source_issue] : []), ...g.missing] });
  });
  const factorIssues = (opinion?.issues || []).filter((x) => x.gate === 'EVIDENCE_REQUIRED');
  if (factorIssues.length) {
    tasks.push({ title: `개별요인(${factorIssues.map((x) => x.title.replace(' 확인', '')).join('·')}) 비교 검토`, code: null, status: 'BLOCKED',
      prerequisites: [...new Set(factorIssues.flatMap((x) => x.needs || []))] });
  }
  if (LITIGATION_GOALS.has(intakeEval?.goal)) {
    tasks.push({ title: '재결·이의재결 단계 감정평가서 간 비교 검토', code: null, status: 'BLOCKED', prerequisites: ['재결서·이의재결서', '각 단계 감정평가서'] });
  }
  if (intakeEval?.goal === 'REMAINDER') {
    tasks.push({ title: '잔여지 등 추가 손실 검토', code: null, status: 'BLOCKED', prerequisites: ['잔여지 현황·이용 가능성 자료', '편입·잔여 면적 기재 문서'] });
  }
  return tasks;
}

// record를 넘기면 현재 draft와 결속이 맞는 기록만 사용한다. 불일치면 상담 4요소·증빙 표시를 비우고 binding_ok=false.
export function buildConsultReport({ draft, record, intake = null, evidence = {}, pack = null, now = new Date() } = {}) {
  const d = draft;
  let recordBinding = { status: 'NOT_PROVIDED', record_id: null };
  if (record !== undefined) {
    if (recordMatches(record, d)) { intake = record.intake; evidence = record.evidence || {}; recordBinding = { status: 'MATCHED', record_id: record.record_id }; }
    else { intake = null; evidence = {}; recordBinding = { status: 'MISMATCH', record_id: record?.record_id || null }; }
  }
  intake = intake ? scrubSecrets(intake) : null;
  const opinion = d.analysis?.opinion || null;
  const intakeEval = evaluateIntake(intake, { now });
  const gates = buildEvidenceGates({ pack, draft: d, evidence });
  const tasks = buildTasks({ gates, opinion, intakeEval });
  const materials = [...new Set([
    ...gates.filter((g) => g.state !== EVIDENCE_STATE.NOT_TRIGGERED).flatMap((g) => g.requirements.filter((r) => !r.auto && r.state !== EVIDENCE_STATE.SATISFIED).map((r) => r.label)),
    ...(opinion?.materials || []),
  ])];
  const actions = nextActionsFor(intakeEval);

  const header = [
    `[1차 상담 검토서 · 검토 보조${d.synthetic ? ' · 합성 데이터(실제 필지 아님)' : ''}${pack ? ' · 내부 전용(기본서 발췌 포함)' : ''}]`,
    `필지: ${d.parcel.legal_dong_name} ${d.parcel.lot_label} (PNU ${d.parcel.pnu}) · 기준연도 ${d.binding.base_year}`,
    ...(recordBinding.status === 'MATCHED' ? [`상담 ID: ${recordBinding.record_id} (이 필지·기준연도·데이터 모드 조회에 결속)`] : []),
    ...(recordBinding.status === 'MISMATCH' ? ['상담 기록 결속 불일치 — 상담 4요소·증빙 표시를 포함하지 않음'] : []),
  ];
  const s1 = [
    ...factLines(d),
    '■ 상담 4요소(상담자 기록 · 원 문서 대조 전)',
    ...intakeEval.items.map((i) => `- ${i.label}: ${i.value_text} [${INTAKE_STATUS_LABEL[i.status]}]`),
    '■ 확인 필요 신호(결론 아님)',
    ...(d.analysis.signals.length ? d.analysis.signals : [{ title: '자동 신호 없음', detail: '' }]).map((s) => `- ${s.title}${s.detail ? `: ${s.detail}` : ''}`),
  ];
  const s2 = standardLines(d, opinion);
  const s3 = manualLines(gates, opinion, pack);
  const s4 = evidenceLines(gates);
  const deadline = intakeEval.items.find((i) => i.element === 'deadline');
  const s5 = [
    `- 절차 단계: ${intakeEval.items.find((i) => i.element === 'stage').value_text}`,
    `- 판단·결정 권한자: ${intakeEval.items.find((i) => i.element === 'authority').value_text}`,
    `- 기한·기산일: ${deadline.value_text} (${deadline.note})`,
    '■ 다음 조치', ...actions.map((a) => `- ${a}`),
    '■ 상담 멘트(초안)', opinion?.script || '- 표준지 검토 후 생성',
  ];
  const s6 = [
    '■ 정밀검토 과업(제안 · 전문가 검토 전제)',
    ...(tasks.length ? tasks.map((t) => `- ${t.title}${t.code ? `(${t.code})` : ''} [${t.status === 'READY' ? '자료 대조 착수 가능' : '선행자료 필요'}]${t.prerequisites.length ? ` · 선행: ${t.prerequisites.join(', ')}` : ''}`) : ['- 현재 자료로 제안할 과업 없음']),
    '■ 추가 확보자료', ...materials.map((m) => `- ${m}`),
  ];
  const bodies = [s1, s2, s3, s4, s5, s6];
  const lines = [...header];
  bodies.forEach((body, i) => lines.push('', `${i + 1}. ${REPORT_SECTIONS[i]}`, ...body));
  lines.push('', '※ 검토 보조 자료입니다. 감정평가·법률자문을 대체하지 않으며, 법령·평가서·현장 원문과 전문가 검토가 필요합니다.');
  const text = lines.join('\n');
  // 기본서 발췌는 원문 인용이므로 BSO 생성 문구만 금지표현 검사 대상으로 삼는다.
  const generated = lines.filter((l) => !/^\s+· (성립요건|확인자료|근거)\(기본서/.test(l));
  return {
    text, sections: REPORT_SECTIONS.map((title, i) => ({ no: i + 1, title, lines: bodies[i] })),
    intake: intakeEval, gates, tasks, materials, actions,
    record_binding: recordBinding, binding_ok: recordBinding.status !== 'MISMATCH',
    internal_excerpt_included: Boolean(pack),
    forbidden_hits: generated.filter((t) => FORBIDDEN_PHRASES.some((re) => re.test(t))),
  };
}
