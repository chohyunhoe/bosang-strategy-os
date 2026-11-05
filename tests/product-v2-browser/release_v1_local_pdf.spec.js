const fs=require('node:fs');
const {test,expect}=require('@playwright/test');
// Local-only Acceptance A PDF; expected counts come from the frozen release acceptance record.
const pdf=process.env.BSO_V1_ACCEPTANCE_A_PDF;
const expectedPath=process.env.BSO_V1_ACCEPTANCE_EXPECT;
const expected=expectedPath && fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath,'utf8')) : null;
test.skip(process.env.BSO_RELEASE_V1!=='1'||!pdf||!fs.existsSync(pdf)||!expected,'Local Acceptance A PDF required');
test('실제 Acceptance A PDF의 원장·합계와 법인명 미식별 보류를 함께 보존한다',async({page})=>{
  test.setTimeout(180_000);
  await page.goto('/');
  await page.locator('[data-upload]').first().setInputFiles(pdf);
  await expect(page.locator('.status-pill')).not.toHaveAttribute('data-status','EMPTY');
  await expect(page.locator('.status-pill')).not.toHaveAttribute('data-status','PROCESSING',{timeout:150_000});
  const summary=await page.evaluate(()=>{
    const {store}=window.BSOProductV2;const s=store.state;
    return {status:s.status,lands:s.lands.length,standards:s.standardLands.length,cases:s.transactionCases.length,results:s.appraisalResults.length,obstacles:s.obstacleRows.length,landSum:s.appraisalResults.reduce((sum,row)=>sum+Number(row.amount||0),0),obstacleSum:s.obstacleRows.reduce((sum,row)=>sum+Number(row.amount||0),0),holds:s.documentSanity.flatMap(row=>row.hold_codes),auto:s.appraisals.some(row=>row.auto_confirmed===true),mapAllowed:store.mapEligibility().allowed};
  });
  expect(summary).toMatchObject(expected);
  expect(summary.status).toBe('PARSE_HOLD');
  expect(summary.holds).toContain('APPRAISAL_COMPANY_UNIDENTIFIED');
  expect(summary.mapAllowed).toBe(false);
  await page.locator('[data-route="case"]:visible').first().click();
  await expect(page.locator('main')).toContainText('추출 보류 사유');
  await expect(page.locator('[data-inspect-collection="appraisals"]')).toBeVisible();
});

