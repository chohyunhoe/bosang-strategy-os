import { openRecordInspector } from './record-inspector.js';
import { recordDiagnosticEvent } from './session-diagnostics.js';

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const arr = (value) => Array.isArray(value) ? value : [];
const fmt = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ko-KR') : String(value);
};

function firstSource(row) {
  const ref = arr(row && row.source_refs)[0] || null;
  if (!ref) return { label:'원문근거 없음', text:'원본 PDF에서 직접 확인이 필요합니다.' };
  const page = ref.page_no ? `p.${ref.page_no}` : '';
  const label = [ref.source_label || '원문', page].filter(Boolean).join(' · ');
  return { label, text: ref.raw_text_excerpt || ref.excerpt || '원문 발췌가 저장되지 않았습니다. 페이지를 기준으로 대조하세요.' };
}

function landName(state, row) {
  if (row && row.parcel_address) return row.parcel_address;
  const land = arr(state.lands).find((candidate) => candidate.land_id && candidate.land_id === row?.land_id);
  return land?.parcel_address || row?.land_id || '토지 확인 필요';
}

function rowPreview(collection, row, state) {
  const evidence = firstSource(row);
  switch (collection) {
    case 'caseInfo':
      return {
        title: row.project_name || row.case_name || '사건 기본정보',
        value: `평가목적 ${row.appraisal_purpose || '확인 필요'} · 기준시점 ${row.price_date || row.base_date || '확인 필요'}`,
        evidence,
      };
    case 'appraisals':
      return {
        title: row.appraisal_company || '평가법인 확인 필요',
        value: `평가기준일 ${row.valuation_date || '확인 필요'}${row.appraisal_company_origin ? ` · 법인명 근거 ${row.appraisal_company_origin}` : ''}`,
        evidence,
      };
    case 'lands':
      return { title: row.parcel_address || row.land_id || '편입토지', value: `지목 ${row.land_category || '—'} · 면적 ${fmt(row.area)}㎡${row.appraisal_use_status ? ` · 현황 ${row.appraisal_use_status}` : ''}`, evidence };
    case 'standardLands':
      return { title: `표준지 ${row.standard_land_symbol || '—'} · ${row.parcel_address || '소재지 확인 필요'}`, value: `지목 ${row.land_category || '—'} · 공시지가 ${fmt(row.official_price)}원/㎡`, evidence };
    case 'transactionCases':
      return { title: `사례 ${row.case_symbol || '—'} · ${row.parcel_address || '소재지 확인 필요'}`, value: `${row.case_date || '시점 확인 필요'} · ${row.zoning || '용도지역 확인 필요'} · ${fmt(row.case_unit_price)}원/㎡`, evidence };
    case 'appraisalResults':
      return { title: landName(state, row), value: `표준지 ${row.standard_land_symbol || '—'} · 개별 ${fmt(row.individual_factor_total)} · 그 밖 ${fmt(row.other_factor)} · 적용 ${fmt(row.unit_price)}원/㎡ · 금액 ${fmt(row.amount)}원`, evidence };
    case 'subjectFactorTotals':
      return { title: landName(state, row), value: `표준지 ${row.standard_land_symbol || '—'} · 개별요인 누계 ${fmt(row.total_factor)} · ${row.detail_status === 'DETAIL_AVAILABLE' ? '세부계수 확인 가능' : '누계만 확인'}`, evidence };
    case 'otherFactors':
      return { title: `표준지 ${row.standard_land_symbol || '—'}`, value: `그 밖의 요인 결정치 ${fmt(row.decided_other_factor)}`, evidence };
    case 'obstacleRows':
      return { title: `${row.serial_no || '—'} · ${row.item_type || '지장물'}`, value: `${row.parcel_address || '소재지 확인 필요'} · ${row.specification || '규격 확인 필요'} · ${fmt(row.quantity)}${row.quantity_unit || ''} · 금액 ${fmt(row.amount)}원`, evidence };
    case 'obstacleSummaries':
      return { title: '지장물 합계 교차검증', value: `원문 ${fmt(row.stated_total_amount ?? row.obstacle_total_amount)}원 · 행합계 ${fmt(row.extracted_row_amount_sum)}원 · ${row.total_crosscheck_status || 'NOT_CHECKED'}`, evidence };
    case 'issueCandidates':
      return { title: row.title || row.issue_code || '쟁점 후보', value: row.description || '기계적 검토 후보입니다. 결론은 자동 생성하지 않습니다.', evidence };
    default: {
      const preferred = ['parcel_address','standard_land_symbol','unit_price','amount','total_factor','decided_other_factor']
        .filter((key) => row && row[key] !== undefined && row[key] !== null && row[key] !== '')
        .map((key) => `${key} ${fmt(row[key])}`);
      return { title:'구조화 항목', value:preferred.join(' · ') || '상세 화면에서 값을 확인하세요.', evidence };
    }
  }
}

