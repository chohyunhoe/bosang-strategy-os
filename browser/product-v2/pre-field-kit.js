// BSO Pre-Field 사전분석키트 v0.2.1
// 신규사업 모니터링(발견·선별)에서 '현장검토 필요'로 넘어온 사업을 현장 방문 전에
// 사업·공간·타깃·접촉거점·쟁점과 1차 Mission 으로 정리한다.
//
// 이 모듈은 판정하지 않는다.
// - 출처가 있는 사실([확인쟁점])과 BSO 추정([BSO 추정쟁점/현장검증 필요])을 분리해 담는다.
// - 값이 없으면 지어내지 않고 '미확인' 과 확인방법을 남긴다.
// - 인물정보는 만들지 않는다. 접촉거점은 장소·단체만 담고 성명·연락처는 제거한다.
//
// v0.2 에서 고친 것(광명시흥·남양주도심 실사용 검증 결과):
// P1-1 사업단계별 Target 프로필. 필지 타깃만 전제하지 않고 지역·거점·시설 타깃을 함께 만든다.
//      자료가 없으면 타깃을 지어내지 않고 '타깃 확보 행동'으로 전환한다.
// P1-2 실행형 Mission. 방문장소·순서·목적·확인질문·현장확인사항·종료기준을 갖는다.
// P1-3 추정쟁점 전제조건. 전제가 확인되지 않으면 승격하지 않고 FIELD_CHECK_REQUIRED 로 강등한다.
// P1-4 사업현황과 확인쟁점 분리. 출처만 있다고 확인쟁점으로 올리지 않는다.
//
// v0.2.1 에서 더한 것(현장 산출물 검수 결과):
// 새 분석을 넣지 않고, 이미 만든 데이터를 현장 실행 순서로 압축한 현장카드(field_card)를
// 맨 위에 둔다. 목표 → 동선 → 핵심질문 → 오늘의 종료기준만 담고,
// 출처·근거등급·판정코드 같은 내부 판정정보는 아래 상세근거에만 남긴다.

export const PRE_FIELD_KIT_CONTRACT = Object.freeze({
  kit_version: 'bso-pre-field-kit/0.2.1',
  role: 'PRE_FIELD_ANALYSIS_FOR_SITE_VISIT',
  upstream_role: 'NEW_BUSINESS_MONITORING_DISCOVERY_AND_SELECTION_ONLY',
  review_required: true,
  auto_confirmed: false,
  personal_data_precollection: 'NOT_ASSUMED',
  person_info_estimation: 'PROHIBITED',
});

export const PRE_FIELD_SAFETY_BOUNDARY = 'Pre-Field Kit은 현장검토 준비용 사전분석 보조자료입니다. 편입·보상대상, 보상금액, 증액 가능성, 수임 가능성을 판정하지 않습니다.';
export const UNVERIFIED = '미확인';
export const CONFIRMED_ISSUE_LABEL = '[확인쟁점]';
export const ESTIMATED_ISSUE_LABEL = '[BSO 추정쟁점/현장검증 필요]';
export const FIELD_CHECK_LABEL = '[현장확인 필요 · 전제 미확인]';
export const DEFAULT_EXIT_CRITERIA = '핵심인물 1명 이상 접촉 + 연락경로 확보 + 다음 접촉 명분 확보';

// 아래 수치는 방문 후보를 고르는 검토 임계값이다. 편입규모·밀집도의 확정 기준이 아니다.
const LARGE_AREA_M2 = 3000;
const CLUSTER_MIN_COUNT = 3;
// 1~2페이지 분량을 넘기지 않도록 화면 표시 건수를 제한한다. 초과분은 CSV로 내보낸다.
const MAX_TARGETS_ON_PAGE = 8;
const MAX_CONTACT_POINTS = 6;
const MAX_ISSUES_EACH = 6;
const MAX_QUESTIONS_PER_MISSION = 5;
const MIN_MISSIONS = 3;
const MAX_MISSIONS = 5;
const TWO_PAGE_LINE_THRESHOLD = 26;
// 방문장소를 모를 때에도 '사업지 일원' 같은 일반 문구로 끝내지 않는다.
const PLACE_TO_CONFIRM = '관할 읍·면·동 행정복지센터(방문 전 위치 확인)';

const PERSON_KEYS = Object.freeze(['person_name','owner_name','owner','representative','name','phone','mobile','tel','telephone','contact','email','resident_no','birth','birthdate']);
const PHONE_RE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

