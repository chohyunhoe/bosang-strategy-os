import { REVIEW_CHECKS, registerDocument, changeDocument, documentProgress, sha256Bytes, attachDocumentArtifact, createDocumentHandoff, importDocumentResult } from './document-workflow.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const labels = { DRAFT: '작성 중', REVIEWED: '검수 기록 완료', APPROVED: '승인 기록', SUBMITTED: '제출 기록' };
const checks = { SOURCE: '원본', NUMBERS: '수치', LEGAL: '법률', FORMAT: '서식' };
const field = (name, label, type = 'text') => `<label>${label}<input name="${name}" type="${type}" required maxlength="1000"></label>`;

export function installDocumentWorkflowUi(store, { pollIntervalMs = 15000, now = Date.now } = {}) {
  // Result bodies are displayed only in this session; case backups keep receipt metadata.
  const previews = new WeakMap(), delivery = new WeakMap();
  let busy = false, polling = false, destroyed = false, paused = false, dirty = false, epoch = 0, activePoll = null;
  function keepPreview(state, preview) {
    if (!previews.has(state)) previews.set(state, new Map());
    previews.get(state).set(preview.document_id, preview);
  }
  function deliveryMap(state) {
    if (!delivery.has(state)) delivery.set(state, new Map());
    return delivery.get(state);
  }
  function pending(rows) {
    return rows.flatMap(doc => (doc.handoffs || []).filter(h => h.revision === doc.revision && h.artifact_sha256 === doc.artifact?.sha256 && !(doc.execution_receipts || []).some(r => r.job_id === h.job_id)).map(h => ({ ...h, document_id: doc.id })));
  }
  function paintDelivery() {
    if (store.state.route !== 'outputs' || destroyed) return;
    const statuses = deliveryMap(store.state), requests = pending(store.state.documentWorkflow || []);
    const note = document.querySelector('[data-doc-auto-status]');
    if (note) note.textContent = paused ? '자동 수신 일시정지' : dirty ? '입력 내용 보호를 위해 자동 수신을 잠시 멈췄습니다. 입력을 기록하거나 비운 뒤 다시 확인하세요.' : `자동 수신 켜짐 · 대기 ${requests.length}건 · 이 화면이 열려 있을 때 15초마다 확인합니다.`;
    for (const el of document.querySelectorAll('[data-doc-delivery]')) {
      const jobs = requests.filter(r => r.document_id === el.dataset.docDelivery);
      el.textContent = jobs.map(r => {
        const s = statuses.get(r.job_id);
        const label = s?.phase === 'ERROR' ? '결과 확인 실패 · 자동 재확인 예정' : s?.firstAt != null && now() - s.firstAt >= 300000 ? '5분 이상 결과 미수신' : '결과 대기';
        return `${r.job_id}: ${label}`;
      }).join(' / ') || '미수신 작업 없음';
    }
  }
  async function transport(action, body, signal = AbortSignal.timeout(15000)) {
    let response;
    try { response = await fetch('/__bso_transport/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BSO-Transport': '1' }, body: JSON.stringify(body), signal }); }
    catch (_) { throw Error('전송 연결을 확인하세요. 같은 지시문으로 다시 전송하면 기존 요청을 재사용합니다.'); }
    const value = await response.json().catch(() => ({}));
    if (!response.ok || value.ok !== true) throw Error('연결 처리 실패: ' + (value.code || 'LOCAL_BRIDGE_UNAVAILABLE'));
    return value;
  }
  async function checkResults() {
    if (destroyed || polling || busy || paused || dirty || document.hidden || store.state.route !== 'outputs' || store.state.status === 'PROCESSING') return;
    const state = store.state, rows = state.documentWorkflow || [], capturedEpoch = epoch, statuses = deliveryMap(state);
    const jobs = pending(rows).filter(h => (statuses.get(h.job_id)?.nextAt || 0) <= now()).sort((a,b) => (statuses.get(a.job_id)?.lastAt || 0) - (statuses.get(b.job_id)?.lastAt || 0)).slice(0,3);
    if (!jobs.length) { paintDelivery(); return; }
    polling = true; activePoll = new AbortController();
    const valid = () => !destroyed && !busy && !dirty && !paused && !document.hidden && store.state === state && state.documentWorkflow === rows && state.route === 'outputs' && epoch === capturedEpoch;
    let next = rows; const received = [];
    try {
      for (const h of jobs) {
        if (!valid()) return;
        const status = statuses.get(h.job_id) || { firstAt: now(), failures: 0 };
        status.lastAt = now(); statuses.set(h.job_id, status);
        try {
          const response = await transport('result', { job_id: h.job_id, document_id: h.document_id, revision: h.revision, input_sha256: h.input_sha256, artifact_sha256: h.artifact_sha256 }, AbortSignal.any([activePoll.signal, AbortSignal.timeout(15000)]));
          if (!valid()) return;
          if (response.status === 'WAITING') { status.phase = 'WAITING'; status.failures = 0; }
          else if (response.status === 'RESULT_READY') {
            const result = await importDocumentResult(next, h.document_id, response.result, 'BSO 자동 수신');
            if (!valid()) return;
            next = result.rows; received.push(result.preview); status.phase = 'RECEIVED'; status.failures = 0;
          } else throw Error('UNEXPECTED_RESULT_STATUS');
          status.nextAt = now() + pollIntervalMs;
        } catch (_) {
          if (!valid()) return;
          status.phase = 'ERROR'; status.failures = Math.min(6, status.failures + 1);
          status.nextAt = now() + Math.min(300000, pollIntervalMs * 2 ** status.failures);
        }
      }
      if (!valid()) return;
      if (received.length) {
        for (const preview of received) keepPreview(state, preview);
        state.documentWorkflow = next; store.emit();
        const message = document.querySelector('[data-doc-message]');
        if (message) message.textContent = `결과 ${received.length}건을 자동 수신했습니다. 문서·버전·본문 지문을 대조했으며 검수·승인 상태는 유지했습니다. 사건 저장으로 실행 기록을 보관하세요.`;
        for (const preview of received) {
          const article = [...document.querySelectorAll('[data-doc-id]')].find(el => el.dataset.docId === preview.document_id);
          if (article?.querySelector('details')) article.querySelector('details').open = true;
        }
      }
      paintDelivery();
    } finally { polling = false; activePoll = null; }
  }
  function render() {
    epoch++; activePoll?.abort(); dirty = false;
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
      <p data-doc-auto-status></p><p>결과 확인은 AI를 호출하지 않습니다. 결과 대기만으로 n8n 접수·실행 여부를 확정할 수 없습니다.</p><button type="button" class="secondary" data-doc-auto-toggle>${paused ? '자동 수신 재개' : '자동 수신 일시정지'}</button>
      ${rows.map((row) => {
        const preview = previews.get(store.state)?.get(row.id);
        const currentPreview = preview?.document_id === row.id && preview.revision === row.revision ? preview : null;
        const progress = documentProgress(row, new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
        const actions = row.status === 'DRAFT' ? REVIEW_CHECKS.filter((key) => !row.checks[key]).map((key) => [`CHECK:${key}`, `${checks[key]} 검수 기록`]) : row.status === 'REVIEWED' ? [['APPROVE', '승인 기록']] : row.status === 'APPROVED' ? [['SUBMIT', '제출 기록']] : [];
        actions.push(['REVISE', '수정본 시작']);
        return `<article class="card section" data-doc-id="${esc(row.id)}"><h3>${esc(row.title)} · v${row.revision}</h3><p>${labels[row.status]} · ${progress.status} · 후속조치 ${progress.pending} · 기한경과 ${progress.overdue}</p><p>${esc(row.purpose)} · 담당 ${esc(row.owner)}<br>서식: ${esc(row.template_ref)}<br>원본: ${esc(row.source_ref)}</p><p>${REVIEW_CHECKS.map((key) => `${checks[key]} ${row.checks[key] ? '✓' : '대기'}`).join(' · ')}</p>
          <p data-doc-delivery="${esc(row.id)}"></p><details><summary>파일·n8n 실행 연결</summary><p>파일은 이 브라우저에서 SHA-256 지문만 계산합니다. 파일 내용이 바뀌면 수정본으로 전환하고 검수·승인을 다시 기록합니다.</p><p>${row.artifact ? `${esc(row.artifact.name)} · ${row.artifact.size} bytes<br>SHA-256 ${esc(row.artifact.sha256)}` : '파일 지문 미등록'}</p>
          <form data-doc-artifact class="document-workflow-form">${field('actor', '기록자')}<label>문서 파일(최대 50MB)<input name="artifact_file" type="file" required></label><button class="secondary">파일 지문 등록</button></form>
          <p>작업요청 JSON은 공개·합성 지시문과 파일 지문을 포함합니다. 접수함 전송은 연결된 Google Drive 폴더에 지시문과 지문을 저장합니다. 실제 원본 파일은 전송하지 않습니다. AI 실행은 n8n에서 별도로 승인합니다.</p>
          <form data-doc-handoff class="document-workflow-form">${field('actor', '기록자')}<label>입력 구분<select name="data_class"><option value="SYNTHETIC">합성자료</option><option value="PUBLIC">공개자료</option></select></label><label>공개·합성 작업지시<textarea name="prompt" required maxlength="24000"></textarea></label><button class="primary" name="transport" value="send">n8n 접수함에 전송</button><button class="secondary">n8n 작업요청 JSON 저장</button></form>
          <form data-doc-sync-result class="document-workflow-form">${field('actor', '기록자')}<label>수신할 작업<select name="job_id" required>${(row.handoffs || []).filter(h => h.revision === row.revision).map(h => `<option value="${esc(h.job_id)}">${esc(h.job_id)}</option>`).join('')}</select></label><button class="secondary">완료 결과 수신</button></form>
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
    const markEditing = () => {
      dirty = [...panel.querySelectorAll('input,textarea,select')].some(el => el.type === 'file' ? el.files.length > 0 : el.tagName === 'SELECT' ? el.selectedIndex > 0 : Boolean(el.value));
      if (dirty) { epoch++; activePoll?.abort(); } paintDelivery();
    };
    panel.addEventListener('input', markEditing); panel.addEventListener('change', markEditing);
    panel.querySelector('[data-doc-auto-toggle]').addEventListener('click', event => {
      paused = !paused; epoch++; if (paused) activePoll?.abort();
      event.target.textContent = paused ? '자동 수신 재개' : '자동 수신 일시정지'; paintDelivery();
    });
    paintDelivery();
    panel.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const form = event.target;
      const input = Object.fromEntries(new FormData(form));
      const message = panel.querySelector('[data-doc-message]');
      const state = store.state;
      try {
        if (store.state.status === 'PROCESSING') throw new Error('평가서 처리 완료 후 기록하세요.');
        let next, jobDownload = null, jobSend = null, resultPreview = null, reopened = false;
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
            if (event.submitter?.value === 'send') {
              // Reuse an identical request, including after an ambiguous network failure or page reload.
              const old = rows.find(r => r.id === id).handoffs?.find(h => h.revision === result.job.bso_context.revision && h.artifact_sha256 === result.job.bso_context.artifact_sha256 && h.input_sha256 === result.job.input_sha256 && h.data_class === result.job.data_class);
              next = old ? rows : result.rows;
              jobSend = { ...result.job, job_id: old?.job_id || result.job.job_id };
            } else { next = result.rows; jobDownload = result.job; }
          } else if (form.hasAttribute('data-doc-sync-result')) {
            const doc = rows.find(r => r.id === id), handoff = doc.handoffs?.find(h => h.job_id === input.job_id && h.revision === doc.revision);
            if (!handoff) throw Error('현재 문서 버전의 작업요청을 먼저 생성하세요.');
            const response = await transport('result', { job_id: handoff.job_id, document_id: id, revision: handoff.revision, input_sha256: handoff.input_sha256, artifact_sha256: handoff.artifact_sha256 });
            if (response.status === 'WAITING') throw Error('결과 파일 동기화를 기다리고 있습니다. AI 실행 승인·완료 여부도 확인하세요.');
            const result = await importDocumentResult(rows, id, response.result, input.actor);
            next = result.rows; resultPreview = result.preview; reopened = result.reopened === true;
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
        if (resultPreview) keepPreview(state, resultPreview);
        store.state.documentWorkflow = next; store.emit();
        if (jobSend) {
          // Persist the request ID before network I/O so retries cannot create another queue item.
          const response = await transport('send', jobSend);
          if (store.state !== state || store.state.documentWorkflow !== next) return;
          const target = document.querySelector('[data-doc-message]');
          if (target) target.textContent = response.duplicate ? '기존 요청 파일을 확인했습니다. n8n 접수·실행 상태는 별도로 확인하세요.' : '동기화 폴더에 저장했습니다. 클라우드 접수 확인 전이며 AI 실행은 별도 승인 대상입니다.';
          return;
        }
        document.querySelector('[data-doc-message]').textContent = reopened ? '기존 실행 기록과 일치하는 결과 본문을 다시 표시했습니다.' : '기록했습니다.';
        if (jobDownload) {
          const url = URL.createObjectURL(new Blob([JSON.stringify(jobDownload, null, 2)], { type: 'application/json' }));
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${jobDownload.job_id}.json`; anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        }
      } catch (error) { if (store.state === state) { const target = document.querySelector('[data-doc-message]') || message; target.textContent = error.message; } }
      finally { busy = false; }
    });
  }
  const unsubscribe = store.subscribe(render); render();
  const timer = setInterval(() => { void checkResults(); }, pollIntervalMs); timer.unref?.();
  return { checkResults, destroy() { destroyed = true; clearInterval(timer); activePoll?.abort(); unsubscribe(); document.querySelector('[data-document-workflow]')?.remove(); } };
}
