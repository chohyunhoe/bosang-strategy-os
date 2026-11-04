import { REVIEW_CHECKS, registerDocument, changeDocument, documentProgress } from './document-workflow.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const labels = { DRAFT: '작성 중', REVIEWED: '검수 기록 완료', APPROVED: '승인 기록', SUBMITTED: '제출 기록' };
const checks = { SOURCE: '원본', NUMBERS: '수치', LEGAL: '법률', FORMAT: '서식' };
const field = (name, label, type = 'text') => `<label>${label}<input name="${name}" type="${type}" required maxlength="1000"></label>`;

export function installDocumentWorkflowUi(store) {
  function render() {
    document.querySelector('[data-document-workflow]')?.remove();
    if (store.state.route !== 'outputs') return;
    const main = document.querySelector('main');
    if (!main) return;
    const panel = document.createElement('section');
    panel.className = 'card section'; panel.dataset.documentWorkflow = '1';
    const rows = store.state.documentWorkflow || [];
    panel.innerHTML = `<h2>문서 진행관리</h2><p>기록한 근거를 기준으로 작성·검수·승인·제출·후속조치를 구분합니다. 파일 내용 검사와 실제 발송은 별도로 수행하세요. 승인자는 직접 입력하며 직원 인증과 연결되지 않습니다.</p><p class="source-note">현재 사건에만 보관됩니다. 종료 전 홈의 사건 저장을 사용하세요.</p>
      <details><summary>문서 등록</summary><form data-doc-register class="document-workflow-form">
      ${field('title', '문서명')}${field('purpose', '용도·독자')}${field('owner', '담당자')}${field('template_ref', '기준 서식·버전')}${field('source_ref', '원본·파일 참조')}${field('actor', '기록자')}
      <button class="primary">등록</button></form></details><p role="status" data-doc-message></p>
      ${rows.map((row) => {
        const progress = documentProgress(row, new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
        const actions = row.status === 'DRAFT' ? REVIEW_CHECKS.filter((key) => !row.checks[key]).map((key) => [`CHECK:${key}`, `${checks[key]} 검수 기록`]) : row.status === 'REVIEWED' ? [['APPROVE', '승인 기록']] : row.status === 'APPROVED' ? [['SUBMIT', '제출 기록']] : [];
        actions.push(['REVISE', '수정본 시작']);
        return `<article class="card section" data-doc-id="${esc(row.id)}"><h3>${esc(row.title)} · v${row.revision}</h3><p>${labels[row.status]} · ${progress.status} · 후속조치 ${progress.pending} · 기한경과 ${progress.overdue}</p><p>${esc(row.purpose)} · 담당 ${esc(row.owner)}<br>서식: ${esc(row.template_ref)}<br>원본: ${esc(row.source_ref)}</p><p>${REVIEW_CHECKS.map((key) => `${checks[key]} ${row.checks[key] ? '✓' : '대기'}`).join(' · ')}</p>
          <form data-doc-action class="document-workflow-form">${field('actor', '검수·승인·제출 기록자')}${field('reference', '검수보고·승인내역·접수증 등 근거')}<label>작업<select name="action">${actions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><button class="secondary">기록</button></form>
          <details><summary>후속조치 추가</summary><form data-doc-followup class="document-workflow-form">${field('title', '할 일')}${field('owner', '담당자')}${field('due_date', '기한', 'date')}${field('actor', '기록자')}${field('reference', '조치 근거')}<button class="secondary">추가</button></form></details>
          ${row.followups.map((task) => `<div><p>${esc(task.title)} · ${esc(task.owner)} · ${esc(task.due_date)} · ${task.status === 'DONE' ? '완료 기록' : '진행 중'}</p>${task.status === 'OPEN' ? `<form data-doc-complete="${esc(task.id)}" class="document-workflow-form">${field('actor', '완료 기록자')}${field('reference', '완료 근거')}<button class="secondary">완료 기록</button></form>` : ''}</div>`).join('')}
          <details><summary>변경 이력 ${row.history.length}건</summary><ul>${row.history.map((event) => `<li>v${event.revision} · ${esc(event.action)} ${esc(event.check || '')} · ${esc(event.actor)} · ${esc(event.reference)} · ${esc(event.recorded_at)}</li>`).join('')}</ul></details></article>`;
      }).join('')}`;
    if (!document.getElementById('document-workflow-style')) {
      const style = document.createElement('style'); style.id = 'document-workflow-style';
      style.textContent = '.document-workflow-form{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:12px 0}.document-workflow-form label{display:grid;gap:4px;flex:1 1 180px;min-width:0}.document-workflow-form input,.document-workflow-form select{width:100%;box-sizing:border-box;min-height:40px}[data-document-workflow]{overflow-wrap:anywhere}';
      document.head.appendChild(style);
    }
    main.appendChild(panel);
    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.target;
      const input = Object.fromEntries(new FormData(form));
      const message = panel.querySelector('[data-doc-message]');
      try {
        if (store.state.status === 'PROCESSING') throw new Error('평가서 처리 완료 후 기록하세요.');
        let next;
        if (form.hasAttribute('data-doc-register')) next = registerDocument(rows, input);
        else {
          const id = form.closest('[data-doc-id]').dataset.docId;
          let action = input.action;
          if (form.hasAttribute('data-doc-followup')) action = 'ADD_FOLLOWUP';
          else if (form.hasAttribute('data-doc-complete')) { action = 'COMPLETE_FOLLOWUP'; input.task_id = form.dataset.docComplete; }
          else if (action.startsWith('CHECK:')) { input.check = action.split(':')[1]; action = 'CHECK'; }
          next = changeDocument(rows, id, action, input);
        }
        store.state.documentWorkflow = next; store.emit();
        document.querySelector('[data-doc-message]').textContent = '기록했습니다.';
      } catch (error) { message.textContent = error.message; }
    });
  }
  const unsubscribe = store.subscribe(render); render();
  return { destroy() { unsubscribe(); document.querySelector('[data-document-workflow]')?.remove(); } };
}
