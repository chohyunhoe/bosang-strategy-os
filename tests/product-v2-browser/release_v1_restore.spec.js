const {test,expect} = require('@playwright/test');
test.skip(process.env.BSO_RELEASE_V1 !== '1', 'Release v1 artifact only');
test.beforeEach(async ({page}) => { page.on('dialog', dialog => dialog.accept()); });

test('Release v1에서 보류 사건을 파일로 저장하고 새 세션에서 복원한다',async({page})=>{
  await page.goto('/');
  await expect(page).toHaveTitle(/Release v1/);
  await page.evaluate(()=>{
    const {store}=window.BSOProductV2;
    store.state.caseInfo={case_name:'합성 보류 사건'};
    store.state.sourceDocuments=[{document_id:'D1',appraisal_id:'A1',file_name:'synthetic.pdf'}];
    store.state.documentSanity=[{appraisal_id:'A1',status:'PARSE_HOLD',hold_codes:['TOTAL_MISMATCH']}];
    store.state.batchHasHold=true;store.state.status='PARSE_HOLD';store.emit();
  });
  const downloadEvent=page.waitForEvent('download');
  await page.locator('[data-case-save]').click();
  const download=await downloadEvent;
  const file=await download.path();
  await page.reload();
  await page.locator('[data-case-import-input]').setInputFiles(file);
  await expect(page.locator('[data-case-registry]')).toContainText('합성 보류 사건');
  const restored=await page.evaluate(()=>({status:window.BSOProductV2.store.state.status,hold:window.BSOProductV2.store.state.batchHasHold}));
  expect(restored).toEqual({status:'PARSE_HOLD',hold:true});
});

test('잘못된 백업은 기존 사건을 교체하지 않는다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(()=>{
    const {registry,store}=window.BSOProductV2;
    store.state.caseInfo={case_name:'보존할 합성 사건'};store.emit();
    const bundle=registry.exportBundle();bundle.entries[0].snapshot.lands={bad:true};
    let rejected=false;try{registry.importBundle(bundle);}catch(_){rejected=true;}
    return {rejected,name:store.state.caseInfo.case_name};
  });
  expect(result).toEqual({rejected:true,name:'보존할 합성 사건'});
});

test('PDF 처리 중에는 다른 사건으로 결과가 섞이지 않도록 사건 변경을 막는다',async({page})=>{
  await page.goto('/');
  await page.locator('[data-case-new]').click();
  await page.evaluate(()=>window.BSOProductV2.store.setStatus('PROCESSING'));
  for(const selector of ['[data-case-new]','[data-case-import]','[data-case-remove]','[data-case-switch]']) {
    const buttons=page.locator(selector);
    for(let index=0;index<await buttons.count();index++) await expect(buttons.nth(index)).toBeDisabled();
  }
});

test('법인명 미식별 보류는 원문·수정 입력으로 해소하고 다른 보류는 보존한다',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    const {store}=window.BSOProductV2;
    store.state.sourceDocuments=[{document_id:'D1',appraisal_id:'A1',file_name:'synthetic.pdf',parse_status:'TEXT_PARSED'}];
    store.state.appraisals=[{appraisal_id:'A1',appraisal_company:'',file_type:'TEXT_PDF',auto_confirmed:false}];
    store.state.documentSanity=[{appraisal_id:'A1',status:'PARSE_HOLD',hold_codes:['APPRAISAL_COMPANY_UNIDENTIFIED'],holds:[{code:'APPRAISAL_COMPANY_UNIDENTIFIED',detail:'평가법인명 원문 확인 필요'}]}];
    store.state.status='PARSE_HOLD';store.state.batchHasHold=true;store.rebuildReviewQueue();store.emit();
  });
  await expect(page.locator('main')).toContainText('보류 문서 원문·추출 확인');
  await page.locator('[data-route="case"]:visible').first().click();
  await expect(page.locator('main')).toContainText('추출 보류 사유');
  await page.locator('[data-inspect-collection="appraisals"]').click();
  await page.locator('.inspector [data-key="appraisal_company"]').fill('합성감정평가법인');
  await page.locator('.inspector-save').click();
  expect(await page.evaluate(()=>window.BSOProductV2.store.state.status)).toBe('READY');
  expect(await page.evaluate(()=>window.BSOProductV2.store.state.appraisals[0].auto_confirmed)).toBe(false);
  const remaining=await page.evaluate(()=>{
    const {store}=window.BSOProductV2;
    store.state.documentSanity[0].hold_codes=['APPRAISAL_COMPANY_UNIDENTIFIED','STANDARD_LAND_AREA_IMPLAUSIBLE'];
    store.state.documentSanity[0].holds=[{code:'APPRAISAL_COMPANY_UNIDENTIFIED'},{code:'STANDARD_LAND_AREA_IMPLAUSIBLE'}];
    store.updateRecord('appraisals',()=>true,{appraisal_company:'수정합성감정평가법인'});
    return {status:store.state.status,codes:store.state.documentSanity[0].hold_codes};
  });
  expect(remaining).toEqual({status:'PARSE_HOLD',codes:['STANDARD_LAND_AREA_IMPLAUSIBLE']});
});
