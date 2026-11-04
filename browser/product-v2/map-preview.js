import { recordDiagnosticEvent } from './session-diagnostics.js';

let mapPreviewRenderSequence = 0;

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));

const ROLE_STYLE = Object.freeze({
  TARGET:{ label:'대상토지', fill:'rgba(255,214,0,.42)', stroke:'#d19a00', text:'#171717' },
  SUBJECT:{ label:'대상토지', fill:'rgba(255,214,0,.42)', stroke:'#d19a00', text:'#171717' },
  STANDARD:{ label:'비교표준지', fill:'rgba(214,53,53,.30)', stroke:'#bd2d2d', text:'#171717' },
  CASE:{ label:'평가·거래사례', fill:'rgba(0,229,255,.58)', stroke:'#00d4f0', text:'#071b22' },
  TRANSACTION:{ label:'평가·거래사례', fill:'rgba(0,229,255,.58)', stroke:'#00d4f0', text:'#071b22' },
  FIELD_ACTIVE:{ label:'FIELD ACTIVE', fill:'rgba(176,51,73,.25)', stroke:'#a02e45', text:'#7f2437' },
  FIELD_REVIEW:{ label:'FIELD REVIEW', fill:'rgba(88,96,108,.18)', stroke:'#59616a', text:'#444b54' },
  OTHER:{ label:'OTHER', fill:'rgba(90,98,108,.15)', stroke:'#5a626c', text:'#444b54' },
});

function roleKey(role) { const key=String(role||'').toUpperCase(); return ROLE_STYLE[key] ? key : 'OTHER'; }
function roleStyle(role) { return ROLE_STYLE[roleKey(role)]; }
function roleClass(role) {
  const key=roleKey(role);
  if (key==='TARGET'||key==='SUBJECT') return 'map-target';
  if (key==='STANDARD') return 'map-standard';
  if (key==='CASE'||key==='TRANSACTION') return 'map-case';
  if (key==='FIELD_ACTIVE') return 'map-field-active';
  if (key==='FIELD_REVIEW') return 'map-field-review';
  return 'map-other';
}

function pointsFromGeometry(geometry) {
  const points=[];
  const walk=(node)=>{
    if(!Array.isArray(node))return;
    if(node.length>=2&&Number.isFinite(Number(node[0]))&&Number.isFinite(Number(node[1]))){points.push([Number(node[0]),Number(node[1])]);return;}
    node.forEach(walk);
  };
  walk(geometry?.coordinates);
  return points;
}

function bounds(features) {
  const points=features.flatMap((feature)=>pointsFromGeometry(feature.geometry));
  if(!points.length)return null;
  const xs=points.map((point)=>point[0]);const ys=points.map((point)=>point[1]);
  return{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};
}

function boundsProjector(box,width,height,padding=24){
  const spanX=Math.max(1e-9,box.maxX-box.minX);const spanY=Math.max(1e-9,box.maxY-box.minY);
  const scale=Math.min((width-padding*2)/spanX,(height-padding*2)/spanY);
  const xOffset=(width-spanX*scale)/2;const yOffset=(height-spanY*scale)/2;
  return([x,y])=>[xOffset+(Number(x)-box.minX)*scale,height-(yOffset+(Number(y)-box.minY)*scale)];
}

function mercatorWorld([lon,lat],zoom){
  const safeLat=Math.max(-85.05112878,Math.min(85.05112878,Number(lat)));const sin=Math.sin(safeLat*Math.PI/180);const scale=256*(2**Number(zoom));
  return[(Number(lon)+180)/360*scale,(0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale];
}
function mercatorNormalized([lon,lat]){
  const safeLat=Math.max(-85.05112878,Math.min(85.05112878,Number(lat)));const sin=Math.sin(safeLat*Math.PI/180);
  return[(Number(lon)+180)/360,0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI)];
}
function inverseMercator([x,y]){
  return[x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI];
}
function mercatorProjector(background,width,height){
  const center=mercatorWorld(background.center,background.zoom);
  return(point)=>{const world=mercatorWorld(point,background.zoom);return[width/2+(world[0]-center[0]),height/2+(world[1]-center[1])];};
}

