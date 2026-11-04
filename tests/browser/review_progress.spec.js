'use strict';

const { test, expect } = require('@playwright/test');
const { enterLegacyFullScreen } = require('./legacy_navigation');

test('전체 검수 시작 shows stage progress and leaves a completion result', async ({ page }) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') {
      externalRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await enterLegacyFullScreen(page);
  await expect.poll(async () => page.evaluate(() => Boolean(window.__bsoReviewProgress))).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__bsoReviewProgress && window.__bsoReviewProgress.contractVersion)).toBe('review-progress/0.1');

  await page.evaluate(() => {
    data.document_uploads = [{
      upload_id: 'UPLOAD_REVIEW_001',
      file_name: 'anonymous-review.pdf',
      extraction_status: 'CANDIDATES_READY',
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
    }];
    data['00_extract_staging'] = [{
      staging_id: 'STAGE_UPLOAD_REVIEW_001',
      upload_id: 'UPLOAD_REVIEW_001',
      file_name: 'anonymous-review.pdf',
      extraction_status: 'CANDIDATES_READY',
      extracted_text_length: 500,
      page_texts: [{ page_no: 1, text: '익명 평가서 검수용 텍스트' }],
      extraction_candidates: [],
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
    }];
    data['00_extraction_candidates'] = [{
      candidate_id: 'CAND_REVIEW_001',
      upload_id: 'UPLOAD_REVIEW_001',
      source_upload_id: 'UPLOAD_REVIEW_001',
      candidate_type: 'REVIEW_NOTE',
      core_field_key: 'other_factor',
      core_field_label: '그 밖의 요인 보정치',
      parsed_value: { field: '그 밖의 요인 보정치', value: '', reason: '필수 필드 미추출' },
      confidence_level: 'LOW',
      review_status_code: 'NEEDS_REVIEW',
      candidate_generation_status: 'MISSING_REQUIRED_FIELD',
      review_reason: '필수 필드 미추출',
      priority: 1,
      next_action: '필수 필드 미추출',
      auto_confirmed: false,
    }];
    data.lands = [{
      land_id: 'LAND_REVIEW_001', parcel_address: '익명시 샘플동 1-1', land_category: '전', area: 480,
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }];
    data.land_appraisal_results = [{
      appraisal_result_id: 'LAR_REVIEW_001', appraisal_id: 'APP_REVIEW_001', land_id: 'LAND_REVIEW_001',
      parcel_address: '익명시 샘플동 1-1', land_category: '전', area: 480, unit_price: 250000, amount: 120000000,
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }];
    data.appraisals = [{
      appraisal_id: 'APP_REVIEW_001', appraisal_company: '익명감정평가법인', file_name: 'anonymous-review.pdf',
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }];
    renderAll();
  });

  const trigger = page.getByRole('button', { name: /전체 검수 시작/ }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const panel = page.locator('#bsoReviewProgressPanel');
  await expect(panel).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__bsoReviewProgressState && window.__bsoReviewProgressState.status)).toBe('NEEDS_REVIEW');
  await expect(panel.locator('.bso-review-progress-track')).toHaveAttribute('aria-valuenow', '100');
  await expect(panel.locator('.bso-review-progress-fill')).toHaveCSS('width', /.+/);
  await expect(panel).toContainText('검수 작업대 준비 완료');
  await expect(panel).toContainText('검수 필요');
  await expect(panel.locator('.bso-review-progress-step.done')).toHaveCount(6);
  await expect(page.locator('#candidateReviewWorkspace')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: /전체 검수 시작/ }).first()).toBeEnabled();

  const snapshot = await page.evaluate(() => ({
    state: window.__bsoReviewProgressState,
    actualReviewCandidateCount: (Array.isArray(data['00_extraction_candidates']) ? data['00_extraction_candidates'] : [])
      .filter((row) => row && row.review_status_code === 'NEEDS_REVIEW').length,
  }));
  expect(snapshot.state.pct).toBe(100);
  expect(snapshot.state.file_count).toBe(1);
  expect(snapshot.state.appraisal_result_count).toBe(1);
  expect(snapshot.actualReviewCandidateCount).toBeGreaterThan(0);
  expect(snapshot.state.review_candidate_count).toBe(snapshot.actualReviewCandidateCount);
  expect(snapshot.state.auto_confirmed).toBe(false);
  await expect(panel).toContainText(String(snapshot.actualReviewCandidateCount));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
