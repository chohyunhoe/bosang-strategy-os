import { test, expect } from '@playwright/test';

test('PDF 배치 중에는 중간 문서 병합이 READY를 만들거나 지도 실행을 허용하지 않는다', async ({ page }) => {
  await page.goto('/');
  const status=await page.evaluate(async()=>{
    const {CaseStore}=await import('./case-store.js');
    const isolated=new CaseStore();isolated.setStatus('PROCESSING');
    isolated.ingestDocument({fileMeta:{name:'비공개.pdf',size:1},pageModel:[{page_no:1,text:'비공개'}],parsed:{meta:{parse_status:'TEXT_PARSED'},case:{case_name:'비공개'},appraisals:[{appraisal_id:'A1',appraisal_company:'가람감정평가법인'}],lands:[],standard_lands:[],comp_cases:[],land_appraisal_results:[],subject_to_standard_factor_comparisons:[],subject_factor_total_candidates:[],other_factor_reviews:[],obstacle_summary_by_appraisal:[],obstacle_appraisal_results_sample:[]}});
    window.BSOProductV2.store.setStatus('PROCESSING');window.BSOProductV2.store.setRoute('map');
    return isolated.state.status;
  });
  expect(status).toBe('PROCESSING');
  await expect(page.locator('[data-vworld-api-start]')).toBeDisabled();
  await expect(page.locator('[data-vworld-api-start]')).toContainText('PDF 처리 완료 대기');
  await expect(page.locator('button[data-reset-case]')).toBeDisabled();
});

test('수행 로그는 집계 이벤트만 현재 탭에 보존하고 JSON으로 저장한다', async ({ page }) => {
  await page.goto('/');
  const button=page.locator('[data-session-log-download]');
  await expect(button).toBeVisible();
  await page.evaluate(()=>window.BSOProductV2.store.setRoute('map'));
  const report=await page.evaluate(()=>{
    window.BSODiagnostics.record('TEST_DIAGNOSTIC',{count:2,error_code:'EXPECTED_FAILURE',item_refs:['T1','S4','T1','가상동 202-5'],parcel_address:'가상동 202-5',pnu:'4415012345678901234',api_key:'TEST-SESSION-VWORLD-KEY',raw_text:'평가서 원문'});
    window.BSODiagnostics.record('TEST_URL_REDACTION',{error_code:'https://api.vworld.kr/req?key=TEST-SESSION-VWORLD-KEY'});
    return window.BSODiagnostics.snapshot();
  });
  expect(report.contract_version).toBe('bso-session-diagnostics/1.0');
  expect(report.storage_profile).toBe('CURRENT_TAB_MEMORY_UNTIL_USER_DOWNLOAD');
  expect(report.events.some((event)=>event.type==='STATE_SNAPSHOT'&&event.details.route==='map')).toBeTruthy();
  expect(report.events.some((event)=>event.type==='TEST_DIAGNOSTIC'&&event.details.count===2&&event.details.error_code==='EXPECTED_FAILURE')).toBeTruthy();
  expect(report.events.find((event)=>event.type==='TEST_DIAGNOSTIC').details.item_refs).toEqual(['T1','S4']);
  expect(report.events.some((event)=>event.type==='TEST_URL_REDACTION'&&event.details.error_code==='REDACTED_VALUE')).toBeTruthy();
  const serialized=JSON.stringify(report);
  for(const forbidden of ['가상동 202-5','4415012345678901234','TEST-SESSION-VWORLD-KEY','평가서 원문'])expect(serialized).not.toContain(forbidden);
  const downloadedName=await page.evaluate(()=>{
    const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalClick=HTMLAnchorElement.prototype.click;let name='';
    URL.createObjectURL=()=> 'blob:bso-session-log-test';URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){name=this.download;};
    try{window.BSODiagnostics.download();return name;}finally{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;HTMLAnchorElement.prototype.click=originalClick;}
  });
  expect(downloadedName).toBe('BSO_session_execution_log.json');
});

test('지도 인셋 로딩 실패와 재시도 결과가 수행 로그에 남는다', async ({ page }) => {
  await page.route('https://api.vworld.kr/req/image**',async(route)=>route.abort('failed'));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {renderMapPreview,hydrateMapInsetImages}=await import('./map-preview.js');
    const tiny={type:'Feature',geometry:{type:'Polygon',coordinates:[[[127,36],[127.00001,36],[127.00001,36.00001],[127,36.00001],[127,36]]]},properties:{display_label:'C1',parcel_address:'비공개',pnu:'0000000000000000000'}};
    const far={type:'Feature',geometry:{type:'Polygon',coordinates:[[[127.1,36.1],[127.101,36.1],[127.101,36.101],[127.1,36.101],[127.1,36.1]]]},properties:{display_label:'S1',parcel_address:'비공개',pnu:'1111111111111111111'}};
    const preview={artifact_type:'LK_MAP_PREVIEW',title:'진단',coordinate_space:{crs:'EPSG:4326'},view:{background:{center:[127.05,36.05],zoom:12,size:[1024,768],projection:'WEB_MERCATOR_TILE_256',basemap:'PHOTO',url:'https://api.vworld.kr/req/image?service=image&center=127.05%2C36.05&zoom=12&size=1024%2C768'}},layers:[{role:'CASE',feature_collection:{features:[tiny]}},{role:'STANDARD',feature_collection:{features:[far]}}]};
    const holder=document.createElement('div');holder.innerHTML=renderMapPreview(preview);document.body.appendChild(holder);const before=window.BSODiagnostics.snapshot().events.filter((entry)=>entry.type==='MAP_INSET_BATCH_COMPLETED').length;await Promise.all([hydrateMapInsetImages(holder),hydrateMapInsetImages(holder)]);const report=window.BSODiagnostics.snapshot();return{report,batchCount:report.events.filter((entry)=>entry.type==='MAP_INSET_BATCH_COMPLETED').length-before};
  });
  const event=result.report.events.find((entry)=>entry.type==='MAP_INSET_BATCH_COMPLETED');
  expect(result.batchCount).toBe(1);
  expect(event.details.inset_count).toBeGreaterThan(0);
  expect(event.details.retry_count).toBeGreaterThan(0);
  expect(event.details.failure_count).toBeGreaterThan(0);
  expect(JSON.stringify(result.report)).not.toContain('0000000000000000000');
});
