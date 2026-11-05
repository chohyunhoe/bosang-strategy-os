'use strict';
const {test,expect}=require('@playwright/test');

test('업무 시작은 키보드 PDF 등록과 명시적 사건 백업을 제공한다',async({page})=>{
  await page.goto('/');
  const upload=page.getByLabel('감정평가서 PDF 선택');
  for(let step=0;step<24;step++){
    if(await upload.evaluate(node=>document.activeElement===node))break;
    await page.keyboard.press('Tab');
  }
  await expect(upload).toBeFocused();
  const chooserPromise=page.waitForEvent('filechooser');
  await upload.press('Space');
  await (await chooserPromise).setFiles([]);
  await expect(upload).toBeEnabled();
  await expect(page.locator('.upload')).toContainText('PDF 선택');
  await expect(page.locator('[data-case-import]')).toBeVisible();
  await expect(page.locator('[data-case-save]')).toBeVisible();
  await expect(page.locator('main')).toContainText('현재 탭 메모리에서만');
  for(const route of ['case','lands','valuation','obstacles','map','outputs']){
    await page.locator(`[data-route="${route}"]:visible`).first().click();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('[data-case-registry-top]')).toHaveCount(1);
    await expect(page.locator('[data-session-log-download]')).toHaveCount(1);
  }
  await expect(page.locator('[data-document-workflow]')).toHaveCount(1);
  await page.getByRole('button',{name:'보상전략 OS 홈',exact:true}).press('Enter');
  await expect(page.locator('.workspace-heading')).toContainText('원본을 검토자료로');
  await expect(page.locator('[data-case-registry]')).toHaveCount(1);
});

test('분석 중 새 사건·이동·파일 선택은 잠긴다',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>window.BSOProductV2.store.setStatus('PROCESSING'));
  await expect(page.locator('[data-upload]')).toBeDisabled();
  await expect(page.locator('[data-home]')).toBeDisabled();
  await expect(page.locator('[data-case-registry-top]')).toBeDisabled();
  await expect(page.locator('[data-case-new]')).toBeDisabled();
  await expect(page.locator('[data-review-workbench-launch]')).toBeDisabled();
  for(const button of await page.locator('[data-work-route]').all())await expect(button).toBeDisabled();
  await expect(page.locator('[data-case-import]')).toBeDisabled();
  await expect(page.locator('[data-route="lands"]:visible').first()).toBeDisabled();
});

test('좁은 화면에서 본문은 넘치지 않고 사건·홈 접근은 유지된다',async({page})=>{
  await page.goto('/');
  for(const route of ['home','case','lands','valuation','obstacles','map','outputs']){
    if(route!=='home')await page.locator(`[data-route="${route}"]:visible`).first().click();
    const width=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    expect(width.scroll).toBeLessThanOrEqual(width.client+1);
    await expect(page.locator('[data-home]')).toBeVisible();
    await expect(page.locator('[data-case-registry-top]')).toBeVisible();
  }
});

test('자료와 긴 사건명이 있어도 목록 직접열기·표·기능이 유지된다',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>window.BSOProductV2.store.ingestDocument({
    fileMeta:{name:'synthetic-ui.pdf',size:1000},pageModel:[{page_no:1,text:'synthetic',items:[]}],
    parsed:{meta:{parse_status:'TEXT_PARSED'},case:{case_name:'합성 사건 · 긴 사건명과 여러 원본을 검토하는 모바일 업무화면 검증'},
      appraisals:[{appraisal_id:'APP_001',appraisal_company:'합성법인'}],
      lands:[{land_id:'LAND_001',land_no:'101',parcel_address:'익명시 검증동 1-1',area:123.45,land_category:'대',source_refs:[{page_no:1,source_label:'합성 원본',raw_text_excerpt:'합성 토지조서'}]}],
      standard_lands:[],comp_cases:[],land_appraisal_results:[],subject_to_standard_factor_comparisons:[],subject_factor_total_candidates:[],other_factor_reviews:[],obstacle_summary_by_appraisal:[],obstacle_appraisal_results_sample:[]}
  }));
  await expect(page.locator('.next-task')).toBeVisible();
  await page.locator('[data-case-registry-top]').click();
  await expect(page.locator('.registry-list')).toHaveAttribute('open','');
  await expect(page.locator('[data-case-remove]')).toBeVisible();
  await expect(page.locator('[data-case-registry] h2')).toBeFocused();
  for(const route of ['case','lands','valuation','obstacles','map','outputs']){
    await page.locator(`[data-route="${route}"]:visible`).first().click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if(route==='case')await expect(page.locator('[data-reset-case]')).toBeVisible();
    if(route==='lands'){
      await expect(page.locator('main')).toContainText('123.45');
      const wrap=page.locator('.table-wrap').first();
      const widths=await wrap.evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth,viewport:innerWidth,position:getComputedStyle(node.querySelector('tbody td')).position}));
      if(widths.viewport<=900){expect(widths.scroll).toBeGreaterThan(widths.client);expect(widths.position).toBe('sticky');}
    }
  }
  await expect(page.locator('[data-document-workflow]')).toHaveCount(1);
});