const SPECIAL_USE_RE = /주유소|충전|가스|공장|제조|축사|우사|돈사|계사|양계|양돈|버섯|화훼|원예|온실|비닐하우스|폐기물|고물|석재|채석|골재|세차|장례|묘지|납골|종교/;
const COMMERCIAL_INDUSTRIAL_RE = /상업|근린|점포|상가|시장|사무|숙박|음식|공업|공장|산업|물류|창고|자동차정비/;
const BUILDING_RE = /건물|건축물|주택|점포|상가|공장|창고|축사|무허가|부속|건부지/;
const ROAD_WEAK_RE = /맹지|무접면|접면\s*없|세로\s*\(?\s*불|세로불|소로\s*각지|세로\s*가/;

// P1-4. 사업현황 서술과 대응이 필요한 쟁점을 가른다.
const PROJECT_STATUS_RE = /지구\s*지정|지구\s*계획|실시계획|승인(되|됐|하였|됨)|고시(되|됐|하였|번호|됨)|면적(은|이)?\s*(약|총)?\s*[\d,.]|공급\s*(계획|규모)|\d+\s*(만|천)?\s*(가구|호)\b|사업시행자(는|가)|착공|분양|입주\s*(예정|목표)|보상\s*(착수|개시|공고)(되|됐|하였|가|를|됨)|지정\s*조치|지정(되|됐|됨)/;
const ISSUE_SIGNAL_RE = /요구|촉구|반발|집회|이의|불만|미제시|미비|부재|형평성|지연|피해|손실|배상|분쟁|갈등|제기|호소|반대|청구|민원|우려|미달|누락|차별|소송|거부|철회|이주대책|생활대책|영업보상|영농보상|이축|무허가/;

// 타깃 종류. 사업단계에 따라 우선순위가 달라진다(P1-1).
const TARGET_KINDS = Object.freeze({ AREA: '지역·거점', FACILITY: '시설·필지군', CASE: '사건 필지' });

export const STAGE_PROFILES = Object.freeze({
  PRE_DESIGNATION: Object.freeze({
    code: 'PRE_DESIGNATION', label: '발표·지구지정 전',
    priority: ['AREA', 'FACILITY', 'CASE'],
    note: '지구지정 전 단계다. 지역·생활권·행정거점·주민조직 확보가 먼저다. 필지 단위 보상쟁점은 아직 실무 대상이 아니다.',
  }),
  PRE_COMPENSATION: Object.freeze({
    code: 'PRE_COMPENSATION', label: '지구지정~보상 전',
    priority: ['FACILITY', 'AREA', 'CASE'],
    note: '지구지정 후 보상 전 단계다. 공장·상가·특수이용 시설과 대규모 편입후보를 먼저 확인한다.',
  }),
  COMPENSATION: Object.freeze({
    code: 'COMPENSATION', label: '보상 진행',
    priority: ['CASE', 'FACILITY', 'AREA'],
    note: '보상 진행 단계다. 개별 편입필지와 평가·잔여지 쟁점이 우선이다.',
  }),
  UNKNOWN: Object.freeze({
    code: 'UNKNOWN', label: '단계 미확인',
    priority: ['AREA', 'FACILITY', 'CASE'],
    note: '사업단계가 확인되지 않았다. 단계 확인을 먼저 하고 타깃 우선순위를 다시 정한다.',
  }),
});

// 순서가 판정이다. '지구지정 전'을 지구지정으로 읽으면 단계가 뒤집힌다.
const STAGE_PATTERNS = Object.freeze([
  [/수용재결|이의재결|협의\s*보상|보상\s*(협의|착수|개시|계획\s*공고)|감정평가|보상공고/, 'COMPENSATION'],
  [/발표|후보지|(지정|승인)\s*전|예정|검토\s*중|선정/, 'PRE_DESIGNATION'],
  [/지구\s*지정|지구\s*계획|실시계획|사업\s*인정|지형도면|공람/, 'PRE_COMPENSATION'],
]);

// 타깃 규칙. kind 는 단계 프로필 우선순위에, preconditions 는 추정쟁점 승격 여부에 쓰인다(P1-1·P1-3).
const TARGET_RULES = Object.freeze({
  SPECIAL_USE: Object.freeze({
    rank: 1, kind: 'FACILITY', label: '특수이용(주유소·공장·축사 등)',
    verification: ['영업주체·설비·인허가 현황 확인', '설비 이전 가능성과 잔여 설비 범위 확인'],
    questions: ['이 시설의 영업주체와 영업 개시 시점은 언제입니까', '설비·인허가 명의와 갱신 상태는 어떻습니까', '이전 가능한 설비와 이전 불가능한 설비를 구분할 수 있습니까'],
    preconditions: [{ code: 'FACILITY_RECORD_STATED', label: '영업·시설 기재 또는 공공데이터 레코드 존재' }],
    issue: '특수이용 시설의 영업·설비 보상범위와 이전 가능성이 쟁점이 될 수 있습니다.',
  }),
  LARGE_AREA: Object.freeze({
    rank: 2, kind: 'FACILITY', label: '대규모 편입후보',
    verification: ['편입 구간과 잔여 구간의 실제 경계 확인', '전부편입·일부편입 구분 확인'],
    questions: ['이 필지는 전부편입입니까 일부편입입니까', '일부편입이면 잔여 구간의 면적과 형상은 어떻게 됩니까', '잔여 구간에 진출입 도로가 남습니까'],
    preconditions: [
      { code: 'PARTIAL_ACQUISITION_CONFIRMED', label: '일부편입 사실 확인' },
      { code: 'REMAINDER_EXISTS', label: '잔여부분 존재 확인' },
    ],
    issue: '일부편입으로 남는 잔여지의 가치하락·잔여지 매수청구 필요성을 검토할 필요가 있습니다.',
  }),
  BUILDING_INCLUDED: Object.freeze({
    rank: 3, kind: 'CASE', label: '건축물 편입',
    verification: ['건축물 존재·용도·부속시설 현황 확인', '허가·사용승인 여부 확인자료 소재 확인'],
    questions: ['건축물의 실제 용도와 사용 상태는 어떻습니까', '허가·사용승인 서류가 있습니까', '부속시설과 무허가 부분이 있습니까'],
    preconditions: [{ code: 'BUILDING_EXISTENCE_CONFIRMED', label: '건축물 존재 확인(지목만으로는 불가)' }],
    issue: '건축물·부대시설의 편입범위와 허가·무허가 구분이 쟁점이 될 수 있습니다.',
  }),
  COMMERCIAL_INDUSTRIAL: Object.freeze({
    rank: 4, kind: 'FACILITY', label: '상업·공업 이용지',
    verification: ['영업 계속 여부와 영업주체 수 확인', '휴업·폐업 구분 판단자료 소재 확인'],
    questions: ['현재 영업 중입니까 중단 상태입니까', '같은 자리에 영업주체가 몇 곳입니까', '사업자등록·임대차 관계는 어떻게 정리되어 있습니까'],
    preconditions: [{ code: 'USE_STATED', label: '지목·이용상황 또는 영업 기재 존재' }],
    issue: '영업보상 대상 여부와 휴업·폐업 구분이 쟁점이 될 수 있습니다.',
  }),
  CLUSTER: Object.freeze({
    rank: 5, kind: 'AREA', label: '마을·상가 밀집부',
    verification: ['주민·상인 집단 대응체계 존재 여부 확인', '정보가 모이는 장소(회관·상인회 등) 확인'],
    questions: ['이 구역 주민·상인이 모이는 장소는 어디입니까', '대책위나 주민모임이 있습니까', '보상 관련 설명회가 열린 적이 있습니까'],
    preconditions: [{ code: 'MULTIPLE_RECORDS_OR_SOURCE', label: '복수 레코드 또는 출처 있는 공간구조 기재' }],
    issue: '이해관계인이 밀집한 구역은 집단 대응체계 형성 여부와 정보 경로를 확인할 필요가 있습니다.',
  }),
  ROAD_ACCESS_CHANGE: Object.freeze({
    rank: 6, kind: 'CASE', label: '도로접면 변화',
    verification: ['현재 진출입 경로와 도로 접면 현황 확인', '사업 후 접면 변화 가능 구간 확인'],
    questions: ['현재 진출입 경로는 어디입니까', '사업 후 접면이 달라질 가능성이 있습니까'],
    preconditions: [{ code: 'ROAD_CONDITION_STATED', label: '도로조건 기재 존재' }],
    issue: '도로접면·진출입 변화가 개별요인에 반영되었는지 검토할 필요가 있습니다.',
  }),
  MULTI_PARCEL_SAME_OWNER: Object.freeze({
    rank: 7, kind: 'CASE', label: '동일소유자 다필지',
    verification: ['현장에서 일단지 이용 여부 확인', '필지별 이용상황 차이 확인'],
    questions: ['여러 필지를 하나로 이용하고 있습니까', '필지별 이용상황이 다릅니까'],
    preconditions: [{ code: 'OWNER_GROUP_STATED', label: '동일소유자 그룹 자료 존재' }],
    issue: '동일 소유 다필지의 일단지·개별 평가 여부와 잔여지 판단을 검토할 필요가 있습니다.',
  }),
  BOUNDARY_CUT: Object.freeze({
    rank: 8, kind: 'CASE', label: '경계절단',
    verification: ['절단 후 잔여 형상·접면 확인', '잔여지 이용 가능성 확인'],
    questions: ['경계가 필지를 가로지릅니까', '절단 후 남는 구간을 계속 이용할 수 있습니까'],
    preconditions: [{ code: 'PARTIAL_ACQUISITION_CONFIRMED', label: '일부편입·경계절단 자료 확인' }],
    issue: '경계절단에 따른 잔여지 형상·면적 변화와 잔여지 손실보상 검토가 필요합니다.',
  }),
  // v0.2 신규. 초기 단계에서 방문할 지역·거점을 만든다.
  ADMIN_HUB: Object.freeze({
    rank: 9, kind: 'AREA', label: '행정·주민조직 거점',
    verification: ['주민 안내 게시물과 문의 창구 확인', '마을회관·경로당 등 정보 집결지점 위치 확인'],
    questions: ['이 사업 관련 주민 문의는 어디로 접수됩니까', '주민설명회 개최 이력과 예정이 있습니까', '편입 예상 구역의 마을회관·경로당은 어디입니까'],
    preconditions: [{ code: 'CONTACT_SOURCE_STATED', label: '거점 출처 기재' }],
    issue: null,
  }),
  ACCESS_CORRIDOR: Object.freeze({
    rank: 10, kind: 'AREA', label: '생활권 진입·간선 동선',
    verification: ['주 진출입 경로와 통행 상태 확인', '편입 예상 구역과의 접면 확인'],
    questions: ['이 구간이 사업지 주 진출입로입니까', '통행량·도로폭에 대한 지역 민원이 있습니까'],
    preconditions: [{ code: 'SURROUNDING_SOURCE_STATED', label: '출처 있는 공간구조 기재' }],
    issue: null,
  }),
  FACILITY_ZONE: Object.freeze({
    rank: 11, kind: 'FACILITY', label: '시설 밀집 구간 후보',
    verification: ['시설 유형·규모·영업 상태 확인', '편입 여부와 경계 관계 확인'],
    questions: ['이 시설군의 유형과 규모는 어떻습니까', '사업지 편입 대상에 들어갑니까', '운영 주체가 하나입니까 여러 곳입니까'],
    preconditions: [{ code: 'FACILITY_SOURCE_STATED', label: '출처 있는 시설 기재' }],
    issue: null,
  }),
});

const CONTACT_TYPES = Object.freeze({
  VILLAGE_HALL: '마을회관·경로당',
  COMMITTEE: '대책위·주민협의체 장소',
  MERCHANT: '상인회·시장 사무실',
  REALTOR: '중개업소',
  PUBLIC_OFFICE: '읍·면·동 주민센터·지자체 창구',
  PROJECT_OFFICE: '시행자 현장사무소',
  OTHER: '기타 확인된 거점',
});

// 거점 유형별 현장 질문. Mission 의 확인질문으로 재사용한다(P1-2).
const CONTACT_QUESTIONS = Object.freeze({
  VILLAGE_HALL: ['주민이 모이는 시간과 요일은 언제입니까', '보상 관련 안내문이 게시된 적이 있습니까'],
  COMMITTEE: ['현재 요구사항과 진행 경과는 무엇입니까', '시행자와의 협의 창구와 다음 일정은 어떻게 됩니까', '영업·시설 소유자들의 별도 조직이 있습니까'],
  MERCHANT: ['상인 구성과 영업 형태는 어떻습니까', '영업보상 관련 문의가 들어오고 있습니까'],
  REALTOR: ['발표 이후 거래와 문의가 어떻게 변했습니까', '토지주 모임이나 대책위 움직임이 있습니까'],
  PUBLIC_OFFICE: ['이 사업 관련 주민 문의는 어디로 접수됩니까', '주민설명회 개최 이력과 예정이 있습니까', '행위제한·공람 안내가 게시되었습니까'],
  PROJECT_OFFICE: ['해당 구역 협의 일정과 감정평가 진행 단계는 어떻습니까', '간접보상 신청 기준과 절차는 어떻게 안내됩니까'],
  OTHER: ['이 거점에서 확인 가능한 지역 정보는 무엇입니까'],
});

const STAGE_EXIT = Object.freeze({
  PRE_DESIGNATION: '정보경로 1개 + 핵심지역 1개 + 후속접촉 명분 1개',
  PRE_COMPENSATION: '거점 접촉 1건 + 시설·편입 후보 1곳 확인 + 후속접촉 명분 1개',
  COMPENSATION: DEFAULT_EXIT_CRITERIA,
  UNKNOWN: DEFAULT_EXIT_CRITERIA,
});
const STAGE_GOAL = Object.freeze({
  PRE_DESIGNATION: '지역 조직·핵심정보 경로 확보',
  PRE_COMPENSATION: '시설·편입 후보 확인과 정보경로 확보',
  COMPENSATION: '핵심 이해관계인 접촉과 쟁점 확인',
  UNKNOWN: '사업단계 확인과 정보경로 확보',
});
const MAX_CARD_QUESTIONS = 4;
const MAX_CARD_CHECKS = 3;

const CONTACT_EXIT = '연락경로 1개 이상 확보 + 다음 접촉 시점·장소 합의';
const TARGET_EXIT = '타깃 전제 확인 결과 기록 + 현장 사진 1장 이상';
const ACQUISITION_EXIT = '열람 장소·기간 확인 또는 사본 확보 경로 확정';

const SURROUNDING_TYPES = Object.freeze({
  ROAD: '도로', VILLAGE: '마을', COMMERCIAL: '상권', FACILITY: '공장·시설',
  RIVER: '하천', RAIL: '철도', OTHER: '그 밖의 공간구조',
});

const SURROUNDING_TYPE_HINTS = Object.freeze([
  [/도로|대로|국도|지방도|고속/, 'ROAD'],
  [/마을|취락|주거|아파트|단지|생활권/, 'VILLAGE'],
  [/상권|상가|시장|점포|상업/, 'COMMERCIAL'],
  [/공장|산업|물류|창고|농장|농업|온실|비닐하우스|축사|시설/, 'FACILITY'],
  [/하천|천|강|저수지/, 'RIVER'],
  [/철도|전철|역사|역세권/, 'RAIL'],
]);

// 타깃이 없을 때 지어내지 않고 확보 행동으로 전환한다(P1-1).
const ACQUISITION_ACTIONS = Object.freeze({
  BOUNDARY: Object.freeze({
    code: 'BOUNDARY', label: '사업경계 도면 확보',
    place: '관할 시·군 도시개발 부서 또는 시행자 공람 창구',
    how: '공람도면·고시 지형도면 열람 장소와 기간을 확인하고 경계 좌표를 확보한다.',
    questions: ['공람도면·지형도면을 어디서 열람할 수 있습니까', '경계 도면 사본이나 좌표 제공이 가능합니까'],
  }),
  PARCEL_LIST: Object.freeze({
    code: 'PARCEL_LIST', label: '편입 후보 필지자료 확보',
    place: '관할 시·군 공람 창구 또는 시행자 보상 창구',
    how: '공람 토지조서·지적도에서 편입 후보 필지 목록을 확보한다.',
    questions: ['편입 토지조서를 열람할 수 있습니까', '지번 단위 편입 여부를 어디서 확인합니까'],
  }),
  FIELD_SCREEN: Object.freeze({
    code: 'FIELD_SCREEN', label: '현장선별 후보 생성',
    place: 'BSO 현장선별 엔진(공공데이터 키 연결 후 실행)',
    how: '시군구·행정동 코드 또는 경계로 P1·P4·P5 후보를 생성한 뒤 키트를 다시 만든다.',
    questions: [],
  }),
  LOCAL_HUB: Object.freeze({
    code: 'LOCAL_HUB', label: '지역 거점 조사',
    place: '관할 읍·면·동 행정복지센터',
    how: '마을회관·경로당·대책위·상인회 등 정보 집결지점을 확인해 거점으로 등록한다.',
    questions: ['편입 예상 구역의 마을회관·경로당은 어디입니까', '주민 대책위나 모임이 있습니까'],
  }),
});

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value == null ? '' : String(value).trim(); }
function number(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
function uniq(values) { return [...new Set(arr(values).map(text).filter(Boolean))]; }
function id(prefix, index) { return `${prefix}_${String(index + 1).padStart(3, '0')}`; }
function normalizedAddress(value) { return text(value).replace(/\s+/g, ' '); }

// 성명·연락처는 현장 전에 수집하지 않는다. 입력에 섞여 들어온 값은 지운 뒤 지운 사실을 남긴다.
function redact(value) {
  const source = text(value);
  if (!source) return { value: '', redacted: [] };
  const redacted = [];
  let output = source;
  if (PHONE_RE.test(output)) { redacted.push('PHONE'); output = output.replace(PHONE_RE, '[연락처 미기재]'); }
  PHONE_RE.lastIndex = 0;
  if (EMAIL_RE.test(output)) { redacted.push('EMAIL'); output = output.replace(EMAIL_RE, '[이메일 미기재]'); }
  EMAIL_RE.lastIndex = 0;
  return { value: output.replace(/\s+/g, ' ').trim(), redacted };
}

function personKeysIn(row) {
  if (!row || typeof row !== 'object') return [];
  return Object.keys(row).filter((key) => PERSON_KEYS.includes(String(key).toLowerCase()) && text(row[key]));
}

function normalizedSource(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const label = text(value);
    return label ? { source_type: 'UNSPECIFIED', label, url: '', published_at: '' } : null;
  }
  if (typeof value !== 'object') return null;
  const label = text(value.label || value.title || value.name || value.source_label);
  if (!label) return null;
  return {
    source_type: text(value.source_type || value.type) || 'UNSPECIFIED',
    label,
    url: text(value.url || value.detail_url),
    published_at: text(value.published_at || value.date || value.notice_date),
  };
}

