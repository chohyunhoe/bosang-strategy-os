// 상담 4요소(고객 목표·절차 단계·기한/기산일·판단 권한자) 기록 모델 (결정론 · 네트워크·저장 없음)
// 원칙
// - 상담자가 입력하지 않은 요소는 '미확정'으로 남긴다. 추정으로 채우지 않는다.
// - 법정기한을 계산하지 않는다. 기한은 통지서·공고문 등 문서에 기재된 날짜를 상담자가 옮겨 적은 값만 다룬다.
// - 남은 일수는 상담자가 입력한 '문서 기재 기한'까지의 달력 일수일 뿐이며 법정기한 검증이 아니다.

export const INTAKE_SCHEMA = 'bso-consult-intake/0.1';

export const GOAL_OPTIONS = Object.freeze([
  ['', '미확정'],
  ['ADEQUACY_REVIEW', '보상금(평가액) 적정성 검토'],
  ['NEGOTIATION', '협의 대응·협의 수락 여부 판단'],
  ['ADJUDICATION', '수용재결 대응'],
  ['OBJECTION', '이의신청 대응'],
  ['LITIGATION', '행정소송 검토'],
  ['REMAINDER', '잔여지 등 추가 손실 검토'],
  ['OTHER', '기타(직접 기재)'],
]);

// 절차 단계 구분은 상담 기록용 분류다. 단계별 법적 효과·기간은 BSO가 판단하지 않는다.
export const STAGE_OPTIONS = Object.freeze([
  ['', '미확정'],
  ['PRE_RECOGNITION', '사업인정 전(사업 공람·공고 등)'],
  ['RECOGNITION', '사업인정(의제) 고시 후'],
  ['COMPENSATION_PLAN', '보상계획 공고·열람'],
  ['APPRAISAL', '보상 감정평가 진행'],
  ['NEGOTIATION', '손실보상 협의(협의요청 수령)'],
  ['ADJUDICATION_REQUEST', '협의 불성립·재결신청(청구)'],
  ['ADJUDICATION', '수용재결(재결서 수령)'],
  ['OBJECTION', '이의신청·이의재결'],
  ['LITIGATION', '행정소송'],
]);

export const AUTHORITY_OPTIONS = Object.freeze([
  ['', '미확정'],
  ['PROJECT_OPERATOR', '사업시행자(보상 담당)'],
  ['LAND_COMMITTEE_LOCAL', '지방토지수용위원회'],
  ['LAND_COMMITTEE_CENTRAL', '중앙토지수용위원회'],
  ['COURT', '법원'],
  ['CLIENT', '고객 본인(협의 수락 여부 등)'],
  ['OTHER', '기타(직접 기재)'],
]);

const label = (options, value) => (options.find(([v]) => v === value) || options[0])[1];
const txt = (v) => (v == null ? '' : String(v).trim());

export function emptyIntake() {
  return {
    schema: INTAKE_SCHEMA,
    goal: '', goal_note: '',
    stage: '', stage_basis: '',
    trigger_event: '', trigger_date: '', trigger_source: '',
    stated_deadline: '', deadline_source: '',
    authority: '', authority_note: '',
  };
}

