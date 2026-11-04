import { recordDiagnosticEvent } from './session-diagnostics.js';

const SCHEMAS = {
  caseInfo: [
    ['case_name','사건명','text'],['project_name','사업명','text'],['appraisal_purpose','평가목적','text'],['base_date','기준시점','text'],['price_date','가격시점','text'],
  ],
  appraisals: [
    ['appraisal_company','평가법인','text'],['valuation_date','평가기준일','text'],
  ],
  lands: [
    ['parcel_address','소재지','text'],['pnu','PNU(19자리)','text'],['land_category','지목','text'],['area','면적(㎡)','number'],['appraisal_use_status','현황 이용상황','text'],
  ],
  standardLands: [
    ['standard_land_symbol','기호','text'],['parcel_address','소재지','text'],['pnu','PNU(19자리)','text'],['land_category','지목','text'],['use_status','이용상황','text'],['zoning','용도지역','text'],['official_price','공시지가','number'],
  ],
  transactionCases: [
    ['case_symbol','기호','text'],['case_date','시점','text'],['parcel_address','소재지','text'],['pnu','PNU(19자리)','text'],['land_category','지목','text'],['zoning','용도지역','text'],['case_unit_price','단가','number'],
  ],
  appraisalResults: [
    ['standard_land_symbol','표준지 기호','text'],['official_price','공시지가','number'],['time_correction','시점수정','number'],['regional_factor','지역요인','number'],['individual_factor_total','개별요인 누계','number'],['other_factor','그 밖의 요인','number'],['calculated_unit_price','산출단가','number'],['unit_price','적용단가','number'],['amount','평가금액','number'],
  ],
  subjectFactorTotals: [
    ['standard_land_symbol','표준지 기호','text'],['total_factor','개별요인 누계','number'],
  ],
  otherFactors: [
    ['standard_land_symbol','표준지 기호','text'],['decided_other_factor','그 밖의 요인 결정치','number'],
  ],
  obstacleRows: [
    ['serial_no','일련번호','text'],['parcel_address','소재지','text'],['item_type','물건 종류','text'],['specification','규격','text'],['quantity','수량','number'],['quantity_unit','단위','text'],['unit_price','단가','number'],['amount','금액','number'],
  ],
};

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const arr = (value) => Array.isArray(value) ? value : [];

function style() {
  if (document.getElementById('bso-v2-inspector-style')) return;
  const node = document.createElement('style');
  node.id = 'bso-v2-inspector-style';
  node.textContent = `
  .inspector-backdrop{position:fixed;inset:0;z-index:600;background:rgba(15,18,22,.46);display:flex;justify-content:flex-end}.inspector{width:min(640px,100%);height:100%;background:#f5f6f8;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(0,0,0,.14)}.inspector-head{background:#fff;border-bottom:1px solid #dde1e6;padding:16px;display:flex;justify-content:space-between;align-items:center}.inspector-head h2{font-size:18px;margin:0}.inspector-close{border:0;background:#eef0f3;border-radius:10px;width:40px;height:40px;font-size:21px}.inspector-body{padding:14px;overflow:auto;display:grid;gap:12px}.inspector-section{background:#fff;border:1px solid #dde1e6;border-radius:14px;padding:15px}.inspector-section h3{font-size:14px;margin:0 0 10px}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field label{display:block;font-size:11px;color:#6d747d;font-weight:800;margin-bottom:5px}.field input{width:100%;min-height:42px;border:1px solid #c9cfd6;border-radius:9px;padding:8px 10px;background:#fff}.source-ref{border:1px solid #e1e4e8;border-radius:10px;padding:10px;margin-top:8px;background:#fafbfc}.source-meta{font-size:11px;color:#68707a;font-weight:800}.source-text{font-size:12px;line-height:1.55;margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}.inspector-actions{position:sticky;bottom:0;background:#fff;border-top:1px solid #dde1e6;padding:12px 14px;display:flex;gap:8px}.inspector-actions button{min-height:46px;border-radius:11px;padding:8px 14px;font-weight:850}.inspector-save{border:0;background:#872647;color:#fff;flex:1}.inspector-cancel{border:1px solid #cbd1d8;background:#fff}.review-warning{font-size:12px;line-height:1.5;color:#7b5700;background:#fff6dd;border-radius:10px;padding:10px}@media(max-width:640px){.field-grid{grid-template-columns:1fr}.inspector{width:100%}.inspector-body{padding-bottom:24px}}
  `;
  document.head.appendChild(node);
}

