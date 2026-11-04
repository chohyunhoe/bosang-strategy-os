'use strict';

const { test, expect } = require('@playwright/test');

function parsed(appraisalId, projectName, purpose, priceDate) {
  return {
    meta:{parse_status:'TEXT_PARSED',auto_confirmed:false},
    case:{case_name:projectName,project_name:projectName,price_date:priceDate,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:[{appraisal_id:appraisalId,page_no:1,source_label:'기본정보',raw_text_excerpt:`${projectName} ${priceDate}`}]},
    appraisals:[{appraisal_id:appraisalId,appraisal_company:`${appraisalId}감정평가법인`,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:[]}],
    lands:[],standard_lands:[],comp_cases:[],land_appraisal_results:[],subject_to_standard_factor_comparisons:[],subject_factor_total_candidates:[],other_factor_reviews:[],obstacle_summary_by_appraisal:[],obstacle_appraisal_results_sample:[],
  };
}

test('평가서별 사건명·평가목적 문언이 다르면 첫 값을 조용히 덮어쓰지 않고 variants와 쟁점으로 보존한다', async ({page})=>{
  await page.goto('/');
  await page.evaluate(([a,b])=>{
    const store=window.BSOProductV2.store;
    store.ingestDocument({fileMeta:{name:'익명(경일).pdf',size:1000},pageModel:[{page_no:1,text:'본건은 「가상표본지구 도시개발사업」에 편입되는 토지에 대한 보상(협의) 목적의 감정평가임.'}],parsed:a});
    store.ingestDocument({fileMeta:{name:'익명(가람).pdf',size:1000},pageModel:[{page_no:1,text:'본건은 「가상·표본지구 도시개발사업」에 편입되는 토지에 대한 보상(사업인정 후 협의) 목적의 감정평가임.'}],parsed:b});
  },[
    parsed('APP_001','가상표본지구 도시개발사업','', '2025.11.01'),
    parsed('APP_002','가상·표본지구 도시개발사업','', '2025.11.01'),
  ]);

  const state=await page.evaluate(()=>window.BSOProductV2.store.snapshot());
  expect(state.caseInfo.project_name).toBe('가상표본지구 도시개발사업');
  expect(state.caseInfo.appraisal_purpose).toBe('보상(협의)');
  expect(state.caseInfo.price_date).toBe('2025.11.01');
  expect(state.caseInfo.case_info_variants.project_name).toEqual(expect.arrayContaining(['가상표본지구 도시개발사업','가상·표본지구 도시개발사업']));
  expect(state.caseInfo.case_info_variants.appraisal_purpose).toEqual(expect.arrayContaining(['보상(협의)','보상(사업인정 후 협의)']));
  expect(state.caseInfo.case_info_conflicts.map((row)=>row.field)).toEqual(expect.arrayContaining(['case_name','project_name','appraisal_purpose']));
  expect(state.caseInfo.case_info_conflicts.some((row)=>row.field==='price_date')).toBe(false);
  expect(new Set((state.caseInfo.source_refs||[]).map((row)=>row.appraisal_id))).toEqual(new Set(['APP_001','APP_002']));

  const conflicts=state.issueCandidates.filter((row)=>row.issue_code==='CASE_INFO_CONFLICT');
  expect(conflicts).toHaveLength(3);
  expect(conflicts.every((row)=>row.auto_confirmed===false && row.conclusion===null)).toBe(true);
  expect(conflicts.some((row)=>row.description.includes('보상(사업인정 후 협의)'))).toBe(true);

  const caseReview=state.reviewQueue.find((row)=>row.review_id==='GROUP:caseInfo');
  expect(caseReview).toBeTruthy();
  expect(caseReview.status).toBe('NEEDS_REVIEW');
});
