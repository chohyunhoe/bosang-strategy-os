'use strict';

const { test, expect } = require('@playwright/test');

const ref = (label) => [{ page_no:1, source_label:label, raw_text_excerpt:`${label} 익명 원문` }];
function parsed() {
  return {
    meta:{ parse_status:'TEXT_PARSED', auto_confirmed:false },
    case:{ case_name:'익명 전체검수 사건', project_name:'익명 전체검수 사건', base_date:'2025.11.01', review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('기본정보') },
    appraisals:[{ appraisal_id:'APP_001', appraisal_company:'익명감정평가법인', valuation_date:'2025.11.01', review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('평가법인') }],
    lands:[{ land_id:'LAND_001', land_no:'1', parcel_address:'익명시 검수동 1-1', land_category:'대', area:100, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('토지조서') }],
    standard_lands:[{ standard_land_id:'STD_001', appraisal_id:'APP_001', standard_land_symbol:'A', parcel_address:'익명시 검수동 2-1', land_category:'대', official_price:100000, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('비교표준지') }],
    comp_cases:[],
    land_appraisal_results:[{ appraisal_result_id:'LAR_001', appraisal_id:'APP_001', land_id:'LAND_001', standard_land_id:'STD_001', standard_land_symbol:'A', official_price:100000, time_correction:1.01, regional_factor:1, individual_factor_total:0.95, other_factor:1.2, calculated_unit_price:115140, unit_price:115000, amount:11500000, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('평가결과') }],
    subject_to_standard_factor_comparisons:[],
    subject_factor_total_candidates:[{ factor_total_id:'SFT_001', appraisal_id:'APP_001', land_id:'LAND_001', standard_land_symbol:'A', total_factor:0.95, detail_status:'TOTAL_ONLY', review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('개별요인 누계') }],
    other_factor_reviews:[{ other_factor_review_id:'OFR_001', appraisal_id:'APP_001', standard_land_symbol:'A', decided_other_factor:1.2, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('그 밖의 요인') }],
    obstacle_summary_by_appraisal:[], obstacle_appraisal_results_sample:[], issue_candidates:[], draft_sentences:[], risk_warnings:[],
  };
}

async function inject(page) {
  await page.evaluate((data) => window.BSOProductV2.store.ingestDocument({
    fileMeta:{name:'anonymous.pdf',size:1000}, pageModel:[{page_no:1,text:'anonymous',items:[]}], parsed:data,
  }), parsed());
}

test('전체검수는 사건부터 실무그룹을 1건씩 보여주고 값·원문근거·수정·확인·보류·다음이 동작한다', async ({ page }) => {
  await page.goto('/');
  await inject(page);
  const before = await page.evaluate(() => window.BSOProductV2.store.state.reviewQueue.filter((item) => item.status !== 'CONFIRMED').length);
  expect(before).toBeGreaterThan(4);
  await expect(page.locator('[data-review-workbench-launch]')).toBeVisible();
  await expect(page.locator('[data-review-workbench-launch]')).toContainText(String(before));

  await page.locator('[data-review-workbench-launch]').click();
  await expect(page.locator('[data-review-workbench]')).toBeVisible();
  await expect(page.locator('.review-workbench-progress')).toHaveText(`1 / ${before}`);
  await expect(page.locator('.review-workbench-card h3')).toHaveText('사건 기본정보');
  await expect(page.locator('.review-workbench-preview').first()).toContainText('익명 전체검수 사건');
  await expect(page.locator('.review-workbench-preview').first()).toContainText('기준시점 2025.11.01');
  await expect(page.locator('.review-workbench-preview').first()).toContainText('기본정보 · p.1');
  await expect(page.locator('.review-workbench-preview').first()).toContainText('기본정보 익명 원문');
  await expect(page.locator('[data-review-workbench]')).not.toContainText('{"field"');
  await expect(page.locator('[data-review-workbench]')).not.toContainText('mobile-review-router');

  await page.locator('[data-review-edit="0"]').click();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.inspector [data-key="case_name"]')).toHaveValue('익명 전체검수 사건');
  await page.locator('.inspector [data-key="case_name"]').fill('익명 수정 사건');
  await page.locator('.inspector-save').click();
  expect(await page.evaluate(() => window.BSOProductV2.store.state.caseInfo.case_name)).toBe('익명 수정 사건');
  expect(await page.evaluate(() => window.BSOProductV2.store.state.reviewQueue.find((item) => item.review_id === 'GROUP:caseInfo').status)).toBe('NEEDS_REVIEW');

  const firstLabel = await page.locator('.review-workbench-card h3').innerText();
  await page.locator('.review-workbench-next').click();
  await expect(page.locator('.review-workbench-progress')).toHaveText(`2 / ${before}`);
  const secondLabel = await page.locator('.review-workbench-card h3').innerText();
  expect(secondLabel).not.toBe(firstLabel);
  await expect(page.locator('.review-workbench-preview').first()).toContainText('익명감정평가법인');

  await page.locator('.review-workbench-hold').click();
  const held = await page.evaluate(() => Object.values(window.BSOProductV2.store.state.reviewDecisions).some((row) => row.status === 'HOLD'));
  expect(held).toBe(true);

  const pendingBeforeConfirm = await page.evaluate(() => window.BSOProductV2.store.state.reviewQueue.filter((item) => item.status !== 'CONFIRMED').length);
  await page.locator('.review-workbench-confirm').click();
  const pendingAfterConfirm = await page.evaluate(() => window.BSOProductV2.store.state.reviewQueue.filter((item) => item.status !== 'CONFIRMED').length);
  expect(pendingAfterConfirm).toBe(pendingBeforeConfirm - 1);
  await expect(page.locator('[data-review-workbench]')).toBeVisible();
});

