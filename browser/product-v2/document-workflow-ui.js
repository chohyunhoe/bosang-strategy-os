import { REVIEW_CHECKS, registerDocument, changeDocument, documentProgress, sha256Bytes, attachDocumentArtifact, createDocumentHandoff, importDocumentResult } from './document-workflow.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const labels = { DRAFT: '작성 중', REVIEWED: '검수 기록 완료', APPROVED: '승인 기록', SUBMITTED: '제출 기록' };
const checks = { SOURCE: '원본', NUMBERS: '수치', LEGAL: '법률', FORMAT: '서식' };
const field = (name, label, type = 'text') => `<label>${label}<input name="${name}" type="${type}" required maxlength="1000"></label>`;

export function installDocumentWorkflowUi(store) {
  // Result bodies are displayed only in this session; case backups keep receipt metadata.
  const previews = new WeakMap();
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
        const preview = previews.get(store.state);
        const currentPreview = preview?.document_id === row.id && preview.revision === row.revision ? preview : null;
        const progress = documentProgress(row, new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
        const actions = row.status === 'DRAFT' ? REVIEW_CHECKS.filter((key) => !row.checks[key]).map((key) => [`CHECK:${key}`, `${checks[key]} 검수 기록`]) : row.status === 'REVIEWED' ? [['APPROVE', '승인 기록']] : row.status === 'APPROVED' ? [['SUBMIT', '제출 기록']] : [];
        actions.push(['REVISE', '수정본 시작']);
        return `<article class="card section" data-doc-id="${esc(row.id)}"><h3>${esc(row.title)} · v${row.revision}</h3><p>${labels[row.status]} · ${progress.status} · 후속조치 ${progress.pending} · 기한경과 ${progress.overdue}</p><p>${esc(row.purpose)} · 담당 ${esc(row.owner)}<br>서식: ${esc(row.template_ref)}<br>원본: ${esc(row.source_ref)}</p><p>${REVIEW_CHECKS.map((key) => `${checks[key]} ${row.checks[key] ? '✓' : '대기'}`).join(' · ')}</p>
          <details><summary>파일·n8n 실행 연결</summary><p>파일은 이 브라우저에서 SHA-256 지문만 계산합니다. 파일 내용이 바뀌면 수정본으로 전환하고 검수·승인을 다시 기록합니다.</p><p>${row.artifact ? `${esc(row.artifact.name)} · ${row.artifact.size} bytes<br>SHA-256 ${esc(row.artifact.sha256)}` : '파일 지문 미등록'}</p>
          <form data-doc-artifact class="document-workflow-form">${field('actor', '기록자')}<label>문서 파일(최대 50MB)<input name="artifact_file" type="file" required></label><button class="secondary">파일 지문 등록</button></form>
          <p>작업요청 JSON은 공개·합성 지시문과 파일 지문을 포함합니다. 다운로드 후 n8n 대기열에서 접수·실행해야 하며 여기서 자동 전송하거나 AI를 호출하지 않습니다.</p>
          <form data-doc-handoff class="document-workflow-form">${field('actor', '기록자')}<label>입력 구분<select name="data_class"><option value="SYNTHETIC">합성자료</option><option value="PUBLIC">공개자료</option></select></label><label>공개·합성 작업지시<textarea name="prompt" required maxlength="24000"></textarea></label><button class="secondary">n8n 작업요청 JSON 저장</button></form>
          <form data-doc-receipt class="document-workflow-form">${field('actor', '기록자')}<label>n8n 실행결과 JSON<input name="receipt_file" type="file" accept="application/json,.json" required></label><button class="secondary">실행 기록 가져오기</button></form>
          <p>작업요청 ${(row.handoffs || []).length}건 · 실행 기록 ${(row.execution_receipts || []).length}건. 가져온 실행 기록은 직원 인증이나 사람의 검수·승인을 대신하지 않습니다.</p>
          ${currentPreview ? `<section data-doc-result-preview><h4>가져온 결과 · v${row.revision} · ${esc(currentPreview.status)}</h4><p>본문 SHA-256과 문서 연결을 대조했습니다. 가져온 JSON의 발급자는 인증하지 않습니다. 본문은 현재 화면에서만 표시하며 사건 저장에는 실행 기록만 보관합니다.</p><pre style="white-space:pre-wrap">${esc(currentPreview.output || '차단된 실행입니다. 검토할 결과 본문이 없습니다.')}</pre></section>` : ''}
          ${(row.execution_receipts || []).map((item) => `<p>v${item.revision} · ${esc(item.job_id)} · ${esc(item.status)} · 실행 ${esc(item.execution_id)}</p>`).join('')}</details>
          <form data-doc-action class="document-workflow-form">${field('actor', '검수·승인·제출 기록자')}${field('reference', '검수보고·승인내역·접수증 등 근거')}<label>작업<select name="action">${actions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><button class="secondary">기록</button></form>
          <details><summary>후속조치 추가</summary><form data-doc-followup class="document-workflow-form">${field('title', '할 일')}${field('owner', '담당자')}${field('due_date', '기한', 'date')}${field('actor', '기록자')}${field('reference', '조치 근거')}<button class="secondary">추가</button></form></details>
          ${row.followups.map((task) => `<div><p>${esc(task.title)} · ${esc(task.owner)} · ${esc(task.due_date)} · ${task.status === 'DONE' ? '완료 기록' : '진행 중'}</p>${task.status === 'OPEN' ? `<form data-doc-complete="${esc(task.id)}" class="document-workflow-form">${field('actor', '완료 기록자')}${field('reference', '완료 근거')}<button class="secondary">완료 기록</button></form>` : ''}</div>`).join('')}
          <details><summary>변경 이력 ${row.history.length}건</summary><ul>${row.history.map((event) => `<li>v${event.revision} · ${esc(event.action)} ${esc(event.check || '')} · ${esc(event.actor)} · ${esc(event.reference)} · ${esc(event.recorded_at)}</li>`).join('')}</ul></details></article>`;
      }).join('')}`;
    if (!document.getElementById('document-workflow-style')) {
      const style = document.createElement('style'); style.id = 'document-workflow-style';
      style.textContent = '.document-workflow-form{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:12px 0}.document-workflow-form label{display:grid;gap:4px;flex:1 1 180px;min-width:0}.document-workflow-form input,.document-workflow-form select,.document-workflow-form textarea{width:100%;box-sizing:border-box;min-height:40px}[data-document-workflow]{overflow-wrap:anywhere}';
      document.head.appendChild(style);
    }
    main.appendChild(panel);
    panel.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const input = Object.fromEntries(new FormData(form));
      const message = panel.querySelector('[data-doc-message]');
      const state = store.state;
      try {
        if (store.state.status === 'PROCESSING') throw new Error('평가서 처리 완료 후 기록하세요.');
        let next, jobDownload = null, resultPreview = null, reopened = false;
        if (form.hasAttribute('data-doc-register')) next = registerDocument(rows, input);
        else {
          const id = form.closest('[data-doc-id]').dataset.docId;
          if (form.hasAttribute('data-doc-artifact')) {
            const file = input.artifact_file;
            if (!file || file.size > 50 * 1024 * 1024) throw new Error('50MB 이하의 파일을 선택하세요.');
            const hash = await sha256Bytes(await file.arrayBuffer());
            next = attachDocumentArtifact(rows, id, { name: file.name, size: file.size, sha256: hash }, input.actor);
          } else if (form.hasAttribute('data-doc-handoff')) {
            const result = await createDocumentHandoff(rows, id, input.prompt, input.data_class, input.actor);
            next = result.rows; jobDownload = result.job;
          } else if (form.hasAttribute('data-doc-receipt')) {
            const file = input.receipt_file;
            if (!file || file.size > 2 * 1024 * 1024) throw new Error('2MB 이하의 실행결과 JSON을 선택하세요.');
            const result = await importDocumentResult(rows, id, JSON.parse(await file.text()), input.actor);
            next = result.rows; resultPreview = result.preview; reopened = result.reopened === true;
          } else {
            let action = input.action;
            if (form.hasAttribute('data-doc-followup')) action = 'ADD_FOLLOWUP';
            else if (form.hasAttribute('data-doc-complete')) { action = 'COMPLETE_FOLLOWUP'; input.task_id = form.dataset.docComplete; }
            else if (action.startsWith('CHECK:')) { input.check = action.split(':')[1]; action = 'CHECK'; }
            next = changeDocument(rows, id, action, input);
          }
        }
        if (store.state !== state || store.state.documentWorkflow !== rows) throw new Error('처리 중 사건이나 문서가 변경됐습니다. 현재 사건에서 다시 시도하세요.');
        if (resultPreview) previews.set(state, resultPreview);
        store.state.documentWorkflow = next; store.emit();
        document.querySelector('[data-doc-message]').textContent = reopened ? '기존 실행 기록과 일치하는 결과 본문을 다시 표시했습니다.' : '기록했습니다.';
        if (jobDownload) {
          const url = URL.createObjectURL(new Blob([JSON.stringify(jobDownload, null, 2)], { type: 'application/json' }));
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${jobDownload.job_id}.json`; anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        }
      } catch (error) { message.textContent = error.message; }
    });
  }
  const unsubscribe = store.subscribe(render); render();
  return { destroy() { unsubscribe(); document.querySelector('[data-document-workflow]')?.remove(); } };
}