// 'YYYY-MM-DD' 형식의 실제 달력 날짜만 허용한다(2026-02-30 등 거부).
export function parseIsoDate(value) {
  const s = txt(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

// 기준일(now)의 상담자 현지 날짜(Asia/Seoul 고정이 아니라 기기 현지 날짜)를 UTC 자정으로 맞춰 달력 일수만 센다.
function localDay(now) {
  const n = now instanceof Date ? now : new Date(now);
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

const UNDETERMINED = 'UNDETERMINED';
const RECORDED = 'RECORDED_BY_COUNSELOR';
const PARTIAL = 'PARTIAL';
const INVALID = 'INPUT_INVALID';

export const INTAKE_STATUS_LABEL = Object.freeze({
  [UNDETERMINED]: '미확정', [RECORDED]: '상담자 기록', [PARTIAL]: '일부 기록 · 근거 미확인', [INVALID]: '입력 확인 필요',
});

export function evaluateIntake(raw, { now = new Date() } = {}) {
  const v = { ...emptyIntake(), ...(raw || {}) };
  const items = [];

  // 1) 고객의 목표
  {
    const other = v.goal === 'OTHER';
    const note = txt(v.goal_note);
    const ok = v.goal && (!other || note);
    items.push({
      element: 'goal', label: '고객의 목표',
      status: ok ? RECORDED : (v.goal || note ? PARTIAL : UNDETERMINED),
      value_text: ok ? `${other ? note : label(GOAL_OPTIONS, v.goal)}${!other && note ? ` (${note})` : ''}` : (note ? `메모: ${note}` : '미확정'),
      note: ok ? '고객 진술 기준 · 상담자 기록' : '고객이 원하는 결과(적정성 검토·협의 대응·재결/이의 대응 등) 확인 필요',
    });
  }
  // 2) 현재 사업·보상 절차 단계
  {
    const basis = txt(v.stage_basis);
    items.push({
      element: 'stage', label: '현재 사업·보상 절차 단계',
      status: v.stage ? (basis ? RECORDED : PARTIAL) : UNDETERMINED,
      value_text: v.stage ? `${label(STAGE_OPTIONS, v.stage)}${basis ? ` · 근거: ${basis}` : ''}` : '미확정',
      note: v.stage ? (basis ? '상담자 기록 · 원 문서 대조 전' : '근거 문서(공고문·협의요청서·재결서 등) 미확인') : '고객이 받은 공문 종류·수령일로 단계 확인 필요',
    });
  }
  // 3) 기한 및 기산일 — 법정기한 계산 없음
  {
    const triggerDate = txt(v.trigger_date) ? parseIsoDate(v.trigger_date) : null;
    const deadline = txt(v.stated_deadline) ? parseIsoDate(v.stated_deadline) : null;
    const problems = [];
    if (txt(v.trigger_date) && !triggerDate) problems.push('기산일 날짜 형식 오류(YYYY-MM-DD)');
    if (txt(v.stated_deadline) && !deadline) problems.push('기한 날짜 형식 오류(YYYY-MM-DD)');
    if (triggerDate && deadline && deadline < triggerDate) problems.push('입력한 기한이 기산일보다 앞섬 — 원 문서 재확인');
    const parts = [];
    if (txt(v.trigger_event) || triggerDate) {
      parts.push(`기산 사유 ${txt(v.trigger_event) || '미기재'} · 기산일 ${triggerDate ? txt(v.trigger_date) : '미확정'}${txt(v.trigger_source) ? ` (근거: ${txt(v.trigger_source)})` : ' (근거 문서 미확인)'}`);
    }
    let remaining = null;
    if (deadline) {
      remaining = Math.round((deadline - localDay(now)) / 86400000);
      parts.push(`문서 기재 기한 ${txt(v.stated_deadline)}${txt(v.deadline_source) ? ` (근거: ${txt(v.deadline_source)})` : ' (근거 문서 미확인)'} — 입력 기한까지 ${remaining >= 0 ? `${remaining}일` : `${Math.abs(remaining)}일 지남`}`);
    }
    const sourced = (!triggerDate || txt(v.trigger_source)) && (!deadline || txt(v.deadline_source));
    items.push({
      element: 'deadline', label: '기한 및 기산일',
      status: problems.length ? INVALID : deadline || triggerDate ? (sourced && txt(v.trigger_event) ? RECORDED : PARTIAL) : (txt(v.trigger_event) ? PARTIAL : UNDETERMINED),
      value_text: parts.length ? parts.join(' / ') : '미확정',
      note: [
        ...problems,
        'BSO는 법정기한을 계산하지 않음 — 기간은 법령 원문과 통지서·재결서 등 문서 기재로 확인',
      ].join(' · '),
      remaining_days: remaining,
      legal_deadline_computed: false,
    });
  }
  // 4) 현재 판단·결정 권한자
  {
    const other = v.authority === 'OTHER';
    const note = txt(v.authority_note);
    const ok = v.authority && (!other || note);
    items.push({
      element: 'authority', label: '현재 판단·결정 권한자',
      status: ok ? RECORDED : (v.authority || note ? PARTIAL : UNDETERMINED),
      value_text: ok ? `${other ? note : label(AUTHORITY_OPTIONS, v.authority)}${!other && note ? ` (${note})` : ''}` : (note ? `메모: ${note}` : '미확정'),
      note: ok ? '상담자 기록 · 기관·담당자 확인 전' : '지금 결정을 내리는 주체(사업시행자·토지수용위원회·법원·고객 본인) 확인 필요',
    });
  }

  const undetermined = items.filter((i) => i.status !== RECORDED);
  return {
    schema: INTAKE_SCHEMA, items,
    recorded_count: items.length - undetermined.length,
    undetermined: undetermined.map((i) => i.label),
    stage: v.stage || null, goal: v.goal || null, authority: v.authority || null,
    legal_deadline_computed: false,
  };
}

// 절차 단계별 다음 조치(자료확보·확인 행위). 기간 수치는 넣지 않는다.
const STAGE_ACTIONS = Object.freeze({
  '': ['현재 절차 단계 확인: 고객이 받은 공문(보상계획 공고·협의요청서·재결서 등)의 종류와 수령일 확인'],
  PRE_RECOGNITION: ['사업 공람·공고문 확보', '사업인정(의제) 여부·예정 시기 확인', '편입 범위(토지조서 작성 여부) 확인'],
  RECOGNITION: ['사업인정(의제) 고시문 확보 — 고시일 기록(T-05 요인비교 시점 검토 자료)', '보상계획 공고 예정 여부 확인'],
  COMPENSATION_PLAN: ['보상계획 공고문·토지조서·물건조서 열람 및 기재사항 대조', '조서 기재에 대한 의견 제출 방법·기간은 공고문 기재로 확인(BSO 미계산)'],
  APPRAISAL: ['감정평가 진행 여부·평가기관 확인', '실제 이용상황 증빙(촬영일 있는 사진·대장) 정리'],
  NEGOTIATION: ['협의요청서·보상금 산정 내역 확보', '보상평가서(비교표준지·개별요인 비교표) 열람·사본 요청', '협의기간은 협의요청서 기재로 확인(BSO 미계산)'],
  ADJUDICATION_REQUEST: ['재결신청(청구) 여부·일자 확인 — 관련 기간은 법령 원문·통지서로 확인(BSO 미계산)', '협의 경위 자료(협의요청서·회신) 정리'],
  ADJUDICATION: ['재결서 정본 송달일 확인 및 기산일 기록', '이의신청·행정소송 기간은 법령 원문·재결서 안내문으로 확인(BSO 미계산)', '재결 감정평가서 확보'],
  OBJECTION: ['이의신청서·이의재결서 확보', '이의재결 감정평가서 확보', '행정소송 제기 기간은 법령 원문·이의재결서 안내로 확인(BSO 미계산)'],
  LITIGATION: ['소송 진행 단계·담당 변호사 확인', '법원 감정 신청 여부 확인'],
});

export function nextActionsFor(intakeEval) {
  const actions = [...(STAGE_ACTIONS[intakeEval?.stage || ''] || STAGE_ACTIONS[''])];
  const items = Object.fromEntries((intakeEval?.items || []).map((i) => [i.element, i]));
  if (items.goal?.status !== RECORDED) actions.push('고객 목표 확인(무엇을 결정·대응하려는지)');
  if (items.deadline?.status !== RECORDED) actions.push('기산일·기한이 적힌 원 문서(통지서·재결서 등) 확보 — 기한은 문서 기재값으로만 기록');
  if (items.deadline?.status === INVALID) actions.push('기한·기산일 입력값 재확인');
  if (items.authority?.status !== RECORDED) actions.push('현재 결정 권한자(사업시행자·토지수용위원회·법원 등)와 담당 부서 확인');
  if (Number.isFinite(items.deadline?.remaining_days) && items.deadline.remaining_days <= 14) {
    actions.unshift(`입력한 문서 기재 기한이 ${items.deadline.remaining_days < 0 ? '지났습니다' : `${items.deadline.remaining_days}일 남았습니다`} — 담당 전문가에게 즉시 공유(기한 효력은 원문으로 확인)`);
  }
  return actions;
}