function sourceText(ref) {
  return ref?.raw_text_excerpt || ref?.excerpt || ref?.source_text || '원문 발췌가 저장되지 않았습니다. 페이지 번호를 기준으로 원본 PDF와 대조하세요.';
}
function renderSourceRefs(record) {
  const refs = arr(record?.source_refs);
  if (!refs.length) return '<div class="review-warning">원문 source_ref가 없습니다. 이 값은 자동확정할 수 없으며 원본 PDF 대조가 필요합니다.</div>';
  return refs.map((ref, index) => `<div class="source-ref"><div class="source-meta">근거 ${index + 1} · p.${esc(ref.page_no || ref.page || '—')} · ${esc(ref.source_label || ref.label || '원문')}</div><div class="source-text">${esc(sourceText(ref))}</div></div>`).join('');
}
function normalizeInput(type, value) {
  if (type !== 'number') return String(value || '').trim();
  if (String(value || '').trim() === '') return null;
  const number = Number(String(value).replace(/,/g,''));
  return Number.isFinite(number) ? number : null;
}
function validPnu(value) { return value === '' || /^\d{19}$/.test(value); }
function getRecord(store, collection, index) {
  if (collection === 'caseInfo') return store.state?.caseInfo || null;
  return store.state?.[collection]?.[Number(index)] || null;
}

export function openRecordInspector(store, collection, index = 0, title = '원문·수정') {
  style();
  document.querySelector('.inspector-backdrop')?.remove();
  const record = getRecord(store, collection, index);
  if (!record) return false;
  const schema = SCHEMAS[collection] || [];
  const backdrop = document.createElement('div');
  backdrop.className = 'inspector-backdrop';
  backdrop.innerHTML = `<aside class="inspector" role="dialog" aria-modal="true"><header class="inspector-head"><div><h2>${esc(title)}</h2><div class="source-meta">${esc(collection)} · 자동확정 아님</div></div><button type="button" class="inspector-close" aria-label="닫기">×</button></header><div class="inspector-body"><section class="inspector-section"><h3>구조화값</h3>${schema.length ? `<div class="field-grid">${schema.map(([key,label,type]) => `<div class="field"><label>${esc(label)}</label><input data-key="${esc(key)}" data-type="${type}" type="text" inputmode="${type === 'number' ? 'decimal' : key === 'pnu' ? 'numeric' : 'text'}" value="${esc(record[key] ?? '')}"></div>`).join('')}</div>` : '<div class="review-warning">이 컬렉션은 현재 직접 수정 대상이 아닙니다.</div>'}</section><section class="inspector-section"><h3>원문 근거</h3>${renderSourceRefs(record)}</section><section class="inspector-section"><h3>검토 상태</h3><div class="review-warning">저장하면 해당 레코드 또는 기본정보 그룹은 다시 NEEDS_REVIEW 상태가 됩니다. PNU도 자동추정하지 않으며 19자리 확인값만 저장합니다.</div></section></div><footer class="inspector-actions"><button type="button" class="inspector-cancel">취소</button><button type="button" class="inspector-save" ${schema.length ? '' : 'disabled'}>수정 저장</button></footer></aside>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('.inspector-close').addEventListener('click', close);
  backdrop.querySelector('.inspector-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('.inspector-save').addEventListener('click', () => {
    const changes = {};
    backdrop.querySelectorAll('[data-key]').forEach((input) => { changes[input.dataset.key] = normalizeInput(input.dataset.type, input.value); });
    if ('pnu' in changes && !validPnu(changes.pnu)) {
      recordDiagnosticEvent('RECORD_EDIT_BLOCKED',{operation:collection,reason_code:'PNU_INVALID'});
      window.alert('PNU는 비워 두거나 정확한 19자리 숫자여야 합니다.');
      return;
    }
    if (collection === 'caseInfo' && typeof store.updateCaseInfo === 'function') store.updateCaseInfo(changes);
    else store.updateRecord(collection, (_row, rowIndex) => rowIndex === Number(index), changes);
    recordDiagnosticEvent('RECORD_EDIT_SAVED',{operation:collection,count:Object.keys(changes).length});
    close();
  });
  return true;
}
