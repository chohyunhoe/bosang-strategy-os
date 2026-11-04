import { probePublicDataBridge, resolvePnuCandidate } from './public-data-adapter.js';

// P0 rebuild sync marker: this module is deliberately review-only.
// PNU candidates are never auto-applied; the user must explicitly apply each candidate.
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const validPnu = (value) => /^\d{19}$/.test(String(value || '').trim());

export function installPnuResolverUi(store) {
  const local = { probing:false, resolving:false, probe:null, candidates:[], failures:[], progress:'' };

  function ensureStyle() {
    if (document.getElementById('bso-v2-pnu-resolver-style')) return;
    const style = document.createElement('style');
    style.id = 'bso-v2-pnu-resolver-style';
    style.textContent = `
      .pnu-resolver-card{margin-top:14px}.pnu-grid{display:grid;gap:8px;margin-top:12px}.pnu-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(150px,.8fr) auto;gap:10px;align-items:center;border:1px solid #dde1e6;border-radius:11px;padding:10px;background:#fff}.pnu-row .mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.pnu-meta{font-size:11px;color:#69717a;line-height:1.45}.pnu-error{color:#8a2844}.pnu-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}@media(max-width:640px){.pnu-row{grid-template-columns:1fr}.pnu-row button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function targets() {
    return [
      ...store.state.lands.map((row, index) => ({ collection:'lands', index, id:row.land_id, label:row.parcel_address || row.land_id, row })),
      ...store.state.standardLands.map((row, index) => ({ collection:'standardLands', index, id:row.standard_land_id, label:`표준지 ${row.standard_land_symbol || ''} ${row.parcel_address || ''}`.trim(), row })),
      ...store.state.transactionCases.map((row, index) => ({ collection:'transactionCases', index, id:row.comp_case_id || row.case_id, label:`사례 ${row.case_symbol || ''} ${row.parcel_address || ''}`.trim(), row })),
    ].filter((item) => !validPnu(item.row?.pnu) && String(item.row?.parcel_address || '').trim());
  }

  function documentAddressContext() {
    return [
      store.state.caseInfo?.case_name,
      store.state.caseInfo?.project_name,
      ...store.state.lands.map((row) => row.parcel_address),
      ...store.state.standardLands.map((row) => row.parcel_address),
      ...store.state.transactionCases.map((row) => row.parcel_address),
    ].filter(Boolean).join(' · ');
  }

  async function probe() {
    if (local.probing) return local.probe;
    local.probing = true; render();
    try { local.probe = await probePublicDataBridge(); }
    finally { local.probing = false; render(); }
    return local.probe;
  }

  async function resolveAll() {
    if (local.resolving) return;
    const status = local.probe || await probe();
    if (!status?.publicData) {
      local.failures = [{ label:'법정동/PNU', error_code:'PUBLIC_DATA_KEY_MISSING' }];
      render();
      return;
    }
    local.resolving = true; local.candidates = []; local.failures = [];
    const source = targets();
    for (let index = 0; index < source.length; index += 1) {
      const item = source[index];
      local.progress = `${index + 1}/${source.length} · ${item.label}`;
      render();
      const result = await resolvePnuCandidate(item.row.parcel_address, documentAddressContext());
      if (result.ok && result.candidate) local.candidates.push({ ...item, candidate:result.candidate });
      else local.failures.push({ ...item, error_code:result.error_code || 'PNU_RESOLVE_FAILED' });
    }
    local.progress = `후보 ${local.candidates.length}건 · 미해결 ${local.failures.length}건`;
    local.resolving = false; render();
  }

  function apply(itemIndex) {
    const item = local.candidates[Number(itemIndex)];
    if (!item) return;
    const candidate = item.candidate;
    store.updateRecord(item.collection, (_row, index) => index === item.index, {
      pnu:candidate.pnu,
      pnu_origin:candidate.origin || 'MOIS_LEGAL_DONG_RESOLVER',
      pnu_legal_dong_name:candidate.legal_dong_name || '',
      pnu_review_status:'NEEDS_REVIEW',
      auto_confirmed:false,
    });
    local.candidates.splice(Number(itemIndex), 1);
    render();
  }

  function render() {
    ensureStyle();
    document.querySelector('[data-pnu-resolver]')?.remove();
    if (store.state.route !== 'lands') return;
    const missing = targets();
    const main = document.querySelector('main');
    if (!main) return;
    const panel = document.createElement('section');
    panel.className = 'card pnu-resolver-card';
    panel.dataset.pnuResolver = '1';
    const configured = Boolean(local.probe?.publicData);
    panel.innerHTML = `
      <div class="section-head"><div><div class="eyebrow">법정동 · PNU</div><h2>PNU 검수 후보</h2><p>주소의 법정동과 지번을 분리하고, 행안부 법정동코드가 exact 또는 유일 suffix로 확인된 경우에만 19자리 PNU 후보를 만듭니다. 자동확정하지 않습니다.</p></div><span class="badge ${configured ? 'ok' : 'warn'}">${local.probing ? '확인 중' : configured ? 'AVAILABLE' : 'LOCAL_ONLY'}</span></div>
      <div class="pnu-actions">
        ${missing.length ? `<button type="button" class="primary" data-pnu-resolve ${local.resolving ? 'disabled' : ''}>${local.resolving ? '후보 생성 중…' : `주소로 PNU 후보 생성 · ${missing.length}필지`}</button>` : '<span class="badge ok">PNU 입력 완료</span>'}
        <button type="button" class="secondary" data-pnu-probe ${local.probing ? 'disabled' : ''}>로컬 법정동 조회 확인</button>
      </div>
      ${local.progress ? `<div class="pnu-meta" style="margin-top:9px">${esc(local.progress)}</div>` : ''}
      ${local.candidates.length ? `<div class="pnu-grid">${local.candidates.map((item, index) => `<div class="pnu-row"><div><b>${esc(item.label)}</b><div class="pnu-meta">${esc(item.candidate.legal_dong_name)} · ${esc(item.candidate.lot_number)} · 검토 필요</div></div><div class="mono">${esc(item.candidate.pnu)}</div><button type="button" class="secondary" data-pnu-apply="${index}">후보 적용</button></div>`).join('')}</div>` : ''}
      ${local.failures.length ? `<div class="pnu-grid">${local.failures.map((item) => `<div class="pnu-row"><div><b>${esc(item.label || 'PNU')}</b></div><div class="pnu-meta pnu-error">${esc(item.error_code)}</div><span class="badge warn">수동 검수</span></div>`).join('')}</div>` : ''}
    `;
    main.appendChild(panel);
    panel.querySelector('[data-pnu-resolve]')?.addEventListener('click', resolveAll);
    panel.querySelector('[data-pnu-probe]')?.addEventListener('click', probe);
    panel.querySelectorAll('[data-pnu-apply]').forEach((button) => button.addEventListener('click', () => apply(button.dataset.pnuApply)));
  }

  store.subscribe(render);
  return { probe, resolveAll, state:local };
}
