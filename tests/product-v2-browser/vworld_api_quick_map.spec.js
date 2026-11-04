'use strict';

const { test, expect } = require('@playwright/test');

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('VWorld API 실무지도는 PNU 폴리곤·3개 역할·라벨·범례·PNG를 제공하고 키를 저장하지 않는다', async ({ page }) => {
  const origins = {
    '1111111111100010001':[127.1200,36.4500],
    '1111111111100020001':[127.1210,36.4510],
    '1111111111100030001':[127.1220,36.4520],
  };
  await page.route('https://api.vworld.kr/req/data**', async (route) => {
    const url = new URL(route.request().url());
    const callback = url.searchParams.get('callback');
    const filter = url.searchParams.get('attrFilter');
    expect(url.searchParams.get('data')).toBe('LP_PA_CBND_BUBUN');
    expect(url.searchParams.get('geometry')).toBe('true');
    expect(callback).toBeTruthy();
    const pnu = String(filter || '').split(':').pop();
    const [x,y] = origins[pnu] || origins['1111111111100010001'];
    const feature = {
      type:'Feature', properties:{pnu},
      geometry:{type:'Polygon',coordinates:[[[x,y],[x+.0005,y],[x+.0005,y+.0004],[x,y+.0004],[x,y]]]},
    };
    await route.fulfill({
      status:200,
      contentType:'application/javascript; charset=utf-8',
      body:`${callback}(${JSON.stringify({response:{status:'OK',result:{featureCollection:{type:'FeatureCollection',features:[feature]}}}})});`,
    });
  });
  await page.route('https://api.vworld.kr/req/search**', async (route) => {
    const url = new URL(route.request().url());
    const callback = url.searchParams.get('callback');
    expect(url.searchParams.get('type')).toBe('address');
    expect(url.searchParams.get('category')).toBe('parcel');
    expect(url.searchParams.get('query')).toBe('익명시 지도동 3-1');
    const item = { id:'1111111111100030001', title:'익명시 지도동 3-1', address:{parcel:'익명시 지도동 3-1'}, point:{x:127.1220,y:36.4520} };
    await route.fulfill({
      status:200,
      contentType:'application/javascript; charset=utf-8',
      body:`${callback}(${JSON.stringify({response:{status:'OK',result:{items:[item]}}})});`,
    });
  });
  await page.route('https://api.vworld.kr/req/image**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('basemap')).toBe('PHOTO');
    expect(url.searchParams.has('layers')).toBe(false);
    expect(url.searchParams.get('size')).toBe('1024,768');
    await route.fulfill({ status:200, contentType:'image/png', headers:{'Access-Control-Allow-Origin':'*'}, body:PIXEL });
  });
  await page.route('**/__map_bridge/vworld-image**', async (route) => {
    const url=new URL(route.request().url());const target=new URL(url.searchParams.get('url'));
    expect(target.hostname).toBe('api.vworld.kr');
    expect(target.searchParams.get('key')).toBe('TEST-SESSION-VWORLD-KEY');
    await route.fulfill({status:200,contentType:'image/png',body:PIXEL});
  });

  await page.goto('/');
  await page.evaluate(() => {
    window.BSOProductV2.store.ingestDocument({
      fileMeta:{name:'익명평가서.pdf',size:1000}, pageModel:[{page_no:1,text:'익명'}],
      parsed:{
        meta:{parse_status:'TEXT_PARSED',auto_confirmed:false}, case:{case_name:'API 지도 사건'},
        appraisals:[{appraisal_id:'APP_001',appraisal_company:'익명법인',review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        lands:[{land_id:'L1',land_no:'1',pnu:'1111111111100010001',parcel_address:'익명시 지도동 1-1',land_category:'대',area:479,review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        standard_lands:[{standard_land_id:'S1',standard_land_symbol:'가',pnu:'1111111111100020001',parcel_address:'익명시 지도동 2-1',land_category:'대',official_price:100000,review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        comp_cases:[{case_id:'C1',case_symbol:'A',pnu:'',parcel_address:'익명시 지도동 3-1',land_category:'대',case_unit_price:120000,review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        land_appraisal_results:[{appraisal_result_id:'R1',appraisal_id:'APP_001',land_id:'L1',standard_land_id:'S1',standard_land_symbol:'가',unit_price:110000,amount:52690000,review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        subject_to_standard_factor_comparisons:[{comparison_id:'TS1',appraisal_id:'APP_001',land_id:'L1',standard_land_id:'S1',standard_land_symbol:'가',total_factor:1,review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        standard_to_comp_case_factor_comparisons:[{comparison_id:'SC1',appraisal_id:'APP_001',standard_land_symbol:'가',comp_case_id:'C1',comp_case_parcel_address:'익명시 지도동 3-1',total_factor:1,review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        subject_factor_total_candidates:[],other_factor_reviews:[],obstacle_summary_by_appraisal:[],obstacle_appraisal_results_sample:[],
      },
    });
    window.BSOProductV2.store.setRoute('map');
  });

  await expect(page.locator('[data-vworld-api-panel]')).toBeVisible();
  await expect(page.locator('[data-vworld-api-panel]')).toContainText('PNU 폴리곤 위치 검토도');
  await expect(page.locator('[data-vworld-basemap]')).toHaveValue('PHOTO');
  await page.locator('[data-vworld-api-key]').fill('TEST-SESSION-VWORLD-KEY');
  await page.evaluate(() => window.BSOProductV2.store.setRoute('map'));
  await expect(page.locator('[data-vworld-api-key]')).toHaveValue('TEST-SESSION-VWORLD-KEY');
  await page.locator('[data-vworld-api-start]').click();

  const sheets = page.locator('[data-vworld-api-panel] [data-map-sheet]');
  await expect(sheets).toHaveCount(3);
  await expect(page.locator('[data-map-sheet="OVERVIEW"]')).toContainText('전체 위치도');
  await expect(page.locator('[data-map-sheet="SUBJECT_STANDARD"]')).toContainText('편입토지–비교표준지 1');
  await expect(page.locator('[data-map-sheet="STANDARD_CASE"]')).toContainText('비교표준지–평가·거래사례 1');
  await expect(page.locator('[data-map-match-rejections]')).toHaveCount(0);
  const workMap = page.locator('[data-map-sheet="OVERVIEW"] [data-map-preview]');
  await expect(workMap.locator('img.map-basemap')).toBeVisible();
  await expect(workMap.locator('img.map-basemap')).toHaveAttribute('alt', 'VWorld 새틀라이트 배경지도');
  await expect(workMap.locator('g[data-role="TARGET"] path:not(.map-label-leader)')).toHaveCount(1);
  await expect(workMap.locator('g[data-role="STANDARD"] path:not(.map-label-leader)')).toHaveCount(1);
  await expect(workMap.locator('g[data-role="CASE"] path:not(.map-label-leader)')).toHaveCount(1);
  await expect(workMap.locator('[data-map-label="T1"]')).toHaveCount(1);
  await expect(workMap.locator('[data-map-label="S1"]')).toHaveCount(1);
  await expect(workMap.locator('[data-map-label="C1"]')).toHaveCount(1);
  await expect(workMap).toContainText('[대상토지]');
  await expect(workMap).toContainText('익명시 지도동 1-1');
  await expect(workMap).toContainText('[비교표준지]');
  await expect(workMap).toContainText('[평가·거래사례]');
  await expect(workMap.locator('.map-feature-label rect')).toHaveCount(0);
  await expect(workMap.locator('.map-label-leader')).toHaveCount(3);
  await expect(page.locator('[data-map-sheet="OVERVIEW"] [data-map-legend]')).toContainText('대상토지');
  await expect(page.locator('[data-map-sheet="OVERVIEW"] [data-map-legend]')).toContainText('비교표준지');
  await expect(page.locator('[data-map-sheet="OVERVIEW"] [data-map-legend]')).toContainText('평가·거래사례');
  await expect(page.locator('[data-vworld-api-panel]')).toContainText('VWorld Satellite');
  await expect(page.locator('[data-vworld-api-panel]')).toContainText('폴리곤 3건');
  await expect(page.locator('[data-map-bridge-panel]')).toContainText('API 실패 시 선택형 fallback · QGIS');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-map-sheet="SUBJECT_STANDARD"] [data-vworld-map-export]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/SUBJECT_STANDARD_1\.png$/);
  await expect(page.locator('[data-vworld-api-progress]')).toContainText('VWorld 배경 포함');
  await expect(page.locator('[data-vworld-api-panel] [data-map-sheet]')).toHaveCount(3);
  const reportMaps=await page.evaluate(async()=>window.BSOProductV2.mapBridge.reportPngItems());
  expect(reportMaps).toHaveLength(3);
  expect(reportMaps.map((item)=>item.map_scope)).toEqual(['OVERVIEW','SUBJECT_STANDARD','STANDARD_CASE']);
  expect(reportMaps.every((item)=>item.png_base64.startsWith('data:image/png;base64,'))).toBeTruthy();
  expect(JSON.stringify(reportMaps)).not.toContain('TEST-SESSION-VWORLD-KEY');

  const persisted = await page.evaluate(() => ({
    local:Object.values(localStorage).join('|'),
    session:Object.values(sessionStorage).join('|'),
    caseJson:JSON.stringify(window.BSOProductV2.store.snapshot()),
    geometryType:window.BSOProductV2.store.state.mapContext.layers[0].feature_collection.features[0].geometry.type,
    backgroundUrl:window.BSOProductV2.store.state.mapContext.view.background.url || '',
  }));
  expect(persisted.geometryType).toBe('Polygon');
  expect(persisted.backgroundUrl).toBe('');
  expect(persisted.local).not.toContain('TEST-SESSION-VWORLD-KEY');
  expect(persisted.session).not.toContain('TEST-SESSION-VWORLD-KEY');
  expect(persisted.caseJson).not.toContain('TEST-SESSION-VWORLD-KEY');
});

test('PNU exact 결과가 복수이면 폴리곤을 채택하지 않고 전체 위치도 점 대체로만 남긴다', async ({ page }) => {
  const pnu='1111111111100010001';
  await page.route('https://api.vworld.kr/req/data**',async(route)=>{
    const url=new URL(route.request().url());const callback=url.searchParams.get('callback');
    const polygon=(dx)=>({type:'Feature',properties:{pnu},geometry:{type:'Polygon',coordinates:[[[127+dx,36],[127.0002+dx,36],[127.0002+dx,36.0002],[127+dx,36.0002],[127+dx,36]]]}});
    await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:`${callback}(${JSON.stringify({response:{status:'OK',result:{featureCollection:{features:[polygon(0),polygon(.001)]}}}})});`});
  });
  await page.route('https://api.vworld.kr/req/search**',async(route)=>{
    const url=new URL(route.request().url());const callback=url.searchParams.get('callback');
    const item={id:pnu,address:{parcel:'익명시 지도동 1-1'},point:{x:127,y:36}};
    await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:`${callback}(${JSON.stringify({response:{status:'OK',result:{items:[item]}}})});`});
  });
  await page.route('https://api.vworld.kr/req/image**',async(route)=>route.fulfill({status:200,contentType:'image/png',body:PIXEL}));
  await page.goto('/');
  const result=await page.evaluate(async(pnuValue)=>{
    const api=await import('./vworld-api-map.js');api.setSessionVworldKey('TEST-EXACT-ONE-GATE');
    const built=await api.buildQuickMaps({caseInfo:{case_name:'exact-one 검증'},lands:[{land_id:'L1',pnu:pnuValue,parcel_address:'익명시 지도동 1-1'}],standardLands:[],transactionCases:[],publicLandCharacteristics:[],subjectFactorDetails:[],subjectFactorTotals:[],comparisonSummaryByLand:[],appraisalResults:[],standardToCompCaseFactors:[],otherFactors:[]});
    return {exact_one_count:built.exact_one_count,point_count:built.point_count,point_reason:built.point_fallbacks[0]?.reason,comparison_count:built.comparison_previews.length,geometry_type:built.map_preview.layers[0].feature_collection.features[0].geometry.type};
  },pnu);
  expect(result.exact_one_count).toBe(0);
  expect(result.point_count).toBe(1);
  expect(result.point_reason).toBe('VWORLD_PNU_GEOMETRY_NOT_UNIQUE');
  expect(result.comparison_count).toBe(0);
  expect(result.geometry_type).toBe('Point');
});

test('주소 검색이 복수 필지이면 첫 결과를 임의 채택하지 않고 지도 blocker로 남긴다', async ({ page }) => {
  await page.route('https://api.vworld.kr/req/search**', async (route) => {
    const url = new URL(route.request().url());
    const callback = url.searchParams.get('callback');
    const items = [
      {id:'1111111111100010001',address:{parcel:'익명도 가시 중복동 1-1'},point:{x:127.1,y:36.4}},
      {id:'1111111111100020001',address:{parcel:'익명도 나시 중복동 1-1'},point:{x:128.1,y:37.4}},
    ];
    await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:`${callback}(${JSON.stringify({response:{status:'OK',result:{items}}})});`});
  });
  await page.goto('/');
  await page.evaluate(() => {
    window.BSOProductV2.store.ingestDocument({
      fileMeta:{name:'익명평가서.pdf',size:1000},pageModel:[{page_no:1,text:'익명'}],
      parsed:{
        meta:{parse_status:'TEXT_PARSED',auto_confirmed:false},case:{case_name:'주소 복수후보 사건'},
        appraisals:[{appraisal_id:'APP_001',appraisal_company:'익명법인',review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        lands:[{land_id:'L1',land_no:'1',parcel_address:'중복동 1-1',land_category:'대',area:100,review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        standard_lands:[],comp_cases:[],land_appraisal_results:[{appraisal_result_id:'R1',appraisal_id:'APP_001',land_id:'L1',unit_price:100000,amount:10000000,review_status_code:'NEEDS_REVIEW',auto_confirmed:false}],
        subject_to_standard_factor_comparisons:[],subject_factor_total_candidates:[],other_factor_reviews:[],obstacle_summary_by_appraisal:[],obstacle_appraisal_results_sample:[],
      },
    });
    window.BSOProductV2.store.setRoute('map');
  });
  await page.locator('[data-vworld-api-key]').fill('TEST-AMBIGUOUS-KEY');
  await page.locator('[data-vworld-api-start]').click();
  await expect(page.locator('[data-vworld-api-panel]')).toContainText('VWORLD_MAP_ALL_FAILED');
  await expect(page.locator('[data-vworld-api-panel]')).toContainText('T1:VWORLD_ADDRESS_AMBIGUOUS');
  await expect(page.locator('[data-vworld-api-panel] [data-map-preview]')).toHaveCount(0);
});

test('복수 주소 후보는 사건 지역명과 유일하게 일치할 때만 해당 PNU를 사용한다', async ({ page }) => {
  await page.route('https://api.vworld.kr/req/search**', async (route) => {
    const url=new URL(route.request().url());const callback=url.searchParams.get('callback');
    const items=[
      {id:'4415010100102020005',address:{parcel:'충청남도 익명시 표본동 202-5'},point:{x:127.1,y:36.4}},
      {id:'1111010100102020005',address:{parcel:'서울특별시 종로구 표본동 202-5'},point:{x:126.9,y:37.5}},
    ];
    await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:`${callback}(${JSON.stringify({response:{status:'OK',result:{items}}})});`});
  });
  await page.route('https://api.vworld.kr/req/data**', async (route) => {
    const url=new URL(route.request().url());const callback=url.searchParams.get('callback');
    const feature={type:'Feature',properties:{pnu:'4415010100102020005'},geometry:{type:'Polygon',coordinates:[[[127.1,36.4],[127.101,36.4],[127.101,36.401],[127.1,36.401],[127.1,36.4]]]}};
    const payload={response:{status:'OK',result:{featureCollection:{features:[feature]}}}};
    await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:`${callback}(${JSON.stringify(payload)});`});
  });
  await page.route('https://api.vworld.kr/req/image**', async (route)=>route.fulfill({status:200,contentType:'image/png',body:PIXEL}));
  await page.goto('/');
  await page.evaluate(()=>{window.BSOProductV2.store.ingestDocument({fileMeta:{name:'익명시.pdf',size:1},pageModel:[{page_no:1,text:'익명시'}],parsed:{meta:{parse_status:'TEXT_PARSED'},case:{case_name:'익명시 가상표본지구 도시개발사업'},appraisals:[{appraisal_id:'A1',appraisal_company:'가람감정평가법인'}],lands:[{land_id:'L1',parcel_address:'표본동 202-5',land_category:'대',area:100}],standard_lands:[],comp_cases:[],land_appraisal_results:[],subject_to_standard_factor_comparisons:[],subject_factor_total_candidates:[],other_factor_reviews:[],obstacle_summary_by_appraisal:[],obstacle_appraisal_results_sample:[]}});window.BSOProductV2.store.setRoute('map');});
  await page.locator('[data-vworld-api-key]').fill('TEST-CONTEXT-KEY');await page.locator('[data-vworld-api-start]').click();
  await expect(page.locator('[data-vworld-api-panel]')).toContainText('폴리곤 1건');
  await expect(page.locator('[data-vworld-api-panel]')).not.toContainText('VWORLD_ADDRESS_AMBIGUOUS');
});

test('같은 필지의 법인별 ID·기호는 한 PNU 형상에 별칭으로 병합되어 명시 관계가 탈락하지 않는다', async ({ page }) => {
  const targetPnu='4415010100100030001';const standardPnu='4415010100101510000';
  await page.route('https://api.vworld.kr/req/data**',async(route)=>{
    const url=new URL(route.request().url());const callback=url.searchParams.get('callback');const pnu=String(url.searchParams.get('attrFilter')||'').split(':').pop();
    const x=pnu===targetPnu?127.1:127.11;const feature={type:'Feature',properties:{pnu},geometry:{type:'Polygon',coordinates:[[[x,36.4],[x+.001,36.4],[x+.001,36.401],[x,36.401],[x,36.4]]]}};
    await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:`${callback}(${JSON.stringify({response:{status:'OK',result:{featureCollection:{features:[feature]}}}})});`});
  });
  await page.goto('/');
  const result=await page.evaluate(async({targetPnuValue,standardPnuValue})=>{
    const api=await import('./vworld-api-map.js');api.setSessionVworldKey('TEST-ALIAS-KEY');
    return api.buildQuickMaps({
      caseInfo:{case_name:'익명시 별칭 병합'},publicLandCharacteristics:[],
      lands:[{land_id:'L1',appraisal_id:'A1',pnu:targetPnuValue,parcel_address:'익명시 가상동 산3-1'},{land_id:'L2',appraisal_id:'A2',pnu:targetPnuValue,parcel_address:'익명시 가상동 산3-1'}],
      standardLands:[{standard_land_id:'S1',appraisal_id:'A1',standard_land_symbol:'가',pnu:standardPnuValue,parcel_address:'익명시 가상동 151'},{standard_land_id:'S2',appraisal_id:'A2',standard_land_symbol:'차',pnu:standardPnuValue,parcel_address:'익명시 가상동 151'}],
      transactionCases:[],subjectFactorDetails:[],subjectFactorTotals:[],comparisonSummaryByLand:[],
      appraisalResults:[{appraisal_result_id:'R1',appraisal_id:'A1',land_id:'L1',standard_land_id:'S1',standard_land_symbol:'가'},{appraisal_result_id:'R2',appraisal_id:'A2',land_id:'L2',standard_land_id:'S2',standard_land_symbol:'차'}],
      standardToCompCaseFactors:[],otherFactors:[],
    });
  },{targetPnuValue:targetPnu,standardPnuValue:standardPnu});
  expect(result.maps).toHaveLength(2);
  expect(result.maps.find((row)=>row.role==='TARGET').map_aliases).toHaveLength(2);
  expect(result.maps.find((row)=>row.role==='STANDARD').map_aliases).toHaveLength(2);
  expect(result.comparison_counts.subject_standard).toBe(1);
  expect(result.match_rejections).toHaveLength(0);
});

test('지번 형태가 아닌 OCR 오염 주소는 VWorld 검색 전에 검토 대상으로 차단한다', async ({ page }) => {
  let searchRequests=0;const pnu='4415010100101510000';
  await page.route('https://api.vworld.kr/req/data**',async(route)=>{const url=new URL(route.request().url());const callback=url.searchParams.get('callback');const feature={type:'Feature',properties:{pnu},geometry:{type:'Polygon',coordinates:[[[127.1,36.4],[127.101,36.4],[127.101,36.401],[127.1,36.401],[127.1,36.4]]]}};await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:`${callback}(${JSON.stringify({response:{status:'OK',result:{featureCollection:{features:[feature]}}}})});`});});
  await page.route('https://api.vworld.kr/req/search**',async(route)=>{searchRequests+=1;await route.abort();});
  await page.goto('/');
  const result=await page.evaluate(async(pnuValue)=>{const api=await import('./vworld-api-map.js');api.setSessionVworldKey('TEST-ADDRESS-GATE');return api.buildQuickMaps({caseInfo:{case_name:'주소 검수'},lands:[{land_id:'L1',pnu:pnuValue,parcel_address:'익명시 가상동 151'}],standardLands:[{standard_land_id:'S1',parcel_address:'B98 전 전 계획관리 993.0 94000 세로(가) 지구외'}],transactionCases:[],publicLandCharacteristics:[],subjectFactorDetails:[],subjectFactorTotals:[],comparisonSummaryByLand:[],appraisalResults:[],standardToCompCaseFactors:[],otherFactors:[]});},pnu);
  expect(searchRequests).toBe(0);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0].error_code).toBe('PARCEL_ADDRESS_REVIEW_REQUIRED');
});