function sourceText(source) {
  if (!source) return '';
  return [source.label, source.published_at].filter(Boolean).join(' · ');
}

function signalFacts(signal) {
  if (!signal || typeof signal !== 'object') return null;
  const title = text(signal['공고명'] || signal.title);
  const institution = text(signal['발주기관'] || signal.institution);
  const region = text(signal['지역'] || signal.region);
  const noticeDate = text(signal['일자'] || signal.notice_date);
  const stage = text(signal['단계'] || signal.stage);
  if (!title && !institution) return null;
  return {
    title, institution, region, notice_date: noticeDate, stage,
    detail_url: text(signal['상세URL'] || signal.detail_url),
    monitoring_state: text(signal['상태']) || '확인 필요',
  };
}

const SNAPSHOT_FIELDS = Object.freeze([
  ['project_name', '사업명', 'name', '지구지정·사업계획 고시문 또는 공람자료에서 사업명을 확인합니다.'],
  ['developer', '시행자', 'developer', '고시문의 사업시행자 표기를 확인합니다(발주기관과 시행자는 다를 수 있습니다).'],
  ['stage', '사업단계', 'stage', '발표·지구지정·실시계획승인·사업인정고시·보상계획공고 중 현재 단계를 확인합니다.'],
  ['area', '면적', 'area', '고시 면적과 편입 면적을 구분해 확인합니다.'],
  ['budget', '사업비', 'budget', '총사업비와 보상비를 구분해 확인합니다(보도 수치는 확정치가 아닙니다).'],
  ['schedule', '주요 일정', 'schedule', '고시일·공람기간·실시계획 예정일을 확인합니다.'],
  ['compensation_timing', '보상 예상시점', 'compensation_timing', '보상계획 공고·협의 개시 시점은 고시문과 시행자 공지로 확인합니다. 사업단계만으로 시점을 추정하지 않습니다.'],
]);

function buildSnapshot(project, signal) {
  const source = normalizedSource(project?.source);
  const facts = signalFacts(signal);
  const signalValue = {
    project_name: facts?.title ? { value: facts.title, note: '나라장터 공고명 기준 후보입니다. 사업명 확인이 필요합니다.' } : null,
    developer: facts?.institution ? { value: facts.institution, note: '발주기관 기준 후보입니다. 사업시행자 확인이 필요합니다.' } : null,
    stage: facts?.stage ? { value: facts.stage, note: '나라장터 신호 단계이며 공익사업 절차 단계와 다릅니다.' } : null,
  };

  const rows = SNAPSHOT_FIELDS.map(([key, label, field, nextCheck]) => {
    const manual = text(project?.[field]);
    if (manual) {
      return {
        key, label, value: manual,
        status: source ? 'SOURCE_STATED' : 'INPUT_WITHOUT_SOURCE',
        provenance: source ? sourceText(source) : '출처 미기재 입력',
        next_check: source ? '' : nextCheck,
      };
    }
    const fromSignal = signalValue[key];
    if (fromSignal) {
      return {
        key, label, value: fromSignal.value,
        status: 'EARLY_SIGNAL_PENDING_REVIEW',
        provenance: `나라장터 EARLY_SIGNAL(${facts.monitoring_state})`,
        next_check: `${fromSignal.note} ${nextCheck}`.trim(),
      };
    }
    return { key, label, value: UNVERIFIED, status: 'UNVERIFIED', provenance: '', next_check: nextCheck };
  });

  return {
    rows,
    region: facts?.region || text(project?.region) || '',
    source: source || null,
    signal: facts,
    status_candidates: [],
    unverified_count: rows.filter((row) => row.status === 'UNVERIFIED').length,
    unsourced_count: rows.filter((row) => row.status !== 'SOURCE_STATED').length,
  };
}

