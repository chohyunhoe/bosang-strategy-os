export function normalizeCellAddress(value){
  const lines=String(value??'').split(/\r?\n/).map(v=>v.replace(/\s+/g,' ').trim().replace(/^[|"'.]+(?=[가-힣])/,'').replace(/(?<=[가-힣])[|"'.]+$/,'')).filter(Boolean),out=[];
  for(const line of lines){const previous=out.at(-1)||'';if(/^[시도군구읍면동리가]$/.test(line)&&/^[가-힣]{2,}$/.test(previous)&&!/[시도군구읍면동리가]$/.test(previous))out[out.length-1]+=line;else out.push(line);}
  return out.join(' ');
}
export function cellAddressValid(value){
  const normalized=normalizeCellAddress(value),tokens=normalized.split(' ');
  if(!normalized||tokens.length>6||tokens.some(v=>!(/^[가-힣]{1,16}(?:시|도|군|구|읍|면|동|리)$/.test(v)||/^[가-힣0-9]{1,16}가$/.test(v))))return false;
  const ranks=tokens.map(v=>/(?:특별시|광역시|특별자치시|시)$/.test(v)?1:/도$/.test(v)?0:/(?:군|구)$/.test(v)?2:/(?:읍|면)$/.test(v)?3:4);
  if(ranks.some((rank,index)=>index>0&&rank<=ranks[index-1]))return false;
  return /(?:읍|면|동|리|가)$/.test(tokens.at(-1));
}
export function chooseCellAddress(readings){
  const candidates=readings.map((raw,index)=>({raw,index,value:normalizeCellAddress(raw)})).filter(r=>cellAddressValid(r.value));
  if(!candidates.length)return{status:'UNRESOLVED',index:0,value:normalizeCellAddress(readings[0])};
  const fits=(a,b)=>a===b||a.endsWith(' '+b)||b.endsWith(' '+a);
  if(candidates.some(a=>candidates.some(b=>!fits(a.value,b.value))))return{status:'CONFLICT',index:0,value:normalizeCellAddress(readings[0])};
  candidates.sort((a,b)=>b.value.length-a.value.length);return{status:'SOURCE_CANDIDATE',index:candidates[0].index,value:candidates[0].value};
}
// Ruled-table geometry is derived only from page pixels, never case coordinates.
export function detectRuledTables({width,height,data}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<200||height<200||!data||data.length<width*height*4)return [];
  const ink=new Uint8Array(width*height);
  for(let i=0,j=0;i<ink.length;i++,j+=4)ink[i]=data[j+3]>128&&Math.max(data[j],data[j+1],data[j+2])<210?1:0;
  const segments=[],minimum=Math.max(90,Math.round(width*.06));
  for(let y=0;y<height;y++){
    let start=-1,last=-1;
    const finish=()=>{if(start>=0&&last-start+1>=minimum)segments.push({left:start,right:last,y});start=-1;last=-1;};
    for(let x=0;x<width;x++){if(ink[y*width+x]){if(start<0)start=x;last=x;}else if(start>=0&&x-last>2)finish();}finish();
  }
  const lines=[];
  for(const s of segments){
    const line=lines.findLast(l=>s.y-l.maxY<=3&&s.y>=l.minY&&Math.min(s.right,l.right)-Math.max(s.left,l.left)>Math.max(20,.05*Math.min(s.right-s.left,l.right-l.left)));
    if(line){line.left=Math.min(line.left,s.left);line.right=Math.max(line.right,s.right);line.maxY=s.y;line.y=(line.minY+line.maxY)/2;}
    else lines.push({...s,minY:s.y,maxY:s.y});
  }
  const groups=[];
  for(const line of lines){let group=groups.find(g=>Math.abs(g.left-line.left)<=12&&Math.abs(g.right-line.right)<=12);if(!group){group={left:line.left,right:line.right,lines:[]};groups.push(group);}group.lines.push(line);}
  const tables=[];
  for(const group of groups){
    if(group.lines.length<3)continue;
    const boundaries=group.lines.sort((a,b)=>a.y-b.y).filter((l,i,a)=>i===0||l.y-a[i-1].y>=8);
    const rows=[];
    for(let i=0;i<boundaries.length-1;i++){
      const top=Math.round(boundaries[i].y),bottom=Math.round(boundaries[i+1].y),span=bottom-top;
      if(span<12||span>height*.2)continue;
      const xs=[];let active=[];
      const finish=()=>{if(active.length)xs.push(Math.round(active.reduce((a,b)=>a+b,0)/active.length));active=[];};
      for(let x=Math.max(0,group.left-3);x<=Math.min(width-1,group.right+3);x++){
        let hits=0,n=0;
        for(let y=top+3;y<bottom-2;y++){n++;if([-2,-1,0,1,2].some(dx=>x+dx>=0&&x+dx<width&&ink[y*width+x+dx]))hits++;}
        if(n&&hits/n>=.78)active.push(x);else finish();
      }finish();
      if(xs.length<4||xs.length>50||Math.abs(xs[0]-group.left)>8||Math.abs(xs.at(-1)-group.right)>8)continue;
      const cells=xs.slice(0,-1).map((left,j)=>({left,top,right:xs[j+1],bottom})).filter(c=>c.right-c.left>=14);
      if(cells.length>=3)rows.push({top,bottom,cells});
    }
    if(rows.length>=2)tables.push({left:group.left,right:group.right,top:rows[0].top,bottom:rows.at(-1).bottom,rows});
  }
  return tables.sort((a,b)=>a.top-b.top||a.left-b.left);
}

export function summaryTablePlans(tables) {
  return tables.flatMap((table,index)=>{
    const count=Math.max(...table.rows.map(row=>row.cells.length));
    if(count<6||count>10)return [];
    const rows=table.rows.slice(1).filter(row=>row.cells.length===count);
    if(rows.length<1)return [];
    const first=rows[0];
    if(first.top<=table.top)return [];
    return [{id:index,headers:first.cells.map(cell=>({...cell,top:table.top,bottom:first.top})),rows}];
  });
}

// Otsu threshold is computed before adding white OCR padding. This avoids a
// coloured header becoming one dark rectangle against the artificial border.
export function prepareCellImages(image,box,{splitLines=false,binary=false,inset=3,cleanLines=false}={}) {
  const pad=Math.max(0,Math.min(3,inset)),left=Math.ceil(box.left)+pad,top=Math.ceil(box.top)+pad;
  const width=Math.floor(box.right)-pad-left,height=Math.floor(box.bottom)-pad-top;
  if(width<5||height<5||left<0||top<0||left+width>image.width||top+height>image.height)return [];
  const gray=new Uint8Array(width*height),hist=new Uint32Array(256);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=((top+y)*image.width+left+x)*4;const v=Math.round((299*image.data[i]+587*image.data[i+1]+114*image.data[i+2])/1000);gray[y*width+x]=v;hist[v]++;}
  const n=gray.length,total=hist.reduce((sum,count,i)=>sum+count*i,0);let weight=0,sum=0,best=-1,threshold=128;
  for(let i=0;i<256;i++){weight+=hist[i];sum+=hist[i]*i;if(!weight||weight===n)continue;const score=weight*(n-weight)*(sum/weight-(total-sum)/(n-weight))**2;if(score>best){best=score;threshold=i;}}
  if(best<0)return [];
  const mask=Uint8Array.from(gray,v=>v<=threshold?1:0),removed=new Uint8Array(gray.length);
  if(splitLines||binary||cleanLines){
    for(let x=0;x<width;x++){let count=0;for(let y=0;y<height;y++)count+=mask[y*width+x];if(count>height*.8)for(let y=0;y<height;y++){mask[y*width+x]=0;removed[y*width+x]=1;}}
    for(let y=0;y<height;y++){let count=0;for(let x=0;x<width;x++)count+=mask[y*width+x];if(count>width*.85){mask.fill(0,y*width,(y+1)*width);removed.fill(1,y*width,(y+1)*width);}}
  }
  let regions=[{x:0,y:0,width,height}];
  if(splitLines){
    const bands=[];
    for(let y=0;y<height;y++){let count=0;for(let x=0;x<width;x++)count+=mask[y*width+x];if(count<2)continue;const band=bands.at(-1);if(band&&y-band.bottom<=3)band.bottom=y;else bands.push({top:y,bottom:y});}
    regions=bands.filter(b=>b.bottom-b.top>=3).flatMap(b=>{let x0=width,x1=-1;for(let y=b.top;y<=b.bottom;y++)for(let x=0;x<width;x++)if(mask[y*width+x]){x0=Math.min(x0,x);x1=Math.max(x1,x);}if(x1<0)return [];const x=Math.max(0,x0-2),y=Math.max(0,b.top-2);return [{x,y,width:Math.min(width,x1+3)-x,height:Math.min(height,b.bottom+3)-y}];});
  }
  return regions.map(r=>{const pixels=new Uint8Array(r.width*r.height);for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const i=(r.y+y)*width+r.x+x;pixels[y*r.width+x]=binary?(mask[i]?0:255):removed[i]?255:gray[i];}return {left:left+r.x,top:top+r.y,width:r.width,height:r.height,pixels};});
}

