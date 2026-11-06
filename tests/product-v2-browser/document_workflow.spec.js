'use strict';
const { test, expect } = require('@playwright/test');

test('문서 진행관리: 근거 입력, 수정 시 검수 해제, 사건별 분리', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-route="outputs"]:visible').first().click();
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
  await page.locator('[data-case-registry-top]').click();
  await page.locator('[data-case-new]').click();
  await page.locator('[data-route="outputs"]:visible').first().click();
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

test('파일 지문·n8n 작업요청·실행기록을 연결하고 파일 변경 시 승인을 해제한다', async ({ page }) => {
  const { createHash } = require('node:crypto');
  const fs = require('node:fs/promises');
  await page.goto('/');
  await page.evaluate(async () => {
    const { registerDocument } = await import('/document-workflow.js');
    const store = window.BSOProductV2.store;
    store.state.documentWorkflow = registerDocument([], { title:'합성 파일 검토',purpose:'내부',owner:'A',template_ref:'v1',source_ref:'합성 원본',actor:'A' });
    store.setRoute('outputs');
  });
  const article = page.locator('[data-doc-id]');
  async function openConnection() { await article.locator('summary').filter({hasText:'파일·n8n 실행 연결'}).click(); }
  async function attach(text) {
    const form = article.locator('[data-doc-artifact]');
    await form.locator('[name="actor"]').fill('기록자 A');
    await form.locator('input[type="file"]').setInputFiles({ name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from(text) });
    await form.locator('button').click();
  }
  await openConnection(); await attach('synthetic document');
  const hash = createHash('sha256').update('synthetic document').digest('hex');
  await expect(article).toContainText(hash);
  await openConnection();
  const requestForm=article.locator('[data-doc-handoff]');
  await requestForm.locator('[name="actor"]').fill('기록자 A');
  await requestForm.locator('[name="prompt"]').fill('Synthetic instructions only');
  const downloadPromise=page.waitForEvent('download');
  await requestForm.getByRole('button', {name:'n8n 작업요청 JSON 저장',exact:true}).click();
  const downloaded=await downloadPromise;
  const job=JSON.parse(await fs.readFile(await downloaded.path(),'utf8'));
  expect(job.status).toBe('READY');expect(job.bso_context.artifact_sha256).toBe(hash);
  const receipt={...job.bso_context,schema_version:'lk-bso-receipt/1.0',job_id:job.job_id,input_sha256:job.input_sha256,output_sha256:hash,execution_id:'SYNTHETIC_BROWSER_EXECUTION',status:'NEEDS_GPT_REVIEW',human_approved:false};
  await openConnection();
  const resultForm=article.locator('[data-doc-receipt]');
  await resultForm.locator('[name="actor"]').fill('기록자 A');
  await resultForm.locator('input[type="file"]').setInputFiles({name:'receipt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(receipt))});
  await resultForm.locator('button').click();
  await expect(article).toContainText('실행 기록 1건');
  await expect(article).toContainText('작성 중 · PARTIAL');
  await page.evaluate(() => {const row=window.BSOProductV2.store.state.documentWorkflow[0];if(Object.keys(row.checks).length)throw Error('AI receipt must not approve human checks');});
  await openConnection(); await attach('changed synthetic document');
  await expect(article).toContainText('v2');
  await expect(article).toContainText('작성 중 · PARTIAL');
});

test('결과 패키지는 본문 지문을 검증하고 HTML을 실행하지 않으며 백업에 본문을 남기지 않는다', async ({ page }) => {
  await page.goto('/');
  const bundle = await page.evaluate(async () => {
    const api = await import('/document-workflow.js'), store = window.BSOProductV2.store;
    let rows = api.registerDocument([], { title:'합성 결과 검토',purpose:'내부',owner:'A',template_ref:'v1',source_ref:'합성',actor:'A' });
    rows = api.attachDocumentArtifact(rows, rows[0].id, { name:'test.txt',size:4,sha256:'1'.repeat(64) }, 'A');
    const request = await api.createDocumentHandoff(rows, rows[0].id, 'Synthetic test only', 'SYNTHETIC', 'A');
    store.state.documentWorkflow = request.rows; store.setRoute('outputs');
    const output = '<img src=x onerror="window.__bsoResultXss=1"> 합성 결과';
    return { schema_version:'lk-bso-result/1.0',bso_receipt:{...request.job.bso_context,schema_version:'lk-bso-receipt/1.0',job_id:request.job.job_id,input_sha256:request.job.input_sha256,output_sha256:await api.sha256Bytes(new TextEncoder().encode(output)),execution_id:'SYNTHETIC_BROWSER_NO_MODEL',status:'NEEDS_GPT_REVIEW',human_approved:false},output,verification:{output_sha256_checked:true,provider_guard_passed:true,human_approved:false,legal_accuracy_approved:false} };
  });
  const article = page.locator('[data-doc-id]');
  await article.locator('summary').filter({ hasText:'파일·n8n 실행 연결' }).click();
  const form = article.locator('[data-doc-receipt]');
  await form.locator('[name="actor"]').fill('기록자 A');
  await form.locator('input[type="file"]').setInputFiles({name:'tampered.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...bundle,output:'tampered'}))});
  await form.locator('button').click();
  await expect(page.locator('[data-doc-message]')).toContainText('지문이 일치하지 않습니다');
  await expect(article.locator('[data-doc-result-preview]')).toHaveCount(0);
  await form.locator('input[type="file"]').setInputFiles({name:'result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
  await form.locator('button').click();
  await article.locator('summary').filter({ hasText:'파일·n8n 실행 연결' }).click();
  await expect(article.locator('[data-doc-result-preview]')).toContainText(bundle.output);
  await expect(article.locator('[data-doc-result-preview] img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__bsoResultXss)).toBeUndefined();
  expect(await page.evaluate(body => JSON.stringify(window.BSOProductV2.store.state).includes(body), bundle.output)).toBe(false);
  await expect(article).toContainText('작성 중 · PARTIAL');
  const historyLength = await page.evaluate(() => window.BSOProductV2.store.state.documentWorkflow[0].history.length);
  await page.evaluate(() => {
    const store = window.BSOProductV2.store;
    store.state = JSON.parse(JSON.stringify(store.state)); store.emit();
  });
  await expect(article.locator('[data-doc-result-preview]')).toHaveCount(0);
  await article.locator('summary').filter({ hasText:'파일·n8n 실행 연결' }).click();
  await form.locator('[name="actor"]').fill('기록자 A');
  await form.locator('input[type="file"]').setInputFiles({name:'same-result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
  await form.locator('button').click();
  await expect(page.locator('[data-doc-message]')).toContainText('다시 표시');
  await article.locator('summary').filter({ hasText:'파일·n8n 실행 연결' }).click();
  await expect(article.locator('[data-doc-result-preview]')).toContainText(bundle.output);
  expect(await page.evaluate(() => window.BSOProductV2.store.state.documentWorkflow[0].history.length)).toBe(historyLength);
  await page.evaluate(() => {
    const store = window.BSOProductV2.store;
    return import('/document-workflow.js').then(api => {store.state.documentWorkflow=api.changeDocument(store.state.documentWorkflow,'WORK_DOC_1','REVISE',{actor:'A',reference:'수정'});store.emit();});
  });
  await expect(article.locator('[data-doc-result-preview]')).toHaveCount(0);
});