function layoutFor(preview,valid){
  const background=preview?.view?.background||null;
  const size=Array.isArray(background?.size)?background.size:[];
  const width=Number(size[0])||900;const height=Number(size[1])||520;
  if(background&&background.projection==='WEB_MERCATOR_TILE_256'&&Array.isArray(background.center)&&Number.isFinite(Number(background.zoom))){
    return{width,height,project:mercatorProjector(background,width,height),background};
  }
  const box=bounds(valid.features);if(!box)return null;
  return{width,height,project:boundsProjector(box,width,height),background:null};
}

function linePath(line,project,close=false){return(line||[]).map((point,index)=>{const[x,y]=project(point);return`${index?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`;}).join(' ')+(close?' Z':'');}
function pathForGeometry(geometry,project,style){
  if(!geometry)return'';
  const paint=`fill:${style.fill};stroke:${style.stroke};stroke-width:3`;
  if(geometry.type==='Point'){const[x,y]=project(geometry.coordinates);return`<circle class="map-point-fallback" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="8" style="${paint}"/>`;}
  if(geometry.type==='LineString')return`<path d="${linePath(geometry.coordinates,project)}" style="${paint};fill:none"/>`;
  if(geometry.type==='Polygon')return`<path fill-rule="evenodd" d="${(geometry.coordinates||[]).map((ring)=>linePath(ring,project,true)).join(' ')}" style="${paint}"/>`;
  if(geometry.type==='MultiPolygon')return(geometry.coordinates||[]).map((polygon)=>`<path fill-rule="evenodd" d="${polygon.map((ring)=>linePath(ring,project,true)).join(' ')}" style="${paint}"/>`).join('');
  return'';
}
function projectedBox(feature,project){
  const points=pointsFromGeometry(feature?.geometry);if(!points.length)return null;
  const projected=points.map(project);const xs=projected.map((point)=>point[0]);const ys=projected.map((point)=>point[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  return{minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
}
function labelForFeature(feature){return String(feature?.properties?.display_label||feature?.properties?.label||'').trim();}
function mapLabel(feature,style){
  const address=String(feature?.properties?.parcel_address||'소재지 확인 필요').trim();
  return{role:`[${style.label}]`,address};
}
function overlaps(a,b,pad=3){return!(a.maxX+pad<b.minX||a.minX-pad>b.maxX||a.maxY+pad<b.minY||a.minY-pad>b.maxY);}
function labelPlacement(feature,project,width,height,occupied,index=0,style=ROLE_STYLE.OTHER){
  const box=projectedBox(feature,project);const label=mapLabel(feature,style);if(!box)return null;
  const w=Math.max(76,Math.max(label.role.length,label.address.length)*11+14),h=40,gap=12;
  const candidates=[
    [box.cx,box.minY-gap-h/2],[box.maxX+gap+w/2,box.cy],[box.cx,box.maxY+gap+h/2],[box.minX-gap-w/2,box.cy],
    [box.maxX+gap+w/2,box.minY-gap-h/2],[box.minX-gap-w/2,box.minY-gap-h/2],
  ];
  const ordered=candidates.map((_,i)=>candidates[(i+index)%candidates.length]);
  let chosen=null;
  for(const [x,y] of ordered){const rect={minX:x-w/2,maxX:x+w/2,minY:y-h/2,maxY:y+h/2};if(rect.minX<8||rect.maxX>width-8||rect.minY<8||rect.maxY>height-8)continue;if(!occupied.some((other)=>overlaps(rect,other))){chosen={x,y,rect};break;}}
  if(!chosen){const[x,y]=ordered[0];chosen={x:Math.max(w/2+8,Math.min(width-w/2-8,x)),y:Math.max(h/2+8,Math.min(height-h/2-8,y))};chosen.rect={minX:chosen.x-w/2,maxX:chosen.x+w/2,minY:chosen.y-h/2,maxY:chosen.y+h/2};}
  occupied.push(chosen.rect);return{...chosen,anchor:[box.cx,box.cy],box,needsInset:Math.max(box.width,box.height)<42};
}
function featureSvg(feature,project,style,placement){
  const path=pathForGeometry(feature.geometry,project,style);const label=mapLabel(feature,style);const id=labelForFeature(feature);
  if(!placement)return path;
  const{x,y,anchor}=placement;const leader=`<path class="map-label-leader" d="M${anchor[0].toFixed(2)},${anchor[1].toFixed(2)} L${x.toFixed(2)},${y.toFixed(2)}" style="fill:none;stroke:${style.stroke};stroke-width:1.5;stroke-dasharray:3 2"/>`;
  return`${path}${leader}<g class="map-feature-label" data-map-label="${esc(id)}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)})"><text text-anchor="middle" style="font-family:'Malgun Gothic','Noto Sans KR',sans-serif;fill:${style.text};stroke:#fff;stroke-width:5px;paint-order:stroke;stroke-linejoin:round"><tspan x="0" y="-5" style="font-size:14px;font-weight:900">${esc(label.role)}</tspan><tspan x="0" y="13" style="font-size:13px;font-weight:800">${esc(label.address)}</tspan></text></g>`;
}
function insetSlots(width,height,features,project,count,occupied=[]){
  const panelW=220,panelH=160,m=24;const candidates=[{x:m,y:m},{x:width-panelW-m,y:m},{x:m,y:height-panelH-m},{x:width-panelW-m,y:height-panelH-m},{x:m,y:(height-panelH)/2},{x:width-panelW-m,y:(height-panelH)/2}];
  const featureBoxes=features.map((feature)=>projectedBox(feature,project)).filter(Boolean);
  return candidates.map((slot)=>{const panel={minX:slot.x,maxX:slot.x+panelW,minY:slot.y,maxY:slot.y+panelH};return{...slot,score:featureBoxes.filter((box)=>overlaps(panel,box,6)).length*2+occupied.filter((box)=>overlaps(panel,box,4)).length};}).sort((a,b)=>a.score-b.score).slice(0,count);
}
function insetView(feature,panelW,panelH){
  const points=pointsFromGeometry(feature?.geometry);if(!points.length)return null;const projected=points.map(mercatorNormalized);const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);const center=inverseMercator([(minX+maxX)/2,(minY+maxY)/2]);const spanX=Math.max(1e-12,maxX-minX),spanY=Math.max(1e-12,maxY-minY);let zoom=18;for(;zoom>6;zoom-=1){const scale=256*(2**zoom);if(spanX*scale<=panelW-48&&spanY*scale<=panelH-40)break;}return{center,zoom};
}
function insetBackgroundUrl(background,view,panelW,panelH){
  if(!background?.url||!view)return'';
  try{const url=new URL(background.url);const scale=view.zoom<18?2:1;url.searchParams.set('center',`${view.center[0]},${view.center[1]}`);url.searchParams.set('zoom',String(Math.min(18,view.zoom+(scale===2?1:0))));url.searchParams.set('size',`${panelW*scale},${panelH*scale}`);url.searchParams.set('basemap',background.basemap==='PHOTO_HYBRID'?'PHOTO_HYBRID':'PHOTO');url.searchParams.delete('marker');url.searchParams.delete('layers');return url.toString();}catch(_error){return'';}
}
function prioritizedInsets(items,mainProject){
  return[...items].sort((a,b)=>{const ab=projectedBox(a.feature,mainProject),bb=projectedBox(b.feature,mainProject);const as=ab?Math.max(ab.width,ab.height):Infinity,bs=bb?Math.max(bb.width,bb.height):Infinity;return as-bs;});
}
function insetSvg(items,width,height,allFeatures,mainProject,background,occupied=[],clipScope='0'){
  const selected=prioritizedInsets(items,mainProject).slice(0,6);const slots=insetSlots(width,height,allFeatures,mainProject,selected.length,occupied);
  return selected.map((item,index)=>{
    const panelW=220,panelH=160,headerH=30,x=slots[index].x,y=slots[index].y;
    const pts=pointsFromGeometry(item.feature.geometry);if(!pts.length)return'';const view=insetView(item.feature,panelW,panelH-headerH);if(!view)return'';const local=mercatorProjector(view,panelW,panelH-headerH);const project=(p)=>{const[a,b]=local(p);return[x+a,y+headerH+b];};const fallbackBox=bounds([item.feature]);const fallbackLocal=fallbackBox?boundsProjector(fallbackBox,panelW,panelH-headerH,28):null;const fallbackProject=(p)=>{const[a,b]=fallbackLocal(p);return[x+a,y+headerH+b];};const imageUrl=insetBackgroundUrl(background,view,panelW,panelH-headerH);const label=mapLabel(item.feature,item.style);const clipId=`map-inset-clip-${clipScope}-${index}-${labelForFeature(item.feature).replace(/[^0-9A-Za-z가-힣]/g,'')}`;
    return`<g class="map-inset" data-map-inset="${esc(labelForFeature(item.feature))}" data-pnu-exact="${esc(item.feature?.properties?.pnu||'')}"><defs><clipPath id="${esc(clipId)}"><rect x="${x}" y="${y+headerH}" width="${panelW}" height="${panelH-headerH}"/></clipPath></defs><rect x="${x+7}" y="${y+7}" width="${panelW+2}" height="${panelH+2}" rx="5" style="fill:rgba(0,0,0,.35);stroke:none"/><rect x="${x-3}" y="${y-3}" width="${panelW+6}" height="${panelH+6}" rx="5" style="fill:#fff;stroke:#fff;stroke-width:7"/><rect x="${x}" y="${y}" width="${panelW}" height="${panelH}" rx="2" style="fill:#eef1f4;stroke:#172231;stroke-width:3"/><g clip-path="url(#${esc(clipId)})"><g class="map-inset-vector-fallback" data-map-inset-fallback>${fallbackLocal?pathForGeometry(item.feature.geometry,fallbackProject,item.style):''}</g>${imageUrl?`<image data-map-inset-image data-src="${esc(imageUrl)}" x="${x}" y="${y+headerH}" width="${panelW}" height="${panelH-headerH}" preserveAspectRatio="none"/>`:''}${pathForGeometry(item.feature.geometry,project,item.style)}</g><rect x="${x}" y="${y}" width="${panelW}" height="${headerH}" style="fill:rgba(255,255,255,.95);stroke:#172231;stroke-width:1"/><text x="${x+8}" y="${y+13}" style="font:900 12px 'Malgun Gothic',sans-serif;fill:#111820">${esc(label.role)} ${esc(label.address)}</text><text x="${x+8}" y="${y+25}" style="font:700 9px 'Malgun Gothic',sans-serif;fill:#4b5563">항공사진 · PNU exact 지적경계</text></g>`;
  }).join('');
}

function hydrateInsetImage(image){
  const source=image?.getAttribute?.('data-src');if(!source)return Promise.resolve(false);
  return new Promise((resolve)=>{let settled=false;const finish=(ok)=>{if(settled)return;settled=true;clearTimeout(timer);image.onload=null;image.onerror=null;if(ok)image.setAttribute('data-loaded','true');else{image.removeAttribute('href');image.setAttribute('data-load-failed','true');}resolve(ok);};const timer=setTimeout(()=>finish(false),5000);image.onload=()=>finish(true);image.onerror=()=>finish(false);image.setAttribute('href',source);});
}
export async function hydrateMapInsetImages(root=document){
  const candidates=[...(root?.querySelectorAll?.('image[data-map-inset-image][data-src]:not([data-loaded]):not([data-loading])')||[])];
  const images=candidates.filter((image)=>{if(image.getAttribute('data-loaded')||image.getAttribute('data-loading'))return false;image.setAttribute('data-loading','true');return true;});
  let attempted=0,loadedCount=0,retryCount=0;for(const image of images){attempted+=1;let loaded=await hydrateInsetImage(image);if(!loaded){retryCount+=1;await new Promise((resolve)=>setTimeout(resolve,180));loaded=await hydrateInsetImage(image);}if(loaded)loadedCount+=1;image.removeAttribute('data-loading');}
  if(attempted)recordDiagnosticEvent('MAP_INSET_BATCH_COMPLETED',{inset_count:attempted,loaded_count:loadedCount,retry_count:retryCount,failure_count:attempted-loadedCount});
}
function orderedLayers(layers){const order={CASE:1,TRANSACTION:1,STANDARD:2,TARGET:3,SUBJECT:3};return[...layers].sort((a,b)=>(order[roleKey(a.role)]||0)-(order[roleKey(b.role)]||0));}

export function validateMapPreview(preview){
  if(!preview||typeof preview!=='object')return{ok:false,reason:'MAP_JSON_INVALID'};
  if(preview.artifact_type!=='LK_MAP_PREVIEW')return{ok:false,reason:'MAP_ARTIFACT_TYPE_MISMATCH'};
  const layers=Array.isArray(preview.layers)?preview.layers:[];
  const features=layers.flatMap((layer)=>Array.isArray(layer?.feature_collection?.features)?layer.feature_collection.features:[]);
  if(!features.length)return{ok:false,reason:'MAP_FEATURES_EMPTY'};
  return{ok:true,layers,features};
}

export function renderMapPreview(preview){
  const valid=validateMapPreview(preview);if(!valid.ok)return`<div class="empty">지도 미리보기 데이터가 없습니다.</div>`;
  const layout=layoutFor(preview,valid);if(!layout)return`<div class="empty">렌더링 가능한 지도 좌표가 없습니다.</div>`;
  const clipScope=String(++mapPreviewRenderSequence);const occupied=[];const insetItems=[];let featureIndex=0;
  const svgLayers=orderedLayers(valid.layers).map((layer)=>{const role=layer.role||'OTHER';const style=roleStyle(role);const features=layer?.feature_collection?.features||[];return`<g class="${roleClass(role)}" data-role="${esc(roleKey(role))}">${features.map((feature)=>{const placement=labelPlacement(feature,layout.project,layout.width,layout.height,occupied,featureIndex++,style);if(placement?.needsInset&&feature.geometry?.type!=='Point')insetItems.push({feature,style});return featureSvg(feature,layout.project,style,placement);}).join('')}</g>`;}).join('');
  const allowInsets=preview?.presentation?.insets!==false;const insets=allowInsets?insetSvg(insetItems,layout.width,layout.height,valid.features,layout.project,layout.background,occupied,clipScope):'';
  const backgroundUrl=layout.background?.url;
  const backgroundLabel=backgroundUrl?`VWorld ${layout.background?.basemap==='PHOTO_HYBRID'?'Hybrid':'Satellite'}`:'없음(벡터 검토)';
  const background=backgroundUrl?`<img class="map-basemap" alt="VWorld ${layout.background?.basemap==='PHOTO_HYBRID'?'하이브리드':'새틀라이트'} 배경지도" src="${esc(backgroundUrl)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill">`:'';
  const emptyBackground=backgroundUrl?'':'<rect class="map-empty-background" x="0" y="0" width="100%" height="100%"/>';
  const north=`<g class="map-north" transform="translate(${layout.width-42} 42)" style="font-family:Arial,sans-serif;fill:#171717;stroke:#fff;stroke-width:3;paint-order:stroke"><text text-anchor="middle" y="-12" style="font-size:18px;font-weight:800">N</text><path d="M0,-7 L-7,11 L0,7 L7,11 Z" style="fill:#171717;stroke:#fff;stroke-width:2"/></g>`;
  const legendRoles=[...new Set(valid.layers.map((layer)=>roleKey(layer.role)))];
  const warnings=Array.isArray(preview.warnings)?preview.warnings:[];
  return`<div class="map-work-title" style="font-size:16px">${esc(preview.title||'각 토지 위치도')}</div><div class="map-frame" data-map-preview style="position:relative;aspect-ratio:${layout.width}/${layout.height};border-radius:2px;border-color:#475366">${background}<svg viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="토지보상 위치 검토도" style="position:absolute;inset:0;width:100%;height:100%;min-height:0;z-index:1">${emptyBackground}${svgLayers}${insets}${north}</svg></div><div class="map-legend" data-map-legend style="display:flex;gap:18px;padding:10px 14px;border:2px solid #475366;border-radius:2px;background:#fff;font-size:14px;font-weight:900">${legendRoles.map((role)=>{const style=roleStyle(role);return`<span class="map-legend-item ${roleClass(role)}"><i style="width:28px;height:18px;background:${style.fill};border:3px solid ${style.stroke}"></i>${esc(style.label)}</span>`;}).join('')}</div><div class="source-note">배경: ${esc(backgroundLabel)} · 지적경계: ${backgroundUrl?'VWorld Data API PNU exact':'가져온 벡터 형상(원천 별도 검수)'} · CRS: ${esc(preview.coordinate_space?.crs||'확인 필요')} · ${allowInsets&&insetItems.length?`항공사진 확대 ${Math.min(6,insetItems.length)}건 · `:''}${preview?.presentation?.report_graphic?'칸샘플형 관계도 · ':''}${warnings.length?`폴리곤 미확인 점표시 ${warnings.length}건 · `:''}검토 보조자료·자동확정 아님</div>`;
}

function traceLine(ctx,line,project,close=false){(line||[]).forEach((point,index)=>{const[x,y]=project(point);if(index)ctx.lineTo(x,y);else ctx.moveTo(x,y);});if(close)ctx.closePath();}
function drawGeometry(ctx,geometry,project,style){
  ctx.save();ctx.fillStyle=style.fill;ctx.strokeStyle=style.stroke;ctx.lineWidth=3;
  if(geometry?.type==='Point'){const[x,y]=project(geometry.coordinates);ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();return;}
  ctx.beginPath();
  if(geometry?.type==='LineString')traceLine(ctx,geometry.coordinates,project,false);
  if(geometry?.type==='Polygon')(geometry.coordinates||[]).forEach((ring)=>traceLine(ctx,ring,project,true));
  if(geometry?.type==='MultiPolygon')(geometry.coordinates||[]).forEach((polygon)=>polygon.forEach((ring)=>traceLine(ctx,ring,project,true)));
  if(geometry?.type!=='LineString')ctx.fill('evenodd');ctx.stroke();ctx.restore();
}
function drawFeatureLabel(ctx,feature,style,placement){
  const label=mapLabel(feature,style);if(!placement)return;
  const{x,y,anchor}=placement;ctx.save();ctx.beginPath();ctx.moveTo(anchor[0],anchor[1]);ctx.lineTo(x,y);ctx.strokeStyle=style.stroke;ctx.lineWidth=1.5;ctx.setLineDash([3,2]);ctx.stroke();ctx.setLineDash([]);ctx.textAlign='center';ctx.textBaseline='middle';ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.lineJoin='round';ctx.font='900 14px "Malgun Gothic","Noto Sans KR",sans-serif';ctx.strokeText(label.role,x,y-6);ctx.fillStyle=style.text;ctx.fillText(label.role,x,y-6);ctx.font='800 13px "Malgun Gothic","Noto Sans KR",sans-serif';ctx.strokeText(label.address,x,y+12);ctx.fillText(label.address,x,y+12);ctx.restore();
}
function exportBackgroundUrl(value){
  try{const url=new URL(String(value||''),window.location.href);if(url.protocol==='https:'&&url.hostname==='api.vworld.kr'&&url.pathname==='/req/image'&&['127.0.0.1','localhost'].includes(window.location.hostname))return `/__map_bridge/vworld-image?url=${encodeURIComponent(url.toString())}`;return url.toString();}catch(_error){return String(value||'');}
}
async function drawInsets(ctx,items,width,height,allFeatures,mainProject,background,includeBackground,occupied=[]){
  const selected=prioritizedInsets(items,mainProject).slice(0,6);const slots=insetSlots(width,height,allFeatures,mainProject,selected.length,occupied);for(let index=0;index<selected.length;index+=1){const item=selected[index],panelW=220,panelH=160,headerH=30,x=slots[index].x,y=slots[index].y;const view=insetView(item.feature,panelW,panelH-headerH);if(!view)continue;const local=mercatorProjector(view,panelW,panelH-headerH);const project=(p)=>{const[a,b]=local(p);return[x+a,y+headerH+b];};ctx.save();ctx.shadowColor='rgba(0,0,0,.48)';ctx.shadowBlur=14;ctx.shadowOffsetY=6;ctx.fillStyle='#fff';ctx.fillRect(x-4,y-4,panelW+8,panelH+8);ctx.restore();ctx.save();ctx.fillStyle='#eef1f4';ctx.fillRect(x,y,panelW,panelH);ctx.beginPath();ctx.rect(x,y+headerH,panelW,panelH-headerH);ctx.clip();const imageUrl=insetBackgroundUrl(background,view,panelW,panelH-headerH);if(includeBackground&&imageUrl){try{const image=await loadImage(exportBackgroundUrl(imageUrl));ctx.drawImage(image,x,y+headerH,panelW,panelH-headerH);}catch(_error){}}
    drawGeometry(ctx,item.feature.geometry,project,item.style);ctx.restore();ctx.save();ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillRect(x,y,panelW,headerH);ctx.strokeStyle='#172231';ctx.lineWidth=3;ctx.strokeRect(x,y,panelW,panelH);const label=mapLabel(item.feature,item.style);ctx.fillStyle='#111820';ctx.font='900 12px "Malgun Gothic",sans-serif';ctx.fillText(`${label.role} ${label.address}`,x+8,y+13);ctx.fillStyle='#4b5563';ctx.font='700 9px "Malgun Gothic",sans-serif';ctx.fillText('항공사진 · PNU exact 지적경계',x+8,y+25);ctx.restore();}
}
function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('MAP_BACKGROUND_LOAD_FAILED'));image.src=url;});}
function blobFromCanvas(canvas){return new Promise((resolve,reject)=>{try{canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error('MAP_PNG_EMPTY')),'image/png');}catch(error){reject(error);}});}

