'use strict';
const array=value=>Array.isArray(value)?value:[];
const text=value=>String(value??'').replace(/\s+/g,' ').trim();
function number(value,money=false){const s=text(value).replace(/\s/g,'');if(money&&/^\d{1,3}(?:[,.]\d{3}){2,}$/.test(s)){const n=Number(s.replace(/[,.]/g,''));return Number.isSafeInteger(n)?n:null;}if(!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,6})?$/.test(s))return null;const n=Number(s.replace(/,/g,''));return Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER?n:null;}
function areaShare(value){const s=text(value).replace(/\s/g,'').split(/[xX×*]/);if(s.length>2)return null;const area=number(s[0]);if(!(area>0))return null;if(s.length===1)return{area,numerator:1,denominator:1};const share=/^(\d+)\/(\d+)$/.exec(s[1]);if(!share)return null;const numerator=Number(share[1]),denominator=Number(share[2]);return Number.isSafeInteger(numerator)&&Number.isSafeInteger(denominator)&&numerator>0&&denominator>=numerator?{area,numerator,denominator}:null;}
// Preserve explicit area and numerator when only the denominator is unreadable.
// This is candidate evidence, never a completed share or an arithmetic match.
function partialAreaShare(value){const parts=text(value).replace(/\s/g,'').split(/[xX×*]/);if(parts.length!==2)return null;const area=number(parts[0]),m=/^(\d+)\/$/.exec(parts[1]);if(!(area>0)||!m)return null;const numerator=Number(m[1]);return Number.isSafeInteger(numerator)&&numerator>0?{area,numerator,denominator:null,shareIncomplete:true}:null;}
function normalizeCellAddress(value){
  const lines=String(value??'').split(/\r?\n/).map(v=>v.replace(/\s+/g,' ').trim().replace(/^[|"'.]+(?=[가-힣])/,'').replace(/(?<=[가-힣])[|"'.]+$/,'')).filter(Boolean),out=[];
  for(const line of lines){const previous=out.at(-1)||'';if(/^[시도군구읍면동리가]$/.test(line)&&/^[가-힣]{2,}$/.test(previous)&&!/[시도군구읍면동리가]$/.test(previous))out[out.length-1]+=line;else out.push(line);}
  return out.join(' ');
}
function cellAddressValid(value){
  const normalized=normalizeCellAddress(value),tokens=normalized.split(' ');
  if(!normalized||tokens.length>6||tokens.some(v=>!(/^[가-힣]{1,16}(?:시|도|군|구|읍|면|동|리)$/.test(v)||/^[가-힣0-9]{1,16}가$/.test(v))))return false;
  const ranks=tokens.map(v=>/(?:특별시|광역시|특별자치시|시)$/.test(v)?1:/도$/.test(v)?0:/(?:군|구)$/.test(v)?2:/(?:읍|면)$/.test(v)?3:4);
  if(ranks.some((rank,index)=>index>0&&rank<=ranks[index-1]))return false;
  return /(?:읍|면|동|리|가)$/.test(tokens.at(-1));
}
function chooseCellAddress(readings){
  const candidates=readings.map((raw,index)=>({raw,index,value:normalizeCellAddress(raw)})).filter(r=>cellAddressValid(r.value));
  if(!candidates.length)return{status:'UNRESOLVED',index:0,value:normalizeCellAddress(readings[0])};
  const fits=(a,b)=>a===b||a.endsWith(' '+b)||b.endsWith(' '+a);
  if(candidates.some(a=>candidates.some(b=>!fits(a.value,b.value))))return{status:'CONFLICT',index:0,value:normalizeCellAddress(readings[0])};
  candidates.sort((a,b)=>b.value.length-a.value.length);return{status:'SOURCE_CANDIDATE',index:candidates[0].index,value:candidates[0].value};
}
const cellAddress=normalizeCellAddress;
function compact(value){return text(value).replace(/[^가-힣]/g,'');}
function distance(a,b){const r=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=r[0];r[0]=i;for(let j=1;j<=b.length;j++){const old=r[j];r[j]=Math.min(r[j]+1,r[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old;}}return r[b.length];}
function validHeaders(table){const h=table.header_evidence||{};return table.format==='COMPENSATION_SUMMARY_7_8'&&[7,8].includes(table.columns)&&Object.entries({company:'평가업체',address:'소재지',lot:'지번',unit:'단가'}).every(([key,target])=>{const value=compact(h[key]);for(let i=0;i<=value.length-target.length;i++)if(distance(value.slice(i,i+target.length),target)<=1)return true;return false;});}
function applyRuledSummary(base,pages,context={}){
  if(['lands','land_appraisal_results','standard_lands','comp_cases','other_factor_reviews'].some(key=>array(base[key]).length))return base;
  const candidates=[],rejected=[];let observed=0;
  for(const page of array(pages))for(const table of array(page.ruled_tables)){
    if(!validHeaders(table))continue;
    for(const [index,row] of array(table.rows).entries()){
      observed++;
      const raw=row.raw||{},company=text(raw.company).replace(/\s/g,''),lot=text(raw.lot).replace(/\s/g,''),address=cellAddress(raw.address),category=text(raw.land_category).replace(/\s/g,'');
      const area=areaShare(raw.area)||partialAreaShare(raw.area),unit=number(raw.unit_price,true),amount=number(raw.amount,true);
      const valid=/^[가-힣·]{2,20}$/.test(company)&&/^(?:산)?\d{1,5}(?:-\d{1,5})?$/.test(lot)&&area&&/^(?:전|답|대|임야|도로|잡종지|공장용지|과수원|목장용지|학교용지|주차장|창고용지|하천|구거|유지|제방|철도용지|묘지|공원|체육용지|종교용지|사적지|광천지|염전|주유소용지)$/.test(category);
      const locationValid=cellAddressValid(address)&&!['CONFLICT','UNRESOLVED'].includes(row.address_reading_status);
      const bbox=row.bbox;const bounds=bbox&&['left','top','right','bottom'].every(k=>Number.isFinite(bbox[k]))&&bbox.left>=0&&bbox.top>=0&&bbox.right>bbox.left&&bbox.bottom>bbox.top&&bbox.right<=page.image_width&&bbox.bottom<=page.image_height;
      if(!valid||!bounds||!Number.isInteger(page.page_no)||page.page_no<1){rejected.push({page_no:page.page_no,row:index+1,reason:!bounds?'INVALID_SOURCE_BOUNDS':'INCOMPLETE_IDENTITY',raw:{...raw},alternatives:row.alternatives||{},bbox:bounds?{...bbox}:null});continue;}
      const match=Number.isSafeInteger(area.denominator)&&area.denominator>0&&Number.isSafeInteger(unit)&&unit>0&&Number.isSafeInteger(amount)&&amount>0&&Math.abs(area.area*area.numerator/area.denominator*unit-amount)<=1;
      candidates.push({company,lot,address:locationValid?address:'',candidateAddress:address,locationValid,category,area,unit,amount,match,page:page.page_no,index,bbox:{...bbox},raw,alternatives:row.alternatives||{}});
    }
  }
  if(!candidates.length)return observed?{...base,meta:{...base.meta,recognition_method:'AUTOMATIC_RULED_TABLE',recognition_rows:observed,recognition_checked_rows:0,recognition_unresolved:rejected}}:base;
  const compatibleAddress=(a,b)=>a===b||a.endsWith(' '+b)||b.endsWith(' '+a);
  for(const row of candidates){const pool=candidates.filter(other=>other.lot===row.lot&&other.area.area===row.area.area&&other.category===row.category&&row.locationValid&&other.locationValid&&compatibleAddress(other.address,row.address));row.ambiguous=pool.some(a=>pool.some(b=>!compatibleAddress(a.address,b.address)));}
  const appraisals=[],lands=[],results=[];const companies=new Map();const seenPairs=new Map();const unresolved=[...rejected];
  const ref=(row)=>({appraisal_id:companies.get(row.company),file_name:context.fileName||null,page_no:row.page,line_start:row.index+1,line_end:row.index+1,source_label:'자동 표 셀 OCR',raw_text_excerpt:Object.values(row.raw).map(text).join(' | ').slice(0,1000),ocr_address_readings:array(row.alternatives?.address).slice(0,3).map(text),bbox:row.bbox,extraction_method:'RULED_CELL_OCR'});
  for(const row of candidates){
    if(!companies.has(row.company)){const id=`${context.appraisalId||'APP_001'}_GRID_${String(companies.size+1).padStart(3,'0')}`;companies.set(row.company,id);appraisals.push({appraisal_id:id,appraisal_company:row.company,appraisal_company_origin:'EXPLICIT_TABLE_CELL',company_label_is_abbreviation:true,source_refs:[ref(row)],review_status_code:'NEEDS_REVIEW',auto_confirmed:false});}
    const address=row.locationValid?[row.address,row.lot].join(' '):'';const candidateAddress=[row.candidateAddress,row.lot].filter(Boolean).join(' ');const compatible=lands.filter(land=>row.locationValid&&land.location_recognition_status!=='UNRESOLVED'&&land.grid_lot===row.lot&&land.area===row.area.area&&land.land_category===row.category&&(!(row.ambiguous||land.grid_location_ambiguous)||land.parcel_address===address)&&(land.parcel_address===address||land.parcel_address.endsWith(' '+address)||address.endsWith(' '+land.parcel_address)));
    let land=compatible.length===1?compatible[0]:null;
    if(!land){land={land_id:`GRID_LAND_${String(lands.length+1).padStart(3,'0')}`,grid_lot:row.lot,grid_location_ambiguous:row.ambiguous,land_no:row.lot,parcel_address:address,candidate_parcel_address:candidateAddress,location_recognition_status:row.locationValid?'SOURCE_CANDIDATE':'UNRESOLVED',input_origin:'AUTOMATIC_RULED_TABLE',land_category:row.category,area:row.area.area,source_appraisal_ids:[],source_refs:[],review_status_code:row.locationValid?'NEEDS_REVIEW':'MISSING',auto_confirmed:false};lands.push(land);}
    if(address.length>land.parcel_address.length)land.parcel_address=address;
    const appraisalId=companies.get(row.company);land.source_appraisal_ids=[...new Set([...land.source_appraisal_ids,appraisalId])];land.source_refs.push(ref(row));
    const pair=appraisalId+'|'+land.land_id;
    if(seenPairs.has(pair)){const previous=seenPairs.get(pair);if(previous.candidate_unit_price!==row.unit||previous.candidate_amount!==row.amount||previous.ownership_share_numerator!==row.area.numerator||previous.ownership_share_denominator!==row.area.denominator){previous.unit_price=null;previous.amount=null;previous.review_status_code='MISSING';previous.recognition_status='CONFLICTING_TABLE_ROWS';unresolved.push({page_no:row.page,row:row.index+1,reason:'CONFLICTING_TABLE_ROWS'});}previous.source_refs.push(ref(row));continue;}
    const result={appraisal_result_id:`GRID_LAR_${String(results.length+1).padStart(3,'0')}`,appraisal_id:appraisalId,appraisal_company:row.company,land_id:land.land_id,parcel_address:address,candidate_parcel_address:candidateAddress,location_recognition_status:row.locationValid?'SOURCE_CANDIDATE':'UNRESOLVED',area:row.area.area,ownership_share_numerator:row.area.numerator,ownership_share_denominator:row.area.denominator,unit_price:row.match?row.unit:null,amount:row.match?row.amount:null,candidate_unit_price:row.unit,candidate_amount:row.amount,recognition_status:row.area.shareIncomplete?'SHARE_DENOMINATOR_UNREADABLE':row.match?'ARITHMETIC_MATCH':'ARITHMETIC_MISMATCH',source_refs:[ref(row)],review_status_code:row.match?'NEEDS_REVIEW':'MISSING',auto_confirmed:false,input_origin:'AUTOMATIC_RULED_TABLE'};
    if(!row.match)unresolved.push({page_no:row.page,row:row.index+1,reason:row.area.shareIncomplete?'SHARE_DENOMINATOR_UNREADABLE':'ARITHMETIC_MISMATCH',raw:{...row.raw},alternatives:row.alternatives,bbox:row.bbox});
    results.push(result);seenPairs.set(pair,result);
  }
  return {...base,appraisals,lands,land_appraisal_results:results,meta:{...base.meta,recognition_method:'AUTOMATIC_RULED_TABLE',recognition_rows:observed,recognition_location_unresolved_rows:results.filter(r=>r.location_recognition_status==='UNRESOLVED').length,recognition_checked_rows:results.filter(r=>r.recognition_status==='ARITHMETIC_MATCH').length,recognition_unresolved:unresolved,parser_notes:'표 경계·셀을 자동 검출한 요약표의 기재값입니다. 면적·지분·단가·금액을 대조했으며 법률판단·사람 검수·승인 기록을 대체하지 않습니다.'}};
}
module.exports={applyRuledSummary,validHeaders,areaShare,number,partialAreaShare,cellAddress,cellAddressValid,chooseCellAddress};
