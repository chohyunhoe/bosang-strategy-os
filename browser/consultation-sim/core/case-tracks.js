// 사업·보상 유형별 상담 트랙 (Issue #31) — 결정론 · 네트워크 없음 · LLM 없음
// 원칙
// - 사업·보상 유형은 상담자가 명시적으로 고른다. 목표·절차 단계에서 유형을 추정하지 않는다.
// - 유형 미확인이면 특정 불복 경로(재결·이의재결·소송)·기한·유형별 과업 안내를 보류한다(일반 서류 확보만).
// - 정비사업 종전자산평가 이의는 토지수용 재결·이의재결·행정소송 트랙과 자동 동일시하지 않는다.
// - 법령은 조문 번호만 '관련 조문(현행 원문 확인 필요)'으로 표시하고 원문을 자동 인용하거나 요건 충족을 판단하지 않는다.
// - 기간 숫자·보상액·증액 가능성·위법 여부를 만들지 않는다.
// 조문 확인: 국가법령정보센터 현행 원문(2026-11-24) — 토지보상법 제73조·제74조·제75조, 도시정비법 제74조.

import { CASE_TYPE_OPTIONS, EXPROPRIATION_FAMILY, STAGE_OPTIONS, AUTHORITY_OPTIONS, authorityMismatch } from './consult-intake.js';

const isFamily = (t) => EXPROPRIATION_FAMILY.includes(t);
const DISPUTE_GOALS = Object.freeze(['ADJUDICATION', 'OBJECTION', 'LITIGATION']);
const stageLabel = (v) => (STAGE_OPTIONS.find(([k]) => k === v) || ['', v])[1];
export const caseTypeLabel = (t) => (CASE_TYPE_OPTIONS.find(([v]) => v === (t || '')) || CASE_TYPE_OPTIONS[0])[1];