// P1-1. 사업단계에서 타깃 프로필을 정한다. 단계를 못 읽으면 지어내지 않고 UNKNOWN 으로 둔다.
function stageProfile(snapshot) {
  const row = snapshot.rows.find((item) => item.key === 'stage');
  const stageText = row && row.value !== UNVERIFIED ? row.value : '';
  if (!stageText) return { ...STAGE_PROFILES.UNKNOWN, source_value: '' };
  const matched = STAGE_PATTERNS.find(([pattern]) => pattern.test(stageText));
  const profile = matched ? STAGE_PROFILES[matched[1]] : STAGE_PROFILES.UNKNOWN;
  return { ...profile, source_value: stageText };
}

function blockKey(address) {
  const normalized = normalizedAddress(address);
  if (!normalized) return '';
  const match = normalized.match(/^(.*?(?:동|리|읍|면)\s+산?\d{1,5})(?:-\d{1,5})?/);
  return match ? match[1] : normalized;
}

function targetKey(location) { return normalizedAddress(location) || '위치 확인 필요'; }

function addMatch(store, location, type, basis, options = {}) {
  if (!TARGET_RULES[type]) return;
  const key = targetKey(location);
  const entry = store.get(key) || {
    location: key, matches: [], basis: [], verification: [], priority: '', in_boundary: null,
    evidence_levels: new Set(), notes: [], satisfied: new Map(), contact_id: '',
  };
  entry.matches.push(type);
  if (basis) entry.basis.push(basis);
  arr(TARGET_RULES[type].verification).forEach((item) => entry.verification.push(item));
  arr(options.verification).forEach((item) => entry.verification.push(item));
  if (options.priority && !entry.priority) entry.priority = text(options.priority);
  if (options.in_boundary !== undefined && options.in_boundary !== null && entry.in_boundary === null) entry.in_boundary = options.in_boundary;
  entry.evidence_levels.add(options.evidence_level || 'BSO_ESTIMATE');
  if (options.note) entry.notes.push(text(options.note));
  if (options.contact_id && !entry.contact_id) entry.contact_id = options.contact_id;
  const satisfied = entry.satisfied.get(type) || new Set();
  arr(options.satisfied).forEach((code) => satisfied.add(code));
  entry.satisfied.set(type, satisfied);
  store.set(key, entry);
}

function collectParcelMatches(store, parcels) {
  const ownerGroups = new Map();
  arr(parcels).forEach((parcel) => {
    const location = normalizedAddress(parcel?.parcel_address || parcel?.jibun_address || parcel?.address);
    if (!location) return;
    const evidence = normalizedSource(parcel?.source) ? 'DATA_SOURCED' : 'BSO_ESTIMATE';
    const area = number(parcel?.area ?? parcel?.area_m2);
    const category = text(parcel?.land_category);
    const use = text(parcel?.appraisal_use_status || parcel?.use_status || parcel?.actual_use);
    const road = text(parcel?.road_condition || parcel?.road_side || parcel?.road);
    const useAndCategory = `${category} ${use}`.trim();
    const ratio = number(parcel?.acquisition_ratio);
    const partial = parcel?.boundary_cut === true || parcel?.partial_acquisition === true || (ratio !== null && ratio > 0 && ratio < 1);
    const remainder = partial || parcel?.remainder_exists === true;

    if (area !== null && area >= LARGE_AREA_M2) {
      const satisfied = [];
      if (partial) satisfied.push('PARTIAL_ACQUISITION_CONFIRMED');
      if (remainder) satisfied.push('REMAINDER_EXISTS');
      addMatch(store, location, 'LARGE_AREA', `편입 후보 면적 ${area.toLocaleString('ko-KR')}㎡ ≥ 검토임계 ${LARGE_AREA_M2.toLocaleString('ko-KR')}㎡`, { evidence_level: evidence, satisfied });
    }
    if (parcel?.building_included === true || BUILDING_RE.test(use) || category === '대') {
      const stated = parcel?.building_included === true || BUILDING_RE.test(use);
      const basis = parcel?.building_included === true ? '자료상 건축물 편입 표기' : BUILDING_RE.test(use) ? `이용상황 기재 '${use}'` : `지목 '${category}'(건축물 존재는 미확인)`;
      addMatch(store, location, 'BUILDING_INCLUDED', basis, { evidence_level: evidence, satisfied: stated ? ['BUILDING_EXISTENCE_CONFIRMED'] : [] });
    }
    if (COMMERCIAL_INDUSTRIAL_RE.test(useAndCategory)) {
      addMatch(store, location, 'COMMERCIAL_INDUSTRIAL', `지목·이용상황 기재 '${useAndCategory}'`, { evidence_level: evidence, satisfied: ['USE_STATED'] });
    }
    if (SPECIAL_USE_RE.test(useAndCategory)) {
      addMatch(store, location, 'SPECIAL_USE', `지목·이용상황 기재 '${useAndCategory}'`, { evidence_level: evidence, satisfied: ['FACILITY_RECORD_STATED'] });
    }
    if (road && ROAD_WEAK_RE.test(road)) {
      addMatch(store, location, 'ROAD_ACCESS_CHANGE', `도로조건 기재 '${road}'`, { evidence_level: evidence, satisfied: ['ROAD_CONDITION_STATED'] });
    }
    if (partial) {
      const basis = ratio !== null && ratio > 0 && ratio < 1 ? `자료상 부분편입 비율 ${ratio}` : '자료상 부분편입·경계절단 표기';
      addMatch(store, location, 'BOUNDARY_CUT', basis, { evidence_level: evidence, satisfied: ['PARTIAL_ACQUISITION_CONFIRMED'] });
    }
    const ownerKey = text(parcel?.owner_group_key || parcel?.owner_group);
    if (ownerKey) {
      const group = ownerGroups.get(ownerKey) || [];
      group.push({ location, evidence });
      ownerGroups.set(ownerKey, group);
    }
  });

  let groupIndex = 0;
  [...ownerGroups.values()].forEach((group) => {
    if (group.length < 2) return;
    groupIndex += 1;
    group.forEach(({ location, evidence }) => {
      addMatch(store, location, 'MULTI_PARCEL_SAME_OWNER', `동일소유자 그룹 ${groupIndex}(${group.length}필지) 표기`, {
        evidence_level: evidence, satisfied: ['OWNER_GROUP_STATED'],
        note: '소유자 식별정보는 키트에 기재하지 않습니다.',
      });
    });
  });
  return { owner_group_count: groupIndex };
}

function collectFieldCandidateMatches(store, candidates) {
  const blocks = new Map();
  arr(candidates).forEach((row) => {
    const location = normalizedAddress(row?.jibun_address || row?.road_address || row?.parcel_address);
    if (!location) return;
    const priority = text(row?.priority);
    const type = text(row?.candidate_type);
    const category = text(row?.business_category);
    const count = number(row?.business_count);
    const dataset = text(row?.source_dataset);
    const evidence = dataset ? 'DATA_SOURCED' : 'BSO_ESTIMATE';
    const basisTail = dataset ? ` · 출처 ${dataset}` : '';
    const nextCheck = text(row?.next_check);
    const options = { priority, evidence_level: evidence, in_boundary: row?.in_boundary, verification: nextCheck ? [nextCheck] : [] };

    if (SPECIAL_USE_RE.test(`${type} ${category}`)) {
      addMatch(store, location, 'SPECIAL_USE', `현장선별 ${priority || 'REVIEW'} 후보 '${type}'${basisTail}`, { ...options, satisfied: ['FACILITY_RECORD_STATED'] });
    } else if (COMMERCIAL_INDUSTRIAL_RE.test(`${type} ${category}`) || type) {
      addMatch(store, location, 'COMMERCIAL_INDUSTRIAL', `현장선별 ${priority || 'REVIEW'} 후보 '${type || '영업시설'}'${basisTail}`, { ...options, satisfied: ['USE_STATED'] });
    }
    if (count !== null && count >= CLUSTER_MIN_COUNT) {
      addMatch(store, location, 'CLUSTER', `동일 위치 영업레코드 ${count}건${basisTail}`, { ...options, satisfied: ['MULTIPLE_RECORDS_OR_SOURCE'] });
    }
    const block = blockKey(location);
    if (!block) return;
    const rows = blocks.get(block) || [];
    rows.push({ location, evidence });
    blocks.set(block, rows);
  });

  blocks.forEach((rows, block) => {
    if (rows.length < CLUSTER_MIN_COUNT) return;
    addMatch(store, `${block} 일원`, 'CLUSTER', `동일 가구·블록 영업시설 후보 ${rows.length}곳`, {
      evidence_level: rows.some((row) => row.evidence === 'DATA_SOURCED') ? 'DATA_SOURCED' : 'BSO_ESTIMATE',
      satisfied: ['MULTIPLE_RECORDS_OR_SOURCE'],
    });
  });
}

