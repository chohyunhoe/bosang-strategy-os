'use strict';
const { test, expect } = require('@playwright/test');

test('문서 진행관리: 근거 입력, 수정 시 검수 해제, 사건별 분리', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-route="outputs"]').first().click();
  let panel = page.locator('[data-document-workflow]');
  await expect(panel).toContainText('문서 진행관리');
  await panel.locator('summary').filter({ hasText: '문서 등록' }).click();
  const form = panel.locator('[data-doc-register]');
  for (const [key, value] of Object.entries({ title:'내부 검토문',purpose:'기관 제출 검토',owner:'담당자 A',template_ref:'공식서식 v1',source_ref:'원본 참조 A',actor:'기록자 A' })) await form.locator(`[name="${key}"]`).fill(value);
  await form.locator('button').click();
  let article = panel.locator('[data-doc-id]');
  await expect(article).toContainText('작성 중');
  async function record(action, actor = '검토자 A', reference = '검토메모 A') {
    const actionForm = article.locator('[data-doc-action]');
    await actionForm.locator('[name="actor"]').fill(actor);
    await actionForm.locator('[name="reference"]').fill(reference);
    await actionForm.locator('[name="action"]').selectOption(action);
    await actionForm.locator('button').click();
  }
  for (const check of ['SOURCE','NUMBERS','LEGAL','FORMAT']) await record(`CHECK:${check}`);
  await expect(article).toContainText('검수 기록 완료');
  await record('APPROVE', '승인자 A', '승인메모 A');
  await expect(article).toContainText('승인 기록');
  await expect(article).toContainText('PARTIAL');
  await record('SUBMIT', '제출자 A', '접수증 A');
  await expect(article).toContainText('제출 기록 · DONE');
  await record('REVISE', '작성자 A', '내용 변경 B');
  await expect(article).toContainText('v2');
  await expect(article).toContainText('작성 중 · PARTIAL');
  await expect(article.locator('select option[value="APPROVE"]')).toHaveCount(0);
  await page.locator('[data-route="home"]').first().click();
  await page.locator('[data-case-new]').click();
  await page.locator('[data-route="outputs"]').first().click();
  await expect(page.locator('[data-doc-id]')).toHaveCount(0);
});

test('문서 표시값은 HTML로 실행하지 않는다', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { registerDocument } = await import('/document-workflow.js');
    const store = window.BSOProductV2.store;
    store.state.documentWorkflow = registerDocument([], { title:'<img src=x onerror="window.__docXss=1">',purpose:'내부',owner:'A',template_ref:'v1',source_ref:'A',actor:'A' });
    store.setRoute('outputs');
  });
  await expect(page.locator('[data-document-workflow] img')).toHaveCount(0);
  await expect(page.locator('[data-document-workflow]')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__docXss)).toBeUndefined();
});