test('미세필지 인셋은 판독 크기와 최대 상세 축척 및 분리 프레임을 유지한다', async ({ page }) => {
  await page.route('https://api.vworld.kr/req/image**',async(route)=>route.fulfill({status:200,contentType:'image/png',body:PIXEL}));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {renderMapPreview}=await import('./map-preview.js');
    const tiny={type:'Feature',geometry:{type:'Polygon',coordinates:[[[127,36],[127.00001,36],[127.00001,36.00001],[127,36.00001],[127,36]]]},properties:{display_label:'T1',parcel_address:'표본동 202-5'}};
    const far={type:'Feature',geometry:{type:'Polygon',coordinates:[[[127.1,36.1],[127.101,36.1],[127.101,36.101],[127.1,36.101],[127.1,36.1]]]},properties:{display_label:'S1',parcel_address:'가상동 151'}};
    const preview={artifact_type:'LK_MAP_PREVIEW',title:'인셋 회귀',coordinate_space:{crs:'EPSG:4326'},view:{background:{center:[127.05,36.05],zoom:12,size:[1024,768],projection:'WEB_MERCATOR_TILE_256',basemap:'PHOTO',url:'https://api.vworld.kr/req/image?service=image&center=127.05%2C36.05&zoom=12&size=1024%2C768&layers=lp_pa_cbnd_bubun'}},layers:[{role:'TARGET',feature_collection:{features:[tiny]}},{role:'STANDARD',feature_collection:{features:[far]}}]};
    const html=renderMapPreview(preview);const holder=document.createElement('div');holder.innerHTML=html;const insets=[...holder.querySelectorAll('[data-map-inset]')];const insetUrls=insets.map((inset)=>new URL(inset.querySelector('image').getAttribute('data-src')));return{hasInset:html.includes('map-inset'),hasClip:html.includes('clipPath'),pnuExact:html.includes('PNU exact 지적경계'),layersRemoved:insetUrls.every((url)=>!url.searchParams.has('layers')),readableSize:insetUrls.every((url)=>['220,130','440,260'].includes(url.searchParams.get('size'))),satellite:insetUrls.every((url)=>url.searchParams.get('basemap')==='PHOTO'),maximumDetail:insetUrls.some((url)=>Number(url.searchParams.get('zoom'))===18),strongFrame:html.includes('fill:rgba(0,0,0,.35)')&&html.includes('stroke:#172231'),vectorFallback:html.includes('map-inset-vector-fallback'),whiteFallback:html.includes('map-empty-background')===false};
  });
  expect(result).toEqual({hasInset:true,hasClip:true,pnuExact:true,layersRemoved:true,readableSize:true,satellite:true,maximumDetail:true,strongFrame:true,vectorFallback:true,whiteFallback:true});
});

