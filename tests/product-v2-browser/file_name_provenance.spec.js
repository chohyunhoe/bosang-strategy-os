'use strict';

const { test, expect } = require('@playwright/test');

test('원문에 법인명이 없으면 파일명 후보와 명시적 목적·기준시점을 검토상태로 보존한다', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.BSOProductV2.store.ingestDocument({
      fileMeta: { name: '익명소유자(경일)(20260822-010821).pdf', size: 1000 },
      pageModel: [{ page_no: 1, text: '본건은 익명사업에 편입되는 토지에 대한 사업인정 후의 보상(협의) 목적의 감정평가임.', items: [] }],
      parsed: {
        meta: { parse_status: 'TEXT_PARSED', auto_confirmed: false },
        case: {
          case_name: '익명 사건', project_name: '익명사업', base_date: '2025.11.01',
          review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
          source_refs: [{ page_no:1, source_label:'기본정보', raw_text_excerpt:'기준시점 2025.11.01' }],
        },
        appraisals: [{ appraisal_id: 'APP_001', appraisal_company: '', valuation_date:'2025.11.01', review_status_code: 'MISSING', auto_confirmed: false, source_refs: [{ page_no:1, source_label:'기본정보', raw_text_excerpt:'기준시점 2025.11.01' }] }],
        lands: [], standard_lands: [], comp_cases: [], land_appraisal_results: [],
        subject_to_standard_factor_comparisons: [], subject_factor_total_candidates: [],
        other_factor_reviews: [], obstacle_summary_by_appraisal: [], obstacle_appraisal_results_sample: [],
      },
    });
  });

  const snapshot = await page.evaluate(() => window.BSOProductV2.store.snapshot());
  const appraisal = snapshot.appraisals[0];
  expect(appraisal.appraisal_company).toBe('경일');
  expect(appraisal.appraisal_company_origin).toBe('FILE_NAME');
  expect(appraisal.appraisal_company_review_status).toBe('NEEDS_REVIEW');
  expect(appraisal.auto_confirmed).toBe(false);
  expect(snapshot.caseInfo.price_date).toBe('2025.11.01');
  expect(snapshot.caseInfo.price_date_origin).toBe('EXPLICIT_BASE_DATE_ALIAS');
  expect(snapshot.caseInfo.appraisal_purpose).toBe('보상(협의)');
  expect(snapshot.caseInfo.appraisal_purpose_origin).toBe('EXPLICIT_PAGE_TEXT');
  expect(snapshot.caseInfo.auto_confirmed).toBe(false);
  expect(snapshot.reviewQueue.some((item) => item.review_id === 'GROUP:caseInfo')).toBe(true);
  expect(snapshot.reviewQueue.some((item) => item.review_id === 'GROUP:appraisals')).toBe(true);

  await page.locator('[data-route="case"]:visible').first().click();
  await expect(page.locator('main')).toContainText('경일');
  await expect(page.locator('main')).toContainText('NEEDS_REVIEW');
  await expect(page.locator('main')).toContainText('보상(협의)');
  await expect(page.locator('main')).toContainText('2025.11.01');

  await page.locator('[data-review-workbench-launch]').click();
  await expect(page.locator('.review-workbench-card h3')).toHaveText('사건 기본정보');
  await expect(page.locator('.review-workbench-preview').first()).toContainText('보상(협의)');
  await page.locator('.review-workbench-next').click();
  await expect(page.locator('.review-workbench-card h3')).toHaveText('평가법인');
  await expect(page.locator('.review-workbench-preview').first()).toContainText('경일');
  await expect(page.locator('.review-workbench-preview').first()).toContainText('FILE_NAME');
});
