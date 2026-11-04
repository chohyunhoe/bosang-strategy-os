'use strict';

function safeText(value) {
  return String(value === undefined || value === null ? '' : value);
}

function formatFactor(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : '-';
}

function sourceLabel(detail) {
  const ref = Array.isArray(detail.source_refs) ? detail.source_refs[0] : null;
  if (!ref) return '출처 확인 필요';
  const page = ref.page_no ? `${ref.page_no}쪽` : '페이지 미확인';
  const lines = ref.line_start ? ` ${ref.line_start}${ref.line_end && ref.line_end !== ref.line_start ? `–${ref.line_end}` : ''}행` : '';
  return `${page}${lines}`;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = safeText(text);
  return element;
}

function renderDetailTable(row) {
  const details = Array.isArray(row.individual_factor_details) ? row.individual_factor_details : [];
  const wrapper = createElement('div', 'ifd-row');
  const heading = createElement('div', 'ifd-heading');
  heading.appendChild(createElement('strong', '', row.parcel_address || row.land_id || '대상토지'));
  heading.appendChild(createElement('span', 'ifd-total', `개별요인 누계 ${formatFactor(row.individual_factor_total)}`));
  wrapper.appendChild(heading);

  if (details.length === 0) {
    wrapper.appendChild(createElement(
      'div',
      'ifd-missing',
      '평가서에서 세부계수를 명시적으로 확인하지 못했습니다. 누계값을 임의로 분해하지 않았습니다.',
    ));
    return wrapper;
  }

  const tableWrap = createElement('div', 'ifd-table-wrap');
  const table = createElement('table', 'ifd-table');
  const thead = createElement('thead');
  const headRow = createElement('tr');
  ['구분', '세부항목', '계수', '원문 근거'].forEach((label) => headRow.appendChild(createElement('th', '', label)));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = createElement('tbody');
  details.forEach((detail) => {
    const tr = createElement('tr');
    tr.appendChild(createElement('td', '', detail.category));
    tr.appendChild(createElement('td', '', detail.item));
    tr.appendChild(createElement('td', 'ifd-number', formatFactor(detail.factor_value)));
    tr.appendChild(createElement('td', 'ifd-source', sourceLabel(detail)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);
  return wrapper;
}

function ensureStyles() {
  if (document.getElementById('bosang-individual-factor-styles')) return;
  const style = document.createElement('style');
  style.id = 'bosang-individual-factor-styles';
  style.textContent = `
    .ifd-card{grid-column:1/-1;min-width:0;background:var(--lk-paper,#fff);color:var(--lk-ink,#16181b);border:1px solid var(--lk-line,#e2e4e8);border-radius:10px;padding:20px;margin-top:2px;box-shadow:0 4px 14px rgba(20,24,28,.05)}
    .ifd-card h3{margin:0 0 6px;font-size:16px;line-height:1.35;color:var(--lk-ink,#16181b)}
    .ifd-note{color:var(--lk-slate,#6b7076);font-size:12px;line-height:1.55;margin-bottom:14px}
    .ifd-row{min-width:0;border-top:1px solid var(--lk-line,#e2e4e8);padding:14px 0}.ifd-row:first-of-type{border-top:0}
    .ifd-heading{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:9px;color:var(--lk-ink,#16181b)}
    .ifd-total{flex:0 0 auto;color:var(--lk-warn,#8a5b00);background:#fff7df;border:1px solid #ead8a9;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}
    .ifd-missing{border:1px dashed #d7bd77;background:#fff9e8;color:#6f5315;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.55}
    .ifd-table-wrap{width:100%;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
    .ifd-table{width:100%;min-width:620px;border-collapse:collapse;table-layout:fixed;font-size:12px;color:var(--lk-ink,#16181b)}
    .ifd-table th,.ifd-table td{padding:8px 10px;border-bottom:1px solid var(--lk-line-soft,#eceef0);text-align:left;vertical-align:top;overflow-wrap:anywhere}
    .ifd-table th{color:var(--lk-slate,#5f646b);background:var(--lk-panel,#f7f7f8);font-weight:750}
    .ifd-table th:nth-child(1),.ifd-table td:nth-child(1){width:18%}.ifd-table th:nth-child(2),.ifd-table td:nth-child(2){width:34%}.ifd-table th:nth-child(3),.ifd-table td:nth-child(3){width:14%}.ifd-table th:nth-child(4),.ifd-table td:nth-child(4){width:34%}
    .ifd-number{font-variant-numeric:tabular-nums;font-weight:800;white-space:nowrap}.ifd-source{color:var(--lk-slate,#6b7076)}
    @media(max-width:767px){
      .ifd-card{padding:16px;border-radius:9px}.ifd-heading{align-items:flex-start;flex-direction:column}.ifd-total{align-self:flex-start}
      .ifd-table-wrap{overflow:visible}.ifd-table{min-width:0}.ifd-table,.ifd-table tbody,.ifd-table tr,.ifd-table td{display:block;width:100%}.ifd-table thead{display:none}
      .ifd-table tr{box-sizing:border-box;border:1px solid var(--lk-line,#e2e4e8);background:var(--lk-paper,#fff);border-radius:8px;padding:9px 10px;margin-bottom:8px}
      .ifd-table td,.ifd-table td:nth-child(n){box-sizing:border-box;width:100%;border:0;padding:4px 0;white-space:normal}
      .ifd-table td::before{display:inline-block;min-width:74px;margin-right:6px;color:var(--lk-slate,#6b7076);font-weight:700}
      .ifd-table td:nth-child(1)::before{content:'구분'}.ifd-table td:nth-child(2)::before{content:'세부항목'}.ifd-table td:nth-child(3)::before{content:'계수'}.ifd-table td:nth-child(4)::before{content:'원문 근거'}
    }
  `;
  document.head.appendChild(style);
}

function renderIntoWorkflow(rowsInput = []) {
  const grid = document.getElementById('workflowValueGrid');
  if (!grid) return;
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  const existing = document.getElementById('individualFactorDetailCard');

  if (rows.length === 0) {
    if (existing) existing.remove();
    return;
  }

  ensureStyles();
  const card = createElement('div', 'ifd-card');
  card.id = 'individualFactorDetailCard';
  card.appendChild(createElement('h3', '', '개별요인 세부내역'));
  card.appendChild(createElement(
    'div',
    'ifd-note',
    '평가서에 명시된 항목별 계수와 원문 근거를 표시합니다. 누계에서 항목별 값을 역산하거나 추정하지 않습니다.',
  ));
  rows.forEach((row) => card.appendChild(renderDetailTable(row)));

  if (existing) existing.replaceWith(card);
  else grid.appendChild(card);
}

function isFullReviewButton(event) {
  const button = event.target && event.target.closest ? event.target.closest('button') : null;
  return button && /전체\s*검수\s*시작/.test(button.textContent || '') ? button : null;
}

function revealCandidateReviewWorkspace() {
  if (typeof window.showSection === 'function') window.showSection('uploadHub');
  const target = document.getElementById('candidateReviewWorkspace');
  if (!target) return;
  if (target.tagName === 'DETAILS') target.open = true;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (target.focus) target.focus({ preventScroll: true });
}

function installCandidateReviewCtaFix() {
  // Preserve the stable16 contract synchronously before the live progress
  // controller takes ownership of the same click later in window capture.
  window.addEventListener('click', (event) => {
    if (!isFullReviewButton(event)) return;
    revealCandidateReviewWorkspace();
  }, true);

  document.addEventListener('click', (event) => {
    const button = isFullReviewButton(event);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    revealCandidateReviewWorkspace();
  }, true);
}

function installIndividualFactorUi() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__bosangIndividualFactorUiInstalled) return;
  window.__bosangIndividualFactorUiInstalled = true;

  installCandidateReviewCtaFix();
}

module.exports = {
  installIndividualFactorUi,
  renderIntoWorkflow,
};
