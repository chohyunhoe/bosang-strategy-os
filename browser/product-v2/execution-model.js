import { computeAppraisalCoverage } from './appraisal-coverage.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function stage(key, label, state, action, route, note = '') {
  return { key, label, state, action, route, note };
}

export function computeExecutionModel(state) {
  const documents = arr(state.sourceDocuments);
  const lands = arr(state.lands);
  const results = arr(state.appraisalResults);
  const reviewQueue = arr(state.reviewQueue);
  const publicRows = arr(state.publicLandCharacteristics);
  const documentReady = documents.length > 0;
  const parseHeld = state.status === 'PARSE_HOLD' || state.batchHasHold === true || arr(state.documentSanity).some((row) => row.status === 'PARSE_HOLD');
  const parseReady = !parseHeld && documentReady && documents.every((row) => ['TEXT_PARSED', 'CANDIDATES_READY', 'READY'].includes(String(row.parse_status || '').toUpperCase()));
  const landReady = lands.length > 0;
  const publicCapability = state.capabilities?.publicData || 'NOT_CONNECTED';
  // Provider 연결 여부와 자료 완전성은 별개다. 검증된 JSON import로도 자료 단계는 완료될 수 있다.
  const publicMissingCount = Math.max(0, lands.length - publicRows.length);
  const publicReady = landReady && publicMissingCount === 0;
  const appraisalCoverage = computeAppraisalCoverage(state);
  const analysisReady = landReady && appraisalCoverage.complete;
  const appraisalMissingCount = appraisalCoverage.missing_count;
  const appraisalMissingLabel = appraisalCoverage.missing[0]?.parcel_address || appraisalCoverage.missing[0]?.land_id || '';
  const mapReady = Boolean(state.mapContext);
  const reviewReady = reviewQueue.length > 0 && reviewQueue.every((item) => item.status === 'CONFIRMED');
  const outputCapability = state.capabilities?.outputCenter || 'LOCAL_ONLY';

  const stages = [
    stage('home', '홈·실행보드', documentReady ? 'COMPLETED' : 'NOT_STARTED', documentReady ? '사건 확인' : '평가서 등록', 'case'),
    stage('workspace', '사건 워크스페이스', parseReady ? 'COMPLETED' : documentReady ? 'IN_PROGRESS' : 'NOT_STARTED', parseReady ? '토지·자료 확인' : '평가서 해석·추출', parseReady ? 'lands' : 'case'),
    stage('data', '자료·데이터', publicReady ? 'COMPLETED' : landReady ? 'NEEDS_REVIEW' : 'NOT_STARTED', landReady ? (publicReady ? '공적자료 대조 완료' : `${publicMissingCount}필지 PNU·공적자료 보강`) : '토지조서 검수', 'lands', publicCapability === 'LOCAL_ONLY' && !publicReady ? '자동조회는 로컬 기능이며 검증된 JSON import도 사용할 수 있습니다.' : ''),
    stage('analysis', '분석', analysisReady ? 'COMPLETED' : landReady ? 'NEEDS_REVIEW' : 'NOT_STARTED', analysisReady ? '평가결과 연결 완료' : appraisalMissingCount ? `평가결과 누락 ${appraisalMissingCount}필지 확인${appraisalMissingLabel ? ` · ${appraisalMissingLabel}` : ''}` : '필지별 평가결과 확인', 'valuation'),
    stage('map', '지도·현장', mapReady ? 'COMPLETED' : analysisReady ? 'NEEDS_REVIEW' : 'NOT_STARTED', mapReady ? '쟁점 검토' : 'API 실무지도 생성', 'map'),
    stage('output', '결과물', reviewReady ? (outputCapability === 'AVAILABLE' ? 'COMPLETED' : 'NEEDS_REVIEW') : reviewQueue.length ? 'NEEDS_REVIEW' : 'NOT_STARTED', reviewReady ? (outputCapability === 'AVAILABLE' ? '결과물 생성' : '로컬 Output Center 연결') : '검토 큐 완료', 'outputs'),
  ];

  if (parseHeld) { stages[1] = stage('workspace', '사건 워크스페이스', 'NEEDS_REVIEW', '보류 문서 원문·추출 확인', 'case'); }
  let next = stages.find((item) => item.state !== 'COMPLETED') || stages[stages.length - 1];
  if (!documentReady) next = stages[0];
  else if (!parseReady) next = stages[1];
  else if (!landReady) next = stages[2];
  // 감정평가 원문 분석은 공적자료 조회를 기다리지 않고 진행할 수 있다.
  else if (!analysisReady) next = stages[3];
  // 분석 후에는 누락 공적자료를 마저 보강해 지도·쟁점의 근거를 완성한다.
  else if (!publicReady) next = stages[2];
  else if (!mapReady) next = stages[4];
  else next = stages[5];

  return {
    stages,
    next,
    progress: Math.round((stages.filter((item) => item.state === 'COMPLETED').length / stages.length) * 100),
    blockers: [
      ...(parseHeld ? ['PARSE_HOLD_REQUIRES_SOURCE_REVIEW'] : []),
      ...(appraisalMissingCount ? [`APPRAISAL_RESULT_MISSING:${appraisalMissingCount}`] : []),
      ...(!publicReady && publicCapability === 'NOT_CONNECTED' ? ['PUBLIC_DATA_NOT_CONNECTED'] : []),
      ...(!publicReady && publicCapability !== 'NOT_CONNECTED' ? ['PUBLIC_DATA_INCOMPLETE'] : []),
      ...(state.capabilities?.map === 'NOT_CONNECTED' ? ['MAP_NOT_CONNECTED'] : []),
      ...(outputCapability !== 'AVAILABLE' ? ['OUTPUT_CENTER_LOCAL_ONLY'] : []),
    ],
    appraisalCoverage,
  };
}