test('여러 도면의 동일 필지 인셋은 서로 다른 clipPath를 사용한다', async ({ page }) => {
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {renderMapPreview}=await import('./map-preview.js');
    const tiny={type:'Feature',geometry:{type:'Polygon',coordinates:[[[127,36],[127.00001,36],[127.00001,36.00001],[127,36.00001],[127,36]]]},properties:{display_label:'C1',parcel_address:'가상동 564-2'}};
    const far={type:'Feature',geometry:{type:'Polygon',coordinates:[[[127.1,36.1],[127.101,36.1],[127.101,36.101],[127.1,36.101],[127.1,36.1]]]},properties:{display_label:'S1',parcel_address:'가상동 238-1'}};
    const preview={artifact_type:'LK_MAP_PREVIEW',title:'clip 회귀',coordinate_space:{crs:'EPSG:4326'},view:{background:{center:[127.05,36.05],zoom:12,size:[1024,768],projection:'WEB_MERCATOR_TILE_256',basemap:'PHOTO',url:'https://api.vworld.kr/req/image?service=image&center=127.05%2C36.05&zoom=12&size=1024%2C768'}},layers:[{role:'CASE',feature_collection:{features:[tiny]}},{role:'STANDARD',feature_collection:{features:[far]}}]};
    const holder=document.createElement('div');holder.innerHTML=renderMapPreview(preview)+renderMapPreview(preview);document.body.appendChild(holder);
    const ids=[...holder.querySelectorAll('clipPath[id]')].map((node)=>node.id);
    const references=[...holder.querySelectorAll('g[clip-path]')].map((node)=>{const id=node.getAttribute('clip-path').slice(5,-1);return Boolean(node.closest('svg')?.querySelector(`#${CSS.escape(id)}`));});
    return{count:ids.length,unique:new Set(ids).size,references};
  });
  expect(result.count).toBeGreaterThan(1);
  expect(result.unique).toBe(result.count);
  expect(result.references.every(Boolean)).toBeTruthy();
});

