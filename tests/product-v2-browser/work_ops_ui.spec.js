'use strict';

const { test, expect } = require('@playwright/test');

test('현장선별·신규사업·RTMS·건축물대장은 한 v2 화면에서 실행된다', async ({ page }) => {
  await page.route('**/__public_data_bridge/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/status')) {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, public_data_configured:true, vworld_configured:false, capabilities:{ FIELD_CANDIDATES:true, EARLY_SIGNAL:true, RTMS:true, BUILDING_LEDGER:true }, secrets_exposed:false }) });
      return;
    }
    if (path.endsWith('/field_candidates')) {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'DONE_REVIEW_REQUIRED', total:3, field_active:2, priority_counts:{P1:1,P4:1,P5:1,REVIEW:0}, candidates:[
        {priority:'P1',candidate_type:'주유소·연료',field_status:'FIELD_ACTIVE',pnu:'4139013200108760359',jibun_address:'경기도 시흥시 정왕동 876-359',business_count:2,business_names:'익명 주유소',next_check:'영업·설비·인허가·진출입 현황 확인'},
        {priority:'P4',candidate_type:'화훼·원예',field_status:'FIELD_ACTIVE',pnu:'4139013200108760374',jibun_address:'경기도 시흥시 정왕동 876-374',business_count:3,business_names:'익명 화훼 3곳',next_check:'영업주체 수·시설재배 확인'},
        {priority:'P5',candidate_type:'일반 영업시설',field_status:'REVIEW',pnu:'4139013200108760175',jibun_address:'경기도 시흥시 정왕동 876-175',business_count:1,business_names:'익명 음식점',next_check:'현재 전략상 후순위'},
      ], failures:[], csv_base64:'QQ==', csv_file_name:'field.csv', review_required:true, auto_confirmed:false }) });
      return;
    }
    if (path.endsWith('/early_signals')) {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true,status:'DONE_REVIEW_REQUIRED',signals:[{stage:'BID_NOTICE'}],monitoring_rows:[{'단계':'BID_NOTICE','공고명':'공공주택 보상업무 용역','발주기관':'익명기관','지역':'경기','일자':'20260822','일치키워드':'보상','상태':'확인 필요'}],failures:[],csv_base64:'QQ==',csv_file_name:'signals.csv',review_required:true,auto_confirmed:false }) });
      return;
    }
    if (path.endsWith('/rtms')) {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true,status:'DONE_REVIEW_REQUIRED',records:[{trade_type:'LAND',legal_dong_nm:'정왕동',contract_date:'2026-07-01',land_category:'대',zoning:'일반공업지역',land_area_m2:500,deal_amount_won:1500000000,unit_price_won_m2:3000000,review_required:true}],failures:[],csv_base64:'QQ==',csv_file_name:'rtms.csv',review_required:true,auto_confirmed:false }) });
      return;
    }
    if (path.endsWith('/building')) {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true,status:'DONE_REVIEW_REQUIRED',pnu:'4139013200108760359',records:{TITLE:[{bld_nm:'익명건물',main_purps_nm:'제2종근린생활시설',tot_area:321.5,arch_area:180,grnd_flr_cnt:2,ugrnd_flr_cnt:0}],BASIS:[],JIJIGU:[]},failures:[],review_required:true,auto_confirmed:false }) });
      return;
    }
    await route.fulfill({ status:422, contentType:'application/json', body:JSON.stringify({ok:false,error_code:'TEST_UNHANDLED'}) });
  });

  await page.goto('/');
  await expect(page.locator('[data-work-ops-home]')).toContainText(process.env.BSO_RELEASE_V1 === '1' ? '업무 바로가기' : '월요일 바로 쓰는 BSO');
  await page.locator('[data-work-route="map"]').first().click();
  await expect(page.locator('[data-work-ops-panel]')).toContainText('현장선별 · 신규사업 · 거래사례 · 공부대조');

  await page.locator('[data-field-sigungu]').fill('41390');
  await page.locator('[data-field-run]').click();
  await expect(page.locator('[data-work-ops-panel]')).toContainText('FIELD_ACTIVE 2');
  await expect(page.locator('[data-work-ops-panel]')).toContainText('익명 주유소');
  await expect(page.locator('[data-work-ops-panel]')).toContainText('P1');
  await expect(page.locator('[data-work-ops-panel]')).toContainText('P4');

  await page.locator('[data-signal-run]').click();
  await expect(page.locator('[data-work-ops-panel]')).toContainText('공공주택 보상업무 용역');
  await expect(page.locator('[data-work-ops-panel]')).toContainText('확인 필요');

  await page.locator('[data-rtms-lawd]').fill('41390');
  await page.locator('[data-rtms-run]').click();
  await expect(page.locator('[data-work-ops-panel]')).toContainText('일반공업지역');
  await expect(page.locator('[data-work-ops-panel]')).toContainText('1,500,000,000');

  await page.locator('[data-building-pnu]').fill('4139013200108760359');
  await page.locator('[data-building-run]').click();
  await expect(page.locator('[data-work-ops-panel]')).toContainText('제2종근린생활시설');
  await expect(page.locator('[data-work-ops-panel]')).toContainText('검토필요');
});
