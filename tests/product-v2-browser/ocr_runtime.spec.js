'use strict';

const { test, expect } = require('@playwright/test');

test('Tesseract local OCR는 pageModel을 만들고 자동확정하지 않는다', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const progress = [];
    window.Tesseract = {
      OEM:{LSTM_ONLY:1},
      createWorker: async () => ({
        recognize: async (_canvas, _opts, output) => ({
          data:{
            text:'3. 토지조서\n101 익명동 1-1 대 100 1,000,000',
            blocks: output?.blocks ? [{paragraphs:[{lines:[{words:[
              {text:'101',confidence:99,bbox:{x0:10,y0:20,x1:30,y1:32}},
              {text:'익명동',confidence:98,bbox:{x0:40,y0:20,x1:80,y1:32}},
            ]}]}]}] : [],
          },
        }),
        terminate: async () => {},
      }),
    };
    const fakePage = {
      getViewport: ({scale}) => ({width:600*scale,height:800*scale}),
      render: () => ({promise:Promise.resolve()}),
    };
    const pdfDocument = {numPages:2,getPage:async()=>fakePage};
    const mod = await import('/ocr-source.js');
    const pages = await mod.ocrPdfDocument(pdfDocument, (event) => progress.push(event));
    return {pages,progress};
  });

  expect(result.pages).toHaveLength(2);
  expect(result.pages.every((row) => row.source_type === 'LOCAL_BROWSER_OCR')).toBe(true);
  expect(result.pages.every((row) => row.extraction_method === 'Tesseract.js kor+eng')).toBe(true);
  expect(result.pages.every((row) => row.review_status_code === 'NEEDS_REVIEW')).toBe(true);
  expect(result.pages.some((row) => row.auto_confirmed === true)).toBe(false);
  expect(result.pages[0].text).toContain('토지조서');
  expect(result.pages[0].items[0].str).toBe('101');
  expect(result.progress.some((row) => row.phase === 'page' && row.page === 2)).toBe(true);
});

test('혼합형 PDF는 텍스트가 부족한 선택 페이지만 OCR한다', async ({ page }) => {
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const requested=[];const progress=[];
    window.Tesseract={OEM:{LSTM_ONLY:1},createWorker:async()=>({recognize:async()=>({data:{text:'선택 OCR',blocks:[]}}),terminate:async()=>{}})};
    const fakePage={getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve()})};
    const pdfDocument={numPages:3,getPage:async(pageNo)=>{requested.push(pageNo);return fakePage;}};
    const {ocrPdfDocument}=await import('/ocr-source.js');
    const pages=await ocrPdfDocument(pdfDocument,(event)=>progress.push(event),{pageNumbers:[2]});
    return{requested,pages:pages.map((row)=>row.page_no),pageEvent:progress.find((row)=>row.phase==='ocr-page-completed')};
  });
  expect(result.requested).toEqual([2]);
  expect(result.pages).toEqual([2]);
  expect(result.pageEvent.page).toBe(2);
  expect(result.pageEvent.selection_index).toBe(1);
  expect(result.pageEvent.total).toBe(1);
});

test('대량 스캔 PDF는 두 OCR 작업자로 병렬 처리하고 페이지 순서를 복원한다', async ({ page }) => {
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    let workers=0,active=0,maxActive=0;const progress=[];
    window.Tesseract={OEM:{LSTM_ONLY:1},createWorker:async()=>{workers+=1;return{recognize:async()=>{active+=1;maxActive=Math.max(maxActive,active);await new Promise((resolve)=>setTimeout(resolve,20));active-=1;return{data:{text:'병렬 OCR',blocks:[]}};},terminate:async()=>{}};}};
    const fakePage={getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve()})};
    const pdfDocument={numPages:6,getPage:async()=>fakePage};
    const {ocrPdfDocument}=await import('/ocr-source.js');
    const pages=await ocrPdfDocument(pdfDocument,(event)=>progress.push(event),{pageNumbers:[1,2,3,4,5,6],workerCount:2});
    return{workers,maxActive,pages:pages.map((row)=>row.page_no),ready:progress.find((row)=>row.phase==='ocr-workers-ready')};
  });
  expect(result.workers).toBe(2);
  expect(result.maxActive).toBe(2);
  expect(result.pages).toEqual([1,2,3,4,5,6]);
  expect(result.ready.parallel_count).toBe(2);
});

test('본문 텍스트가 충분해도 이미지 표 페이지만 선택 OCR한다', async ({page}) => {
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {selectOcrPageNumbers}=await import('/pdf-source.js');
    const pages=Array.from({length:10},(_,index)=>({page_no:index+1,text:'본문 텍스트 '.repeat(80),has_raster_image:false}));
    pages[6]={page_no:7,text:'토지평가조서 표 머리글',has_raster_image:true};
    pages[8]={page_no:9,text:'',has_raster_image:false};
    const selected=selectOcrPageNumbers(pages);
    return {selected,healthy:selectOcrPageNumbers(pages.filter(p=>p.page_no!==7)),scan:selectOcrPageNumbers([{page_no:1,text:'',has_raster_image:true},{page_no:2,text:'',has_raster_image:true}])};
  });
  expect(result).toEqual({selected:[7],healthy:[],scan:[1,2]});
});

