'use strict';
const {test,expect}=require('@playwright/test');

test('업무 시작은 키보드 PDF 등록과 명시적 사건 백업을 제공한다',async({page})=>{
  await page.goto('/');
  const upload=page.getByLabel('감정평가서 PDF 선택');
  await upload.focus();
  await expect(upload).toBeFocused();
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
