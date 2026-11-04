'use strict';

const { test, expect } = require('@playwright/test');

// 신규사업 모니터링(발견·선별) → BSO Pre-Field 사전분석키트(현장 실행용 분석) 인계 경로.
test('모니터링 선별결과로 Pre-Field 키트를 만들고 쟁점 구분을 유지한다', async ({ page }) => {
  await page.route('**/__public_data_bridge/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, public_data_configured:true, vworld_configured:false, capabilities:{ FIELD_CANDIDATES:true, EARLY_SIGNAL:true, RTMS:true, BUILDING_LEDGER:true }, secrets_exposed:false }) });
      return;
    }
    if (path.endsWith('/early_signals')) {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'DONE_REVIEW_REQUIRED', signals:[{stage:'BID_NOTICE'}], monitoring_rows:[
        { '구분':'EARLY_SIGNAL','단계':'BID_NOTICE','공고명':'익명 공공주택지구 보상업무 용역','발주기관':'익명 공사','지역':'익명도','일자':'20260901','상태':'확인 필요' },
      ], failures:[], csv_base64:'QQ==', csv_file_name:'signals.csv', review_required:true, auto_confirmed:false }) });
      return;
    }
    if (path.endsWith('/field_candidates')) {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'DONE_REVIEW_REQUIRED', total:1, field_active:1, priority_counts:{P1:1,P4:0,P5:0,REVIEW:0}, candidates:[
        { priority:'P1', candidate_type:'주유소·연료', field_status:'FIELD_ACTIVE', jibun_address:'익명시 샘플동 200-1', business_count:2, business_names:'익명 주유소', next_check:'영업·설비·인허가·진출입 현황 확인', source_dataset:'소상공인 상가정보', in_boundary:null },
      ], failures:[], csv_base64:'QQ==', csv_file_name:'field.csv', review_required:true, auto_confirmed:false }) });
      return;
    }
    await route.fulfill({ status:422, contentType:'application/json', body:JSON.stringify({ ok:false, error_code:'TEST_UNHANDLED' }) });
  });

  await page.goto('/');
  await page.locator('[data-work-route="map"]').first().click();
  const kitCard = page.locator('[data-pre-field-kit]');
  await expect(kitCard).toContainText('사전분석키트 v0.2');

  // 사업명 없이 선별결과도 없으면 생성하지 않는다.
  await page.locator('[data-pf-run]').click();
  await expect(kitCard).toContainText('모니터링 선별결과를 선택하거나 사업명을 입력하세요.');

  await page.locator('[data-signal-run]').click();
  await expect(page.locator('[data-work-ops-panel]')).toContainText('익명 공공주택지구 보상업무 용역');
  await page.locator('[data-field-sigungu]').fill('41390');
  await page.locator('[data-field-run]').click();
  await expect(page.locator('[data-work-ops-panel]')).toContainText('익명 주유소');

  await page.locator('[data-pf-signal]').selectOption('0');
  await page.locator('[data-pf-stage]').fill('지구지정 고시');
  await page.locator('[data-pf-source]').fill('익명 공공주택지구 지구지정 고시(2026-08-20)');
  await page.locator('[data-pf-surroundings]').fill('도로 | 익명 국도 | 사업지 북측 접면 | 공람도면\n마을 | 샘플리 취락 | 사업지 남측 인접');
  await page.locator('[data-pf-contacts]').fill('마을회관 | 샘플리 마을회관 | 샘플동 150 | 지자체 공개자료\n인물 | 이장 연락처');
  await page.locator('[data-pf-issues]').fill('보상 지연에 대해 주민들이 즉각 보상을 요구하고 있습니다. | 시행자 보도자료(2026-09-01)\n출처 없는 주장이 제기되었습니다.\n지구계획이 승인되었습니다. | 보도자료(2024-12-30)');
  await page.locator('[data-pf-run]').click();

  // v0.2.1. 현장카드가 상세근거보다 먼저 나온다.
  const cardText = await kitCard.innerText();
  expect(cardText.indexOf('오늘의 목표')).toBeGreaterThan(-1);
  expect(cardText.indexOf('오늘의 목표')).toBeLessThan(cardText.indexOf('1. 사업 Snapshot'));
  await expect(kitCard.locator('[data-pf-field-card]')).toContainText('오늘의 종료기준');
  await expect(kitCard.locator('[data-pf-field-card]')).toContainText('핵심 질문');
  await expect(kitCard.locator('[data-pf-field-card]')).toContainText('오늘의 방문동선');
  await expect(kitCard.locator('[data-pf-field-card]')).not.toContainText('SOURCE_STATED');
  await expect(kitCard).toContainText('상세근거');

  await expect(kitCard).toContainText('1. 사업 Snapshot');
  await expect(kitCard).toContainText('현장검토 필요');
  await expect(kitCard).toContainText('EARLY_SIGNAL_PENDING_REVIEW');
  await expect(kitCard).toContainText('미확인');
  await expect(kitCard).toContainText('2. 경계·Target Map');
  await expect(kitCard).toContainText('익명시 샘플동 200-1');
  await expect(kitCard).toContainText('특수이용');
  await expect(kitCard).toContainText('3. 접촉거점');
  await expect(kitCard).toContainText('샘플리 마을회관');
  await expect(kitCard).toContainText('4. 쟁점');
  await expect(kitCard).toContainText('[확인쟁점]');
  await expect(kitCard).toContainText('[BSO 추정쟁점/현장검증 필요]');
  await expect(kitCard).toContainText('SOURCE_MISSING_NOT_CONFIRMED_ISSUE');
  // P1-4. 사업현황 서술은 확인쟁점으로 올리지 않고 Snapshot 으로 되돌린다.
  await expect(kitCard).toContainText('확인쟁점에서 사업현황으로 되돌린 항목');
  await expect(kitCard).toContainText('PROJECT_STATUS_NOT_ISSUE');

  // P1-2. Mission 은 방문장소·목적·확인질문·종료기준을 갖는다.
  await expect(kitCard).toContainText('5. Field Mission');
  await expect(kitCard).toContainText('방문장소:');
  await expect(kitCard).toContainText('확인질문:');
  await expect(kitCard).toContainText('종료기준:');
  await expect(kitCard).toContainText('G1 종료기준');
  // 지구지정 단계이므로 오늘의 종료기준도 그 단계 기준으로 나온다.
  await expect(kitCard).toContainText('거점 접촉 1건');
  await expect(kitCard).not.toContainText('사업지 일원');
  await expect(kitCard).toContainText('판정하지 않습니다');

  // 인물정보로 입력된 줄은 거점 목록에 들어가지 않는다(입력란 원문은 그대로 남는다).
  const contactBlock = kitCard.locator('.pf-block').filter({ has: page.locator('h4', { hasText: '3. 접촉거점' }) });
  await expect(contactBlock).toContainText('샘플리 마을회관');
  await expect(contactBlock).not.toContainText('이장');
  await expect(contactBlock).toContainText('접촉거점은 장소·단체만 기재합니다');

  // 기존 업무도구는 같은 화면에서 그대로 동작한다.
  await expect(page.locator('[data-work-ops-panel]')).toContainText('현장선별 · 신규사업 · 거래사례 · 공부대조');
  await expect(page.locator('[data-rtms-lawd]')).toBeVisible();
  await expect(page.locator('[data-building-pnu]')).toBeVisible();
});