test('혼합 PDF 읽기 경로는 본문을 보존하고 이미지 토지표 OCR 결과를 파서에 전달한다',async({page})=>{
  await page.route('**/vendor/pdf.min.mjs',route=>route.fulfill({contentType:'application/javascript',body:'export const GlobalWorkerOptions={}; export const OPS={paintImageXObject:85}; export function getDocument(){return {promise:Promise.resolve(window.__mixedPdfDocument)}};'}));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const recognized=[];let destroyed=false;
    window.Tesseract={OEM:{LSTM_ONLY:1},createWorker:async()=>({recognize:async()=>{recognized.push(5);return{data:{text:'토지평가조서\n101 익명동 1-1 전 100 20,000 2,000,000',blocks:[]}};},terminate:async()=>{}})};
    window.__mixedPdfDocument={numPages:6,getPage:async(number)=>({getTextContent:async()=>({items:number<=4?[{str:'본문 설명 '.repeat(60),transform:[12,0,0,12,20,700],width:500,height:12}]:[]}),getOperatorList:async()=>({fnArray:number===5?[85]:[]}),getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve()})}),destroy:async()=>{destroyed=true;}};
    const {loadPdfPageModel,parserPagesFromPageModel}=await import('/pdf-source.js');
    const progress=[];const pages=await loadPdfPageModel({arrayBuffer:async()=>new Uint8Array([1]).buffer},event=>progress.push(event));
    return{recognized,destroyed,sources:pages.map(p=>p.source_type),body:pages[0].text,table:parserPagesFromPageModel(pages)[4].text,ocrRequired:progress.find(p=>p.phase==='text-completed').ocr_required};
  });
  expect(result.recognized).toEqual([5]);expect(result.destroyed).toBe(true);expect(result.ocrRequired).toBe(true);
  expect(result.body).toContain('본문 설명');expect(result.table).toContain('101 익명동 1-1');
  expect(result.sources).toEqual(['PDFJS_TEXT','PDFJS_TEXT','PDFJS_TEXT','PDFJS_TEXT','LOCAL_BROWSER_OCR','PDFJS_TEXT']);
});

test('큰 여백 아래의 표 데이터 영역을 확대하고 빈 페이지는 확대하지 않는다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {sparseTableCrop,ocrWordLines}=await import('/ocr-source.js');
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1000;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,800,1000);
    const blank=sparseTableCrop(canvas,ctx,true);
    ctx.fillStyle='black';ctx.font='24px sans-serif';ctx.fillText('TABLE HEADER',50,220);ctx.fillText('101 12-3 250.000 180,000',50,780);ctx.fillText('102 12-4 400.000 180,000',50,820);ctx.fillRect(40,920,720,1);
    const crop=sparseTableCrop(canvas,ctx,true);
    const lines=ocrWordLines([{str:'180,000',x:200,y:780,width:80,height:20},{str:'101',x:20,y:780,width:30,height:20},{str:'HEADER',x:10,y:200,width:100,height:20}]);
    return{blank,crop,lines};
  });
  expect(result.blank).toBeNull();expect(result.crop.y).toBeGreaterThan(700);expect(result.crop.y).toBeLessThan(780);expect(result.crop.height).toBeLessThan(250);
  expect(result.lines).toBe('HEADER\n101 180,000');
});

test('표 확대 OCR은 영역 밖 원문 단어와 이미 읽힌 지번 하이픈을 보존한다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {mergeTableOcrWords}=await import('/ocr-source.js');
    const words=mergeTableOcrWords([{str:'HEADER',x:0,y:10,width:80,height:20},{str:'0012-0003',x:10,y:200,width:100,height:20},{str:'표본동',x:10,y:400,width:80,height:20}],[{str:'00120003',x:10,y:200,width:100,height:20},{str:'400.000',x:150,y:200,width:100,height:20}],{y:150,height:200});
    return words.map(word=>word.str);
  });
  expect(result).toEqual(['HEADER','표본동','0012-0003','400.000']);
});

