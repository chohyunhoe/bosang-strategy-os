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
  const local = { open:false, index:0, notice:'' };

  function pending() { return arr(store.state.reviewQueue).filter((item) => item && item.status !== 'CONFIRMED'); }
  function rowsFor(item) {
    if (!item || !item.collection) return [];
    if (item.collection === 'caseInfo') return store.state.caseInfo ? [store.state.caseInfo] : [];
    return arr(store.state[item.collection]);
  }

  function ensureStyle() {
    if (document.getElementById('bso-v2-review-workbench-style')) return;
    const style = document.createElement('style');
    style.id = 'bso-v2-review-workbench-style';
    style.textContent = `
      .review-workbench-launch{border:0;background:#872647;color:#fff;border-radius:10px;padding:8px 12px;font-weight:850;min-height:40px}.review-workbench-launch.complete{background:#eaf7ee;color:#24633d;border:1px solid #bcdcc7}
      .review-workbench-backdrop{position:fixed;inset:0;z-index:500;background:rgba(17,20,24,.52);display:flex;justify-content:center;align-items:center;padding:20px}
      .review-workbench{width:min(760px,100%);max-height:min(820px,calc(100vh - 40px));background:#f5f6f8;border-radius:18px;box-shadow:0 22px 70px rgba(0,0,0,.26);display:flex;flex-direction:column;overflow:hidden}
      .review-workbench-head{background:#fff;border-bottom:1px solid #dde1e6;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}.review-workbench-head h2{margin:2px 0 0;font-size:20px}.review-workbench-progress{font-size:12px;color:#6c737c;font-weight:800}.review-workbench-close{border:0;background:#eef0f3;border-radius:10px;width:40px;height:40px;font-size:20px}
      .review-workbench-body{padding:18px;overflow:auto}.review-workbench-card{background:#fff;border:1px solid #dde1e6;border-radius:15px;padding:18px}.review-workbench-card h3{margin:8px 0 8px;font-size:22px}.review-workbench-card p{margin:0;line-height:1.65;color:#555e68}
      .review-workbench-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px}.review-workbench-meta div{background:#f7f8fa;border-radius:10px;padding:10px}.review-workbench-meta span{display:block;font-size:10px;color:#707883;font-weight:800}.review-workbench-meta b{display:block;margin-top:4px;font-size:14px}
      .review-workbench-previews{display:grid;gap:9px;margin-top:14px}.review-workbench-preview{border:1px solid #e0e4e8;border-radius:11px;padding:11px;background:#fafbfc}.review-workbench-preview-head{display:flex;gap:8px;justify-content:space-between;align-items:flex-start}.review-workbench-preview-head b{display:block;font-size:13px}.review-workbench-edit{border:1px solid #c8ced5;background:#fff;border-radius:8px;padding:5px 8px;font-size:10px;font-weight:850;white-space:nowrap}.review-workbench-value{margin-top:5px;font-size:12px;line-height:1.55;color:#343b43}.review-workbench-source{margin-top:7px;padding-top:7px;border-top:1px dashed #d9dde2;font-size:11px;line-height:1.5;color:#67707a}.review-workbench-source strong{color:#505861}.review-workbench-more{margin-top:9px;font-size:11px;color:#6c737c;font-weight:800}
      .review-workbench-blocked{margin-top:12px;padding:11px;border-radius:10px;background:#fff1f3;color:#8b253f;font-size:12px;line-height:1.55;font-weight:750}.review-workbench-actions{background:#fff;border-top:1px solid #dde1e6;padding:12px 16px;display:grid;grid-template-columns:1.15fr 1fr 1fr 1fr;gap:8px}.review-workbench-actions button{min-height:48px;border-radius:11px;padding:8px 10px;font-weight:850}.review-workbench-actions button:disabled{cursor:not-allowed;opacity:.55}.review-workbench-open{border:1px solid #c8ced5;background:#fff}.review-workbench-confirm{border:0;background:#872647;color:#fff}.review-workbench-hold,.review-workbench-next{border:1px solid #c8ced5;background:#f8f9fa}.review-workbench-empty{text-align:center;padding:42px 20px;background:#fff;border-radius:14px}.review-workbench-empty h3{font-size:20px;margin:0 0 8px}
      @media(max-width:640px){.review-workbench-backdrop{padding:0;align-items:stretch}.review-workbench{width:100%;max-height:none;height:100%;border-radius:0}.review-workbench-head{padding:14px 15px}.review-workbench-body{padding:14px;padding-bottom:100px}.review-workbench-card h3{font-size:20px}.review-workbench-meta{grid-template-columns:1fr}.review-workbench-actions{position:fixed;left:0;right:0;bottom:0;grid-template-columns:repeat(4,1fr);padding:10px max(10px,env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));z-index:501}.review-workbench-actions button{font-size:12px;padding:6px}.review-workbench-launch{min-height:40px;padding:7px 10px;font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  function normalizeIndex(items) { if (!items.length) { local.index = 0; return; } if (local.index < 0) local.index = 0; if (local.index >= items.length) local.index = items.length - 1; }
  function open(index = 0) { local.index = Math.max(0, Number(index) || 0); local.notice = ''; local.open = true;recordDiagnosticEvent('REVIEW_WORKBENCH_OPENED',{review_pending:pending().length,index:local.index+1});render(); }
  function close() { local.open = false; render(); }

  function confirmCurrent() {
    const items = pending(); normalizeIndex(items); const item = items[local.index]; if (!item) return;
    const result = store.decide(item.review_id, 'CONFIRMED');
    if (result && result.ok === false) { recordDiagnosticEvent('REVIEW_DECISION',{status:'BLOCKED',confirmable:false});local.notice = result.reason || item.blocked_reason || '현재 항목은 검수완료할 수 없습니다.'; render(); return; }
    recordDiagnosticEvent('REVIEW_DECISION',{status:'CONFIRMED',confirmable:true});
    local.notice = '';
    const next = pending(); if (!next.length) local.index = 0; else if (local.index >= next.length) local.index = next.length - 1; render();
  }
  function holdCurrent() {
    const items = pending(); normalizeIndex(items); const item = items[local.index]; if (!item) return;
    store.decide(item.review_id, 'HOLD');recordDiagnosticEvent('REVIEW_DECISION',{status:'HOLD'});const nextItems = pending(); if (nextItems.length) local.index = (local.index + 1) % nextItems.length; render();
  }
  function nextCurrent() { const items = pending(); normalizeIndex(items); if (!items.length) return; local.notice = ''; local.index = (local.index + 1) % items.length; render(); }
  function openSource() { const items = pending(); normalizeIndex(items); const item = items[local.index]; if (!item) return; local.open = false; store.setRoute(item.route || 'home'); }

  function renderLauncher() {
    ensureStyle(); document.querySelector('[data-review-workbench-launch]')?.remove(); if (store.state.status === 'EMPTY') return;
    const actions = document.querySelector('.topbar .review-actions'); if (!actions) return;
    const count = pending().length; const button = document.createElement('button'); button.type = 'button'; button.className = `review-workbench-launch${count ? '' : ' complete'}`; button.dataset.reviewWorkbenchLaunch = '1'; button.dataset.reviewState = count ? 'pending' : 'complete'; button.textContent = count ? `전체 검수 ${count}` : '검수 완료 ✓'; button.addEventListener('click', () => open(0)); actions.prepend(button);
  }

  function renderOverlay() {
    document.querySelector('[data-review-workbench]')?.remove(); if (!local.open) return;
    const items = pending(); normalizeIndex(items); const current = items[local.index] || null; const allRows = current ? rowsFor(current) : [];
    const previews = allRows.slice(0, 5).map((row, rowIndex) => ({ ...rowPreview(current.collection, row, store.state), rowIndex }));
    const overlay = document.createElement('div'); overlay.className = 'review-workbench-backdrop'; overlay.dataset.reviewWorkbench = '1';
    overlay.innerHTML = `
      <section class="review-workbench" role="dialog" aria-modal="true" aria-label="전체 검수">
        <div class="review-workbench-head"><div><div class="review-workbench-progress">${items.length ? `${local.index + 1} / ${items.length}` : '완료'}</div><h2>전체 검수</h2></div><button type="button" class="review-workbench-close" aria-label="닫기">×</button></div>
        <div class="review-workbench-body">${current ? `<div class="review-workbench-card"><span class="badge ${current.status === 'HOLD' ? 'warn' : ''}">${esc(current.route_label || current.route || '검토')}</span><h3>${esc(current.label)}</h3><p>${esc(current.description || '원문과 구조화 값을 확인하세요.')}</p><div class="review-workbench-meta"><div><span>검토 행</span><b>${esc(current.row_count || 0)}행</b></div><div><span>주의</span><b>${esc(current.exception_count || 0)}건</b></div><div><span>현재 상태</span><b>${esc(current.status || 'NEEDS_REVIEW')}</b></div></div>${current.confirmable === false || local.notice ? `<div class="review-workbench-blocked">${esc(local.notice || current.blocked_reason || '필수값 누락으로 검수완료할 수 없습니다.')}</div>` : ''}${previews.length ? `<div class="review-workbench-previews">${previews.map((preview) => `<div class="review-workbench-preview"><div class="review-workbench-preview-head"><b>${esc(preview.title)}</b><button type="button" class="review-workbench-edit" data-review-edit="${preview.rowIndex}">원문·수정</button></div><div class="review-workbench-value">${esc(preview.value)}</div><div class="review-workbench-source"><strong>${esc(preview.evidence.label)}</strong><br>${esc(preview.evidence.text)}</div></div>`).join('')}</div>${allRows.length > previews.length ? `<div class="review-workbench-more">외 ${allRows.length - previews.length}행 · 전체 내용은 ‘상세화면’에서 확인</div>` : ''}` : '<div class="review-workbench-more">구조화 행이 없습니다. 상세화면에서 원문 상태를 확인하세요.</div>'}</div>` : `<div class="review-workbench-empty"><h3>검수가 완료되었습니다.</h3><p>현재 reviewQueue에 남은 검토 항목이 없습니다. 완료 버튼을 눌러 이 상태를 다시 확인할 수 있습니다.</p></div>`}</div>
        ${current ? `<div class="review-workbench-actions"><button type="button" class="review-workbench-open">상세화면</button><button type="button" class="review-workbench-confirm" ${current.confirmable === false ? 'disabled' : ''}>${current.confirmable === false ? '확인 불가' : '검수완료'}</button><button type="button" class="review-workbench-hold">보류</button><button type="button" class="review-workbench-next">다음</button></div>` : ''}
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.review-workbench-close')?.addEventListener('click', close);
    overlay.querySelector('.review-workbench-open')?.addEventListener('click', openSource);
    overlay.querySelector('.review-workbench-confirm')?.addEventListener('click', confirmCurrent);
    overlay.querySelector('.review-workbench-hold')?.addEventListener('click', holdCurrent);
    overlay.querySelector('.review-workbench-next')?.addEventListener('click', nextCurrent);
    overlay.querySelectorAll('[data-review-edit]').forEach((button) => button.addEventListener('click', () => {
      if (!current) return;
      openRecordInspector(store, current.collection, Number(button.dataset.reviewEdit), `${current.label} · 원문·수정`);
    }));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  }

  function render() { renderLauncher(); renderOverlay(); }
  store.subscribe(render); render();
  return { open, close, next:nextCurrent, state:local, pending };
}
