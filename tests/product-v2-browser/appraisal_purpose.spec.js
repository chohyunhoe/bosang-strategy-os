'use strict';

const { test, expect } = require('@playwright/test');

test('사업인정 후 협의 목적 문언을 일반 협의로 축약하지 않는다', async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.BSOProductV2.store.ingestDocument({
      fileMeta:{name:'익명(가람).pdf',size:1000},
      pageModel:[{page_no:1,text:'감정평가의 목적\n본건은 표본개발공사에서 시행하는 「익명 도시개발사업」에 편입되는 토지에 대한 보상(사업인정 후 협의) 목적의 감정평가임.',items:[]}],
      parsed:{
        meta:{parse_status:'TEXT_PARSED',auto_confirmed:false},
        case:{case_name:'익명 도시개발사업',project_name:'익명 도시개발사업',price_date:'2025.11.01',review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:[]},
        appraisals:[{appraisal_id:'APP_001',appraisal_company:'',review_status_code:'MISSING',auto_confirmed:false,source_refs:[]}],
        lands:[],standard_lands:[],comp_cases:[],land_appraisal_results:[],subject_to_standard_factor_comparisons:[],subject_factor_total_candidates:[],other_factor_reviews:[],obstacle_summary_by_appraisal:[],obstacle_appraisal_results_sample:[],
      },
    });
  });
  const info=await page.evaluate(()=>window.BSOProductV2.store.state.caseInfo);
  expect(info.appraisal_purpose).toBe('보상(사업인정 후 협의)');
  expect(info.appraisal_purpose_origin).toBe('EXPLICIT_PAGE_TEXT');
  expect(info.auto_confirmed).toBe(false);
  expect(info.source_refs.some((ref)=>String(ref.raw_text_excerpt||'').includes('사업인정 후 협의'))).toBe(true);
  await page.locator('[data-route="case"]:visible').first().click();
  await expect(page.locator('main')).toContainText('보상(사업인정 후 협의)');
});
