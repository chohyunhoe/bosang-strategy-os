'use strict';

// BSO Pre-Field 사전분석키트 계약 테스트(v0.2.1).
// v0.1 보장(확인쟁점/추정쟁점 분리, 미확인값 보존, 인물정보 차단, 1~2페이지 제한)에
// v0.2 P1 네 건을 더해 고정한다.
//   P1-1 사업단계별 Target 프로필과 자료부족 시 타깃 확보 행동
//   P1-2 실행형 Field Mission(방문장소·순서·목적·확인질문·현장확인사항·종료기준)
//   P1-3 추정쟁점 전제조건과 FIELD_CHECK_REQUIRED 강등
//   P1-4 사업현황과 확인쟁점 분리
//   v0.2.1 현장카드. 목표·동선·핵심질문·종료기준만 맨 위에 두고 내부 판정코드는 넣지 않는다.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'browser', 'product-v2', 'pre-field-kit.js'), 'utf8');
const workOpsUi = fs.readFileSync(path.join(root, 'browser', 'product-v2', 'work-ops-ui.js'), 'utf8');

// 기존 업무도구 화면(현장선별·신규사업·거래사례·공부대조) 위에 키트를 얹는다.
assert.match(workOpsUi, /import \{ buildPreFieldKit, preFieldKitCsvText \} from '\.\/pre-field-kit\.js';/);
assert.match(workOpsUi, /data-pre-field-kit/);
assert.match(workOpsUi, /\$\{preFieldHtml\(\)\}\$\{fieldHtml\(\)\}\$\{signalHtml\(\)\}\$\{rtmsHtml\(\)\}\$\{buildingHtml\(\)\}/);
for (const fn of ['fieldHtml', 'signalHtml', 'rtmsHtml', 'buildingHtml']) assert.match(workOpsUi, new RegExp(`function ${fn}\\(\\)`));
// Mission 구조가 화면에도 나와야 실행지시서로 쓸 수 있다.
for (const label of ['방문장소', '목적', '확인질문', '현장 확인', '종료기준']) assert.ok(workOpsUi.includes(label), `화면에 ${label} 표기 필요`);
for (const label of ['data-pf-field-card', '오늘의 목표', '핵심 질문', '오늘의 종료기준', '상세근거']) assert.ok(workOpsUi.includes(label), `화면에 ${label} 표기 필요`);
assert.ok(workOpsUi.indexOf('data-pf-field-card') < workOpsUi.indexOf('1. 사업 Snapshot'), '현장카드가 상세근거보다 먼저 렌더되어야 한다');
assert.doesNotMatch(source, /auto_confirmed:\s*true/);

const monitoringRow = {
  구분: 'EARLY_SIGNAL', 단계: 'BID_NOTICE', 공고명: '익명 공공주택지구 보상업무 용역',
  발주기관: '익명 공사', 지역: '익명도', 일자: '20260901', 상태: '확인 필요',
};

