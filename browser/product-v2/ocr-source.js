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
  // Sparse/table OCR may omit a whole row that the page pass read. Preserve
  // that original evidence only when the detail pass has no overlapping row
  // band. Within a reread band, keep the existing replacement policy so old
  // and new monetary/address cells are not mixed into a synthetic row.
  const sameBand=(a,b)=>{
    const height=Math.max(1,Math.min(a.height,b.height));
    const overlap=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
    return overlap>=height*.25||Math.abs(a.y+a.height/2-b.y-b.height/2)<=Math.max(4,height*.65);
  };
  const omittedRows=ocrWordRows(original).filter(row=>!row.items.some(item=>detail.some(word=>sameBand(item,word)))).flatMap(row=>row.items.filter(item=>!outside.includes(item)&&!preservedDong.includes(item)));
  return [...outside,...preservedDong,...omittedRows,...corrected];
}

function ocrWordRows(items) {
  const rows=[];
  for(const item of [...items].sort((a,b)=>(a.y+a.height/2)-(b.y+b.height/2)||a.x-b.x)){
    const center=item.y+item.height/2;const row=rows.at(-1);
    const overlap=row?Math.min(row.bottom,item.y+item.height)-Math.max(row.top,item.y):0;
    if(row&&(overlap>=Math.min(row.height,item.height)*.25||Math.abs(center-row.y)<=Math.max(4,Math.min(row.height,item.height)*.65))){row.items.push(item);row.top=Math.min(row.top,item.y);row.bottom=Math.max(row.bottom,item.y+item.height);}
    else rows.push({y:center,height:item.height,top:item.y,bottom:item.y+item.height,items:[item]});
  }
  return rows;
}

export function ocrWordLines(items) {
  return ocrWordRows(items).map(row=>row.items.sort((a,b)=>a.x-b.x).map(item=>item.str).join(' ')).join('\n');
}

// Read sparse statement rows independently: multi-line address cells otherwise
// scramble the row, while page-wide sparse OCR can lose amount digits.
export function statementRowCrops(items, width, height) {
  const anchors=items.filter(item=>/^\d{1,6}$/.test(item.str)&&item.x<width*.2&&item.y>height*.15);
  const crops=[];
  for(const anchor of anchors){
    const h=Math.max(8,anchor.height),center=anchor.y+anchor.height/2;
    const band=items.filter(item=>Math.abs(item.y+item.height/2-center)<=h*1.3);
    const lot=band.find(item=>/^(?:산)?\d{1,5}-\d{1,5}$/.test(item.str)&&item.x>anchor.x+anchor.width&&item.x<width*.4);
    const prices=band.filter(item=>item.x>width*.4&&/^\d[\d,.]*$/.test(item.str)&&Number(item.str.replace(/[,.]/g,''))>=1000);
    if(!lot||prices.length<2)continue;
    const y=Math.max(0,Math.floor(anchor.y-h*3-12)),bottom=Math.min(height,Math.ceil(anchor.y+h*3+24));
    if(crops.some(crop=>Math.abs(crop.y-y)<h*2))continue;
    crops.push({x:0,y,width,height:bottom-y,serial:anchor.str,lot:lot.str});
  }
  return crops.sort((a,b)=>a.y-b.y).filter((crop,index,all)=>!all.some((other,j)=>j!==index&&other.y<crop.y+crop.height&&crop.y<other.y+other.height));
}