async function renderCanvas(preview,includeBackground){
  const valid=validateMapPreview(preview);if(!valid.ok)throw Object.assign(new Error(valid.reason),{code:valid.reason});
  const layout=layoutFor(preview,valid);if(!layout)throw Object.assign(new Error('MAP_COORDINATES_EMPTY'),{code:'MAP_COORDINATES_EMPTY'});
  const header=64;const footer=70;const canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height+header+footer;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#1c2229';ctx.font='bold 25px "Segoe UI","Noto Sans KR",sans-serif';ctx.textBaseline='middle';ctx.fillText(preview.title||'토지보상 위치 검토도',24,header/2);
  ctx.save();ctx.translate(0,header);ctx.fillStyle='#fff';ctx.fillRect(0,0,layout.width,layout.height);
  let backgroundIncluded=false;const url=layout.background?.url;
  if(includeBackground&&url){try{const image=await loadImage(exportBackgroundUrl(url));ctx.drawImage(image,0,0,layout.width,layout.height);backgroundIncluded=true;}catch(_error){backgroundIncluded=false;}}
  const canvasFeatures=[];for(const layer of orderedLayers(valid.layers)){const style=roleStyle(layer.role);for(const feature of layer?.feature_collection?.features||[]){drawGeometry(ctx,feature.geometry,layout.project,style);canvasFeatures.push({feature,style});}}
  const occupied=[];const insetItems=[];canvasFeatures.forEach((item,index)=>{const placement=labelPlacement(item.feature,layout.project,layout.width,layout.height,occupied,index,item.style);drawFeatureLabel(ctx,item.feature,item.style,placement);if(placement?.needsInset&&item.feature.geometry?.type!=='Point')insetItems.push(item);});if(preview?.presentation?.insets!==false)await drawInsets(ctx,insetItems,layout.width,layout.height,valid.features,layout.project,layout.background,includeBackground,occupied);
  ctx.save();ctx.translate(layout.width-42,42);ctx.font='800 18px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.strokeText('N',0,-13);ctx.fillStyle='#171717';ctx.fillText('N',0,-13);ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(-7,11);ctx.lineTo(0,7);ctx.lineTo(7,11);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.restore();
  ctx.restore();
  const roles=[...new Set(valid.layers.map((layer)=>roleKey(layer.role)))];let x=24;const y=header+layout.height+28;ctx.font='bold 15px "Segoe UI","Noto Sans KR",sans-serif';for(const role of roles){const style=roleStyle(role);ctx.fillStyle=style.fill;ctx.strokeStyle=style.stroke;ctx.lineWidth=2;ctx.fillRect(x,y-9,22,18);ctx.strokeRect(x,y-9,22,18);ctx.fillStyle='#343b43';ctx.fillText(style.label,x+30,y);x+=ctx.measureText(style.label).width+70;}
  ctx.font='13px "Malgun Gothic","Noto Sans KR",sans-serif';ctx.fillStyle='#616973';const baseName=layout.background?.basemap==='PHOTO_HYBRID'?'VWorld Hybrid':'VWorld Satellite';ctx.fillText(`${backgroundIncluded?`${baseName} 포함`:'배경 제외 벡터지도'} · 지적경계 VWorld Data API · 검토 보조 · 자동확정 아님`,24,header+layout.height+54);
  return{canvas,backgroundIncluded};
}

function blobDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('MAP_PNG_READ_FAILED'));reader.readAsDataURL(blob);});}

export async function renderMapPreviewPng(preview){
  let rendered=await renderCanvas(preview,true);let blob;
  try{blob=await blobFromCanvas(rendered.canvas);}catch(_error){rendered=await renderCanvas(preview,false);blob=await blobFromCanvas(rendered.canvas);}
  return{ok:true,blob,png_base64:await blobDataUrl(blob),background_included:rendered.backgroundIncluded};
}

export async function downloadMapPreviewPng(preview,fileName='bso-vworld-work-map.png'){
  const rendered=await renderMapPreviewPng(preview);const safeName=String(fileName||'bso-vworld-work-map.png').replace(/[\\/:*?"<>|]+/g,'_').replace(/\.png$/i,'')+'.png';const url=URL.createObjectURL(rendered.blob);const link=document.createElement('a');link.href=url;link.download=safeName;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return{ok:true,file_name:safeName,background_included:rendered.background_included};
}