const baseInput = {
  generatedAt: '2026-09-11T00:00:00.000Z',
  signal: monitoringRow,
  project: { stage: '협의보상 진행', source: { source_type: 'NOTICE', label: '익명 공공주택지구 지구지정 고시', published_at: '2026-08-20' } },
  spatial: {
    boundaryRing: [[127.0, 36.0], [127.01, 36.0], [127.01, 36.01], [127.0, 36.01]],
    boundarySource: '공람도면',
    surroundings: [
      { type: '도로', label: '익명 국도', relation: '사업지 북측 접면', source: '공람도면' },
      { type: '마을', label: '샘플리 취락지구', relation: '사업지 남측 인접' },
    ],
  },
  parcels: [
    { parcel_address: '샘플동 100-1', area: 4200, land_category: '답', appraisal_use_status: '전', owner_group_key: 'OWNER_A' },
    { parcel_address: '샘플동 100-2', area: 900, land_category: '대', appraisal_use_status: '단독주택 건부지', owner_group_key: 'OWNER_A' },
    { parcel_address: '샘플동 101-3', area: 1500, land_category: '장', appraisal_use_status: '공장', road_condition: '세로(불)', acquisition_ratio: 0.4 },
  ],
  fieldCandidates: [
    { priority: 'P1', candidate_type: '주유소·연료', field_status: 'FIELD_ACTIVE', jibun_address: '샘플동 200-1', business_count: 2, next_check: '영업·설비·인허가·진출입 현황 확인', source_dataset: '소상공인 상가정보', in_boundary: true },
    { priority: 'P5', candidate_type: '일반 영업시설', jibun_address: '샘플동 300-1', business_count: 1, source_dataset: '소상공인 상가정보' },
    { priority: 'P5', candidate_type: '일반 영업시설', jibun_address: '샘플동 300-2', business_count: 1, source_dataset: '소상공인 상가정보' },
    { priority: 'P5', candidate_type: '일반 영업시설', jibun_address: '샘플동 300-3', business_count: 4, source_dataset: '소상공인 상가정보' },
  ],
  contactPoints: [
    { type: '마을회관', label: '샘플리 마을회관', address: '샘플동 150', source: '지자체 공개자료' },
    { type: '중개업소', label: '샘플 부동산 010-1234-5678', note: '문의 010-9876-5432', person_name: '홍길동', phone: '02-123-4567' },
    { type: 'PERSON', label: '이장 연락처' },
    { type: '상인회' },
  ],
  confirmedIssues: [
    { statement: '협의양도택지 기준면적 미달로 대상에서 제외된다는 문제가 제기되었습니다.', source: { source_type: 'PRESS', label: '시행자 보도자료', published_at: '2026-09-01' } },
    { statement: '출처 없는 주장이 제기되었습니다.' },
    { statement: '지구계획이 2024년 12월 30일 승인되었습니다.', source: 'PRESS 보도' },
    { statement: '지구 면적은 약 1,271만㎡입니다.', source: 'PRESS 보도' },
  ],
  estimatedIssues: [
    { statement: '근거 없는 추정' },
    { statement: '전제 없는 추정이 제기됩니다.', basis: ['입력 근거'], field_verification: ['현장 확인'] },
    { statement: '잔여 구간 형상 변화 가능성을 검토할 필요가 있습니다.', basis: ['공람도면상 경계 통과'], field_verification: ['잔여 구간 형상 확인'], preconditions: ['일부편입 확인'] },
  ],
};