test('표 셀 OCR 분할을 복원하고 첫 OCR의 유일한 법정동을 버리지 않는다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const modes=[];let calls=0;
    const word=(text,x,y)=>({text,bbox:{x0:x,y0:y,x1:x+90,y1:y+20},confidence:90});
    window.Tesseract={OEM:{LSTM_ONLY:1},createWorker:async()=>({setParameters:async(parameters)=>modes.push(parameters.tessedit_pageseg_mode),recognize:async()=>{calls++;return calls===1?{data:{text:'토지평가조서\n표본동',blocks:[{paragraphs:[{lines:[{words:[word('토지평가조서',20,200)]}]}]}]}}:{data:{text:'101 12-3',blocks:[{paragraphs:[{lines:[{words:[word('101',30,20),word('12-3',180,20)]}]}]}]}};},terminate:async()=>{}})};
    const pdf={numPages:1,getPage:async()=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:({canvasContext})=>{canvasContext.fillStyle='white';canvasContext.fillRect(0,0,1320,1760);canvasContext.fillStyle='black';canvasContext.font='30px sans-serif';canvasContext.fillText('TABLE HEADER',50,400);canvasContext.fillText('101 12-3 250.000 180,000',50,1400);return{promise:Promise.resolve()};}})};
    const {ocrPdfDocument}=await import('/ocr-source.js');const pages=await ocrPdfDocument(pdf);
    return{modes,calls,text:pages[0].text,confirmed:pages[0].auto_confirmed};
  });
  expect(result.modes).toEqual(['11','6']);expect(result.calls).toBe(2);expect(result.text).toContain('표본동');expect(result.text).toContain('12-3');expect(result.confirmed).toBe(false);
});

test('조서 금액 복구는 같은 연번·지번·면적의 OCR 수치와 명시 지분을 대조하고 주소를 보존한다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {recoverStatementMoney,statementRowCrops}=await import('/ocr-source.js');
    const original='토지평가조서\n201 AEA 15-2 답 답 120.000 * 12 180000 1800000\n표본동';
    const candidate='경기도\n201 익명시 15-2 답 답 120.000 * 1/2 180,000 10,800,000\n표본동';
    const crop={serial:'201',lot:'0015-0002'};
    const word=(str,x,y,width=40,height=16)=>({str,x,y,width,height});
    const crops=statementRowCrops([word('201',40,500),word('15-2',200,500),word('180,000',600,500,80),word('10,800,000',800,500,110)],1200,1600);
    return{original,recovered:recoverStatementMoney(original,candidate,crop),mismatch:recoverStatementMoney(original,candidate.replace('10,800,000','10,700,000'),crop),wrongLot:recoverStatementMoney(original,candidate.replace('15-2','15-3'),crop),wrongMountain:recoverStatementMoney(original,candidate.replace('15-2','산15-2'),crop),preserved:recoverStatementMoney(candidate,candidate.replace('180,000','200,000').replace('10,800,000','12,000,000'),crop),candidate,wrongArea:recoverStatementMoney(original,candidate.replace('120.000','121.000'),crop),noShare:recoverStatementMoney(original,candidate.replace('* 1/2',''),crop),crops};
  });
  expect(result.recovered).toContain('201 AEA 15-2 답 답 120.000 * 1/2 180,000 10,800,000');
  expect(result.recovered).toContain('표본동');
  for(const key of ['mismatch','wrongLot','wrongMountain','wrongArea','noShare'])expect(result[key]).toBe(result.original);
  expect(result.preserved).toBe(result.candidate);
  expect(result.crops).toHaveLength(1);expect(result.crops[0].y).toBeLessThan(500);expect(result.crops[0].serial).toBe('201');
});

test('표지 법인명은 확대 OCR의 완전한 기재를 우선하며 누락 수치는 0으로 표시하지 않는다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    let calls=0;
    window.Tesseract={OEM:{LSTM_ONLY:1},createWorker:async()=>({setParameters:async()=>{},recognize:async()=>{calls++;return calls===1?{data:{text:'(주)감정평가법인 가ABC',blocks:[{paragraphs:[{lines:[{text:'(주)감정평가법인 가ABC',bbox:{x0:100,y0:200,x1:500,y1:230},words:[]}]}]}]}}:{data:{text:'(주)감정평가법인 합성',blocks:[]}};},terminate:async()=>{}})};
    const pdf={numPages:1,getPage:async()=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve()})})};
    const {ocrPdfDocument}=await import('/ocr-source.js');const pages=await ocrPdfDocument(pdf);
    const parsed=BosangParser.parseAppraisalPages(pages,{appraisalId:'APP_001',fileName:'synthetic-cover.pdf'});
    BSOProductV2.store.ingestDocument({fileMeta:{name:'synthetic-cover.pdf'},pageModel:pages,parsed});
    BSOProductV2.store.state.appraisalResults=[{appraisal_id:'APP_001',land_id:'LAND_001',area:120,unit_price:180000,amount:10800000,official_price:null,time_correction:0,individual_factor_total:null,other_factor:null}];
    BSOProductV2.store.setRoute('valuation');
    return{company:parsed.appraisals[0].appraisal_company,calls};
  });
  expect(result.company).toBe('합성감정평가법인');expect(result.calls).toBe(2);
  const cells=await page.locator('table').first().locator('tbody tr').first().locator('td').allTextContents();
  expect(cells).toContain('—');expect(cells).toContain('0');
});
