'use strict';

(() => {
  const MOBILE_MAX = 820;
  const SHELL_ID = 'bsoMobileShellV3';
  const OVERLAY_ID = 'bsoMobileReviewDirect';
  const STYLE_ID = 'bso-mobile-review-direct-style';
  const state = { items: [], index: 0, routedAt: 0 };

  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const isMobile = () => (typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width:${MOBILE_MAX}px)`).matches
    : window.innerWidth <= MOBILE_MAX);
  const buttons = (root = document) => Array.from(root.querySelectorAll('button'));
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function smallestCard(button) {
    let node = button;
    for (let i = 0; node && node !== document.body && i < 10; i += 1, node = node.parentElement) {
      const text = clean(node.textContent);
      if (/수동 수정/.test(text) && /검수 후 반영/.test(text) && /건너뜀/.test(text)) return node;
    }
    return null;
  }

  function parseCard(card) {
    const text = card ? card.textContent || '' : '';
    const field = (text.match(/"field"\s*:\s*"([^"]+)"/) || [])[1] || '검토 항목';
    const rawValue = (text.match(/"value"\s*:\s*"([^"]*)"/) || [])[1] || '';
    const reason = (text.match(/"reason"\s*:\s*"([^"]+)"/) || [])[1] || '';
    const value = clean(rawValue);
    return {
      card,
      field: clean(field),
      value: value || '자동추출 실패',
      missing: !value,
      reason: clean(reason) || (/원문 근거 후보 없음/.test(text)
        ? '원문 근거를 자동으로 찾지 못했습니다. 원문 확인 또는 수동 수정이 필요합니다.'
        : '원문과 대조해 확인하세요.'),
      confirm: buttons(card).find((b) => /검수 후 반영/.test(clean(b.textContent))),
      edit: buttons(card).find((b) => /수동 수정/.test(clean(b.textContent))),
      hold: buttons(card).find((b) => /건너뜀/.test(clean(b.textContent))),
    };
  }

  function collectItems() {
    const seen = new Set();
    const items = [];
    buttons().filter((b) => !b.closest(`#${OVERLAY_ID}`) && /수동 수정/.test(clean(b.textContent))).forEach((button) => {
      const card = smallestCard(button);
      if (!card || seen.has(card)) return;
      seen.add(card);
      items.push(parseCard(card));
    });
    state.items = items;
    if (state.index >= items.length) state.index = Math.max(0, items.length - 1);
    return items;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID}{position:fixed;inset:0;z-index:2147483646;background:#f4f5f7;color:#17191d;font-family:inherit;display:flex;flex-direction:column}
      #${OVERLAY_ID}[hidden]{display:none!important}
      .bso-direct-head{padding:calc(12px + env(safe-area-inset-top)) 16px 12px;background:#fff;border-bottom:1px solid #dde1e6;display:flex;align-items:center;justify-content:space-between;gap:12px}
      .bso-direct-head b{font-size:18px}.bso-direct-head span{display:block;font-size:12px;color:#727981;margin-top:2px}.bso-direct-close{width:40px;height:40px;border:0;border-radius:11px;background:#eef0f3;font-size:22px}
      .bso-direct-main{flex:1;min-height:0;overflow:auto;padding:16px 14px 112px}
      .bso-direct-card{background:#fff;border:1px solid #dfe3e8;border-radius:17px;padding:18px}
      .bso-direct-count{font-size:12px;font-weight:850;color:#747b83}.bso-direct-field{font-size:24px;font-weight:950;line-height:1.25;margin-top:8px;overflow-wrap:anywhere}
      .bso-direct-label{font-size:12px;color:#747b83;font-weight:800;margin-top:20px}.bso-direct-value{font-size:21px;font-weight:900;line-height:1.35;margin-top:5px;overflow-wrap:anywhere}.bso-direct-value.missing{color:#9a5e00}
      .bso-direct-reason{margin-top:18px;padding:13px 14px;background:#fafbfc;border-left:3px solid #ccd2d8;border-radius:0 10px 10px 0;font-size:13px;line-height:1.55;color:#555d65}
      .bso-direct-empty{background:#fff;border:1px solid #dfe3e8;border-radius:17px;padding:22px;font-size:15px;line-height:1.6}
      .bso-direct-actions{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 10px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #d9dee4}
      .bso-direct-actions button{min-height:52px;border-radius:12px;border:1px solid #cbd1d8;background:#fff;font-size:14px;font-weight:900}.bso-direct-actions .confirm{background:#872647;border-color:#872647;color:#fff}.bso-direct-actions .hold{background:#fff7df;border-color:#e2c66f}.bso-direct-actions .next{background:#edf4ff;border-color:#b8cdef}
      .bso-fallback-home{padding:16px 14px 110px}.bso-fallback-card{background:#fff;border:1px solid #dfe3e8;border-radius:16px;padding:17px;margin-bottom:12px}.bso-fallback-k{font-size:12px;color:#747b83;font-weight:800}.bso-fallback-v{font-size:22px;font-weight:950;margin-top:5px}.bso-fallback-row{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #edf0f2}.bso-fallback-row:first-child{border-top:0}.bso-fallback-start{width:100%;min-height:52px;border:0;border-radius:13px;background:#872647;color:#fff;font-size:15px;font-weight:900}
      @media(min-width:821px){#${OVERLAY_ID}{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    injectStyle();
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;
    overlay = document.createElement('section');
    overlay.id = OVERLAY_ID;
    overlay.hidden = true;
    overlay.innerHTML = `
      <header class="bso-direct-head"><div><b>전체 검수</b><span>한 항목씩 확인</span></div><button type="button" class="bso-direct-close" aria-label="검수 닫기">×</button></header>
      <main class="bso-direct-main"></main>
      <div class="bso-direct-actions"><button type="button" class="confirm" data-act="confirm">확인</button><button type="button" data-act="edit">수정</button><button type="button" class="hold" data-act="hold">보류</button><button type="button" class="next" data-act="next">다음</button></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.bso-direct-close').addEventListener('click', closeOverlay);
    overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => act('confirm'));
    overlay.querySelector('[data-act="edit"]').addEventListener('click', () => act('edit'));
    overlay.querySelector('[data-act="hold"]').addEventListener('click', () => act('hold'));
    overlay.querySelector('[data-act="next"]').addEventListener('click', () => next());
    return overlay;
  }

  function renderFallbackHome() {
    if (!isMobile()) return;
    const shell = document.getElementById(SHELL_ID);
    const main = shell && shell.querySelector('.bso3-main');
    if (!main) return;
    if (clean(main.textContent) && main.children.length) return;
    const count = collectItems().length;
    const fileNames = Array.from(document.querySelectorAll('body *')).map((n) => clean(n.textContent)).filter((t) => /\.pdf$/i.test(t));
    const fileCount = fileNames.length ? 1 : 0;
    main.innerHTML = `<div class="bso-fallback-home"><section class="bso-fallback-card"><div class="bso-fallback-k">보상전략 OS</div><div class="bso-fallback-v">모바일 작업 홈</div><div class="bso-direct-reason">PC 기능은 그대로 유지하면서 모바일에서는 현재 검토 작업을 우선 표시합니다.</div></section><section class="bso-fallback-card"><div class="bso-fallback-row"><span>등록 평가서</span><b>${fileCount}개</b></div><div class="bso-fallback-row"><span>검토할 항목</span><b>${count}건</b></div></section><section class="bso-fallback-card"><button type="button" class="bso-fallback-start">전체 검수 ${count}건 시작</button></section></div>`;
    main.scrollTop = 0;
    const start = main.querySelector('.bso-fallback-start');
    if (start) start.addEventListener('click', openOverlay);
  }

  function render() {
    const overlay = ensureOverlay();
    const main = overlay.querySelector('.bso-direct-main');
    const actions = overlay.querySelector('.bso-direct-actions');
    const item = state.items[state.index];
    if (!item) {
      main.innerHTML = '<div class="bso-direct-empty"><b>검수 항목을 불러오지 못했습니다.</b><br>기존 검수카드가 아직 생성되지 않았습니다. 상세화면에서 후보 생성 상태를 확인하세요.</div>';
      actions.hidden = true;
    } else {
      actions.hidden = false;
      main.innerHTML = `<article class="bso-direct-card"><div class="bso-direct-count">${state.index + 1} / ${state.items.length}</div><div class="bso-direct-field">${esc(item.field)}</div><div class="bso-direct-label">BSO가 읽은 값</div><div class="bso-direct-value ${item.missing ? 'missing' : ''}">${esc(item.value)}</div><div class="bso-direct-reason">${esc(item.reason)}</div></article>`;
    }
    main.scrollTop = 0;
  }

  function openOverlay() {
    if (!isMobile()) return false;
    state.index = 0;
    collectItems();
    const overlay = ensureOverlay();
    overlay.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    render();
    return true;
  }

  function closeOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.hidden = true;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    window.setTimeout(renderFallbackHome, 0);
  }

  function next() {
    if (!state.items.length) return;
    state.index = (state.index + 1) % state.items.length;
    render();
  }

  function act(kind) {
    const item = state.items[state.index];
    if (!item) return;
    if (kind === 'edit') {
      closeOverlay();
      window.setTimeout(() => {
        if (item.edit) item.edit.click();
        if (item.card && item.card.scrollIntoView) item.card.scrollIntoView({ block: 'center' });
      }, 80);
      return;
    }
    const button = kind === 'confirm' ? item.confirm : item.hold;
    if (button) button.click();
    next();
  }

  function route(event) {
    if (!isMobile()) return;
    const target = event && event.target && event.target.closest ? event.target.closest('button,[role="button"],a') : null;
    if (!target || target.closest(`#${OVERLAY_ID}`)) return;
    if (!/전체\s*검수(?:\s*\d+건)?\s*시작/.test(clean(target.textContent))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const now = Date.now();
    if (now - state.routedAt < 300) return;
    state.routedAt = now;
    openOverlay();
  }

  function boot() {
    if (!isMobile()) return;
    injectStyle();
    window.setTimeout(renderFallbackHome, 0);
    window.setTimeout(renderFallbackHome, 400);
    window.setTimeout(renderFallbackHome, 1200);
    const observer = new MutationObserver(() => window.requestAnimationFrame(renderFallbackHome));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('pointerdown', route, true);
  window.addEventListener('click', route, true);
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
  window.bsoOpenDirectMobileReview = openOverlay;
})();