function normalizedSurroundings(rows) {
  return arr(rows).map((row, index) => {
    const declared = text(row?.type).toUpperCase();
    const hint = SURROUNDING_TYPE_HINTS.find(([pattern]) => pattern.test(`${text(row?.type)} ${text(row?.label)}`));
    const resolved = SURROUNDING_TYPES[declared] ? declared : (hint ? hint[1] : 'OTHER');
    const source = normalizedSource(row?.source);
    return {
      surrounding_id: id('PFS', index),
      type: resolved,
      type_label: SURROUNDING_TYPES[resolved],
      label: redact(row?.label || row?.name).value,
      relation: redact(row?.relation || row?.note).value,
      provenance: source ? sourceText(source) : '출처 미기재 · 지도 판독 확인 필요',
      status: source ? 'SOURCE_STATED' : 'REVIEW_REQUIRED',
    };
  }).filter((row) => row.label);
}

// P1-1. 주변 공간구조에서 지역·시설 타깃을 만든다. 출처가 없으면 근거등급을 낮춘다.
function collectSurroundingMatches(store, surroundings) {
  surroundings.forEach((row) => {
    const sourced = row.status === 'SOURCE_STATED';
    const evidence = sourced ? 'DATA_SOURCED' : 'BSO_ESTIMATE';
    const basis = `주변 공간구조 '${row.type_label}' 기재${sourced ? ` · ${row.provenance}` : ' · 출처 미기재'}`;
    const relation = row.relation ? [`기재된 관계 확인: ${row.relation}`] : [];
    if (row.type === 'VILLAGE' || row.type === 'COMMERCIAL') {
      addMatch(store, row.label, 'CLUSTER', basis, { evidence_level: evidence, verification: relation, satisfied: sourced ? ['MULTIPLE_RECORDS_OR_SOURCE'] : [] });
      return;
    }
    if (row.type === 'ROAD' || row.type === 'RAIL') {
      addMatch(store, row.label, 'ACCESS_CORRIDOR', basis, { evidence_level: evidence, verification: relation, satisfied: sourced ? ['SURROUNDING_SOURCE_STATED'] : [] });
      return;
    }
    if (row.type === 'FACILITY') {
      addMatch(store, row.label, 'FACILITY_ZONE', basis, { evidence_level: evidence, verification: relation, satisfied: sourced ? ['FACILITY_SOURCE_STATED'] : [] });
    }
  });
}

// P1-1. 확인된 접촉거점은 초기 단계의 방문 타깃이기도 하다.
// 지구지정 후·보상 단계에서는 타깃이 시설·사건 필지이므로 거점을 타깃으로 중복 기재하지 않는다.
const CONTACT_TARGET_STAGES = Object.freeze(['PRE_DESIGNATION', 'UNKNOWN']);
function collectContactMatches(store, points, profile) {
  if (!CONTACT_TARGET_STAGES.includes(profile.code)) return;
  arr(points).forEach((point) => {
    const sourced = point.status === 'SOURCE_STATED';
    addMatch(store, point.address || point.label, 'ADMIN_HUB', `접촉거점 '${point.type_label} · ${point.label}'${sourced ? ` · ${point.provenance}` : ' · 출처 미기재'}`, {
      evidence_level: sourced ? 'DATA_SOURCED' : 'BSO_ESTIMATE',
      satisfied: sourced ? ['CONTACT_SOURCE_STATED'] : [],
      contact_id: point.contact_id,
      verification: point.address ? [] : ['거점 위치 확인'],
    });
  });
}

function finalizeTargets(store, profile) {
  const priority = arr(profile?.priority).length ? profile.priority : ['AREA', 'FACILITY', 'CASE'];
  const targets = [...store.values()].map((entry) => {
    const matches = uniq(entry.matches).sort((left, right) => TARGET_RULES[left].rank - TARGET_RULES[right].rank);
    const kinds = uniq(matches.map((type) => TARGET_RULES[type].kind));
    const kind = kinds.slice().sort((left, right) => priority.indexOf(left) - priority.indexOf(right))[0] || 'AREA';
    const preconditions = matches.flatMap((type) => {
      const satisfied = entry.satisfied.get(type) || new Set();
      return TARGET_RULES[type].preconditions.map((item) => ({
        rule: type, rule_label: TARGET_RULES[type].label, code: item.code, label: item.label,
        status: satisfied.has(item.code) ? 'SATISFIED' : 'UNCONFIRMED',
      }));
    });
    const questions = uniq(matches.flatMap((type) => TARGET_RULES[type].questions));
    return {
      location: entry.location,
      kind, kind_label: TARGET_KINDS[kind],
      profile_rank: priority.indexOf(kind) < 0 ? priority.length : priority.indexOf(kind),
      target_types: matches,
      target_type_labels: matches.map((type) => TARGET_RULES[type].label),
      rank: matches.length ? TARGET_RULES[matches[0]].rank : 99,
      priority: entry.priority || 'REVIEW',
      in_boundary: entry.in_boundary,
      evidence_level: entry.evidence_levels.has('DATA_SOURCED') ? 'DATA_SOURCED' : 'BSO_ESTIMATE',
      // 근거등급은 입력자료의 출처 등급일 뿐이다. 타깃 판정은 규칙 일치 결과이므로 확정이 아니다.
      judgment_status: 'FIELD_VERIFICATION_REQUIRED',
      basis: uniq(entry.basis),
      field_verification: uniq(entry.verification),
      questions,
      preconditions,
      contact_id: entry.contact_id || '',
      notes: uniq(entry.notes),
      review_required: true,
      auto_confirmed: false,
    };
  });
  targets.sort((left, right) => left.profile_rank - right.profile_rank || left.rank - right.rank || left.location.localeCompare(right.location, 'ko'));
  return targets.map((target, index) => ({ ...target, target_id: id('PFT', index), visit_order: index + 1 }));
}

function buildTargetMap(input, profile, contactPoints) {
  const store = new Map();
  const surroundings = normalizedSurroundings(input?.spatial?.surroundings);
  const ownerInfo = collectParcelMatches(store, input?.parcels);
  collectFieldCandidateMatches(store, input?.fieldCandidates);
  collectSurroundingMatches(store, surroundings);
  collectContactMatches(store, contactPoints.points, profile);
  const targets = finalizeTargets(store, profile);

  const ring = arr(input?.spatial?.boundaryRing);
  const boundarySource = normalizedSource(input?.spatial?.boundarySource);
  const boundary = {
    status: ring.length >= 3 ? 'RING_LOADED' : 'NOT_LOADED',
    point_count: ring.length >= 3 ? ring.length : 0,
    provenance: boundarySource ? sourceText(boundarySource) : '출처 미기재',
    note: ring.length >= 3
      ? '경계 좌표는 방문 범위 설정용입니다. 필지별 편입 여부는 확정되지 않았습니다.'
      : '사업경계 자료가 없습니다. 공람도면·고시 도면으로 경계를 확인해야 합니다.',
  };

  // P1-1. 자료가 없으면 타깃을 지어내지 않고 확보 행동으로 남긴다.
  const acquisition = [];
  if (boundary.status !== 'RING_LOADED') acquisition.push(ACQUISITION_ACTIONS.BOUNDARY);
  if (!arr(input?.parcels).length) acquisition.push(ACQUISITION_ACTIONS.PARCEL_LIST);
  if (!arr(input?.fieldCandidates).length) acquisition.push(ACQUISITION_ACTIONS.FIELD_SCREEN);
  if (!contactPoints.points.length) acquisition.push(ACQUISITION_ACTIONS.LOCAL_HUB);

  const unknowns = [];
  if (boundary.status !== 'RING_LOADED') unknowns.push('사업경계 도면 미확보 — 공람도면·고시 도면 확인 필요');
  if (!arr(input?.parcels).length) unknowns.push('편입 후보 필지자료 미확보 — 공람 토지조서·지적도 확인 필요');
  if (!arr(input?.fieldCandidates).length) unknowns.push('현장선별 후보 미생성 — 현장선별 엔진(P1·P4·P5) 실행 후 재작성 권장');
  if (!surroundings.length) unknowns.push('주변 도로·마을·상권·공장 등 공간구조 기재 없음 — 지도 판독 필요');
  if (!ownerInfo.owner_group_count && arr(input?.parcels).length) unknowns.push('동일소유자 다필지 판단자료 없음 — 소유자 그룹키 없이는 판정하지 않습니다');
  if (!targets.some((target) => target.target_types.includes('BOUNDARY_CUT'))) unknowns.push('경계절단 여부는 필지 도형자료 없이 판정하지 않습니다 — 지도 판독·현장 확인 필요');

  return {
    boundary,
    surroundings,
    targets: targets.slice(0, MAX_TARGETS_ON_PAGE),
    all_targets: targets,
    total_count: targets.length,
    overflow_count: Math.max(0, targets.length - MAX_TARGETS_ON_PAGE),
    kind_counts: Object.keys(TARGET_KINDS).reduce((out, kind) => ({ ...out, [kind]: targets.filter((target) => target.kind === kind).length }), {}),
    acquisition_actions: acquisition,
    profile_note: profile.note,
    unknowns,
  };
}