export function installReviewWorkbench(store) {
  const PAGE_SIZE = 10;
  const local = { open:false, index:0, selectedId:null, filter:'active', page:0, query:'', notice:'' };
  const filterLabels = { active:'진행', attention:'주의', hold:'보류', all:'전체' };
  function pending() { return arr(store.state.reviewQueue).filter((item) => item && item.status !== 'CONFIRMED'); }
  function attention(item) { return item.confirmable === false || item.type === 'EXCEPTION' || item.exception_count > 0; }
  function visibleItems() {
    return pending().filter((item) => local.filter === 'hold' ? item.status === 'HOLD' : local.filter === 'attention' ? attention(item) : local.filter === 'active' ? item.status !== 'HOLD' : true);
  }
  function rowEntries(item) {
    if (!item?.collection) return [];
    const rows = item.collection === 'caseInfo' ? (store.state.caseInfo ? [store.state.caseInfo] : []) : arr(store.state[item.collection]);
    const entries = rows.map((row,rowIndex)=>({row,rowIndex}));
    if (item.type === 'EXCEPTION' && item.collection === 'obstacleSummaries') {
      const match = /^EXCEPTION:obstacleSummary:(\d+)$/.exec(item.review_id);
      return match ? entries.filter((entry)=>entry.rowIndex===Number(match[1])) : [];
    }
    return entries;
  }
  function ensureStyle() {
    if(document.getElementById('bso-v2-review-workbench-style'))return;
    const style=document.createElement('style');style.id='bso-v2-review-workbench-style';
    style.textContent=`
      .review-workbench-launch{border:0;background:var(--accent,#7b2d43);color:#fff;border-radius:5px;padding:8px 12px;font-weight:600;min-height:40px}.review-workbench-launch.complete{background:#e8f1ec;color:#2f6652;border:1px solid #c8ddd0}
      .review-workbench-backdrop{position:fixed;inset:0;z-index:500;background:#24222666;display:flex;justify-content:center;align-items:center;padding:20px}.review-workbench{width:min(1200px,100%);height:min(900px,calc(100dvh - 40px));background:#f5f3f0;border:1px solid #e3deda;border-radius:8px;box-shadow:0 20px 70px #24222633;display:flex;flex-direction:column;overflow:hidden;color:#242226}.review-workbench-head{background:#fff;border-bottom:1px solid #e3deda;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-shrink:0}.review-workbench-head h2{margin:2px 0 0;font-size:19px;font-weight:600}.review-workbench-progress{font-size:12px;color:#716b70}.review-workbench-close{border:0;background:#f1eeeb;border-radius:5px;width:40px;height:40px;font-size:21px}.review-key-hint{font-size:11px;color:#716b70;margin-left:auto}
      .review-workbench-layout{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:0;flex:1}.review-navigator{background:#fff;border-right:1px solid #e3deda;overflow:auto;padding:14px 12px}.review-filters{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:14px}.review-filters button{border:1px solid #e3deda;background:#fff;color:#716b70;border-radius:5px;min-height:38px;font-size:12px;padding:6px}.review-filters button.active{background:#f4e9ed;color:#7b2d43;border-color:#d9bcc7}.review-group-list{display:grid;gap:4px}.review-group{display:block;text-align:left;background:#fff;border:0;border-radius:5px;padding:11px 10px;width:100%;color:#51464d;font-size:13px}.review-group.active{background:#f4e9ed;color:#7b2d43}.review-group small{display:block;color:#716b70;font-size:11px;margin-top:3px}.review-group-select{display:none}.review-nav-note{font-size:11px;color:#716b70;margin:18px 8px 0;line-height:1.7}
      .review-workbench-body{padding:20px;overflow:auto;min-width:0;min-height:0}.review-workbench-card{background:#fff;border:1px solid #e3deda;border-radius:6px;padding:20px}.review-workbench-card h3{margin:6px 0 5px;font-size:21px;font-weight:600}.review-workbench-card p{margin:0;font-size:12px;line-height:1.6;color:#716b70}.review-workbench-meta{display:flex;gap:20px;flex-wrap:wrap;padding:12px 0;font-size:12px;color:#716b70}.review-workbench-meta b{color:#242226;margin-left:6px;font-variant-numeric:tabular-nums;font-weight:600}.review-workbench-blocked{margin:10px 0;padding:11px;background:#fff1f3;border-left:3px solid #a23d3d;font-size:12px;color:#8b253f}
      .review-search{display:flex;gap:8px;margin:10px 0 12px;flex-wrap:wrap}.review-search input{flex:1;min-width:120px;width:100%;padding:9px 11px;border:1px solid #d9d0d4;border-radius:5px;background:#fff;font:inherit;font-size:13px}.review-search button,.review-pagination button{border:1px solid #e3deda;border-radius:5px;background:#fff;min-height:40px;padding:8px 12px;font-size:12px;color:#51464d}.review-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 0;font-size:12px;color:#716b70}.review-pagination>span{font-variant-numeric:tabular-nums;text-align:center}.review-workbench-previews{display:grid;gap:10px}.review-workbench-preview{border:1px solid #e3deda;border-radius:5px;padding:14px;background:#fff;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:9px 18px;overflow-wrap:anywhere}.review-workbench-preview-head{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:8px}.review-workbench-preview-head b{font-size:13px;font-weight:600}.review-workbench-edit{border:1px solid #d9d0d4;background:#fff;border-radius:5px;min-height:36px;padding:6px 9px;font-size:12px;white-space:nowrap}.review-workbench-value,.review-workbench-source{font-size:12px;line-height:1.7;white-space:pre-wrap;min-width:0}.review-workbench-value{color:#242226}.review-workbench-source{border-left:1px solid #e3deda;padding-left:18px;color:#716b70;max-height:160px;overflow:auto}.review-workbench-source strong{font-size:11px;color:#7b2d43}.review-workbench-more{margin-top:10px;font-size:12px;color:#716b70}.review-workbench-empty{background:#fff;border:1px solid #e3deda;border-radius:6px;padding:38px 24px;text-align:center}.review-workbench-empty h3{font-size:20px;margin:0 0 10px}.review-workbench-empty p{font-size:13px;color:#716b70}
      .review-workbench-actions{display:grid;grid-template-columns:1fr 1.2fr 1fr 1fr;gap:8px;padding:12px 20px;background:#fff;border-top:1px solid #e3deda;flex-shrink:0}.review-workbench-actions button{border:1px solid #d9d0d4;background:#fff;color:#51464d;border-radius:5px;min-height:46px;padding:8px;font-size:13px;font-weight:600}.review-workbench-actions .review-workbench-confirm{border-color:#7b2d43;background:#7b2d43;color:#fff}.review-workbench-actions button:disabled{cursor:not-allowed;opacity:.5}.review-decision-note{grid-column:1/-1;font-size:11px;color:#716b70;text-align:center}.review-workbench button:focus-visible,.review-workbench input:focus-visible,.review-workbench select:focus-visible{outline:3px solid #a35e72;outline-offset:2px}
      @media(max-width:700px){.review-workbench-backdrop{padding:0}.review-workbench{width:100%;height:100dvh;border:0;border-radius:0}.review-workbench-layout{display:flex;flex-direction:column}.review-navigator{flex-shrink:0;padding:10px 14px;border-right:0;border-bottom:1px solid #e3deda;overflow:visible}.review-filters{display:flex;gap:6px;margin-bottom:8px}.review-filters button{flex:1;min-height:38px}.review-group-list,.review-nav-note,.review-key-hint{display:none}.review-group-select{display:block;width:100%;min-height:40px;border:1px solid #d9d0d4;border-radius:5px;background:#fff;padding:7px;font:inherit;font-size:13px}.review-workbench-head{padding:12px 14px}.review-workbench-body{padding:14px;flex:1}.review-workbench-card{padding:15px}.review-workbench-card h3{font-size:18px}.review-workbench-meta{gap:12px}.review-workbench-preview{grid-template-columns:1fr;padding:12px}.review-workbench-source{border-left:0;border-top:1px solid #e3deda;padding:8px 0 0;max-height:130px}.review-workbench-actions{padding:10px 10px calc(10px + env(safe-area-inset-bottom));grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.review-workbench-actions button{font-size:12px;padding:7px 3px}.review-decision-note{font-size:11px}.review-pagination button{min-height:42px}}
    `;document.head.appendChild(style);
  }
  function normalizeIndex(items) {
    if(!items.length){local.index=0;local.selectedId=null;return;}
    const selected=items.findIndex(item=>item.review_id===local.selectedId);
    if(selected>=0)local.index=selected;
    local.index=Math.max(0,Math.min(local.index,items.length-1));local.selectedId=items[local.index].review_id;
  }
  function resetRows(){local.page=0;local.query='';local.notice='';}
  function open(index=0){if(store.state.status==='PROCESSING')return;local.filter='active';if(!visibleItems().length&&pending().length)local.filter='hold';local.index=Math.max(0,Number(index)||0);local.selectedId=null;resetRows();local.open=true;recordDiagnosticEvent('REVIEW_WORKBENCH_OPENED',{review_pending:pending().length,index:local.index+1});render();document.querySelector('.review-workbench-close')?.focus();}
  function close(){local.open=false;render();document.querySelector('[data-review-workbench-launch]')?.focus();}
  function choose(id){if(store.state.status==='PROCESSING')return;local.selectedId=id;resetRows();renderOverlay();}
  function move(direction){if(store.state.status==='PROCESSING')return;const items=visibleItems();normalizeIndex(items);if(!items.length)return;local.index=(local.index+direction+items.length)%items.length;local.selectedId=items[local.index].review_id;resetRows();renderOverlay();}
  function nextCurrent(){move(1);}
  function decision(status){
    if(store.state.status==='PROCESSING')return;
    const items=visibleItems();normalizeIndex(items);const item=items[local.index];if(!item)return;
    if(status==='CONFIRMED'&&item.confirmable===false){local.notice=item.blocked_reason||'필수값을 먼저 확인하세요.';renderOverlay();return;}
    const next=items[(local.index+1)%items.length];local.selectedId=next&&next.review_id!==item.review_id?next.review_id:null;resetRows();
    const result=store.decide(item.review_id,status);
    if(result?.ok===false){local.selectedId=item.review_id;local.notice=result.reason||'검수 결과를 기록하지 못했습니다.';renderOverlay();return;}
    recordDiagnosticEvent('REVIEW_DECISION',{status,confirmable:status==='CONFIRMED'});
  }
  function openSource(){if(store.state.status==='PROCESSING')return;const items=visibleItems();normalizeIndex(items);const item=items[local.index];if(!item)return;local.open=false;store.setRoute(item.route||'home');window.scrollTo({top:0});}
  function renderLauncher(){
    ensureStyle();document.querySelector('[data-review-workbench-launch]')?.remove();if(store.state.status==='EMPTY')return;
    const actions=document.querySelector('.topbar .review-actions');if(!actions)return;
    const count=pending().length;const button=document.createElement('button');button.type='button';button.className=`review-workbench-launch${count?'':' complete'}`;button.dataset.reviewWorkbenchLaunch='1';button.disabled=store.state.status==='PROCESSING';button.dataset.reviewState=count?'pending':'complete';button.textContent=count?`전체 검수 ${count}`:'검수 완료 ✓';button.addEventListener('click',()=>open(0));actions.prepend(button);
  }
  function renderOverlay(){
    const previous=document.querySelector('[data-review-workbench]');const focusKey=previous?.contains(document.activeElement)?document.activeElement.dataset.reviewFocus:null;
    previous?.remove();if(!local.open)return;
    const items=visibleItems();normalizeIndex(items);const current=items[local.index]||null;const allRows=current?rowEntries(current):[];
    const normalized=(value)=>String(value).replace(/[\s,]/g,'').toLocaleLowerCase('ko-KR');const query=normalized(local.query);
    const matches=allRows.map(entry=>({...rowPreview(current.collection,entry.row,store.state),rowIndex:entry.rowIndex})).filter(preview=>!query||normalized([preview.title,preview.value,preview.evidence.label,preview.evidence.text].join(' ')).includes(query));
    const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));local.page=Math.max(0,Math.min(local.page,pages-1));const previews=matches.slice(local.page*PAGE_SIZE,(local.page+1)*PAGE_SIZE);
    const allPending=pending();const counts={active:allPending.filter(item=>item.status!=='HOLD').length,attention:allPending.filter(attention).length,hold:allPending.filter(item=>item.status==='HOLD').length,all:allPending.length};
    const overlay=document.createElement('div');overlay.className='review-workbench-backdrop';overlay.dataset.reviewWorkbench='1';
    overlay.innerHTML=`<section class="review-workbench" role="dialog" aria-modal="true" aria-label="전체 검수">
      <header class="review-workbench-head"><div><div class="review-workbench-progress">${items.length?`${local.index+1} / ${items.length}`:allPending.length?'선택한 보기':'완료'}</div><h2>전체 검수</h2></div><span class="review-key-hint">Ctrl+Enter 검수완료 · Alt+←/→ 이동</span><button type="button" class="review-workbench-close" data-review-focus="close" aria-label="닫기">×</button></header>
      <div class="review-workbench-layout"><aside class="review-navigator" aria-label="검수 묶음"><div class="review-filters">${Object.entries(filterLabels).map(([key,label])=>`<button type="button" data-review-filter="${key}" data-review-focus="filter-${key}" class="${local.filter===key?'active':''}" aria-pressed="${local.filter===key}">${label} ${counts[key]}</button>`).join('')}</div><label class="review-group-select-label"><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">검수 묶음 선택</span><select class="review-group-select" aria-label="검수 묶음 선택" data-review-focus="group-select">${items.length?items.map(item=>`<option value="${esc(item.review_id)}" ${current?.review_id===item.review_id?'selected':''}>${esc(item.label)} · ${item.row_count}행</option>`).join(''):'<option value="">항목 없음</option>'}</select></label><div class="review-group-list">${items.map(item=>`<button type="button" class="review-group ${item.review_id===current?.review_id?'active':''}" data-review-group="${esc(item.review_id)}" data-review-focus="group-${esc(item.review_id)}" ${item.review_id===current?.review_id?'aria-current="true"':''}>${esc(item.label)}<small>${item.row_count}행${item.exception_count?` · 주의 ${item.exception_count}`:''}${item.confirmable===false?' · 보완 필요':''}${item.status==='HOLD'?' · 보류':''}</small></button>`).join('')}</div><p class="review-nav-note">보류는 ‘진행’에서 제외됩니다.<br>검수 기록과 승인·제출은 별도입니다.</p></aside>
      <div class="review-workbench-body">${current?`<section class="review-workbench-card"><span class="badge">${esc(current.route_label||current.route||'검토')}</span><h3>${esc(current.label)}</h3><p>${esc(current.description||'원문과 추출값을 대조하세요.')}</p><div class="review-workbench-meta"><span>검토 행 <b>${allRows.length}행</b></span><span>주의 <b>${current.exception_count||0}건</b></span><span>상태 <b>${current.status==='HOLD'?'보류':'검토 대기'}</b></span></div>${current.confirmable===false||local.notice?`<div class="review-workbench-blocked">${esc(local.notice||current.blocked_reason||'필수값을 먼저 확인하세요.')}</div>`:''}
      <form class="review-search"><input type="search" aria-label="검수 행 검색" placeholder="지번·기호·금액 검색" value="${esc(local.query)}" data-review-focus="search"><button type="submit" data-review-focus="search-submit">검색</button>${local.query?'<button type="button" data-review-clear data-review-focus="search-clear">초기화</button>':''}</form><div class="review-workbench-previews">${previews.map(preview=>`<article class="review-workbench-preview"><div class="review-workbench-preview-head"><b>${esc(preview.title)}</b><button type="button" class="review-workbench-edit" data-review-edit="${preview.rowIndex}" data-review-focus="edit-${preview.rowIndex}">원문·수정</button></div><div class="review-workbench-value">${esc(preview.value)}</div><div class="review-workbench-source"><strong>${esc(preview.evidence.label)}</strong><br>${esc(preview.evidence.text)}</div></article>`).join('')||'<div class="review-workbench-more">검색 결과가 없습니다.</div>'}</div><div class="review-pagination"><button type="button" data-review-page="-1" data-review-focus="page-prev" ${local.page===0?'disabled':''}>이전 행</button><span>${matches.length?`${local.page*PAGE_SIZE+1}–${Math.min((local.page+1)*PAGE_SIZE,matches.length)} / ${matches.length}행`:'0행'} · ${local.page+1}/${pages}쪽</span><button type="button" data-review-page="1" data-review-focus="page-next" ${local.page+1>=pages?'disabled':''}>다음 행</button></div></section>`:`<section class="review-workbench-empty"><h3>${allPending.length?'이 보기에 남은 항목이 없습니다.':'검수가 완료되었습니다.'}</h3><p>${allPending.length?`남은 검토 ${allPending.length}묶음 · 보류 ${counts.hold}묶음. 왼쪽 또는 상단 보기에서 선택하세요.`:'현재 검토 대기 항목이 없습니다. 검수 완료는 승인·실제 제출과 별도입니다.'}</p></section>`}</div></div>
      ${current?`<footer class="review-workbench-actions"><button type="button" class="review-workbench-open" data-review-focus="detail">상세화면</button><button type="button" class="review-workbench-confirm" data-review-focus="confirm" ${current.confirmable===false?'disabled':''}>${current.confirmable===false?'확인 불가':'검수완료'}</button><button type="button" class="review-workbench-hold" data-review-focus="hold">보류</button><button type="button" class="review-workbench-next" data-review-focus="next">다음</button><div class="review-decision-note">검수완료는 검색·페이지와 관계없이 현재 묶음 ${allRows.length}행 전체에 적용됩니다.</div></footer>`:''}
    </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.review-workbench-close').addEventListener('click',close);
    overlay.querySelector('.review-workbench-open')?.addEventListener('click',openSource);
    overlay.querySelector('.review-workbench-confirm')?.addEventListener('click',()=>decision('CONFIRMED'));
    overlay.querySelector('.review-workbench-hold')?.addEventListener('click',()=>decision('HOLD'));
    overlay.querySelector('.review-workbench-next')?.addEventListener('click',nextCurrent);
    overlay.querySelectorAll('[data-review-filter]').forEach(button=>button.addEventListener('click',()=>{local.filter=button.dataset.reviewFilter;local.index=0;local.selectedId=null;resetRows();renderOverlay();}));
    overlay.querySelectorAll('[data-review-group]').forEach(button=>button.addEventListener('click',()=>choose(button.dataset.reviewGroup)));
    overlay.querySelector('.review-group-select').addEventListener('change',event=>choose(event.target.value));
    overlay.querySelector('.review-search')?.addEventListener('submit',event=>{event.preventDefault();local.query=event.target.querySelector('input').value;local.page=0;renderOverlay();document.querySelector('.review-search input')?.focus();});
    overlay.querySelector('[data-review-clear]')?.addEventListener('click',()=>{local.query='';local.page=0;renderOverlay();document.querySelector('.review-search input')?.focus();});
    overlay.querySelectorAll('[data-review-page]').forEach(button=>button.addEventListener('click',()=>{local.page+=Number(button.dataset.reviewPage);renderOverlay();document.querySelector('.review-workbench-body')?.scrollTo({top:0});}));
    overlay.querySelectorAll('[data-review-edit]').forEach(button=>button.addEventListener('click',()=>{if(current&&store.state.status!=='PROCESSING')openRecordInspector(store,current.collection,Number(button.dataset.reviewEdit),`${current.label} · 원문·수정`,{onClose:()=>document.querySelector(`[data-review-workbench] [data-review-edit="${Number(button.dataset.reviewEdit)}"]`)?.focus({preventScroll:true})});}));
    overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
    if(focusKey)(Array.from(overlay.querySelectorAll('[data-review-focus]')).find(node=>node.dataset.reviewFocus===focusKey&&!node.disabled)||overlay.querySelector('.review-workbench-close'))?.focus({preventScroll:true});
  }
  document.addEventListener('keydown',event=>{
    if(!local.open||store.state.status==='PROCESSING'||document.querySelector('.inspector-backdrop')||event.isComposing)return;
    const editable=event.target?.closest('input,textarea,select,[contenteditable="true"]');
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(!editable&&event.ctrlKey&&event.key==='Enter'){event.preventDefault();decision('CONFIRMED');}
    else if(!editable&&event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();move(event.key==='ArrowRight'?1:-1);}
    else if(event.key==='Tab'){
      const controls=Array.from(document.querySelectorAll('[data-review-workbench] button:not(:disabled),[data-review-workbench] input,[data-review-workbench] select')).filter(node=>node.getClientRects().length);
      const first=controls[0],last=controls.at(-1);if(!first)return;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  function render(){if(store.state.status==='PROCESSING')local.open=false;renderLauncher();renderOverlay();}
  store.subscribe(render);render();
  return {open,close,next:nextCurrent,state:local,pending};
}
