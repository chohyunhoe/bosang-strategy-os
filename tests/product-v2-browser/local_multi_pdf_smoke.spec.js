'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('@playwright/test');

const pdfPaths=String(process.env.BSO_SMOKE_PDFS||'').split(path.delimiter).map((value)=>value.trim()).filter(Boolean);
const enabled=pdfPaths.length>0&&pdfPaths.every((filePath)=>fs.existsSync(filePath));

test.describe('local supplied multi-PDF smoke',()=>{
  test.skip(!enabled,'BSO_SMOKE_PDFS local files are required');

  test('실제 PDF 묶음을 한 배치로 처리하고 안전한 최종 상태를 만든다',async({page},testInfo)=>{
    test.setTimeout(600_000);
    page.on('requestfailed',(request)=>console.log(`[BSO request failed] ${request.url()} · ${request.failure()?.errorText||'UNKNOWN'}`));
    page.on('response',(response)=>{if(/pdf(?:\.worker)?\.min\.mjs|tesseract/i.test(response.url()))console.log(`[BSO runtime asset] ${response.status()} ${response.url()}`);});
    page.on('pageerror',(error)=>console.log(`[BSO page error] ${error.message}`));
    page.on('console',(message)=>{if(message.type()==='error')console.log(`[BSO console error] ${message.text()}`);});
    await page.goto('/');
    await page.locator('[data-upload]').first().setInputFiles(pdfPaths);
    await expect(page.locator('.status-pill')).toHaveAttribute('data-status','PROCESSING',{timeout:10_000});
    await expect(page.locator('button[data-route="map"]:visible').first()).toBeDisabled();
    await expect(page.locator('.status-pill')).not.toHaveAttribute('data-status','PROCESSING',{timeout:540_000});
    console.log('[BSO real PDF] READY reached');

    const result=await page.evaluate(()=>{
      const state=window.BSOProductV2.store.state;const report=window.BSODiagnostics.snapshot();
      const count=(type)=>report.events.filter((event)=>event.type===type).length;
      const automatic=[...(state.appraisals||[]),...(state.lands||[]),...(state.standardLands||[]),...(state.transactionCases||[]),...(state.appraisalResults||[])];
      const list=(rows)=>Array.isArray(rows)?rows:[];const PARTICLES=['를','을','의','로','으','는','은','이','가','와','과','에','도','만','및','중','등'];return{status:state.status,batchHasHold:state.batchHasHold===true,documentSanity:list(state.documentSanity).map((row)=>({id:row.appraisal_id,status:row.status,holds:list(row.hold_codes).length})),eligibility:window.BSOProductV2.store.mapEligibility(),mapInputAppraisalIds:[...new Set(list(window.BSOProductV2.store.mapInputState().standardLands).map((row)=>row.appraisal_id))],relations:list(state.subjectFactorDetails).length+list(state.standardToCompCaseFactors).length,relationsWithoutSource:[...list(state.subjectFactorDetails),...list(state.standardToCompCaseFactors)].filter((row)=>list(row.source_refs).length===0).length,particleSymbols:list(state.transactionCases).filter((row)=>PARTICLES.includes(String(row.case_symbol||'').trim())).length,shiftedStandardAreas:list(state.standardLands).filter((row)=>Number(row.area)>=100000).length,namedAppraisals:list(state.appraisals).filter((row)=>/감\s*정\s*평\s*가\s*법\s*인/.test(String(row.appraisal_company||''))).length,documents:state.sourceDocuments.length,appraisals:state.appraisals.length,lands:state.lands.length,standards:state.standardLands.length,cases:state.transactionCases.length,appraisalResults:state.appraisalResults.length,reviewPending:state.reviewQueue.filter((row)=>row.status!=='CONFIRMED').length,autoConfirmed:automatic.filter((row)=>row?.auto_confirmed===true).length,batchStarted:count('PDF_BATCH_STARTED'),batchCompleted:count('PDF_BATCH_COMPLETED'),batchFailed:count('PDF_BATCH_FAILED'),bytesReady:count('PDF_BYTES_READY'),documentsLoaded:count('PDF_DOCUMENT_LOADED'),textPagesLoaded:count('PDF_TEXT_CONTENT_LOADED'),ocrWorkers:report.events.filter((event)=>event.type==='PDF_OCR_WORKERS_READY').map((event)=>event.details.parallel_count),runtimeErrors:count('RUNTIME_ERROR')+count('UNHANDLED_REJECTION'),report};
    });
    console.log('[BSO real PDF] aggregate captured');

    // 화면이 열리고 파일 두 개가 처리됐다는 것만으로는 통과하지 못하게 한다.
    // 승격 판정·관계·기호·열 정합까지 확인한다.
    expect(['READY','PARSE_HOLD']).toContain(result.status);
    expect(result.documentSanity).toHaveLength(pdfPaths.length);
    expect(result.documentSanity.every((row)=>row.status==='READY'||row.status==='PARSE_HOLD')).toBeTruthy();
    // 문서 하나라도 HOLD 면 배치를 READY 로 덮지 않는다.
    expect(result.batchHasHold).toBe(result.documentSanity.some((row)=>row.status==='PARSE_HOLD'));
    expect(result.status).toBe(result.batchHasHold?'PARSE_HOLD':'READY');
    // 평가법인은 문서마다 식별되어야 한다.
    expect(result.namedAppraisals).toBe(pdfPaths.length);
    // 조사형 사례기호·열 밀림은 0 이어야 한다.
    expect(result.particleSymbols).toBe(0);
    expect(result.shiftedStandardAreas,'표준지 면적 자리에 공시지가가 들어갔다').toBe(0);
    // 관계는 하나라도 복원되어야 하고, 근거 없는 관계는 없어야 한다.
    expect(result.relations).toBeGreaterThan(0);
    expect(result.relationsWithoutSource).toBe(0);
    // HOLD 문서 값은 지도 입력에서 빠져야 한다.
    for(const row of result.documentSanity.filter((item)=>item.status==='PARSE_HOLD')){
      expect(result.eligibility.excluded_appraisal_ids).toContain(row.id);
      expect(result.mapInputAppraisalIds).not.toContain(row.id);
    }
    expect(result.documents).toBe(pdfPaths.length);
    expect(result.appraisals).toBe(pdfPaths.length);
    expect(result.lands).toBeGreaterThan(0);
    expect(result.appraisalResults).toBeGreaterThanOrEqual(result.lands);
    expect(result.standards).toBeGreaterThan(0);
    expect(result.batchStarted).toBe(1);
    expect(result.batchCompleted).toBe(1);
    expect(result.batchFailed).toBe(0);
    expect(result.bytesReady).toBe(pdfPaths.length);
    expect(result.documentsLoaded).toBe(pdfPaths.length);
    expect(result.textPagesLoaded).toBeGreaterThanOrEqual(pdfPaths.length);
    expect(result.runtimeErrors).toBe(0);
    expect(result.autoConfirmed).toBe(0);
    expect(result.ocrWorkers.every((count)=>count>=1&&count<=2)).toBeTruthy();
    expect(JSON.stringify(result.report)).not.toContain(path.basename(pdfPaths[0]));

    await testInfo.attach('aggregate-smoke-summary',{body:Buffer.from(JSON.stringify({...result,report:undefined},null,2)),contentType:'application/json'});
    console.log('[BSO real PDF] assertions completed');
  });
});

