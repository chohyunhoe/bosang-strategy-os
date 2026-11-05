'use strict';

const { test, expect } = require('@playwright/test');

function ref(label, page = 1, line = 1) {
  return [{ appraisal_id:'APP_001', page_no:page, line_start:line, line_end:line, source_label:label, raw_text_excerpt:`${label} 익명 근거` }];
}

function v2State() {
  return {
    reviewQueue: [
      { review_id:'GROUP:caseInfo', status:'NEEDS_REVIEW' },
      { review_id:'GROUP:appraisals', status:'NEEDS_REVIEW' },
      { review_id:'GROUP:lands', status:'NEEDS_REVIEW' },
      { review_id:'GROUP:standardLands', status:'NEEDS_REVIEW' },
      { review_id:'GROUP:appraisalResults', status:'NEEDS_REVIEW' },
      { review_id:'GROUP:subjectFactorTotals', status:'NEEDS_REVIEW' },
      { review_id:'GROUP:issueCandidates', status:'NEEDS_REVIEW' },
    ],
    reviewDecisions: {},
    sourceDocuments:[{ document_id:'DOC_001', appraisal_id:'APP_001', file_name:'개인실명(익명법인).pdf', page_count:12, parse_status:'TEXT_PARSED' }],
    caseInfo: { case_id:'CASE_V2_OUTPUT', case_name:'익명 Product v2 사건', project_name:'익명 검토지구', price_date:'2025-11-01', review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('기본정보') },
    appraisals: [{ appraisal_id:'APP_001', appraisal_company:'익명감정평가법인', file_name:'개인실명(익명법인).pdf', review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('평가법인') }],
    lands: [{ land_id:'LAND_001', land_no:'1', parcel_address:'익명시 샘플동 10-1', land_category:'대', area:300, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('토지조서',1,7) }],
    standardLands: [{ standard_land_id:'STD_001', appraisal_id:'APP_001', standard_land_symbol:'A', parcel_address:'익명시 샘플동 100-1', land_category:'대', official_price:350000, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('비교표준지',1,11) }],
    transactionCases: [],
    appraisalResults: [{ appraisal_result_id:'LAR_001', appraisal_id:'APP_001', appraisal_company:'익명감정평가법인', land_id:'LAND_001', subject_link_status:'LINKED', parcel_address:'익명시 샘플동 10-1', land_category:'대', area:300, standard_land_symbol:'A', official_price:350000, time_correction:1.012, regional_factor:1, individual_factor_total:0.98, other_factor:1.05, calculated_unit_price:364000, unit_price:364000, amount:109200000, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('토지가액 산출근거',2,3) }],
    appraisalTotals:[],
    subjectFactorDetails: [{ comparison_id:'SSF_001', comparison_type:'SUBJECT_LAND_TO_STANDARD', appraisal_id:'APP_001', land_id:'LAND_001', standard_land_id:'STD_001', standard_land_symbol:'A', street_condition:1, access_condition:1, environment_or_natural_condition:1, parcel_condition:0.98, administrative_condition:1, other_condition:1, total_factor:0.98, factor_reason:'익명 원문 명시값', review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('개별요인 상세',2,2) }],
    subjectFactorTotals: [{ factor_total_id:'SFT_001', appraisal_id:'APP_001', land_id:'LAND_001', standard_land_symbol:'A', total_factor:0.98, detail_status:'DETAIL_AVAILABLE', review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('개별요인 누계',2,2) }],
    standardToCompCaseFactors:[], otherFactors:[], comparisonSummaryByLand:[], obstacleSummaries:[], obstacleRows:[], landCharacteristics:[], landCharacteristicCrosscheck:[], publicLandCharacteristics:[], publicLandDataEnrichment:{}, publicEnrichment:[],
    issueCandidates: [{ issue_id:'ISSUE_001', issue_code:'LOW_INDIVIDUAL_FACTOR_TOTAL', severity:'MEDIUM', title:'개별요인 검토', description:'평가서 명시 계수의 원문 대조 필요', related:{land_id:'LAND_001'}, source_refs:ref('평가결과'), review_status_code:'NEEDS_REVIEW', auto_confirmed:false, conclusion:null }],
    draftSentences: [],
    riskWarnings: [{ risk_id:'RISK_001', risk_type:'PROHIBITED_INTERPRETATION', risk_level:'HIGH', related_issue_id:'ISSUE_001', message:'평가 오류로 단정 금지', required_action:'원문 근거 중심 표현' }],
  };
}