test('상세화면은 전체검수를 닫고 해당 실무 화면으로 이동한다', async ({ page }) => {
  await page.goto('/');
  await inject(page);
  await page.locator('[data-review-workbench-launch]').click();
  const route = await page.evaluate(() => window.BSOProductV2.reviewWorkbench.pending()[0].route);
  await page.locator('.review-workbench-open').click();
  await expect(page.locator('[data-review-workbench]')).toHaveCount(0);
  expect(await page.evaluate(() => window.BSOProductV2.store.state.route)).toBe(route);
});

test('누락 평가행은 4필지/4상태행으로 보존되고 실제 blocker와 수동 입력 경로를 표시한다', async ({ page }) => {
  await page.goto('/');
  const fixture = parsed();
  fixture.lands.push({ land_id:'LAND_002', land_no:'2', parcel_address:'익명시 검수동 1-2', land_category:'대', area:120, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:ref('토지조서2') });
  await page.evaluate((data) => window.BSOProductV2.store.ingestDocument({ fileMeta:{name:'anonymous.pdf',size:1000}, pageModel:[{page_no:1,text:'anonymous',items:[]}], parsed:data }), fixture);

  const state = await page.evaluate(() => {
    const store=window.BSOProductV2.store;
    const group=store.state.reviewQueue.find((item)=>item.collection==='appraisalResults');
    return { stats:store.stats(), group, result:store.decide(group.review_id,'CONFIRMED') };
  });
  expect(state.stats.lands).toBe(2);
  expect(state.stats.appraisalResults).toBe(2);
  expect(state.group.confirmable).toBe(false);
  expect(state.group.blocked_reason).toContain('평가결과 누락 1필지');
  expect(state.result.ok).toBe(false);

  await expect(page.locator('.card').filter({hasText:'실행보드'}).first()).toContainText('평가결과 누락 1필지 확인');
  await page.evaluate(() => window.BSOProductV2.store.setRoute('valuation'));
  await expect(page.locator('main')).toContainText('평가결과 누락 1필지');
  await expect(page.locator('main')).toContainText('평가행 누락');
  await page.locator('table tbody tr').nth(1).locator('button', {hasText:'원문·수정'}).click();
  await page.locator('.inspector [data-key="unit_price"]').fill('120000');
  await page.locator('.inspector [data-key="amount"]').fill('14400000');
  await page.locator('.inspector-save').click();

  const resolved = await page.evaluate(() => {
    const store=window.BSOProductV2.store;
    const row=store.state.appraisalResults.find((item)=>item.land_id==='LAND_002');
    const group=store.state.reviewQueue.find((item)=>item.collection==='appraisalResults');
    return { status:row.subject_link_status, confirmable:group.confirmable, action:document.body.innerText };
  });
  expect(resolved.status).toBe('MANUALLY_LINKED_REVIEW_REQUIRED');
  expect(resolved.confirmable).toBe(true);
  await expect(page.locator('main')).not.toContainText('평가결과 누락 1필지');
});

