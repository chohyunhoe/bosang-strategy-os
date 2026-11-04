'use strict';

const { test, expect } = require('@playwright/test');

function parsed() {
  return {
    meta:{ parse_status:'TEXT_PARSED', auto_confirmed:false },
    case:{ case_name:'익명 PNU 사건' },
    appraisals:[{ appraisal_id:'APP_001', appraisal_company:'익명감정평가법인', review_status_code:'NEEDS_REVIEW', auto_confirmed:false }],
    lands:[{ land_id:'LAND_001', land_no:'1', parcel_address:'세종특별자치시 전동면 송선리 78-1', land_category:'대', area:100, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:[{page_no:1,source_label:'토지조서',raw_text_excerpt:'송선리 78-1'}] }],
    standard_lands:[{ standard_land_id:'STD_001', appraisal_id:'APP_001', standard_land_symbol:'A', parcel_address:'세종특별자치시 전동면 송선리 산3-1', land_category:'임야', official_price:38500, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:[{page_no:1,source_label:'비교표준지',raw_text_excerpt:'송선리 산3-1'}] }],
    comp_cases:[{ comp_case_id:'CASE_001', appraisal_id:'APP_001', case_symbol:'가', parcel_address:'세종특별자치시 전동면 송선리 90-2', land_category:'대', case_unit_price:120000, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:[{page_no:1,source_label:'거래사례',raw_text_excerpt:'송선리 90-2'}] }], land_appraisal_results:[{ appraisal_result_id:'LAR_001', appraisal_id:'APP_001', land_id:'LAND_001', standard_land_id:'STD_001', standard_land_symbol:'A', unit_price:100000, amount:10000000, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:[{page_no:1,source_label:'평가결과',raw_text_excerpt:'100000'}] }],
    subject_to_standard_factor_comparisons:[], subject_factor_total_candidates:[], other_factor_reviews:[], obstacle_summary_by_appraisal:[], obstacle_appraisal_results_sample:[], issue_candidates:[], draft_sentences:[], risk_warnings:[],
  };
}

async function inject(page) {
  await page.evaluate((data) => window.BSOProductV2.store.ingestDocument({
    fileMeta:{name:'anonymous.pdf',size:1000}, pageModel:[{page_no:1,text:'anonymous',items:[]}], parsed:data,
  }), parsed());
}

async function mockResolver(page) {
  await page.route('**/__public_data_bridge/status', async (route) => {
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, public_data_configured:true, public_data_key_form:'DECODED', vworld_configured:true, review_required:true, secrets_exposed:false }) });
  });
  await page.route('**/__public_data_bridge/resolve_pnu', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    expect(body.address_context).toContain('익명 PNU 사건');
    const mountain = /산3-1/.test(body.parcel_address || '');
    const appraisalCase = /90-2/.test(body.parcel_address || '');
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
      ok:true, status:'CANDIDATE_REVIEW_REQUIRED', review_required:true,
      candidate:{
        parcel_address:body.parcel_address,
        legal_dong_name:'세종특별자치시 전동면 송선리', legal_dong_code:'3611035025',
        lot_number:mountain ? '산3-1' : appraisalCase ? '90-2' : '78-1', pnu:mountain ? '3611035025200030001' : appraisalCase ? '3611035025100900002' : '3611035025100780001',
        origin:'MOIS_LEGAL_DONG_EXACT_OR_UNIQUE_SUFFIX', review_status_code:'NEEDS_REVIEW', auto_confirmed:false,
      },
    }) });
  });
}

test('PNU 후보는 생성만으로 CaseStore에 들어가지 않고 사용자가 적용해야 반영된다', async ({ page }) => {
  await mockResolver(page);
  await page.goto('/');
  await inject(page);
  await page.locator('[data-route="lands"]:visible').first().click();
  await expect(page.locator('[data-pnu-resolver]')).toBeVisible();
  await page.locator('[data-pnu-probe]').click();
  await expect(page.locator('[data-pnu-resolver]')).toContainText('AVAILABLE');
  await page.locator('[data-pnu-resolve]').click();
  await expect(page.locator('[data-pnu-apply]')).toHaveCount(3);

  const before = await page.evaluate(() => ({
    subject:window.BSOProductV2.store.state.lands[0].pnu || '',
    standard:window.BSOProductV2.store.state.standardLands[0].pnu || '',
  }));
  expect(before).toEqual({ subject:'', standard:'' });

  await page.locator('[data-pnu-apply="0"]').click();
  const afterFirst = await page.evaluate(() => ({
    subject:window.BSOProductV2.store.state.lands[0].pnu || '',
    standard:window.BSOProductV2.store.state.standardLands[0].pnu || '',
    origin:window.BSOProductV2.store.state.lands[0].pnu_origin,
    status:window.BSOProductV2.store.state.lands[0].pnu_review_status,
    auto:window.BSOProductV2.store.state.lands[0].auto_confirmed,
  }));
  expect(afterFirst.subject).toBe('3611035025100780001');
  expect(afterFirst.standard).toBe('');
  expect(afterFirst.origin).toBe('MOIS_LEGAL_DONG_EXACT_OR_UNIQUE_SUFFIX');
  expect(afterFirst.status).toBe('NEEDS_REVIEW');
  expect(afterFirst.auto).toBe(false);

  await page.locator('[data-pnu-apply="0"]').click();
  expect(await page.evaluate(() => window.BSOProductV2.store.state.standardLands[0].pnu)).toBe('3611035025200030001');
  await page.locator('[data-pnu-apply="0"]').click();
  expect(await page.evaluate(() => window.BSOProductV2.store.state.transactionCases[0].pnu)).toBe('3611035025100900002');
});

test('모바일에서도 동일한 PNU 후보 생성·적용 동작을 제공한다', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('webkit-390'), 'mobile PNU gate');
  await mockResolver(page);
  await page.goto('/');
  await inject(page);
  await page.locator('.mobile-bottom [data-route="lands"]').click();
  await expect(page.locator('[data-pnu-resolver]')).toBeVisible();
  await page.locator('[data-pnu-probe]').click();
  await page.locator('[data-pnu-resolve]').click();
  await expect(page.locator('[data-pnu-apply]')).toHaveCount(3);
  await page.locator('[data-pnu-apply="0"]').click();
  expect(await page.evaluate(() => window.BSOProductV2.store.state.lands[0].pnu)).toBe('3611035025100780001');
});