async function bridgeStatus(page) {
  return page.evaluate(async () => {
    const response = await fetch('/__output_bridge/status', { cache:'no-store' });
    return response.json();
  });
}
async function snapshot(page, state) {
  return page.evaluate(async (runtimeState) => {
    const adapter = await import('/output-adapter.js');
    return adapter.caseSnapshotForOutput(runtimeState);
  }, state);
}
async function invoke(page, route, state, extra = {}) {
  return page.evaluate(async ({ routeName, runtimeState, extras }) => {
    const adapter = await import('/output-adapter.js');
    const caseData = adapter.caseSnapshotForOutput(runtimeState);
    const response = await fetch(`/__output_bridge/${routeName}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ case:caseData, ...extras }) });
    const data = await response.json();
    return { status:response.status, data };
  }, { routeName:route, runtimeState:state, extras:extra });
}

test('수동 확인 결정만 output snapshot에 CONFIRMED로 승계되고 원본 state는 불변이다', async ({ page }) => {
  await page.goto('/');
  const state = v2State();
  const reviewedAt = '2026-08-22T05:00:00.000Z';
  state.reviewDecisions = {
    'GROUP:caseInfo':{status:'CONFIRMED',reviewed_at:reviewedAt},
    'GROUP:appraisals':{status:'CONFIRMED',reviewed_at:reviewedAt},
    'GROUP:lands':{status:'CONFIRMED',reviewed_at:reviewedAt},
    'GROUP:standardLands':{status:'CONFIRMED',reviewed_at:reviewedAt},
    'GROUP:appraisalResults':{status:'CONFIRMED',reviewed_at:reviewedAt},
    'GROUP:subjectFactorTotals':{status:'HOLD',reviewed_at:reviewedAt},
    'GROUP:issueCandidates':{status:'CONFIRMED',reviewed_at:reviewedAt},
  };
  state.reviewQueue = state.reviewQueue.map((item) => ({ ...item, status:state.reviewDecisions[item.review_id]?.status || item.status }));
  const frozen = JSON.stringify(state);
  const out = await snapshot(page, state);

  expect(out.case.review_status_code).toBe('CONFIRMED');
  expect(out.appraisals[0].review_status_code).toBe('CONFIRMED');
  expect(out.lands[0].review_status_code).toBe('CONFIRMED');
  expect(out.standard_lands[0].review_status_code).toBe('CONFIRMED');
  expect(out.land_appraisal_results[0].review_status_code).toBe('CONFIRMED');
  expect(out.subject_to_standard_factor_comparisons[0].review_status_code).toBe('NEEDS_REVIEW');
  expect(out.subject_factor_total_candidates[0].review_status_code).toBe('NEEDS_REVIEW');
  expect(out.issue_candidates[0].review_status_code).toBe('CONFIRMED');
  expect(out.issue_candidates[0].auto_confirmed).toBe(false);
  expect(out.meta.review_status).toBe('REVIEW_REQUIRED');
  expect(out.document_uploads[0].file_name).toBe('APP_001.pdf');
  expect(out.document_uploads[0].page_count).toBe(12);
  expect(JSON.stringify(out)).not.toContain('개인실명');
  expect(JSON.stringify(state)).toBe(frozen);
});

test('개별요인 canonical 그룹 확인 시 세부행과 누계가 함께 CONFIRMED 된다', async ({ page }) => {
  await page.goto('/');
  const state = v2State();
  const out = await page.evaluate(async (runtimeState) => {
    const {CaseStore} = await import('/case-store.js');
    const {caseSnapshotForOutput} = await import('/output-adapter.js');
    const store = new CaseStore();store.restoreSnapshot(runtimeState);
    store.decide('GROUP:subjectFactorTotals','CONFIRMED');
    return caseSnapshotForOutput(store.state);
  }, state);
  expect(out.subject_to_standard_factor_comparisons[0].review_status_code).toBe('CONFIRMED');
  expect(out.subject_factor_total_candidates[0].review_status_code).toBe('CONFIRMED');
});

test('모든 실제 검수그룹 확인 시 snapshot은 REVIEWED이고 자동확정은 생기지 않는다', async ({ page }) => {
  await page.goto('/');
  const state = v2State();
  const reviewedAt = '2026-08-22T05:00:00.000Z';
  state.reviewDecisions = Object.fromEntries(state.reviewQueue.map((item) => [item.review_id,{status:'CONFIRMED',reviewed_at:reviewedAt}]));
  state.reviewQueue = state.reviewQueue.map((item) => ({ ...item, status:'CONFIRMED' }));
  const out = await snapshot(page, state);
  expect(out.meta.review_status).toBe('REVIEWED');
  const records = [out.case,...out.appraisals,...out.lands,...out.standard_lands,...out.land_appraisal_results,...out.subject_to_standard_factor_comparisons,...out.subject_factor_total_candidates,...out.issue_candidates];
  expect(records.every((row) => row.auto_confirmed === false)).toBe(true);
  expect(records.every((row) => row.review_status_code === 'CONFIRMED')).toBe(true);
});

test('Product v2 snapshot으로 실제 DOCX/XLSX·CSV/의견서 bridge가 동작한다', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const status = await bridgeStatus(page);
  expect(status.available, `Output Center unavailable: ${JSON.stringify(status)}`).toBe(true);
  expect(status.formats).toContain('DOCX');
  expect(status.formats).toContain('CSV');
  const state = v2State();
  const analysis = await invoke(page, 'analysis_report', state);
  expect(analysis.status).toBe(200); expect(analysis.data.ok).toBe(true);
  expect(Buffer.from(analysis.data.docx_base64, 'base64').subarray(0,2).toString('latin1')).toBe('PK');
  expect(analysis.data.counts.subject_parcels).toBe(1); expect(analysis.data.counts.valuation_rows).toBe(1);
  const numeric = await invoke(page, 'numeric_table', state, { formats:['xlsx','csv'] });
  expect(numeric.status).toBe(200); expect(numeric.data.ok).toBe(true); expect(numeric.data.files.some((file) => file.format === 'CSV')).toBe(true);
  if (status.formats.includes('XLSX')) { const xlsx = numeric.data.files.find((file) => file.format === 'XLSX'); expect(xlsx).toBeTruthy(); expect(Buffer.from(xlsx.base64, 'base64').subarray(0,2).toString('latin1')).toBe('PK'); }
  const opinion = await invoke(page, 'opinion_package', state, { map_png_base64:'' });
  expect(opinion.status).toBe(200); expect(opinion.data.ok).toBe(true); expect(Buffer.from(opinion.data.docx_base64, 'base64').subarray(0,2).toString('latin1')).toBe('PK'); expect(opinion.data.auto_confirmed).not.toBe(true);
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const mappedOpinion=await invoke(page,'opinion_package',state,{map_png_items:[{title:'전체 위치도',png_base64:pixel},{title:'편입토지–비교표준지 1',png_base64:pixel}]});
  expect(mappedOpinion.status).toBe(200);expect(mappedOpinion.data.ok).toBe(true);expect(mappedOpinion.data.map_embedded).toBe(true);expect(mappedOpinion.data.map_count).toBe(2);
  await page.locator('[data-route="outputs"]:visible').first().click();
  await expect(page.locator('main')).toContainText('DOCX/XLSX/CSV');
  await expect(page.locator('[data-output-action="analysis"]')).toBeVisible();
  await expect(page.locator('[data-output-action="table"]')).toBeVisible();
  await expect(page.locator('[data-output-action="opinion"]')).toBeVisible();
});

test('Product v2 snapshot의 auto_confirmed=true는 출력 bridge에서 차단된다', async ({ page }) => {
  await page.goto('/');
  const status = await bridgeStatus(page); expect(status.available).toBe(true);
  const state = v2State(); state.appraisalResults[0].auto_confirmed = true;
  const result = await invoke(page, 'analysis_report', state);
  expect(result.status).toBe(422); expect(result.data.ok).toBe(false); expect(result.data.error_code).toBe('AUTO_CONFIRMED_BOUNDARY');
});

test('추출 보류 사건은 기존 검수그룹을 확인해도 출력 검수완료로 승격하지 않는다',async({page})=>{
  await page.goto('/');
  const status=await page.evaluate(async()=>{
    const {caseSnapshotForOutput}=await import('/output-adapter.js');
    return caseSnapshotForOutput({status:'PARSE_HOLD',batchHasHold:true,reviewQueue:[{status:'CONFIRMED'}]}).meta.review_status;
  });
  expect(status).toBe('REVIEW_REQUIRED');
});
