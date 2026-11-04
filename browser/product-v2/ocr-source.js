let tesseractPromise = null;

function loadScript(src, marker) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-bso-v2-script="${marker}"]`);
    if (existing) {
      if (window.Tesseract) return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.bsoV2Script = marker;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`SCRIPT_LOAD_FAILED:${marker}`));
    document.head.appendChild(script);
  });
}

async function tesseract() {
  if (!tesseractPromise) {
    tesseractPromise = (async () => {
      if (!window.Tesseract) await loadScript('./vendor/tesseract/tesseract.min.js', 'tesseract');
      if (!window.Tesseract) throw new Error('TESSERACT_RUNTIME_UNAVAILABLE');
      return window.Tesseract;
    })();
  }
  return tesseractPromise;
}

function wordBoxes(data) {
  const words = [];
  for (const block of data?.blocks || []) for (const paragraph of block?.paragraphs || []) for (const line of paragraph?.lines || []) for (const word of line?.words || []) {
    if (!word?.text || !word?.bbox) continue;
    words.push({
      str: String(word.text),
      x: Number(word.bbox.x0) || 0,
      y: Number(word.bbox.y0) || 0,
      width: Math.max(0, (Number(word.bbox.x1) || 0) - (Number(word.bbox.x0) || 0)),
      height: Math.max(0, (Number(word.bbox.y1) || 0) - (Number(word.bbox.y0) || 0)),
      confidence: Number(word.confidence) || 0,
    });
  }
  return words;
}

async function createWorker(logger) {
  const Tesseract = await tesseract();
  const options = {
    workerPath: './vendor/tesseract/worker.min.js',
    corePath: './vendor/tesseract/core/',
    langPath: './vendor/tesseract/tessdata/',
    logger,
  };
  const oem = Tesseract.OEM?.LSTM_ONLY ?? 1;
  try { return await Tesseract.createWorker(['kor', 'eng'], oem, options); }
  catch (error) { return Tesseract.createWorker('kor+eng', oem, options); }
}

// Widely separated table headers and bottom-aligned data rows need their own OCR viewport.
export function sparseTableCrop(canvas, context, tableLike = false) {
  const {width,height}=canvas;if(width<400||height<400)return null;
  let pixels;try{pixels=context.getImageData(0,0,width,height).data;}catch(_){return null;}
  const active=[];
  for(let y=0;y<height;y+=2){let ink=0;for(let x=0;x<width;x+=4){const at=(y*width+x)*4;if(pixels[at+3]>128&&pixels[at]<190&&pixels[at+1]<190&&pixels[at+2]<190)ink++;}active.push({y,ink});}
  let gapStart=null,best=null;
  for(const row of active){
    if(row.ink<8){if(gapStart===null)gapStart=row.y;continue;}
    if(gapStart!==null){const length=row.y-gapStart;if(gapStart>height*.15&&row.y>height*.45&&row.y<height*.94&&length>=height*.08&&active.filter(next=>next.y>=row.y&&next.ink>=8).length>=3&&(!best||length>best.length))best={y:Math.max(0,row.y-18),length};}
    gapStart=null;
  }
  if(!best){
    const content=active.filter(row=>row.ink>=8);if(!content.length)return null;
    const first=content[0].y,last=content.at(-1).y;
    if(!tableLike&&last>=height*.6)return null;
    return{x:0,y:Math.max(0,first-18),width,height:Math.min(height-Math.max(0,first-18),last-first+42)};
  }
  const tail=active.filter(row=>row.y>=best.y&&row.ink>=8);if(tail.length<3)return null;
  return{x:0,y:best.y,width,height:Math.min(height-best.y,tail.at(-1).y-best.y+24)};
}

export function mergeTableOcrWords(original,detail,crop) {
  const outside=original.filter(item=>item.y+item.height<=crop.y||item.y>=crop.y+crop.height);
  const overlaps=(a,b)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
  const isDong=item=>/^[가-힣]{2,12}(?:동|리|읍|면)$/.test(item.str);
  const preservedDong=original.filter(item=>isDong(item)&&!outside.includes(item)&&!detail.some(word=>isDong(word)&&overlaps(word,item)));
  const corrected=detail.filter(item=>!preservedDong.some(word=>overlaps(word,item))).map(item=>{
    // Keep an explicitly recognized hyphenated lot when the detail pass drops only the hyphen.
    const prior=original.find(word=>/^(?:산)?\d{1,5}-\d{1,5}$/.test(word.str)&&word.str.replace('-','')===item.str&&Math.abs(word.x-item.x)<Math.max(word.width,item.width)&&Math.abs(word.y-item.y)<Math.max(word.height,item.height));
    return prior||item;
  });
  return [...outside,...preservedDong,...corrected];
}

export function ocrWordLines(items) {
  const rows=[];
  for(const item of [...items].sort((a,b)=>(a.y+a.height/2)-(b.y+b.height/2)||a.x-b.x)){
    const center=item.y+item.height/2;const row=rows.at(-1);
    const overlap=row?Math.min(row.bottom,item.y+item.height)-Math.max(row.top,item.y):0;
    if(row&&(overlap>=Math.min(row.height,item.height)*.25||Math.abs(center-row.y)<=Math.max(4,Math.min(row.height,item.height)*.65))){row.items.push(item);row.top=Math.min(row.top,item.y);row.bottom=Math.max(row.bottom,item.y+item.height);}
    else rows.push({y:center,height:item.height,top:item.y,bottom:item.y+item.height,items:[item]});
  }
  return rows.map(row=>row.items.sort((a,b)=>a.x-b.x).map(item=>item.str).join(' ')).join('\n');
}

export async function ocrPdfDocument(pdfDocument, onProgress = () => {}, options = {}) {
  const pages = [];
  const requestedPages=Array.isArray(options.pageNumbers)?options.pageNumbers:[];
  const pageNumbers=(requestedPages.length?requestedPages:Array.from({length:pdfDocument.numPages},(_,index)=>index+1)).filter((pageNo)=>Number.isInteger(pageNo)&&pageNo>=1&&pageNo<=pdfDocument.numPages);
  const requestedWorkerCount=Math.max(1,Math.min(2,Number(options.workerCount)||1,pageNumbers.length||1));
  const workerLogger=(message)=>onProgress({phase:'ocr',...message});
  const workers=[await createWorker(workerLogger)];
  if(requestedWorkerCount>1){try{workers.push(await createWorker(workerLogger));}catch(error){onProgress({phase:'ocr-worker-fallback',parallel_count:1,error_code:'OCR_SECOND_WORKER_UNAVAILABLE'});}}
  onProgress({phase:'ocr-workers-ready',parallel_count:workers.length,total:pageNumbers.length});
  const completed={count:0};
  const processPage=async(worker,pageNo)=>{
    const pageStarted=performance.now();
    const canvas=document.createElement('canvas');const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('CANVAS_2D_UNAVAILABLE');
    const page=await pdfDocument.getPage(pageNo);const base=page.getViewport({scale:1});const scale=Math.min(2.2,Math.max(1.35,1800/Math.max(1,base.width)));const viewport=page.getViewport({scale});
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);context.clearRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:context,viewport}).promise;
    const result=await worker.recognize(canvas,{}, {text:true,blocks:true});let value=String(result?.data?.text||'').trim();let items=wordBoxes(result?.data);
    const tableLike=/(?:토\s*지\s*(?:평\s*가\s*조\s*서|가\s*격\s*산\s*출)|비\s*교\s*표\s*준\s*지|공\s*시\s*지\s*가|개\s*별\s*요\s*인)/.test(value);
    const compactText=value.replace(/\s/g,'');
    const hasTableColumns=['소재지','지번','지목','면적','감정평가액','단가'].filter(label=>compactText.includes(label)).length>=3;
    const originalDongLines=[...new Set(value.split(/\r?\n/).map(line=>line.replace(/\s/g,'')).filter(line=>/^[가-힣]{2,10}(?:동|리|읍|면)$/.test(line)))];
    const crop=sparseTableCrop(canvas,context,tableLike||hasTableColumns);
    if(crop){
      const detail=document.createElement('canvas');detail.width=crop.width*2;detail.height=crop.height*2;const detailContext=detail.getContext('2d');
      if(detailContext){
        detailContext.drawImage(canvas,crop.x,crop.y,crop.width,crop.height,0,0,detail.width,detail.height);
        let recovered;
        try { await worker.setParameters?.({tessedit_pageseg_mode: '11'}); recovered=await worker.recognize(detail,{}, {text:true,blocks:true}); }
        finally { await worker.setParameters?.({tessedit_pageseg_mode: '6'}); }
        const cropItems=wordBoxes(recovered?.data).map(item=>({...item,x:item.x/2+crop.x,y:item.y/2+crop.y,width:item.width/2,height:item.height/2}));
        if(cropItems.length){items=mergeTableOcrWords(items,cropItems,crop);value=ocrWordLines(items);if(originalDongLines.length===1&&!value.split(/\r?\n/).some(line=>line.replace(/\s/g,'')===originalDongLines[0]))value+='\n'+originalDongLines[0];onProgress({phase:'ocr-table-crop-completed',page:pageNo});}
      }
    }
    pages.push({page_no:pageNo,text:value,items,line_count:value?value.split(/\r?\n/).filter(Boolean).length:0,source_type:'LOCAL_BROWSER_OCR',extraction_method:'Tesseract.js kor+eng',auto_confirmed:false,review_status_code:'NEEDS_REVIEW'});
    completed.count+=1;onProgress({phase:'page',page:pageNo,selection_index:completed.count,total:pageNumbers.length});onProgress({phase:'ocr-page-completed',page:pageNo,selection_index:completed.count,total:pageNumbers.length,elapsed_ms:Math.round(performance.now()-pageStarted)});
  };
  try {
    await Promise.all(workers.map((worker,workerIndex)=>(async()=>{for(let index=workerIndex;index<pageNumbers.length;index+=workers.length)await processPage(worker,pageNumbers[index]);})()));
    return pages.sort((a,b)=>a.page_no-b.page_no);
  } finally {
    await Promise.all(workers.map(async(worker)=>{try{await worker.terminate();}catch(error){}}));
  }
}