test('지도에서 사용할 수 없는 비교표준지 소재지는 검수완료되지 않고 수정 이유를 표시한다', async ({ page }) => {
  await page.goto('/');
  const fixture=parsed();
  fixture.standard_lands[0].standard_land_symbol='가';
  fixture.standard_lands[0].parcel_address='B98 전 전 계획관리 993.0 94000 세로(가) 지구외';
  await page.evaluate((data) => window.BSOProductV2.store.ingestDocument({ fileMeta:{name:'anonymous.pdf',size:1000}, pageModel:[{page_no:1,text:'anonymous',items:[]}], parsed:data }), fixture);

  const blocked=await page.evaluate(() => {
    const store=window.BSOProductV2.store;
    const group=store.state.reviewQueue.find((item)=>item.collection==='standardLands');
    return { group, decision:store.decide(group.review_id,'CONFIRMED') };
  });
  expect(blocked.group.confirmable).toBe(false);
  expect(blocked.group.blocked_reason).toContain('비교표준지 위치 확인 필요 1건 (가)');
  expect(blocked.decision.ok).toBe(false);

  await page.locator('[data-review-workbench-launch]').click();
  await page.evaluate(() => {
    const workbench=window.BSOProductV2.reviewWorkbench;
    const index=workbench.pending().findIndex((item)=>item.collection==='standardLands');
    workbench.open(index);
  });
  await expect(page.locator('.review-workbench-blocked')).toContainText('실제 소재지 또는 검증된 19자리 PNU');
  await expect(page.locator('.review-workbench-confirm')).toHaveText('확인 불가');
  await expect(page.locator('.review-workbench-confirm')).toBeDisabled();

  const resolved=await page.evaluate(() => {
    const store=window.BSOProductV2.store;
    const targetId=store.state.standardLands[0].standard_land_id;
    store.updateRecord('standardLands',(row)=>row.standard_land_id===targetId,{parcel_address:'익명시 검수동 2-1'});
    return store.state.reviewQueue.find((item)=>item.collection==='standardLands');
  });
  expect(resolved.confirmable).toBe(true);
});

test('pending=0이면 검수 버튼이 완료 상태를 명확히 표시하고 완료 화면을 연다', async ({ page }) => {
  await page.goto('/');
  await inject(page);
  const pending = await page.evaluate(() => {
    const store=window.BSOProductV2.store;
    for (const item of [...store.state.reviewQueue]) if (item.confirmable !== false) store.decide(item.review_id,'CONFIRMED');
    return store.state.reviewQueue.filter((item)=>item.status!=='CONFIRMED').length;
  });
  expect(pending).toBe(0);
  const launcher=page.locator('[data-review-workbench-launch]');
  await expect(launcher).toBeEnabled();
  await expect(launcher).toHaveAttribute('data-review-state','complete');
  await expect(launcher).toHaveText('검수 완료 ✓');
  await launcher.click();
  await expect(page.locator('[data-review-workbench]')).toContainText('검수가 완료되었습니다.');
  await expect(page.locator('[data-review-workbench]')).toContainText('남은 검토 항목이 없습니다');
});

test('모바일 전체검수도 동일 reviewQueue와 값·근거·수정·액션을 사용한다', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('webkit-390'), 'mobile full-review gate');
  await page.goto('/');
  await inject(page);
  await page.locator('[data-review-workbench-launch]').click();
  await expect(page.locator('[data-review-workbench]')).toBeVisible();
  await expect(page.locator('.review-workbench-actions')).toBeVisible();
  await expect(page.locator('.review-workbench-actions button')).toHaveCount(4);
  await expect(page.locator('.review-workbench-card')).toBeVisible();
  await expect(page.locator('.review-workbench-preview').first()).toContainText('기본정보 익명 원문');
  await expect(page.locator('[data-review-edit="0"]')).toBeVisible();
  const box = await page.locator('.review-workbench').boundingBox();
  expect(box.width).toBeGreaterThan(360);
  expect(box.height).toBeGreaterThan(760);
});