function editDistance(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=old;}}return row[b.length];}
export function matchesHeader(text,role){
  const value=String(text||'').replace(/[^가-힣]/g,'');const target={company:'평가업체',address:'소재지',lot:'지번',unit:'단가'}[role];if(!target)return false;
  for(let i=0;i<=value.length-target.length;i++)if(editDistance(value.slice(i,i+target.length),target)<=1)return true;
  return false;
}
export function readStrictNumber(text,money=false){
  const value=String(text||'').replace(/\s+/g,'');
  if(money&&/^\d{1,3}(?:[,.]\d{3}){2,}$/.test(value)){const n=Number(value.replace(/[,.]/g,''));return Number.isSafeInteger(n)?n:null;}
  if(!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,6})?$/.test(value))return null;
  const number=Number(value.replace(/,/g,''));return Number.isFinite(number)&&number>=0&&number<=Number.MAX_SAFE_INTEGER?number:null;
}
export function readAreaShare(text){
  const value=String(text||'').replace(/\s+/g,'');const parts=value.split(/[xX×*]/);if(parts.length>2)return null;
  const area=readStrictNumber(parts[0]);if(!(area>0))return null;
  if(parts.length===1)return {area,numerator:1,denominator:1,explicitShare:false};
  const share=/^(\d+)\/(\d+)$/.exec(parts[1]);if(!share)return null;const numerator=Number(share[1]),denominator=Number(share[2]);
  if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||numerator<=0||denominator<numerator)return null;
  return {area,numerator,denominator,explicitShare:true};
}
export function arithmeticMatches(area,unit,amount){return Boolean(area&&unit>0&&amount>0&&Number.isSafeInteger(unit)&&Number.isSafeInteger(amount)&&Math.abs(area.area*area.numerator/area.denominator*unit-amount)<=1);}