function contactType(row) {
  const declared = text(row?.type).toUpperCase();
  if (CONTACT_TYPES[declared]) return declared;
  const hint = `${text(row?.type)} ${text(row?.label)} ${text(row?.note)}`;
  const matched = [
    [/마을회관|경로당|회관/, 'VILLAGE_HALL'],
    [/대책위|비상대책|주민협의|협의체/, 'COMMITTEE'],
    [/상인회|시장|번영회/, 'MERCHANT'],
    [/중개|부동산/, 'REALTOR'],
    [/주민센터|행정복지센터|시청|군청|구청|읍사무소|면사무소/, 'PUBLIC_OFFICE'],
    [/현장사무소|보상사무소|사업단|사업본부/, 'PROJECT_OFFICE'],
  ].find(([pattern]) => pattern.test(hint));
  return matched ? matched[1] : 'OTHER';
}

function buildContactPoints(rows) {
  const points = [];
  const redactions = [];
  const rejected = [];
  arr(rows).forEach((row, index) => {
    const declared = text(row?.type).toUpperCase();
    const personKeys = personKeysIn(row);
    if (declared === 'PERSON' || declared === '인물') {
      rejected.push({ input_index: index, reason: 'PERSON_INFO_NOT_PRECOLLECTED', note: '접촉거점은 장소·단체만 기재합니다. 인물정보는 현장에서 확인합니다.' });
      return;
    }
    const label = redact(row?.label || row?.name_label || row?.place);
    if (!label.value) {
      rejected.push({ input_index: index, reason: 'CONTACT_LABEL_MISSING', note: '거점명이 없어 채택하지 않았습니다.' });
      return;
    }
    const address = redact(row?.address || row?.jibun_address);
    const note = redact(row?.note);
    const source = normalizedSource(row?.source);
    const type = contactType(row);
    [...label.redacted, ...address.redacted, ...note.redacted].forEach((kind) => redactions.push({ input_index: index, field_kind: kind }));
    if (personKeys.length) redactions.push({ input_index: index, field_kind: 'PERSON_FIELD_DROPPED', dropped_keys: personKeys });
    points.push({
      contact_id: id('PFC', points.length),
      type,
      type_label: CONTACT_TYPES[type],
      label: label.value,
      address: address.value,
      note: note.value,
      questions: arr(CONTACT_QUESTIONS[type]),
      provenance: source ? sourceText(source) : '출처 미기재',
      status: source ? 'SOURCE_STATED' : 'REVIEW_REQUIRED',
      person_info_included: false,
    });
  });

  const pendingChecks = [];
  if (!points.some((point) => point.type === 'VILLAGE_HALL')) pendingChecks.push('마을회관·경로당 위치 — 관할 읍·면·동 또는 현장 게시물로 확인');
  if (!points.some((point) => point.type === 'COMMITTEE')) pendingChecks.push('대책위·주민협의체 존재 여부와 모이는 장소 — 현장 게시물·주민 안내문으로 확인');
  if (!points.some((point) => point.type === 'MERCHANT' || point.type === 'REALTOR')) pendingChecks.push('상인회·중개업소 등 지역 정보 거점 — 현장에서 확인');
  return {
    points: points.slice(0, MAX_CONTACT_POINTS),
    overflow_count: Math.max(0, points.length - MAX_CONTACT_POINTS),
    pending_checks: pendingChecks,
    redactions,
    rejected,
  };
}

// P1-4. 사업현황 서술은 확인쟁점으로 올리지 않고 Snapshot 후보로 돌린다.
function classifyStatement(statement) {
  if (ISSUE_SIGNAL_RE.test(statement)) return 'ISSUE';
  if (PROJECT_STATUS_RE.test(statement)) return 'PROJECT_STATUS';
  return 'NO_SIGNAL';
}

function buildIssues(input, targetMap, snapshot) {
  const confirmed = [];
  const estimated = [];
  const fieldChecks = [];
  const rejected = [];

  arr(input?.confirmedIssues).forEach((row, index) => {
    const statement = redact(typeof row === 'string' ? row : (row?.statement || row?.title));
    const source = normalizedSource(typeof row === 'string' ? null : row?.source);
    if (!statement.value) {
      rejected.push({ input_index: index, kind: 'CONFIRMED', reason: 'STATEMENT_MISSING' });
      return;
    }
    if (!source) {
      rejected.push({ input_index: index, kind: 'CONFIRMED', reason: 'SOURCE_MISSING_NOT_CONFIRMED_ISSUE', statement: statement.value, note: '출처가 없으면 확인쟁점으로 채택하지 않습니다.' });
      return;
    }
    const category = classifyStatement(statement.value);
    if (category !== 'ISSUE') {
      const reason = category === 'PROJECT_STATUS' ? 'PROJECT_STATUS_NOT_ISSUE' : 'ISSUE_SIGNAL_NOT_FOUND';
      rejected.push({
        input_index: index, kind: 'CONFIRMED', reason, statement: statement.value,
        note: '단순 사업현황은 Snapshot 항목으로 옮기고, 확인쟁점에는 대응이 필요한 이슈만 기재합니다.',
      });
      snapshot.status_candidates.push({ statement: statement.value, provenance: sourceText(source) });
      return;
    }
    confirmed.push({
      issue_id: id('PFI', confirmed.length),
      display_label: CONFIRMED_ISSUE_LABEL,
      statement: statement.value,
      source,
      provenance: sourceText(source),
      field_verification: uniq(typeof row === 'string' ? [] : (row?.field_verification || row?.checks)),
      questions: uniq([`'${statement.value}' 관련 현재 진행상황과 대응 경과는 어떻습니까`]),
      review_required: true,
      auto_confirmed: false,
    });
  });

  // P1-3. 사용자 추정쟁점도 전제조건을 요구한다.
  arr(input?.estimatedIssues).forEach((row, index) => {
    const statement = redact(typeof row === 'string' ? row : (row?.statement || row?.title));
    const basis = uniq(typeof row === 'string' ? [] : (row?.basis || row?.grounds));
    const verification = uniq(typeof row === 'string' ? [] : (row?.field_verification || row?.checks));
    const preconditions = uniq(typeof row === 'string' ? [] : row?.preconditions);
    if (!statement.value) { rejected.push({ input_index: index, kind: 'ESTIMATED', reason: 'STATEMENT_MISSING' }); return; }
    if (!basis.length || !verification.length) {
      rejected.push({ input_index: index, kind: 'ESTIMATED', reason: 'ESTIMATE_BASIS_OR_VERIFICATION_MISSING', statement: statement.value, note: '추정쟁점은 근거와 현장 확인사항을 함께 기재해야 합니다.' });
      return;
    }
    if (!preconditions.length) {
      fieldChecks.push({
        check_id: id('PFK', fieldChecks.length),
        display_label: FIELD_CHECK_LABEL,
        statement: statement.value,
        status: 'FIELD_CHECK_REQUIRED',
        origin: 'USER_INPUT',
        preconditions: [{ code: 'PRECONDITION_NOT_STATED', label: '전제조건 미기재', status: 'UNCONFIRMED' }],
        basis, field_verification: verification,
        note: '전제조건이 기재되지 않아 추정쟁점으로 승격하지 않았습니다.',
      });
      return;
    }
    estimated.push({
      issue_id: id('PFE', estimated.length),
      display_label: ESTIMATED_ISSUE_LABEL,
      statement: statement.value,
      basis, field_verification: verification,
      preconditions: preconditions.map((label) => ({ code: 'USER_STATED', label, status: 'SATISFIED' })),
      origin: 'USER_INPUT',
      review_required: true,
      auto_confirmed: false,
    });
  });

  // 규칙 기반 추정쟁점. 전제가 확인된 규칙만 승격하고, 나머지는 현장확인 항목으로 강등한다(P1-3).
  const byType = new Map();
  arr(targetMap?.all_targets).forEach((target) => {
    target.target_types.forEach((type) => {
      const entry = byType.get(type) || { locations: [], basis: [], preconditions: [] };
      entry.locations.push(target.location);
      target.basis.forEach((item) => entry.basis.push(item));
      target.preconditions.filter((item) => item.rule === type).forEach((item) => entry.preconditions.push(item));
      byType.set(type, entry);
    });
  });

  [...byType.entries()]
    .sort((left, right) => TARGET_RULES[left[0]].rank - TARGET_RULES[right[0]].rank)
    .forEach(([type, entry]) => {
      const rule = TARGET_RULES[type];
      if (!rule.issue) return;
      const locations = uniq(entry.locations);
      const basis = uniq([
        `타깃 규칙 '${rule.label}' 일치 ${entry.locations.length}건(${locations.slice(0, 3).join(', ')}${locations.length > 3 ? ' 외' : ''})`,
        ...entry.basis.slice(0, 2),
      ]);
      const preconditions = rule.preconditions.map((item) => ({
        code: item.code, label: item.label,
        status: entry.preconditions.some((row) => row.code === item.code && row.status === 'SATISFIED') ? 'SATISFIED' : 'UNCONFIRMED',
      }));
      const unmet = preconditions.filter((item) => item.status !== 'SATISFIED');
      if (unmet.length) {
        fieldChecks.push({
          check_id: id('PFK', fieldChecks.length),
          display_label: FIELD_CHECK_LABEL,
          statement: rule.issue,
          status: 'FIELD_CHECK_REQUIRED',
          origin: 'BSO_RULE',
          rule: type,
          locations,
          preconditions,
          basis,
          field_verification: uniq(rule.verification),
          questions: uniq(rule.questions),
          note: `전제 미확인: ${unmet.map((item) => item.label).join(' / ')}. 현장에서 확인한 뒤 쟁점으로 승격합니다.`,
        });
        return;
      }
      estimated.push({
        issue_id: id('PFE', estimated.length),
        display_label: ESTIMATED_ISSUE_LABEL,
        statement: rule.issue,
        basis,
        preconditions,
        field_verification: uniq(rule.verification),
        questions: uniq(rule.questions),
        origin: 'BSO_RULE',
        rule: type,
        locations,
        review_required: true,
        auto_confirmed: false,
      });
    });

  return {
    confirmed: confirmed.slice(0, MAX_ISSUES_EACH),
    confirmed_overflow: Math.max(0, confirmed.length - MAX_ISSUES_EACH),
    estimated: estimated.slice(0, MAX_ISSUES_EACH),
    estimated_overflow: Math.max(0, estimated.length - MAX_ISSUES_EACH),
    field_checks: fieldChecks.slice(0, MAX_ISSUES_EACH),
    field_checks_overflow: Math.max(0, fieldChecks.length - MAX_ISSUES_EACH),
    rejected,
    confirmed_note: confirmed.length ? '' : '출처 있는 확인쟁점이 없습니다. 고시·공람·보도자료에서 대응이 필요한 이슈를 확인해 입력하세요.',
  };
}