const NO_CALC = '(BSO 미계산)';
const CHECKLISTS = Object.freeze({
  OBJECTS: {
    id: 'objects', title: '지장물(건축물·공작물 등) 누락·보완 확인',
    legal_ref: '토지보상법 제75조(건축물등 물건에 대한 보상) — 현행 원문 확인 필요',
    facts: ['누락이 의심되는 물건의 종류·위치·규격·수량', '물건조서 기재 여부와 기재 내용(소유자·수량·규격)', '공사 전후 현황 변화(철거·훼손 여부)'],
    evidence: ['물건조서 사본(누락 항목 표시)', '소유·설치·시공 자료(허가·준공·계약서·영수증 등)', '규격·수량 실측 자료', '촬영일이 확인되는 공사 전후 현황 사진', '감정평가서 물건 목록(평가 누락 항목 대조)'],
    optional: [],
    procedure: [`현장 재조사·보완평가 요청 방법과 회신 기한은 사업시행자 안내·법령 원문으로 확인${NO_CALC}`],
    next: ['물건조서·감정평가서 대조로 누락 항목 목록 작성', '사업시행자에 현장 재조사·보완평가 서면 요청 검토', '서면 회신 확보 후 재협의 준비(전문가 판단 대기)'],
  },
  REMAINDER_73: {
    id: 'remainder_73', title: '잔여지 가격감소·공사비 보상', claim: '제73조',
    legal_ref: '토지보상법 제73조(잔여지의 손실과 공사비 보상) — 현행 원문 확인 필요',
    facts: ['동일 소유자의 일단의 토지 중 일부가 취득·사용되었는지', '잔여지 가격 감소 또는 그 밖의 손실이 생겼는지', '통로·도랑·담장 신설 등 공사가 필요한지'],
    evidence: ['편입 전후 토지 형상·면적 자료(지적도·토지대장)', '가격 감소 근거 자료(전문가 평가 필요)', '필요 공사 항목과 견적·설계 자료'],
    optional: ['진입로 단절·대체 통로 필요(해당 시)', '공사 전후 단차·옹벽 필요(해당 시)', '용수·배수 설비 단절(해당 시)'],
    procedure: [`청구 상대방과 청구 기간(기산점 포함)은 법령 원문으로 확인${NO_CALC}`],
    next: ['손실·공사비 항목을 정리하고 전문가 판단 대기', '제74조의 "종래 목적 사용의 현저한 곤란" 요건 자료와 섞지 않음'],
  },
  REMAINDER_74: {
    id: 'remainder_74', title: '잔여지 매수·수용 청구', claim: '제74조',
    legal_ref: '토지보상법 제74조(잔여지 등의 매수 및 수용 청구) — 현행 원문 확인 필요',
    facts: ['동일 소유자의 일단의 토지 중 일부가 협의매수·수용되었는지', '잔여지를 종래의 목적에 사용하는 것이 현저히 곤란한지(종래 이용 목적·현재 이용 가능성)', '사업인정 여부와 매수 협의 경과'],
    evidence: ['종래 이용 목적을 보여 주는 자료(건축물대장·영업·경작 자료 등)', '잔여지 면적·형상·접근 자료', '매수 청구·협의 경과 서면'],
    optional: ['차량 진입·회전 불가(해당 시)', '경사·단차로 이용 곤란(해당 시)', '설비·용수 단절로 종래 용도 유지 곤란(해당 시)'],
    procedure: [`매수청구·수용청구의 상대방과 청구 기한은 법령 원문으로 확인${NO_CALC}`],
    next: ['종래 목적 사용 곤란 사실을 정리하고 전문가 판단 대기', '제73조의 가격감소 입증 자료와 섞지 않음'],
  },
  PRIOR_ASSET: {
    id: 'prior_asset', title: '정비사업 종전자산평가 이의 확인',
    legal_ref: '도시정비법 제74조(관리처분계획의 인가 등) 등 — 현행 원문 확인 필요',
    facts: ['정비사업 종류와 진행 단계(분양신청·관리처분계획 수립·인가 여부)', '종전 토지·건축물 명세와 가격 산정 기준일', '이의(의견) 대상이 종전자산 가격인지 다른 항목인지'],
    evidence: ['종전자산 평가 결과 통지서', '관리처분계획(안)·공람 공고문', '분양신청 안내서', '종전자산 감정평가서(열람·사본)'],
    optional: [],
    procedure: [`의견 제출·이의 방법과 기한은 공람 공고문·사업시행자(조합) 통지와 법령 원문으로 확인${NO_CALC}`, '토지수용 재결·이의재결·행정소송 절차·기간과 자동 동일시하지 않음'],
    next: ['통지서·공람 공고문을 확보하고 전문가 판단 대기'],
  },
});

const TASKS = Object.freeze({
  OBJECTS: [
    { title: '누락 지장물 현장 재조사·보완평가 요청 검토', prerequisites: ['물건조서 사본', '촬영일이 확인되는 공사 전후 현황 사진', '규격·수량 실측 자료'] },
    { title: '물건조서·감정평가서 대조(누락 항목)', prerequisites: ['물건조서 사본', '감정평가서 물건 목록'] },
  ],
  REMAINDER_73: [{ title: '잔여지 가격감소·공사비 보상 검토(토지보상법 제73조)', prerequisites: ['편입 전후 토지 형상·면적 자료', '필요 공사 항목과 견적·설계 자료'] }],
  REMAINDER_74: [{ title: '잔여지 매수·수용 청구 검토(토지보상법 제74조)', prerequisites: ['종래 이용 목적 자료', '매수 청구·협의 경과 서면'] }],
  PRIOR_ASSET: [{ title: '종전자산평가 이의 검토(관리처분계획 맥락)', prerequisites: ['종전자산 평가 결과 통지서', '관리처분계획(안)·공람 공고문', '종전자산 감정평가서'] }],
});