// A bounded format family, identified by four independent header anchors and
// the grid, not by file name, fixed page coordinates, or an amount guess.
export async function recognizeRuledSummaries(image,readCell,onProgress=()=>{}){
  const plans=summaryTablePlans(detectRuledTables(image));const output=[];let reads=0;
  const read=async(box,mode)=>{if(++reads>1600)throw new Error('RULED_OCR_CELL_LIMIT');return String(await readCell(box,mode)||'').trim();};
  for(const plan of plans.slice(0,8)){
    const n=plan.headers.length;const anchors={company:0,address:1,lot:2,unit:n-2};const headerEvidence={};let identified=true;
    for(const [role,index] of Object.entries(anchors)){headerEvidence[role]=await read(plan.headers[index],'header:'+role);if(!matchesHeader(headerEvidence[role],role)){identified=false;break;}}
    if(!identified)continue;
    const table={format:'COMPENSATION_SUMMARY_7_8',header_evidence:headerEvidence,columns:n,rows:[]};
    if(![7,8].includes(n))continue;
    for(let index=0;index<plan.rows.length;index++){
      const band=plan.rows[index];const raw={};
      // Read Korean fields together before numeric fields to avoid repeatedly
      // reinitializing the worker for each cell in the same row.
      for(const [field,col,mode] of [['company',0,'text'],['address',1,'address'],['land_category',3,'category']])raw[field]=await read(band.cells[col],mode);
      const addressReadings=[raw.address,await read(band.cells[1],'address-large'),await read(band.cells[1],'address-sparse')];
      const addressChoice=chooseCellAddress(addressReadings);raw.address=addressReadings[addressChoice.index];
      const companyReads=[raw.company];
      if(!/^[가-힣·]{2,20}$/.test(raw.company.replace(/\s/g,''))){for(const mode of ['text-small','text-pass6','text-binary'])companyReads.push(await read(band.cells[0],mode));const names=[...new Set(companyReads.map(v=>v.replace(/\s/g,'')).filter(v=>/^[가-힣·]{2,20}$/.test(v)))];raw.company=names.length===1?names[0]:'';}
      const koreanLot=(await read(band.cells[2],'lot-korean')).replace(/\s/g,'');
      const categories=[raw.land_category,await read(band.cells[3],'category-pass10'),await read(band.cells[3],'category-binary')].map(v=>v.replace(/\s/g,''));
      const validCategories=[...new Set(categories.filter(v=>/^(?:전|답|대|임야|도로|잡종지|공장용지|과수원|목장용지|학교용지|주차장|창고용지|하천|구거|유지|제방|철도용지|묘지|공원|체육용지|종교용지|사적지|광천지|염전|주유소용지)$/.test(v)))];
      raw.land_category=validCategories.length===1?validCategories[0]:'';
      for(const [field,col,mode] of [['lot',2,'lot'],['area',n-3,'area'],['unit_price',n-2,'number'],['amount',n-1,'number']])raw[field]=await read(band.cells[col],mode);
      const lotReadings=[raw.lot,await read(band.cells[2],'lot-pass7')].map(v=>v.replace(/\s/g,''));
      if(lotReadings[0]!==lotReadings[1])for(const mode of ['lot-pass6','lot-pass8'])lotReadings.push((await read(band.cells[2],mode)).replace(/\s/g,''));
      if(/산/.test(koreanLot))for(let i=0;i<lotReadings.length;i++)if(/^\d/.test(lotReadings[i]))lotReadings[i]='산'+lotReadings[i];
      if(/^(?:산)?\d{1,5}(?:-\d{1,5})?$/.test(koreanLot)&&!lotReadings.some(v=>v.replace(/-/g,'')===koreanLot.replace(/-/g,'')))lotReadings.push(koreanLot);
      const alternatives={address:addressReadings,company:companyReads,lot:lotReadings,lot_korean:[koreanLot],land_category:categories};
      const votes=[...new Set(lotReadings)].filter(v=>/^(?:산)?\d{1,5}(?:-\d{1,5})?$/.test(v)).map(v=>({v,n:lotReadings.filter(s=>s===v).length})).sort((a,b)=>b.n-a.n);const lot=votes.length===1&&votes[0].n>=2&&(!/산/.test(koreanLot)||/^산\d{1,5}(?:-\d{1,5})?$/.test(koreanLot))?votes[0].v:'';raw.lot=lot;
      let area=readAreaShare(raw.area),unit=readStrictNumber(raw.unit_price,true),amount=readStrictNumber(raw.amount,true);
      if(!arithmeticMatches(area,unit,amount)){
        const areaReads=[raw.area,await read(band.cells[n-3],'area-small')],unitReads=[raw.unit_price,await read(band.cells[n-2],'number-small')],amountReads=[raw.amount,await read(band.cells[n-1],'number-small')];
        alternatives.area=areaReads;alternatives.unit_price=unitReads;alternatives.amount=amountReads;
        for(const mode of ['tight','binary']){areaReads.push(await read(band.cells[n-3],'area-'+mode));unitReads.push(await read(band.cells[n-2],'number-'+mode));amountReads.push(await read(band.cells[n-1],'number-'+mode));}
        let choices=new Map();for(const a of areaReads)for(const u of unitReads)for(const m of amountReads){const aa=readAreaShare(a),uu=readStrictNumber(u,true),mm=readStrictNumber(m,true);if(arithmeticMatches(aa,uu,mm))choices.set(JSON.stringify([aa,uu,mm]),{a,u,m,aa,uu,mm});}
        if(choices.size===0){
          areaReads.push(await read(band.cells[n-3],'area-edge'));unitReads.push(await read(band.cells[n-2],'number-edge'));amountReads.push(await read(band.cells[n-1],'number-edge'));
          for(const mode of [6,8]){areaReads.push(await read(band.cells[n-3],'area-pass'+mode));unitReads.push(await read(band.cells[n-2],'number-pass'+mode));amountReads.push(await read(band.cells[n-1],'number-pass'+mode));}
          for(const a of areaReads)for(const u of unitReads)for(const m of amountReads){const aa=readAreaShare(a),uu=readStrictNumber(u,true),mm=readStrictNumber(m,true);if(arithmeticMatches(aa,uu,mm))choices.set(JSON.stringify([aa,uu,mm]),{a,u,m,aa,uu,mm});}
        }
        if(choices.size===0){
          for(const mode of ['best','best-small']){areaReads.push(await read(band.cells[n-3],'area-'+mode));unitReads.push(await read(band.cells[n-2],'number-'+mode));amountReads.push(await read(band.cells[n-1],'number-'+mode));}
          for(const a of areaReads)for(const u of unitReads)for(const m of amountReads){const aa=readAreaShare(a),uu=readStrictNumber(u,true),mm=readStrictNumber(m,true);if(arithmeticMatches(aa,uu,mm))choices.set(JSON.stringify([aa,uu,mm]),{a,u,m,aa,uu,mm});}
        }
        if(choices.size===1){const chosen=[...choices.values()][0];raw.area=chosen.a;raw.unit_price=chosen.u;raw.amount=chosen.m;area=chosen.aa;unit=chosen.uu;amount=chosen.mm;}
      }
      const identity=Boolean(lot&&/[가-힣]/.test(raw.address)&&/^[가-힣·]{2,20}$/.test(raw.company.replace(/\s/g,'')));
      const row={raw,alternatives,address_reading_status:addressChoice.status,lot,lot_readings:lotReadings,company:raw.company.replace(/\s/g,''),address:raw.address.replace(/\s+/g,' ').trim(),land_category:raw.land_category.replace(/\s/g,''),area:area?.area??null,numerator:area?.numerator??null,denominator:area?.denominator??null,unit_price:unit,amount,arithmetic_match:arithmeticMatches(area,unit,amount),identity_valid:identity,bbox:{left:band.cells[0].left,top:band.top,right:band.cells.at(-1).right,bottom:band.bottom},cell_boxes:band.cells};
      row.status=identity&&row.arithmetic_match?'ARITHMETIC_MATCH':'INCOMPLETE';table.rows.push(row);onProgress({phase:'ocr-grid-row',row:index+1,total:plan.rows.length,status:row.status});
    }
    output.push(table);
  }
  return output;
}