// P1-2. 방문장소·순서·목적·확인질문·현장확인사항·종료기준을 갖춘 Mission 을 만든다.
function buildFieldMission(input, targetMap, contactPoints, issues, profile) {
  const issueQuestions = arr(issues.confirmed).flatMap((issue) => issue.questions);
  const checkQuestions = arr(issues.field_checks).flatMap((row) => arr(row.questions));
  const drafts = [];

  // 찾아갈 수 있는 곳이 먼저다. 위치를 모르는 거점은 같은 유형이라도 뒤로 보낸다.
  const contactOrder = ['COMMITTEE', 'VILLAGE_HALL', 'PUBLIC_OFFICE', 'MERCHANT', 'REALTOR', 'PROJECT_OFFICE', 'OTHER'];
  const contactWeight = (point) => (point.address ? 0 : 100) + Math.max(0, contactOrder.indexOf(point.type));
  const sortedContacts = contactPoints.points.slice().sort((left, right) => contactWeight(left) - contactWeight(right));
  sortedContacts.slice(0, 2).forEach((point, index) => {
    drafts.push({
      weight: index === 0 ? 1 : 5,
      label: point.label,
      focus: '정보경로·주민 대응상황 확인',
      core_questions: arr(point.questions),
      action: `${point.type_label} 방문 — ${point.label}`,
      place: point.address || `${point.label}(위치 확인 필요)`,
      purpose: index === 0
        ? '지역 정보가 모이는 거점에서 사업 진행상황과 주민 대응상황을 확인하고 다음 접촉 경로를 만든다.'
        : '첫 거점에서 얻은 내용을 다른 경로로 교차 확인한다.',
      questions: uniq([...point.questions, ...issueQuestions]).slice(0, MAX_QUESTIONS_PER_MISSION),
      checks: uniq([
        ...(point.address ? [] : ['거점 위치 확인(방문 전 전화·현장 게시물로 확인)']),
        '현재 주민 대응체계 유무 확인', '다음 접촉 가능 시점·장소 확인', '동의 범위에서 연락경로 확보',
      ]),
      exit_criteria: CONTACT_EXIT,
      contact_id: point.contact_id,
    });
  });

  const missionTargets = targetMap.targets.filter((target) => !(target.contact_id && target.target_types.length === 1 && target.target_types[0] === 'ADMIN_HUB'));
  missionTargets.slice(0, 3).forEach((target, index) => {
    const unmet = target.preconditions.filter((item) => item.status !== 'SATISFIED');
    drafts.push({
      weight: index === 0 ? 2 : 6 + index,
      label: target.location,
      focus: `${target.target_type_labels[0]} 확인`,
      core_questions: uniq(target.questions),
      action: `${target.kind_label} 타깃 확인 — ${target.location} (${target.target_type_labels.join(' / ')})`,
      place: target.location,
      purpose: `${target.target_type_labels[0]} 가설을 현장에서 검증한다. 현 단계는 추정이며 확정이 아니다.`,
      questions: uniq(target.questions).slice(0, MAX_QUESTIONS_PER_MISSION),
      checks: uniq([
        ...target.field_verification,
        ...unmet.map((item) => `전제 확인: ${item.label}`),
      ]).slice(0, 5),
      exit_criteria: TARGET_EXIT,
      target_id: target.target_id,
    });
  });

  // 현장선별 실행은 방문이 아니라 도구 실행이므로 Mission 에 넣지 않는다(표시는 확보 행동에 남는다).
  const visitableAcquisitions = arr(targetMap.acquisition_actions).filter((action) => action.code !== 'FIELD_SCREEN');
  visitableAcquisitions.slice(0, missionTargets.length >= 2 ? 1 : 2).forEach((action, index) => {
    drafts.push({
      weight: 3 + index * 0.1,
      label: action.label,
      focus: '열람·확보 경로 확인',
      core_questions: arr(action.questions),
      action: `자료 확보 — ${action.label}`,
      place: action.place,
      purpose: action.how,
      questions: uniq([...action.questions, ...checkQuestions]).slice(0, MAX_QUESTIONS_PER_MISSION),
      checks: uniq(['열람 장소·기간 기록', '사본·좌표 확보 가능 여부 확인']),
      exit_criteria: ACQUISITION_EXIT,
      acquisition_code: action.code,
    });
  });

  if (!drafts.length) {
    drafts.push({
      weight: 1,
      label: ACQUISITION_ACTIONS.LOCAL_HUB.label,
      focus: '지역 거점 확인',
      core_questions: arr(ACQUISITION_ACTIONS.LOCAL_HUB.questions),
      action: `자료 확보 — ${ACQUISITION_ACTIONS.LOCAL_HUB.label}`,
      place: ACQUISITION_ACTIONS.LOCAL_HUB.place,
      purpose: ACQUISITION_ACTIONS.LOCAL_HUB.how,
      questions: arr(ACQUISITION_ACTIONS.LOCAL_HUB.questions),
      checks: ['거점 목록 기록', '다음 방문 대상 확정'],
      exit_criteria: ACQUISITION_EXIT,
    });
  }

  const missions = drafts
    .sort((left, right) => left.weight - right.weight)
    .slice(0, MAX_MISSIONS)
    .map((draft, index) => {
      const { weight, ...rest } = draft;
      return {
        ...rest,
        mission_id: id('PFM', index),
        order: index + 1,
        label: text(rest.label) || text(rest.action),
        focus: text(rest.focus) || '현장 확인',
        core_questions: uniq(rest.core_questions),
        place: text(rest.place) || PLACE_TO_CONFIRM,
        record: '사진·현황 메모(성명·연락처 등 개인정보는 기록하지 않음)',
      };
    });

  const notes = [
    '개인정보·비공개 정보는 방문 전 수집을 전제로 하지 않습니다. 현장에서 상대방이 동의한 범위에서만 확인합니다.',
    '방문 결과는 [확인쟁점]과 [BSO 추정쟁점/현장검증 필요], [현장확인 필요 · 전제 미확인] 구분을 유지해 기록합니다.',
    profile.note,
  ];
  if (profile.code === 'PRE_DESIGNATION') notes.push('지구지정 전 단계에서는 인물 확보보다 정보경로·거점·자료 확보를 우선합니다.');

  return {
    missions,
    exit_criteria: text(input?.exitCriteria) || STAGE_EXIT[profile.code] || DEFAULT_EXIT_CRITERIA,
    mission_count: missions.length,
    min_missions: MIN_MISSIONS,
    notes: uniq(notes),
  };
}

// v0.2.1 현장카드. 오늘 어디로 가서 무엇을 묻고 어디까지 하면 끝인지만 담는다.
// 출처·근거등급·판정코드는 담지 않는다. 그 정보는 아래 상세근거에 그대로 남아 있다.
// 자료 확보는 사무 과업이고 나머지는 물리적 이동이다. 카드에서는 둘을 섞지 않는다.
function buildFieldCard(fieldMission, profile) {
  const missions = arr(fieldMission.missions);
  const stop = (mission, order) => ({
    order,
    mission_id: mission.mission_id,
    label: mission.label,
    place: mission.place,
    focus: mission.focus,
    checks: arr(mission.checks).slice(0, MAX_CARD_CHECKS),
  });
  const prep = missions.filter((mission) => mission.acquisition_code).map((mission, index) => stop(mission, index + 1));
  const route = missions.filter((mission) => !mission.acquisition_code).map((mission, index) => stop(mission, index + 1));
  const questions = uniq(missions.flatMap((mission) => arr(mission.core_questions))).slice(0, MAX_CARD_QUESTIONS);
  return {
    goal: STAGE_GOAL[profile.code] || STAGE_GOAL.UNKNOWN,
    stage_label: profile.label,
    prep,
    route,
    route_note: route.length ? '' : '방문할 지점이 아직 없습니다. 위 확보 과업을 마친 뒤 동선을 다시 만드세요.',
    questions,
    exit_criteria: fieldMission.exit_criteria,
    note: '개인정보는 방문 전 수집하지 않습니다. 현장에서 동의한 범위에서만 확인합니다.',
    detail_hint: '판단 근거·출처·판정상태는 아래 상세근거에 있습니다.',
  };
}

