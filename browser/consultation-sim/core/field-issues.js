// BSO 현장상담 쟁점 카탈로그 — 전국 공통. 사업별 프로필은 이 목록에서 고르고 지역 쟁점만 덧붙인다.
// 각 항목은 '질문 · 확보할 문서 · 후속조치'만 담는다. 법률판단·보상액·기간을 자동으로 정하지 않는다.
export const FIELD_ISSUES = Object.freeze([
  { id: 'stage', label: '절차 단계 확인',
    question: '받은 문서가 무엇인지(고시·보상계획 열람공고·협의요청·재결 관련) 원문으로 확인했나요?',
    documents: ['받은 통지문·우편 원본(봉투 포함)', '보상계획 열람공고문'],
    next: ['원문 날짜·발신기관을 상담카드에 옮겨 적기 — 단계는 원문 확인 후 기록(자동 단정 금지)'] },
  { id: 'obstacle', label: '지장물 누락·조사 입회',
    question: '건물·창고·비닐하우스·수목·분묘 등 지장물이 조사에서 빠졌거나 수량이 다르다고 보시나요? 조사 때 입회하셨나요?',
    documents: ['지장물 조서(통지 시)', '현장 사진(촬영일 표시)', '건축물대장·설치 영수증'],
    next: ['조서 열람 후 누락·수량 차이 목록 작성', '재조사·입회 요청 필요 여부 전문가 검토'] },
  { id: 'land_use', label: '지목과 실제 이용상황',
    question: '공부상 지목과 실제 쓰는 용도(경작·주차·창고·주거 등)가 다른가요? 언제부터 그렇게 쓰셨나요?',
    documents: ['토지이용 사진·항공사진', '농지원부·경작 증빙', '인허가 서류(있을 때)'],
    next: ['이용상황 시점·적법성 자료 확보 후 전문가 검토 — 현황 인정 여부를 여기서 판단하지 않음'] },
  { id: 'farming', label: '영농손실',
    question: '직접 경작 중인가요, 임차 경작인가요? 작목과 경작 기간은?',
    documents: ['농지원부(농업경영체 등록확인서)', '임대차계약서', '판매 실적·출하 증빙'],
    next: ['실경작자·소유자 구분 기록', '영농손실 요건 자료 목록 안내'] },
  { id: 'business', label: '영업손실',
    question: '해당 토지·건물에서 영업 중인가요? 사업자등록·인허가는?',
    documents: ['사업자등록증', '인허가·신고 서류', '최근 매출 자료(부가세 신고 등)'],
    next: ['영업 장소·기간·적법성 자료 정리 후 전문가 검토'] },
  { id: 'residence', label: '거주·이주대책·생활대책',
    question: '이 필지(또는 지상 건물)에 실제 거주하시나요? 기준일 이전부터인가요?',
    documents: ['주민등록초본(주소 이력)', '건축물대장', '전기·수도 사용 내역'],
    next: ['이주대책·생활대책 공고 원문 확인 — 대상 여부를 여기서 판단하지 않음'] },
  { id: 'remainder', label: '일부 편입·잔여지(제73조·제74조 구별)',
    question: '일부만 편입되나요? 남는 땅의 이용이 곤란해지거나 가치가 떨어진다고 보시나요?',
    documents: ['지적도·편입 경계 도면', '잔여지 이용 현황 사진'],
    next: ['제73조(가격감소·공사비 보상)와 제74조(매수·수용 청구)를 따로 기록 — 청구 기간·절차는 원문·전문가 확인'] },
  { id: 'resident_appraiser', label: '토지소유자 추천 감정평가 절차',
    question: '소유자 추천 감정평가업자 선정 절차(동의서 제출 등)에 참여하셨나요?',
    documents: ['추천 동의서 사본', '보상계획 공고의 추천 안내 부분'],
    next: ['추천 절차 진행 상황과 마감일을 원문으로 확인'] },
  { id: 'other', label: '기타', free_text: true,
    question: '위 항목에 없는 쟁점을 자유롭게 적어 주세요(실명·전화번호 제외).',
    documents: [],
    next: ['기타 쟁점은 관련 원문·자료 확인 후 전문가 검토'] },
]);

// '기타'(자유입력)는 사업 프로필과 관계없이 항상 마지막에 둔다.
export function issuesFor(profile) {
  const base = FIELD_ISSUES.filter((it) => it.id !== 'other' && (!profile?.issue_ids || profile.issue_ids.includes(it.id)));
  return [...base, ...(profile?.extra_issues || []), FIELD_ISSUES.find((it) => it.id === 'other')];
}

export function issueLabel(it, otherText) {
  if (!it.free_text) return it.label;
  const t = String(otherText || '').trim();
  return `${it.label}: ${t || '(내용 미입력)'}`;
}
