'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const pdfPath = process.env.BSO_ACCEPTANCE_PDF ? path.resolve(process.env.BSO_ACCEPTANCE_PDF) : '';
const expectedPath = process.env.BSO_ACCEPTANCE_EXPECT ? path.resolve(process.env.BSO_ACCEPTANCE_EXPECT) : '';
const enabled = Boolean(pdfPath && expectedPath && fs.existsSync(pdfPath) && fs.existsSync(expectedPath));
const expected = enabled ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')) : null;

function config() { return expected?.expected || expected || {}; }
function asNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function countContract(counts, ...keys) {
  for (const key of keys) if (counts && counts[key]) return counts[key];
  return null;
}
function verifyCount(actual, contract, label) {
  if (!contract) return;
  if (contract.exact !== undefined) expect(actual, `${label} exact count`).toBe(Number(contract.exact));
  if (contract.min !== undefined) expect(actual, `${label} minimum count`).toBeGreaterThanOrEqual(Number(contract.min));
}

function landMap(state) {
  const resultByLand = new Map((state.appraisalResults || []).map((row) => [row.land_id, row]));
  return new Map((state.lands || []).map((land) => [String(land.land_no || land.serial_no || ''), { land, result: resultByLand.get(land.land_id) }]));
}

test.describe('local real appraisal acceptance', () => {
  test.skip(!enabled, 'BSO_ACCEPTANCE_PDF and BSO_ACCEPTANCE_EXPECT local files are required');

  test('실제 평가서가 Product v2 browser canonical path에서 정답계약을 통과한다', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await page.locator('[data-upload]').first().setInputFiles(pdfPath);
    await expect(page.locator('.status-pill')).toHaveAttribute('title', 'READY', { timeout: 150_000 });

    const state = await page.evaluate(() => window.BSOProductV2.store.snapshot());
    const exp = config();
    const counts = exp.counts || {};
    const checks = [
      ['appraisals', state.appraisals?.length, ['appraisals']],
      ['standard_lands', state.standardLands?.length, ['standard_lands']],
      ['lands', state.lands?.length, ['lands']],
      ['land_appraisal_results', state.appraisalResults?.length, ['land_appraisal_results']],
      ['subject_factor_detail_rows', state.subjectFactorDetails?.length, ['subject_factor_detail_rows']],
      ['subject_factor_total_rows', state.subjectFactorTotals?.length, ['subject_factor_total_rows', 'subject_factor_rows']],
      ['transaction_cases', state.transactionCases?.length, ['transaction_cases']],
      ['other_factor_reviews', state.otherFactors?.length, ['other_factor_reviews']],
      ['obstacle_summaries', state.obstacleSummaries?.length, ['obstacle_summaries']],
      ['obstacle_rows', state.obstacleRows?.length, ['obstacle_rows']],
    ];
    for (const [label, actual, keys] of checks) verifyCount(actual, countContract(counts, ...keys), label);

    const byNo = landMap(state);
    for (const row of exp.lands || []) {
      const pair = byNo.get(String(row.land_no));
      expect(pair, `land_no ${row.land_no}`).toBeTruthy();
      expect(asNumber(pair.land.area)).toBeCloseTo(Number(row.area), 6);
      if (row.land_category !== undefined) expect(String(pair.land.land_category || '')).toBe(String(row.land_category));
      if (row.appraisal_use_status !== undefined) expect(String(pair.land.appraisal_use_status || '')).toBe(String(row.appraisal_use_status));
      expect(pair.result, `result for ${row.land_no}`).toBeTruthy();
      for (const key of ['official_price','time_correction','regional_factor','individual_factor_total','other_factor','calculated_unit_price','unit_price','amount']) {
        if (row[key] === undefined) continue;
        expect(asNumber(pair.result[key]), `${row.land_no}.${key}`).toBeCloseTo(Number(row[key]), 6);
      }
      if (row.standard_land_symbol !== undefined) expect(String(pair.result.standard_land_symbol || '')).toBe(String(row.standard_land_symbol));
    }

    const totals = exp.totals || {};
    const expectedLandTotal = totals.land_amount_sum ?? exp.expected_land_total_amount;
    const expectedObstacleStated = totals.obstacle_stated_total ?? exp.expected_obstacle_total_amount;
    const expectedObstacleRows = totals.obstacle_row_sum ?? exp.expected_obstacle_total_amount;
    if (expectedLandTotal !== undefined) {
      const sum = (state.appraisalResults || []).reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
      expect(sum).toBe(Number(expectedLandTotal));
    }
    if (expectedObstacleStated !== undefined) {
      expect(Number(state.obstacleSummaries?.[0]?.stated_total_amount ?? state.obstacleSummaries?.[0]?.obstacle_total_amount)).toBe(Number(expectedObstacleStated));
      expect(String(state.obstacleSummaries?.[0]?.total_crosscheck_status || '')).toBe('MATCH');
    }
    if (expectedObstacleRows !== undefined) {
      const sum = (state.obstacleRows || []).reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
      expect(sum).toBe(Number(expectedObstacleRows));
    }

    const automaticRows = [
      ...(state.appraisals || []), ...(state.standardLands || []), ...(state.lands || []),
      ...(state.appraisalResults || []), ...(state.subjectFactorDetails || []), ...(state.subjectFactorTotals || []),
      ...(state.transactionCases || []), ...(state.otherFactors || []), ...(state.obstacleRows || []),
    ];
    expect(automaticRows.some((row) => row?.auto_confirmed === true)).toBe(false);
    expect((state.lands || []).every((row) => Array.isArray(row.source_refs) && row.source_refs.length > 0)).toBe(true);
    expect((state.appraisalResults || []).every((row) => Array.isArray(row.source_refs) && row.source_refs.length > 0)).toBe(true);

    // 동일 route/state를 사용하므로 desktop/mobile 모두 현재 보이는 평가검토 버튼으로 진입한다.
    await page.locator('[data-route="valuation"]:visible').first().click();
    await expect(page.locator('main')).toContainText('필지별 평가결과');
    await expect(page.locator('body')).not.toContainText('{"field"');
    await expect(page.locator('body')).not.toContainText('mobile-review-router');
  });
});