(async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const api = await import(moduleUrl);
  const kit = api.buildPreFieldKit(baseInput);

  // 1. 사업 Snapshot — 값을 만들지 않고 확인상태를 구분한다.
  const row = (key) => kit.snapshot.rows.find((item) => item.key === key);
  assert.equal(kit.snapshot.rows.length, 7);
  assert.equal(row('stage').status, 'SOURCE_STATED');
  assert.equal(row('project_name').status, 'EARLY_SIGNAL_PENDING_REVIEW');
  assert.match(row('project_name').next_check, /사업명 확인이 필요/);
  assert.match(row('developer').next_check, /사업시행자 확인이 필요/);
  for (const key of ['area', 'budget', 'schedule', 'compensation_timing']) {
    assert.equal(row(key).value, api.UNVERIFIED, `${key} 은 추정값을 만들지 않는다`);
    assert.ok(row(key).next_check, `${key} 에는 확인방법이 붙는다`);
  }
  assert.match(row('compensation_timing').next_check, /사업단계만으로 시점을 추정하지 않습니다/);
  assert.ok(!/"(?:SOURCE_CONFIRMED|LOCATION_CONFIRMED|CONFIRMED_SOURCE)"/.test(JSON.stringify(kit)), '출처 기재를 검수확정으로 표시하지 않는다');

  // P1-1 사업단계별 프로필
  assert.equal(kit.meta.stage_profile.code, 'COMPENSATION');
  assert.deepEqual(kit.meta.stage_profile.priority, ['CASE', 'FACILITY', 'AREA']);
  assert.equal(api.STAGE_PROFILES.PRE_DESIGNATION.priority[0], 'AREA');
  const stageCode = (stage) => api.buildPreFieldKit({ project: { name: 'X', stage, source: 'S' } }).meta.stage_profile.code;
  assert.equal(stageCode('신규 공공택지 발표 단계 · 지구지정 전'), 'PRE_DESIGNATION', '지구지정 전을 지구지정으로 읽지 않는다');
  assert.equal(stageCode('지구지정 고시'), 'PRE_COMPENSATION');
  assert.equal(stageCode('협의보상 진행'), 'COMPENSATION');
  assert.equal(stageCode(''), 'UNKNOWN');
  assert.equal(kit.target_map.all_targets[0].kind, 'CASE', '보상 단계에서는 사건 필지가 먼저다');
  const firedTypes = new Set(kit.target_map.all_targets.flatMap((target) => target.target_types));
  for (const type of ['SPECIAL_USE', 'LARGE_AREA', 'BUILDING_INCLUDED', 'COMMERCIAL_INDUSTRIAL', 'CLUSTER', 'ROAD_ACCESS_CHANGE', 'MULTI_PARCEL_SAME_OWNER', 'BOUNDARY_CUT', 'ACCESS_CORRIDOR']) {
    assert.ok(firedTypes.has(type), `타깃 규칙 누락: ${type}`);
  }
  assert.ok(!firedTypes.has('ADMIN_HUB'), '보상 단계에서는 접촉거점을 타깃으로 중복 기재하지 않는다');
  for (const target of kit.target_map.all_targets) {
    assert.ok(target.basis.length, `${target.location} 근거 누락`);
    assert.ok(target.field_verification.length, `${target.location} 현장 확인사항 누락`);
    assert.ok(target.questions.length, `${target.location} 확인질문 누락`);
    assert.ok(target.preconditions.length, `${target.location} 전제조건 누락`);
    assert.equal(target.judgment_status, 'FIELD_VERIFICATION_REQUIRED');
    assert.ok(api.STAGE_PROFILES.COMPENSATION.priority.includes(target.kind));
    assert.equal(target.auto_confirmed, false);
  }
  assert.ok(!JSON.stringify(kit).includes('OWNER_A'), '소유자 식별키는 출력하지 않는다');

  // P1-4 사업현황은 확인쟁점으로 승격하지 않는다.
  assert.equal(kit.issues.confirmed.length, 1);
  assert.equal(kit.issues.confirmed[0].display_label, '[확인쟁점]');
  assert.ok(kit.issues.confirmed[0].questions.length, '확인쟁점은 현장 질문으로 전환된다');
  const reasons = kit.issues.rejected.map((item) => item.reason);
  assert.ok(reasons.includes('SOURCE_MISSING_NOT_CONFIRMED_ISSUE'));
  assert.equal(reasons.filter((reason) => reason === 'PROJECT_STATUS_NOT_ISSUE').length, 2, '승인·면적 서술은 현황으로 되돌린다');
  assert.equal(kit.snapshot.status_candidates.length, 2);
  assert.ok(kit.snapshot.status_candidates.every((item) => item.provenance), '되돌린 현황도 출처를 유지한다');

  // P1-3 추정쟁점 전제조건
  assert.ok(!kit.issues.estimated.some((issue) => /잔여지 매수청구/.test(issue.statement)), '일부편입·잔여지 확인 전에는 잔여지 추정을 만들지 않는다');
  const largeAreaCheck = kit.issues.field_checks.find((item) => item.rule === 'LARGE_AREA');
  assert.ok(largeAreaCheck, '전제 미확인 추정은 현장확인 항목으로 강등한다');
  assert.equal(largeAreaCheck.status, 'FIELD_CHECK_REQUIRED');
  assert.equal(largeAreaCheck.display_label, api.FIELD_CHECK_LABEL);
  assert.deepEqual(largeAreaCheck.preconditions.map((item) => item.status), ['UNCONFIRMED', 'UNCONFIRMED']);
  assert.ok(largeAreaCheck.questions.length && largeAreaCheck.field_verification.length);
  assert.ok(kit.issues.field_checks.some((item) => item.origin === 'USER_INPUT' && /전제조건이 기재되지 않아/.test(item.note)), '전제 미기재 사용자 추정도 강등한다');
  for (const issue of kit.issues.estimated) {
    assert.equal(issue.display_label, '[BSO 추정쟁점/현장검증 필요]');
    assert.ok(issue.basis.length && issue.field_verification.length, '추정쟁점 근거·현장확인 누락');
    assert.ok(issue.preconditions.length, '추정쟁점 전제조건 누락');
    assert.ok(issue.preconditions.every((item) => item.status === 'SATISFIED'), '전제가 확인된 추정만 승격한다');
  }
  assert.ok(kit.issues.estimated.some((issue) => issue.origin === 'BSO_RULE'));
  assert.ok(kit.issues.estimated.some((issue) => issue.origin === 'USER_INPUT'));
  assert.doesNotMatch(kit.issues.estimated.map((issue) => issue.statement).join(' '), /증액|위법 확정|확정됩니다|보장/);

  // 전제가 확인되면 같은 규칙이 추정쟁점으로 승격한다.
  const partial = api.buildPreFieldKit({
    ...baseInput,
    parcels: [{ parcel_address: '샘플동 100-1', area: 4200, land_category: '답', partial_acquisition: true, remainder_exists: true, source: { label: '공람 토지조서' } }],
  });
  assert.ok(partial.issues.estimated.some((issue) => issue.rule === 'LARGE_AREA'), '일부편입·잔여부분이 확인되면 잔여지 추정을 만든다');
  assert.ok(!partial.issues.field_checks.some((item) => item.rule === 'LARGE_AREA'));

  // 3. 접촉거점 — 장소·단체만, 인물정보와 연락처는 차단한다.
  assert.deepEqual(kit.contact_points.points.map((point) => point.type), ['VILLAGE_HALL', 'REALTOR']);
  assert.ok(kit.contact_points.points.every((point) => point.questions.length), '거점 유형별 질문을 제공한다');
  assert.ok(!/010-1234-5678|010-9876-5432|02-123-4567/.test(JSON.stringify(kit)), '연락처는 키트에 남지 않는다');
  assert.ok(!JSON.stringify(kit).includes('홍길동'), '성명은 키트에 남지 않는다');
  assert.equal(kit.privacy.personal_data_included, false);
  assert.equal(kit.privacy.rejected_person_inputs.length, 1);
  assert.ok(kit.contact_points.redactions.some((item) => item.field_kind === 'PERSON_FIELD_DROPPED'));

  // P1-2 실행형 Field Mission
  assert.ok(kit.field_mission.missions.length >= 3 && kit.field_mission.missions.length <= 5);
  assert.deepEqual(kit.field_mission.missions.map((mission) => mission.order), kit.field_mission.missions.map((_, index) => index + 1));
  for (const mission of kit.field_mission.missions) {
    assert.ok(mission.place && mission.place !== '사업지 일원', `${mission.action} 방문장소 누락`);
    assert.ok(mission.purpose, `${mission.action} 목적 누락`);
    assert.ok(arr(mission.questions).length, `${mission.action} 확인질문 누락`);
    assert.ok(arr(mission.checks).length, `${mission.action} 현장 확인사항 누락`);
    assert.ok(mission.exit_criteria, `${mission.action} 종료기준 누락`);
  }
  assert.ok(!JSON.stringify(kit.field_mission).includes('사업지 일원'), '일반 문구만 남기지 않는다');
  assert.match(api.DEFAULT_EXIT_CRITERIA, /핵심인물 1명 이상/);
  assert.ok(kit.field_mission.notes.some((note) => /방문 전 수집을 전제로 하지 않습니다/.test(note)));

  // P1-1 초기 단계: 사건 편입토지가 없어도 지역·거점 타깃이 생기고, 없으면 확보 행동이 남는다.
  const early = api.buildPreFieldKit({
    project: { name: '익명 도심 공공주택지구', stage: '신규 공공택지 발표 단계 · 지구지정 전', source: '공개자료 검색요약' },
    spatial: { surroundings: [
      { type: '철도', label: '익명역', relation: '지구 인접', source: '보도' },
      { type: '도로', label: '왕복 2차선 간선도로', relation: '교통망 열악', source: '보도' },
      { type: '농업시설', label: '익명 농장', relation: '편입 여부 미확인', source: '보도' },
    ] },
    contactPoints: [{ type: '주민센터', label: '익명 행정복지센터', address: '익명시 익명로 35', source: '지자체 안내' }],
    confirmedIssues: [{ statement: '교통대책 마련 요구가 제기되었습니다.', source: '보도' }],
  });
  assert.equal(early.meta.stage_profile.code, 'PRE_DESIGNATION');
  assert.ok(early.target_map.kind_counts.AREA >= 1, '초기 단계에서 지역·거점 타깃이 1개 이상 생성되어야 한다');
  assert.ok(early.target_map.all_targets.some((target) => target.target_types.includes('ADMIN_HUB')), '초기 단계에서는 행정·주민조직 거점이 타깃이 된다');
  assert.equal(early.target_map.all_targets[0].kind, 'AREA', '초기 단계는 지역·거점이 먼저다');
  assert.equal(early.target_map.kind_counts.CASE, 0, '없는 사건 타깃을 만들지 않는다');
  assert.ok(early.target_map.acquisition_actions.some((action) => action.code === 'BOUNDARY'));
  assert.ok(early.target_map.acquisition_actions.some((action) => action.code === 'PARCEL_LIST'));
  assert.ok(early.field_mission.missions.some((mission) => /자료 확보/.test(mission.action)), '자료 부족은 확보 Mission 으로 전환한다');
  for (const mission of early.field_mission.missions) {
    assert.ok(mission.place && mission.place !== '사업지 일원');
    assert.ok(arr(mission.questions).length, `${mission.action} 질문 누락`);
  }
  assert.equal(early.issues.confirmed.length, 1);
  assert.ok(early.field_mission.notes.some((note) => /거점·자료 확보를 우선/.test(note)));

  // 자료가 아무것도 없어도 확보 Mission 을 남긴다.
  const empty = api.buildPreFieldKit({ project: { name: '익명 사업' } });
  assert.equal(empty.target_map.total_count, 0);
  assert.equal(empty.meta.stage_profile.code, 'UNKNOWN');
  assert.ok(empty.field_mission.missions.length >= 1);
  assert.ok(empty.field_mission.missions.every((mission) => mission.place && mission.place !== '사업지 일원'));
  assert.ok(empty.target_map.acquisition_actions.length >= 3);
  assert.ok(empty.issues.confirmed_note);

  // v0.2.1 현장카드 — 실행 순서만 담고 내부 판정코드는 담지 않는다.
  const card = kit.field_card;
  assert.ok(card, '현장카드 누락');
  assert.ok(card.goal && card.stage_label, '목표·단계 표기 누락');
  // 사무 과업과 물리적 이동을 섞지 않는다.
  const visitMissions = kit.field_mission.missions.filter((mission) => !mission.acquisition_code);
  const prepMissions = kit.field_mission.missions.filter((mission) => mission.acquisition_code);
  assert.deepEqual(card.route.map((stop) => stop.mission_id), visitMissions.map((mission) => mission.mission_id), '방문동선은 이동이 있는 Mission 만 쓴다');
  assert.deepEqual(card.prep.map((stop) => stop.mission_id), prepMissions.map((mission) => mission.mission_id), '자료 확보는 출발 전 확인으로 뺀다');
  assert.deepEqual(card.route.map((stop) => stop.order), card.route.map((_, index) => index + 1), '방문동선은 1부터 다시 센다');
  assert.ok(card.prep.every((stop) => stop.place && arr(stop.checks).length), '출발 전 확인에도 창구와 확인사항이 붙는다');
  for (const stop of [...card.route, ...card.prep]) {
    assert.ok(stop.label && stop.place && stop.focus, `${stop.order}번 동선 항목 누락`);
    assert.ok(stop.place !== '사업지 일원');
    assert.ok(arr(stop.checks).length >= 1 && arr(stop.checks).length <= 3, '확인사항은 3개까지만 카드에 올린다');
  }
  assert.ok(card.questions.length >= 1 && card.questions.length <= 4);
  assert.ok(card.questions.every((question) => !/관련 현재 진행상황과 대응 경과/.test(question)), '카드 질문은 짧은 현장질문만 쓴다');
  assert.equal(card.exit_criteria, kit.field_mission.exit_criteria, '종료기준은 하나여야 한다');
  assert.ok(!/SOURCE_STATED|DATA_SOURCED|FIELD_VERIFICATION_REQUIRED|PROJECT_STATUS|FIELD_CHECK_REQUIRED|EARLY_SIGNAL/.test(JSON.stringify(card)), '현장카드에는 내부 판정코드를 넣지 않는다');
  assert.ok(card.note && card.detail_hint);

  // 단계별 오늘의 종료기준
  assert.equal(kit.field_mission.exit_criteria, api.DEFAULT_EXIT_CRITERIA, '보상 단계는 기존 기본값을 유지한다');
  assert.equal(early.field_card.exit_criteria, '정보경로 1개 + 핵심지역 1개 + 후속접촉 명분 1개');
  assert.equal(early.field_card.goal, '지역 조직·핵심정보 경로 확보');
  assert.equal(early.field_card.route.length + early.field_card.prep.length, early.field_mission.missions.length);
  assert.ok(early.field_card.prep.some((stop) => /사업경계 도면 확보/.test(stop.label)), '경계 도면 확보는 방문동선이 아니라 출발 전 확인이다');
  assert.ok(early.field_card.route.every((stop) => !/자료 확보/.test(stop.label)));
  assert.equal(empty.field_card.route.length, 0);
  assert.ok(empty.field_card.prep.length >= 1, '자료가 없으면 출발 전 확인만 남는다');
  assert.ok(empty.field_card.route_note, '방문 지점이 없으면 그 사실을 적는다');

  // 분량·안전경계·결정성
  assert.ok(kit.page_budget.estimate_pages <= kit.page_budget.max_pages);
  assert.ok(kit.target_map.targets.length <= 8);
  assert.equal(kit.review_required, true);
  assert.equal(kit.auto_confirmed, false);
  assert.match(kit.safety_boundary, /판정하지 않습니다/);
  assert.equal(kit.meta.kit_version, 'bso-pre-field-kit/0.2.1');
  assert.deepEqual(kit.meta.applied_capabilities, ['M3 공간·현장 증거화', 'M5 쟁점·반박 설계']);
  assert.deepEqual(api.buildPreFieldKit(baseInput), kit, '같은 입력은 같은 키트를 만든다');

  const many = api.buildPreFieldKit({
    ...baseInput,
    fieldCandidates: Array.from({ length: 14 }, (_, index) => ({
      priority: 'P1', candidate_type: '주유소·연료', jibun_address: `샘플동 4${String(index).padStart(2, '0')}-1`,
      business_count: 1, source_dataset: '소상공인 상가정보',
    })),
  });
  assert.equal(many.target_map.targets.length, 8);
  assert.ok(many.target_map.overflow_count > 0);
  assert.equal(many.target_map.all_targets.length, many.target_map.targets.length + many.target_map.overflow_count);

  // CSV — 질문과 전제까지 보존한다.
  const csv = api.preFieldKitCsvText(kit);
  assert.ok(csv.startsWith('"구분","항목","내용","구분표시","근거","현장확인","확인질문","출처"'));
  assert.ok(csv.split('\n')[1].startsWith('"현장카드","오늘의 목표"'), 'CSV 첫 줄도 현장카드로 시작한다');
  assert.ok(csv.includes('"현장카드","방문동선 1.'));
  assert.ok(api.preFieldKitCsvText(early).includes('"현장카드","출발 전 확인 1.'));
  assert.ok(csv.includes('"현장카드","오늘의 종료기준"'));
  assert.ok(csv.includes('[확인쟁점]'));
  assert.ok(csv.includes('[BSO 추정쟁점/현장검증 필요]'));
  assert.ok(csv.includes('FIELD_CHECK_REQUIRED'));
  assert.ok(csv.includes('G1 종료기준'));
  assert.ok(csv.includes('사업 Snapshot') && csv.includes('경계·Target Map') && csv.includes('접촉거점') && csv.includes('Field Mission'));
  assert.ok(!/010-1234-5678|홍길동/.test(csv));
  assert.ok(api.preFieldKitCsvText(empty).includes('TARGET_ACQUISITION_REQUIRED'));

  function arr(value) { return Array.isArray(value) ? value : []; }
  console.log('pre_field_kit.test.js passed');
})().catch((error) => { console.error(error); process.exit(1); });
