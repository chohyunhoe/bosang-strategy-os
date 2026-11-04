'use strict';

(() => {
  const MOBILE_MAX = 820;
  const ROOT_ID = 'bsoMobileShellV3';
  const STYLE_ID = 'bso-mobile-shell-v3-style';
  const NAV = [
    ['home','홈',/홈.?실행보드/,'overview'],
    ['case','사건',/사건 워크스페이스/,'uploadHub'],
    ['data','자료',/자료.?데이터/,'lands'],
    ['analysis','분석',/^\s*4\.?\s*분석|^\s*분석\s*$/,'landCompare'],
    ['map','지도',/지도.?현장/,'workflowLogic'],
    ['output','결과물',/결과물/,'outputCenter'],
  ];
  const state = { mode:'home', items:[], index:0, legacy:false, timer:null };
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g,' ').trim();
  const isMobile = () => (typeof window.matchMedia === 'function' ? window.matchMedia(`(max-width:${MOBILE_MAX}px)`).matches : window.innerWidth <= MOBILE_MAX);
  const buttons = (root=document) => Array.from(root.querySelectorAll('button'));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function store(){ try { return window.eval('typeof data !== "undefined" ? data : null'); } catch(e){ return null; } }
  function uploads(){ const s=store(); return s&&Array.isArray(s.document_uploads)?s.document_uploads:[]; }
  function smallestCard(button){
    let n=button;
    for(let i=0;n&&n!==document.body&&i<10;i++,n=n.parentElement){
      const t=clean(n.textContent);
      if(/수동 수정/.test(t)&&/검수 후 반영/.test(t)&&/건너뜀/.test(t)) return n;
    }
    return null;
  }
  function parseLegacy(card){
    const t=card ? card.textContent||'' : '';
    const field=(t.match(/"field"\s*:\s*"([^"]+)"/)||[])[1]||'검토 항목';
    const value=(t.match(/"value"\s*:\s*"([^"]*)"/)||[])[1]||'';
    const reason=(t.match(/"reason"\s*:\s*"([^"]+)"/)||[])[1]||'';
    return {
      kind:'legacy', card,
      field:clean(field), value:clean(value)||'값을 찾지 못함',
      evidence:clean(reason)||(/원문 근거 후보 없음/.test(t)?'원문 근거를 자동으로 찾지 못했습니다.':'원문과 대조해 확인하세요.'),
      confirm:buttons(card).find(b=>/검수 후 반영/.test(clean(b.textContent))),
      edit:buttons(card).find(b=>/수동 수정/.test(clean(b.textContent))),
      hold:buttons(card).find(b=>/건너뜀/.test(clean(b.textContent))),
    };
  }
  function legacyItems(){
    const seen=new Set(), out=[];
    buttons().filter(b=>!b.closest(`#${ROOT_ID}`)&&/수동 수정/.test(clean(b.textContent))).forEach(b=>{
      const card=smallestCard(b); if(!card||seen.has(card)) return; seen.add(card); out.push(parseLegacy(card));
    });
    return out;
  }
  function structuredItems(){
    const s=store(); if(!s) return [];
    const src=(Array.isArray(s.structured_review_candidates)&&s.structured_review_candidates.length)?s.structured_review_candidates:(Array.isArray(s['00_extraction_candidates'])?s['00_extraction_candidates']:[]);
    const seen=new Set();
    return src.filter(c=>{
      if(!c||c.candidate_type==='REVIEW_NOTE') return false;
      const st=clean(c.review_status_code||c.candidate_generation_status).toUpperCase();
      const ok=['NEEDS_REVIEW','LOW_CONFIDENCE','MISSING_REQUIRED_FIELD','BROKEN_NUMERIC','CONFLICTING_VALUES','STRUCTURED_PARSER_REVIEW','STRUCTURED_FACTOR_REVIEW'].some(x=>st.includes(x));
      const id=clean(c.candidate_id)||JSON.stringify(c).slice(0,120); if(!ok||seen.has(id)) return false; seen.add(id); return true;
    }).map(c=>{
      const pv=c.parsed_value&&typeof c.parsed_value==='object'?c.parsed_value:{};
      const field=clean(c.core_field_key||c.field||pv.field||c.candidate_type||'검토 항목');
      const vals=[pv.parcel_address,pv.standard_land_symbol,pv.official_price,pv.unit_price,pv.amount,pv.value,c.value].filter(v=>v!==null&&v!==undefined&&clean(v));
      return { kind:'structured', candidate:c, field, value:vals.length?clean(vals[0]):'값을 찾지 못함', evidence:clean(c.raw_text_snippet||c.review_reason||c.next_action)||'원문과 대조해 확인하세요.' };
    });
  }
  function collect(){
    const structured=structuredItems();
    const legacy=legacyItems();
    state.items=structured.length?structured:legacy;
    if(state.index>=state.items.length) state.index=Math.max(0,state.items.length-1);
    return state.items;
  }

  function style(){
    if(document.getElementById(STYLE_ID)) return;
    const s=document.createElement('style'); s.id=STYLE_ID; s.textContent=`
      #${ROOT_ID}{position:fixed;inset:0;z-index:2147483000;background:#f4f5f7;color:#191b1f;font-family:inherit;display:flex;flex-direction:column}
      #${ROOT_ID}[hidden]{display:none!important}.bso3-head{padding:calc(12px + env(safe-area-inset-top)) 14px 11px;background:#fff;border-bottom:1px solid #e2e5e8;display:flex;justify-content:space-between;align-items:center}.bso3-head b{font-size:18px}.bso3-head span{display:block;font-size:11px;color:#6f7680}.bso3-head button{border:0;border-radius:10px;background:#eef0f3;padding:9px 11px;font-weight:800}.bso3-main{flex:1;overflow:auto;padding:14px 14px 132px}.bso3-card{background:#fff;border:1px solid #e1e4e8;border-radius:16px;padding:16px;margin-bottom:12px}.bso3-k{font-size:11px;color:#777f87;font-weight:800}.bso3-v{font-size:22px;font-weight:900;line-height:1.25;margin-top:4px;overflow-wrap:anywhere}.bso3-desc{font-size:13px;line-height:1.5;color:#555d65;margin-top:8px}.bso3-row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-top:1px solid #eef0f2}.bso3-row:first-child{border-top:0}.bso3-primary{width:100%;min-height:52px;border:0;border-radius:13px;background:var(--lk-burgundy,#7a243f);color:#fff;font-weight:900;font-size:15px}.bso3-secondary{width:100%;min-height:48px;border:1px solid #cfd4da;border-radius:13px;background:#fff;font-weight:850;margin-top:8px}.bso3-evidence{margin-top:12px;padding:12px;background:#fafbfc;border-left:3px solid #d0d5db;font-size:12.5px;line-height:1.5}.bso3-actions{position:fixed;left:0;right:0;bottom:64px;display:grid;grid-template-columns:repeat(4,1fr);gap:7px;padding:9px 10px;background:#fff;border-top:1px solid #dfe3e7}.bso3-actions button{min-height:48px;border-radius:11px;border:1px solid #ccd2d8;background:#fff;font-weight:900}.bso3-actions .ok{background:var(--lk-burgundy,#7a243f);color:#fff;border-color:var(--lk-burgundy,#7a243f)}.bso3-nav{position:fixed;left:0;right:0;bottom:0;height:64px;display:grid;grid-template-columns:repeat(6,1fr);background:#fff;border-top:1px solid #d9dde2}.bso3-nav button{border:0;background:#fff;font-size:11px;font-weight:800}.bso3-legacybar{position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483005;display:none;gap:8px}.bso3-legacybar button{flex:1;min-height:44px;border-radius:12px;border:1px solid #ccd2d8;background:#fff;font-weight:900}.bso3-legacybar .back{background:var(--lk-burgundy,#7a243f);color:#fff}.bso3-toast{position:fixed;left:50%;bottom:132px;transform:translateX(-50%);background:#20242a;color:#fff;padding:10px 14px;border-radius:10px;font-size:12px;z-index:2147483006}.bso3-upload{display:block;width:100%;padding:16px 12px;border-radius:13px;background:#1f6feb;color:#fff;text-align:center;font-weight:900;box-sizing:border-box}.bso3-upload input{display:none}body.bso3-legacy #${ROOT_ID}{display:none!important}body.bso3-legacy .bso3-legacybar{display:flex!important}@media(min-width:821px){#${ROOT_ID},.bso3-legacybar{display:none!important}}
    `; document.head.appendChild(s);
  }
  function root(){
    style(); let r=document.getElementById(ROOT_ID); if(r) return r;
    r=document.createElement('section'); r.id=ROOT_ID; r.innerHTML=`<header class="bso3-head"><div><b>보상전략 OS</b><span>모바일 · PC 기능 동등</span></div><button data-action="legacy-home">전체 화면</button></header><main class="bso3-main"></main><div class="bso3-actions" hidden></div><nav class="bso3-nav">${NAV.map(n=>`<button data-nav="${n[0]}">${n[1]}</button>`).join('')}</nav><div class="bso3-toast" hidden></div>`; document.body.appendChild(r); r.addEventListener('click',click);
    const bar=document.createElement('div'); bar.className='bso3-legacybar'; bar.innerHTML='<button class="back">모바일 메뉴로</button><button class="top">맨 위로</button>'; document.body.appendChild(bar); bar.querySelector('.back').onclick=closeLegacy; bar.querySelector('.top').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
    return r;
  }
  function toast(msg){ const n=root().querySelector('.bso3-toast'); n.textContent=msg; n.hidden=false; clearTimeout(state.timer); state.timer=setTimeout(()=>n.hidden=true,1800); }
  function caseName(){ const u=uploads(); if(!u.length) return '새 사건'; return clean(u[0].file_name||u[0].source_file_name)||'등록된 사건'; }
  function renderHome(){
    if(!isMobile()||state.legacy) return; state.mode='home'; collect(); const r=root(), m=r.querySelector('.bso3-main'), a=r.querySelector('.bso3-actions'); a.hidden=true;
    const u=uploads(), count=state.items.length;
    m.innerHTML=`<section class="bso3-card"><div class="bso3-k">현재 사건</div><div class="bso3-v">${esc(caseName())}</div><div class="bso3-desc">PC 기능은 모두 유지하고, 모바일에서는 필요한 작업을 먼저 보여줍니다.</div></section><section class="bso3-card"><div class="bso3-row"><span>평가서</span><b>${u.length}개</b></div><div class="bso3-row"><span>검토할 항목</span><b>${count}건</b></div></section>${u.length?`<section class="bso3-card"><button class="bso3-primary" data-action="start-review">전체 검수 ${count}건 시작</button><button class="bso3-secondary" data-action="legacy-case">원문·상세 보기</button></section>`:`<section class="bso3-card"><label class="bso3-upload">평가서 PDF 선택<input type="file" accept="application/pdf" multiple data-role="upload"></label></section>`}`;
    const input=m.querySelector('[data-role=upload]'); if(input) input.onchange=()=>transfer(input);
  }
  function renderReview(){
    collect(); state.mode='review'; const r=root(),m=r.querySelector('.bso3-main'),a=r.querySelector('.bso3-actions');
    if(!state.items.length){ a.hidden=true; m.innerHTML='<section class="bso3-card"><div class="bso3-v">검토 항목을 불러오지 못했습니다</div><div class="bso3-desc">원문 상세에서 기존 수동검수 카드를 확인할 수 있습니다.</div><button class="bso3-secondary" data-action="legacy-case">원문·상세 보기</button></section>'; return; }
    const item=state.items[state.index]; m.innerHTML=`<section class="bso3-card"><div class="bso3-k">${state.index+1} / ${state.items.length}</div><div class="bso3-v">${esc(item.field)}</div><div class="bso3-desc">BSO가 읽은 값</div><div class="bso3-v">${esc(item.value)}</div><div class="bso3-evidence">${esc(item.evidence)}</div><button class="bso3-secondary" data-action="legacy-case">원문·상세 보기</button></section>`;
    a.hidden=false; a.innerHTML='<button class="ok" data-action="confirm">확인</button><button data-action="edit">수정</button><button data-action="hold">보류</button><button data-action="next">다음</button>';
  }
  function transfer(input){ const orig=Array.from(document.querySelectorAll('input[type=file]')).find(x=>!x.closest(`#${ROOT_ID}`)); if(!orig||!input.files.length) return toast('파일 입력을 찾지 못했습니다.'); try{ const dt=new DataTransfer(); Array.from(input.files).forEach(f=>dt.items.add(f)); orig.files=dt.files; orig.dispatchEvent(new Event('change',{bubbles:true})); setTimeout(renderHome,500); }catch(e){ toast('자료 탭에서 파일을 등록해주세요.'); } }
  function findNav(key){ const def=NAV.find(n=>n[0]===key); if(!def) return null; return document.querySelector(`nav.axis-nav button[data-section="${def[3]}"]`)||buttons().find(b=>!b.closest(`#${ROOT_ID}`)&&def[2].test(clean(b.textContent))); }
  function openLegacy(key){ const b=findNav(key)||findNav('home'); if(!b) return toast('해당 PC 기능을 찾지 못했습니다.'); state.legacy=true; document.body.classList.add('bso3-legacy'); b.click(); }
  function closeLegacy(){ state.legacy=false; document.body.classList.remove('bso3-legacy'); renderHome(); }
  function act(kind){
    const item=state.items[state.index]; if(!item) return;
    if(item.kind==='legacy'){
      const b=item[kind]; if(kind==='edit'){ openLegacy('case'); if(b) setTimeout(()=>b.click(),80); return; }
      if(b) b.click();
    } else if(item.candidate){
      item.candidate.review_status_code=kind==='confirm'?'CONFIRMED_BY_USER':'HOLD'; item.candidate.auto_confirmed=false; item.candidate.reviewed_at=new Date().toISOString();
      if(kind==='edit'){ openLegacy('case'); return; }
    }
    state.index=Math.min(state.index+1,Math.max(0,state.items.length-1)); setTimeout(renderReview,60);
  }
  function click(e){ const b=e.target.closest('button'); if(!b) return; if(b.dataset.nav){ if(b.dataset.nav==='home') renderHome(); else openLegacy(b.dataset.nav); return; } switch(b.dataset.action){ case 'start-review': state.index=0; renderReview(); break; case 'legacy-home': openLegacy('home'); break; case 'legacy-case': openLegacy('case'); break; case 'confirm': act('confirm'); break; case 'edit': act('edit'); break; case 'hold': act('hold'); break; case 'next': state.index=(state.index+1)%state.items.length; renderReview(); break; } }
  function interceptLegacyReview(){
    document.addEventListener('click',e=>{
      if(!isMobile()||state.legacy) return;
      const b=e.target.closest('button');
      if(!b||b.closest(`#${ROOT_ID}`)) return;
      if(/전체\s*검수\s*시작/.test(clean(b.textContent))){
        e.preventDefault();
        e.stopImmediatePropagation();
        state.legacy=false;
        document.body.classList.remove('bso3-legacy');
        state.index=0;
        renderReview();
      }
    },true);
  }
  function boot(){ if(!isMobile()) return; root(); renderHome(); interceptLegacyReview(); const o=new MutationObserver(()=>{ if(!state.legacy&&state.mode==='home') requestAnimationFrame(renderHome); }); o.observe(document.body,{childList:true,subtree:true}); }
  if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