export function buildPreFieldKit(input = {}) {
  const snapshot = buildSnapshot(input.project || {}, input.signal);
  const profile = stageProfile(snapshot);
  const contactPoints = buildContactPoints(input.contactPoints);
  const targetMap = buildTargetMap(input, profile, contactPoints);
  const issues = buildIssues(input, targetMap, snapshot);
  const fieldMission = buildFieldMission(input, targetMap, contactPoints, issues, profile);
  const fieldCard = buildFieldCard(fieldMission, profile);

  const lines = snapshot.rows.length + targetMap.targets.length + contactPoints.points.length
    + issues.confirmed.length + issues.estimated.length + issues.field_checks.length + fieldMission.missions.length;

  return {
    meta: {
      ...PRE_FIELD_KIT_CONTRACT,
      generated_at: text(input.generatedAt) || null,
      selected_from: input.signal ? 'NEW_BUSINESS_MONITORING' : 'MANUAL_ENTRY',
      selection_state: input.signal ? '현장검토 필요' : '수동 입력',
      stage_profile: { code: profile.code, label: profile.label, priority: profile.priority, source_value: profile.source_value },
      applied_capabilities: ['M3 공간·현장 증거화', 'M5 쟁점·반박 설계'],
    },
    field_card: fieldCard,
    snapshot,
    target_map: targetMap,
    contact_points: contactPoints,
    issues,
    field_mission: fieldMission,
    privacy: {
      personal_data_included: false,
      person_info_estimation: 'PROHIBITED',
      redactions: contactPoints.redactions,
      rejected_person_inputs: contactPoints.rejected.filter((row) => row.reason === 'PERSON_INFO_NOT_PRECOLLECTED'),
      note: '접촉거점은 장소·단체만 기재합니다. 성명·연락처는 키트에 담지 않습니다.',
    },
    page_budget: { line_estimate: lines, estimate_pages: lines > TWO_PAGE_LINE_THRESHOLD ? 2 : 1, max_pages: 2 },
    safety_boundary: PRE_FIELD_SAFETY_BOUNDARY,
    review_required: true,
    auto_confirmed: false,
  };
}

export const PRE_FIELD_CSV_COLUMNS = Object.freeze(['구분', '항목', '내용', '구분표시', '근거', '현장확인', '확인질문', '출처']);

export function preFieldKitCsvRows(kit) {
  const rows = [];
  const card = kit?.field_card;
  if (card) {
    rows.push({ 구분: '현장카드', 항목: '오늘의 목표', 내용: `${card.goal} (${card.stage_label})`, 구분표시: '', 근거: '', 현장확인: '', 확인질문: '', 출처: '' });
    arr(card.prep).forEach((stop) => rows.push({
      구분: '현장카드', 항목: `출발 전 확인 ${stop.order}. ${stop.label}`, 내용: stop.focus, 구분표시: '',
      근거: stop.place, 현장확인: arr(stop.checks).join(' | '), 확인질문: '', 출처: '',
    }));
    arr(card.route).forEach((stop) => rows.push({
      구분: '현장카드', 항목: `방문동선 ${stop.order}. ${stop.label}`, 내용: stop.focus, 구분표시: '',
      근거: stop.place, 현장확인: arr(stop.checks).join(' | '), 확인질문: '', 출처: '',
    }));
    if (card.route_note) rows.push({ 구분: '현장카드', 항목: '방문동선', 내용: card.route_note, 구분표시: '', 근거: '', 현장확인: '', 확인질문: '', 출처: '' });
    rows.push({ 구분: '현장카드', 항목: '핵심 질문', 내용: arr(card.questions).join(' / '), 구분표시: '', 근거: '', 현장확인: '', 확인질문: arr(card.questions).join(' / '), 출처: '' });
    rows.push({ 구분: '현장카드', 항목: '오늘의 종료기준', 내용: card.exit_criteria, 구분표시: '', 근거: '', 현장확인: card.note, 확인질문: '', 출처: '' });
  }
  arr(kit?.snapshot?.rows).forEach((row) => rows.push({
    구분: '사업 Snapshot', 항목: row.label, 내용: row.value, 구분표시: row.status,
    근거: '', 현장확인: row.next_check, 확인질문: '', 출처: row.provenance,
  }));
  arr(kit?.snapshot?.status_candidates).forEach((row) => rows.push({
    구분: '사업 Snapshot', 항목: '현황 이동 항목', 내용: row.statement, 구분표시: 'PROJECT_STATUS_NOT_ISSUE',
    근거: '', 현장확인: '', 확인질문: '', 출처: row.provenance,
  }));
  arr(kit?.target_map?.all_targets).forEach((target) => rows.push({
    구분: '경계·Target Map', 항목: `${target.visit_order}. ${target.location}`,
    내용: `${target.kind_label} · ${target.target_type_labels.join(' / ')}`,
    구분표시: `${target.priority} · ${target.evidence_level} · ${target.judgment_status}`,
    근거: target.basis.join(' | '), 현장확인: target.field_verification.join(' | '),
    확인질문: arr(target.questions).join(' | '), 출처: '',
  }));
  arr(kit?.target_map?.acquisition_actions).forEach((action) => rows.push({
    구분: '경계·Target Map', 항목: `자료 확보 · ${action.label}`, 내용: action.how, 구분표시: 'TARGET_ACQUISITION_REQUIRED',
    근거: '', 현장확인: action.place, 확인질문: arr(action.questions).join(' | '), 출처: '',
  }));
  arr(kit?.contact_points?.points).forEach((point) => rows.push({
    구분: '접촉거점', 항목: point.type_label, 내용: point.label, 구분표시: point.status,
    근거: '', 현장확인: point.address || point.note, 확인질문: arr(point.questions).join(' | '), 출처: point.provenance,
  }));
  arr(kit?.issues?.confirmed).forEach((issue) => rows.push({
    구분: '쟁점', 항목: issue.display_label, 내용: issue.statement, 구분표시: `SOURCE_STATED · ${issue.source?.source_type || 'UNSPECIFIED'}`,
    근거: '', 현장확인: arr(issue.field_verification).join(' | '), 확인질문: arr(issue.questions).join(' | '), 출처: issue.provenance,
  }));
  arr(kit?.issues?.estimated).forEach((issue) => rows.push({
    구분: '쟁점', 항목: issue.display_label, 내용: issue.statement, 구분표시: `BSO_ESTIMATE · ${issue.origin}`,
    근거: arr(issue.basis).join(' | '), 현장확인: arr(issue.field_verification).join(' | '),
    확인질문: arr(issue.questions).join(' | '), 출처: arr(issue.preconditions).map((item) => `${item.label}:${item.status}`).join(' | '),
  }));
  arr(kit?.issues?.field_checks).forEach((row) => rows.push({
    구분: '쟁점', 항목: row.display_label, 내용: row.statement, 구분표시: `${row.status} · ${row.origin}`,
    근거: arr(row.basis).join(' | '), 현장확인: arr(row.field_verification).join(' | '),
    확인질문: arr(row.questions).join(' | '), 출처: arr(row.preconditions).map((item) => `${item.label}:${item.status}`).join(' | '),
  }));
  arr(kit?.field_mission?.missions).forEach((mission) => rows.push({
    구분: 'Field Mission', 항목: `${mission.order}. ${mission.action}`, 내용: mission.purpose,
    구분표시: 'REVIEW_REQUIRED', 근거: mission.place, 현장확인: arr(mission.checks).join(' | '),
    확인질문: arr(mission.questions).join(' | '), 출처: mission.exit_criteria,
  }));
  rows.push({
    구분: '종료기준', 항목: 'G1 종료기준', 내용: text(kit?.field_mission?.exit_criteria),
    구분표시: 'REVIEW_REQUIRED', 근거: '', 현장확인: arr(kit?.field_mission?.notes).join(' | '), 확인질문: '', 출처: '',
  });
  rows.push({
    구분: '안전경계', 항목: '판정범위', 내용: text(kit?.safety_boundary),
    구분표시: 'REVIEW_REQUIRED', 근거: '', 현장확인: '', 확인질문: '', 출처: '',
  });
  return rows;
}

export function preFieldKitCsvText(kit) {
  const cell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  const rows = preFieldKitCsvRows(kit);
  return [PRE_FIELD_CSV_COLUMNS.map(cell).join(','), ...rows.map((row) => PRE_FIELD_CSV_COLUMNS.map((column) => cell(row[column])).join(','))].join('\n') + '\n';
}