export const TRACK_STATUS_LABEL = Object.freeze({
  UNDETERMINED: '유형 미확인 · 유형별 안내 보류',
  CLAIM_NOT_SELECTED: '청구 유형 미선택 · 판정 보류',
  EXPERT_PENDING: '체크리스트 표시 · 전문가 판단 대기',
  GENERAL: '일반 토지보상 트랙',
});

// intake: emptyIntake() 형태(case_type, claim_73, claim_74, goal, stage 포함)
export function buildCaseTrack(intake) {
  const v = intake || {};
  const type = v.case_type || '';
  const warnings = [];
  const notes = [];
  let checklists = [];
  let tasks = [];
  let status;

  if (!type || type === 'OTHER') {
    status = 'UNDETERMINED';
    notes.push('사업·보상 유형 미확인 — 특정 불복 경로(재결·이의재결·소송)·기한·유형별 과업 안내를 보류하고 일반 서류 확보만 안내');
    if (v.goal === 'REMAINDER') notes.push('잔여지 청구는 사업·보상 유형에서 "잔여지"를 고르고 제73조·제74조 청구를 선택하면 별도 체크리스트로 표시');
  } else if (type === 'PRIOR_ASSET') {
    status = 'EXPERT_PENDING';
    checklists = [CHECKLISTS.PRIOR_ASSET];
    tasks = TASKS.PRIOR_ASSET;
    notes.push('정비사업 종전자산평가 이의는 토지수용 재결 불복과 다른 절차 맥락 — 재결·이의재결·행정소송 안내와 과업을 자동 생성하지 않음');
    if (v.stage) warnings.push(`선택한 절차 단계 "${stageLabel(v.stage)}"는 토지보상법 수용 절차 분류 — 종전자산평가 이의 건에는 적용하지 않음(정비사업 단계는 원문·통지로 확인)`);
    if (DISPUTE_GOALS.includes(v.goal)) warnings.push('선택한 고객 목표(재결·이의·소송 대응)는 토지수용 재결 절차 기준 분류 — 종전자산평가 이의와 동일시하지 않음');
    if (authorityMismatch(v)) warnings.push(`입력 권한자 "${(AUTHORITY_OPTIONS.find(([k]) => k === v.authority) || ['', v.authority])[1]}"는 토지수용 재결 계열 기관 — 종전자산평가 이의 유형과 직접 맞지 않을 수 있음 · 통지서·법령 원문 확인 필요(미검증 입력)`);
  } else if (type === 'OBJECTS') {
    status = 'EXPERT_PENDING';
    checklists = [CHECKLISTS.OBJECTS];
    tasks = TASKS.OBJECTS;
    notes.push('지장물 보상은 토지 평가(비교표준지)와 별도 구조 — 보상액은 산정하지 않음');
  } else if (type === 'REMAINDER') {
    const claims = [v.claim_73 === 'Y' && 'REMAINDER_73', v.claim_74 === 'Y' && 'REMAINDER_74'].filter(Boolean);
    if (!claims.length) {
      status = 'CLAIM_NOT_SELECTED';
      notes.push('잔여지 청구 유형(제73조 가격감소·공사비 / 제74조 매수·수용)을 선택하면 각각 별도 체크리스트를 표시(복수 선택 가능) — 선택 전 판정 보류');
    } else {
      status = 'EXPERT_PENDING';
      checklists = claims.map((k) => CHECKLISTS[k]);
      tasks = claims.flatMap((k) => TASKS[k]);
      if (claims.length === 2) notes.push('제73조와 제74조는 요건·입증·상대방·기간이 다른 별도 청구 — 각각 따로 검토');
    }
  } else {
    status = 'GENERAL';
  }
  return {
    case_type: type || null, label: caseTypeLabel(type), status, status_label: TRACK_STATUS_LABEL[status],
    family: isFamily(type), checklists, tasks: tasks.map((t) => ({ ...t, status: 'BLOCKED', code: null })),
    notes, warnings, materials: [...new Set(checklists.flatMap((c) => c.evidence))],
    legal_conclusion: false, amounts_computed: false, legal_deadline_computed: false,
  };
}