// Adopt only directly OCR-read prices corroborated by the row's explicit
// area and share. Never calculate a missing price or replace address/category cells.
export function recoverStatementMoney(original, candidate, crop) {
  const lotKey=token=>(token.startsWith('산')?'산':'')+token.replace(/^산/,'').split('-').map(Number).join('-');
  const matches=line=>new RegExp('^\\s*'+crop.serial+'(?:\\s|$)').test(line)&&line.split(/\s+/).some(token=>/^(?:산)?\d{1,5}-\d{1,5}$/.test(token)&&lotKey(token)===lotKey(crop.lot));
  const candidateLine=candidate.split(/\r?\n/).find(matches);
  if(!candidateLine)return original;
  const number='(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  const moneyNumber='(?:\\d{1,3}(?:,\\d{3})+|\\d+)';
  const validShare=(n,d)=>Number.isSafeInteger(n)&&Number.isSafeInteger(d)&&n>0&&d>=n;
  const sameShare=(n,d,a,b)=>BigInt(n)*BigInt(b)===BigInt(a)*BigInt(d);
  const readRow=(line,allowDamagedMoney=false)=>{
    const tokens=[...line.matchAll(/\S+/g)];
    const lotIndex=tokens.findIndex(token=>/^(?:산)?\d{1,5}-\d{1,5}$/.test(token[0])&&lotKey(token[0])===lotKey(crop.lot));
    const areaToken=tokens.slice(lotIndex+1).find(token=>new RegExp('^'+number+'$').test(token[0]));
    if(lotIndex<0||!areaToken)return null;
    // Exactly two positional money cells; owner remarks may follow, but no
    // additional numeric cells. A damaged dot separator is source evidence only.
    const cell=allowDamagedMoney?'\\d[\\d,.]*':moneyNumber;
    const layout=line.slice(areaToken.index).match(new RegExp('^('+number+')\\s*[*×]\\s*(\\d+)(?:\\s*/\\s*(\\d+))?\\s+('+cell+')\\s+('+cell+')(?:\\s+(.+?))?\\s*$'));
    if(!layout)return null;
    const prices=[];
    for(const raw of layout.slice(4,6)){
      if(raw.length>24)return null;
      if(new RegExp('^'+moneyNumber+'$').test(raw)){
        const price=Number(raw.replace(/,/g,''));
        if(!Number.isSafeInteger(price)||price<1000)return null;
        prices.push(price);
      }else if(allowDamagedMoney&&/^\d{1,3}\.\d{4,}$/.test(raw))prices.push(null);
      else return null;
    }
    const trailer=(layout[6]||'').trim(),ownerShares=[];
    const words=trailer.replace(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/g,(_,n,d)=>{ownerShares.push([Number(n),Number(d)]);return '';});
    if(/\d/.test(words)||ownerShares.some(([n,d])=>!validShare(n,d)))return null;
    return{area:Number(layout[1].replace(/,/g,'')),numerator:Number(layout[2]),denominator:layout[3]===undefined?null:Number(layout[3]),prices,areaToken,trailer,ownerShares};
  };
  const recovered=readRow(candidateLine);
  if(!recovered||recovered.denominator===null)return original;
  const {area,numerator,denominator,prices}=recovered;
  if(!Number.isFinite(area)||area<=0||!validShare(numerator,denominator)||Math.abs(area*numerator/denominator*prices[0]-prices[1])>1)return original;
  if(recovered.ownerShares.some(([n,d])=>!sameShare(n,d,numerator,denominator)))return original;
  return original.split(/\r?\n/).map(line=>{
    if(!matches(line))return line;
    const explicit=line.match(/[*×]\s*(\d+)\s*\/\s*(\d+)(?=\s|$)/);
    if(explicit&&(!validShare(Number(explicit[1]),Number(explicit[2]))||!sameShare(Number(explicit[1]),Number(explicit[2]),numerator,denominator)))return line;
    const existing=readRow(line,true);
    if(!existing||existing.area!==area||existing.denominator!==null)return line;
    if(existing.ownerShares.some(([n,d])=>!sameShare(n,d,numerator,denominator)))return line;
    // Protect independently consistent whole-share or quantity rows.
    if(Number.isSafeInteger(existing.numerator)&&existing.numerator>0&&existing.prices.every(Number.isSafeInteger)&&Math.abs(existing.area*existing.numerator*existing.prices[0]-existing.prices[1])<=1)return line;
    const areaEnd=existing.areaToken.index+existing.areaToken[0].length;
    return line.slice(0,areaEnd)+' * '+numerator+'/'+denominator+' '+prices.map(value=>value.toLocaleString('en-US')).join(' ')+(existing.trailer?' '+existing.trailer:'');
  }).join('\n');
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
    const initialItems=items;
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
    if(/토지평가조/.test(compactText+value.replace(/\s/g,''))){
      let rowCrops=statementRowCrops(initialItems,canvas.width,canvas.height);
      if(!rowCrops.length)rowCrops=statementRowCrops(items,canvas.width,canvas.height);
      const recoveredRows=[];
      for(const rowCrop of rowCrops){
        const detail=document.createElement('canvas');detail.width=rowCrop.width*3;detail.height=rowCrop.height*3;
        const ctx=detail.getContext('2d');if(!ctx)continue;
        ctx.drawImage(canvas,rowCrop.x,rowCrop.y,rowCrop.width,rowCrop.height,0,0,detail.width,detail.height);
        await worker.setParameters?.({tessedit_pageseg_mode:'6'});
        const result=await worker.recognize(detail,{}, {text:true,blocks:true});
        const text=String(result?.data?.text||'').trim();
        const tokens=text.split(/\s+/),lotKey=token=>(token.startsWith('산')?'산':'')+token.replace(/^산/,'').split('-').map(Number).join('-');
        if(!tokens.includes(rowCrop.serial)||!tokens.some(token=>/^(?:산)?\d{1,5}-\d{1,5}$/.test(token)&&lotKey(token)===lotKey(rowCrop.lot)))continue;
        const words=wordBoxes(result?.data).map(item=>({...item,x:item.x/3+rowCrop.x,y:item.y/3+rowCrop.y,width:item.width/3,height:item.height/3}));
        if(!words.length)continue;
        recoveredRows.push({crop:rowCrop,text,words});
      }
      if(recoveredRows.length){
        const before=value;
        for(const row of recoveredRows)value=recoverStatementMoney(value,row.text,row.crop);
        if(value!==before)onProgress({phase:'ocr-statement-rows-completed',page:pageNo,row_count:recoveredRows.length});
      }
    }
    // A cover's company logo can be damaged by page/table segmentation.
    // Prefer an independently read complete identity line; retain it verbatim.
    if(pageNo<=2){
      const companyLines=[];
      for(const block of result?.data?.blocks||[])for(const paragraph of block?.paragraphs||[])for(const line of paragraph?.lines||[]){
        if(!/감정평가법인/.test(String(line.text||'').replace(/\s/g,''))||!line.bbox)continue;
        const b=line.bbox,pad=20,x=Math.max(0,b.x0-pad),y=Math.max(0,b.y0-pad);
        const w=Math.min(canvas.width-x,b.x1-b.x0+pad*2),h=Math.min(canvas.height-y,b.y1-b.y0+pad*2);
        if(w<=0||h<=0)continue;
        const detail=document.createElement('canvas');detail.width=w*3;detail.height=h*3;const ctx=detail.getContext('2d');if(!ctx)continue;
        ctx.drawImage(canvas,x,y,w,h,0,0,detail.width,detail.height);
        await worker.setParameters?.({tessedit_pageseg_mode:'6'});
        const focused=await worker.recognize(detail,{}, {text:true,blocks:true});
        for(const text of String(focused?.data?.text||'').split(/\r?\n/)){
          const compact=text.replace(/\s/g,'');
          const match=compact.match(/^(?:\(주\)|㈜|주식회사)감정평가법인([가-힣·]{2,15})$/)||compact.match(/^(?:\(주\)|㈜|주식회사)([가-힣·]{2,15})감정평가법인$/);
          if(match)companyLines.push({name:match[1],text:text.trim()});
        }
      }
      if(new Set(companyLines.map(line=>line.name)).size===1)value=companyLines[0].text+'\n'+value;
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

