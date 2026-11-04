'use strict';

const { test, expect } = require('@playwright/test');

const ref = (label) => [{ page_no:1, source_label:label, raw_text_excerpt:`${label} 익명 원문` }];

async function inject(page) {
  await page.evaluate(() => {
    const ref = (label) => [{ page_no:1, source_label:label, raw_text_excerpt:`${label} 익명 원문` }];
    window.BSOProductV2.store.ingestDocument({
      fileMeta:{name:'anonymous.pdf',size:1000},
      pageModel:[{page_no:1,text:'anonymous',items:[]}],
      parsed:{
        meta:{parse_status:'TEXT_PARSED',auto_confirmed:false},
        case:{case_name:'모바일 표 UX 검증'},
        appraisals:[{appraisal_id:'APP_001',appraisal_company:'익명감정평가법인',review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('평가법인')}],
        lands:[
          {land_id:'LAND_001',land_no:'113',parcel_address:'익명시 긴주소동 78-1',land_category:'대',area:479,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('토지조서')},
          {land_id:'LAND_002',land_no:'116',parcel_address:'익명시 긴주소동 78-4',land_category:'전',area:612,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('토지조서')},
        ],
        standard_lands:[
          {standard_land_id:'STD_001',appraisal_id:'APP_001',standard_land_symbol:'가',parcel_address:'익명시 긴주소동 151',land_category:'전',use_status:'전',zoning:'계획관리지역',official_price:137000,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('비교표준지')},
        ],
        comp_cases:[
          {comp_case_id:'CASE_001',appraisal_id:'APP_001',case_symbol:'B',case_date:'2021-03-13',parcel_address:'익명시 긴주소동 409',land_category:'전',zoning:'계획관리지역',case_unit_price:514227,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('사례')},
        ],
        land_appraisal_results:[
          {appraisal_result_id:'LAR_001',appraisal_id:'APP_001',land_id:'LAND_001',standard_land_symbol:'가',official_price:137000,time_correction:1.10575,regional_factor:1,individual_factor_total:.711,other_factor:4.5,calculated_unit_price:842008,unit_price:842000,amount:403318000,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('평가결과')},
        ],
        subject_to_standard_factor_comparisons:[],subject_factor_total_candidates:[],other_factor_reviews:[],obstacle_summary_by_appraisal:[],obstacle_appraisal_results_sample:[],issue_candidates:[],draft_sentences:[],risk_warnings:[],
      },
    });
  });
}

test('모바일 넓은 표는 첫 열을 고정하고 수평 스크롤이 실제 가능하다', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('webkit-390'), 'mobile-only affordance gate');
  await page.goto('/');
  await inject(page);
  await page.locator('.mobile-bottom [data-route="lands"]').click();
  const wrap = page.locator('.table-wrap').first();
  await expect(wrap).toBeVisible();
  const metrics = await wrap.evaluate((node) => ({
    clientWidth:node.clientWidth,
    scrollWidth:node.scrollWidth,
    overflowX:getComputedStyle(node).overflowX,
    shadow:getComputedStyle(node).boxShadow,
    firstCellPosition:getComputedStyle(node.querySelector('tbody td:first-child')).position,
    firstCellLeft:getComputedStyle(node.querySelector('tbody td:first-child')).left,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(['auto','scroll']).toContain(metrics.overflowX);
  expect(metrics.shadow).not.toBe('none');
  expect(metrics.firstCellPosition).toBe('sticky');
  expect(metrics.firstCellLeft).toBe('0px');

  await wrap.evaluate((node) => {
    node.scrollTo({ left: Math.max(40, node.scrollWidth - node.clientWidth), behavior: 'instant' });
  });
  await expect.poll(() => wrap.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await expect(page.locator('.table-wrap tbody td:first-child').first()).toContainText('113');
});