test('인셋 항공사진이 실패해도 빈 프레임 대신 PNU 형상 확대를 남긴다', async ({ page }) => {
  await page.route('https://api.vworld.kr/req/image**',async(route)=>route.abort('failed'));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {renderMapPreview,hydrateMapInsetImages}=await import('./map-preview.js');
    const tiny={type:'Feature',geometry:{type:'Polygon',coordinates:[[[127,36],[127.00001,36],[127.00001,36.00001],[127,36.00001],[127,36]]]},properties:{display_label:'C1',parcel_address:'가상동 564-2',pnu:'4415034023105640002'}};
    const far={type:'Feature',geometry:{type:'Polygon',coordinates:[[[127.1,36.1],[127.101,36.1],[127.101,36.101],[127.1,36.101],[127.1,36.1]]]},properties:{display_label:'S1',parcel_address:'가상동 238-1',pnu:'4415034023102380001'}};
    const preview={artifact_type:'LK_MAP_PREVIEW',title:'인셋 실패 회귀',coordinate_space:{crs:'EPSG:4326'},view:{background:{center:[127.05,36.05],zoom:12,size:[1024,768],projection:'WEB_MERCATOR_TILE_256',basemap:'PHOTO',url:'https://api.vworld.kr/req/image?service=image&center=127.05%2C36.05&zoom=12&size=1024%2C768'}},layers:[{role:'CASE',feature_collection:{features:[tiny]}},{role:'STANDARD',feature_collection:{features:[far]}}]};
    const holder=document.createElement('div');holder.innerHTML=renderMapPreview(preview);document.body.appendChild(holder);await hydrateMapInsetImages(holder);const failed=[...holder.querySelectorAll('image[data-map-inset-image][data-load-failed]')];const fallback=holder.querySelector('[data-map-inset-fallback] path');return{failed:failed.length,fallback:Boolean(fallback),fallbackPath:fallback?.getAttribute('d')||''};
  });
  expect(result.failed).toBeGreaterThan(0);
  expect(result.fallback).toBeTruthy();
  expect(result.fallbackPath).toContain('M');
});