export function normalizedCellScale(region,targetHeight=32){
  const inkHeight=Math.max(1,Number(region?.height)-4);return Math.max(1,Math.min(4,targetHeight/inkHeight));
}
export function renderCellForOcr(region,scale=4){
  const base=document.createElement('canvas');base.width=region.width;base.height=region.height;const ctx=base.getContext('2d');if(!ctx)throw new Error('CELL_CANVAS_UNAVAILABLE');
  const image=ctx.createImageData(region.width,region.height);for(let i=0;i<region.pixels.length;i++){const v=region.pixels[i];image.data[i*4]=v;image.data[i*4+1]=v;image.data[i*4+2]=v;image.data[i*4+3]=255;}ctx.putImageData(image,0,0);
  const result=document.createElement('canvas');result.width=region.width*scale+40;result.height=region.height*scale+40;const target=result.getContext('2d');if(!target)throw new Error('CELL_CANVAS_UNAVAILABLE');target.imageSmoothingEnabled=true;target.imageSmoothingQuality='high';target.fillStyle='white';target.fillRect(0,0,result.width,result.height);target.drawImage(base,20,20,region.width*scale,region.height*scale);return result;
}
export async function recognizeCanvasSummaries(canvas,worker,onProgress=()=>{}){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx||typeof ctx.getImageData!=='function')return [];
  const image={width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
  if(!summaryTablePlans(detectRuledTables(image)).length)return [];
  let language='kor+eng';
  const selectLanguage=async next=>{if(language!==next&&worker.reinitialize){await worker.reinitialize(next);language=next;}};
  try{return await recognizeRuledSummaries(image,async(box,mode)=>{
    const header=mode.startsWith('header:'),role=header?mode.slice(7):'',addressMode=mode==='address'||mode.startsWith('address-');
    const best=mode.includes('-best'),coreMode=mode.replace('-best','');
    const pass=/-pass(\d+)$/.exec(coreMode),small=coreMode.endsWith('-small'),binary=mode.endsWith('-binary'),edge=mode.endsWith('-edge'),tight=mode.endsWith('-tight'),baseMode=addressMode?'address':coreMode.replace(/-(?:pass\d+|small|binary|edge|tight)$/,'');
    const numeric=['number','area','lot'].includes(baseMode);
    const primaryNumber=['number','area'].includes(baseMode)&&!pass&&!small&&!binary&&!edge&&!tight&&!best;
    await selectLanguage(numeric?(best?'eng':'eng_fast'):'kor');
    const whitelist={number:'0123456789,.',area:'0123456789,./xX×*',lot:'0123456789-',category:''}[baseMode]||'';
    await worker.setParameters?.({tessedit_pageseg_mode:header?'6':addressMode?(mode==='address-sparse'?'11':'6'):pass?pass[1]:'7',tessedit_char_whitelist:whitelist});
    const run=async region=>String((await worker.recognize(renderCellForOcr(region,addressMode?(mode==='address-large'?3:2):header||primaryNumber?4:normalizedCellScale(region,small||binary||edge?24:pass?40:32)),{},{text:true,blocks:false}))?.data?.text||'').trim();
    let text='';for(const region of prepareCellImages(image,box,{splitLines:!header&&!primaryNumber&&!addressMode||binary,binary,inset:edge?0:header||primaryNumber?3:1,cleanLines:!header&&!primaryNumber}))text+=await run(region)+'\n';
    if(header&&!matchesHeader(text,role)){await worker.setParameters?.({tessedit_pageseg_mode:'7',tessedit_char_whitelist:''});for(const region of prepareCellImages(image,box,{splitLines:true}))text+=await run(region)+'\n';}
    return text;
  },onProgress);}finally{await selectLanguage('kor+eng');await worker.setParameters?.({tessedit_pageseg_mode:'3',tessedit_char_whitelist:''});}
}
