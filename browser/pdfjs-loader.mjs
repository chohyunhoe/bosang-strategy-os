import './release-factor-matrix.mjs';
import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './browser/vendor/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
window.dispatchEvent(new CustomEvent('bosang:pdfjs-ready', {
  detail: { version: pdfjsLib.version || '5.4.296', sameOrigin: true },
}));

/* BSO v0.1 MVP UI closeout overlay.
 * Presentation-only. Stable16 data keys, render functions, parser contracts,
 * map logic, and review-state semantics are not changed here.
 */
const BSO_V01_STYLE_ID = 'bso-v01-ui-final';
const BSO_V01_CSS = `
  .app-header.v01-header{padding:18px 28px 16px!important}
  .v01-header-main{max-width:1440px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:0 auto}
  .v01-header-copy{min-width:0}
  .v01-eyebrow{display:block;margin-bottom:5px;color:var(--lk-burgundy,#7A243F);font-size:10px;font-weight:850;letter-spacing:.14em;text-transform:uppercase}
  .app-header.v01-header h1{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0!important}
  .app-header.v01-header p{margin:6px 0 0!important;max-width:760px!important;color:#5F6368!important;font-size:12.5px!important;line-height:1.48!important}
  .app-header.v01-header .version-chip{font-size:11px!important;font-weight:850!important;letter-spacing:.02em!important}
  .v01-header-meta{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;flex:0 0 auto}
  .v01-meta-chip{display:inline-flex;align-items:center;min-height:27px;padding:5px 8px;border:1px solid #D8DBE0;border-radius:5px;background:#FAFAFB;color:#555B62;font-size:10.5px;font-weight:760;line-height:1;white-space:nowrap}
  .v01-meta-chip.primary{border-color:#DDB9C7;background:#FCF7F9;color:var(--lk-burgundy,#7A243F)}

  nav.axis-nav .group-label{color:#8A8D91!important}
  nav.axis-nav>button[data-section]{transition:background .12s ease,color .12s ease,border-color .12s ease}
  nav.axis-nav>button[data-section].active{font-weight:800!important}
  nav.axis-nav .dev-options{margin-top:14px;padding-top:12px;border-top:1px solid #ECEDEF}
  nav.axis-nav .dev-options>summary{cursor:pointer;padding:8px 10px;color:#7A7F85;font-size:11px;font-weight:760;list-style:none}
  nav.axis-nav .dev-options>summary::-webkit-details-marker{display:none}
  nav.axis-nav .dev-options>summary::before{content:'＋';display:inline-block;width:16px;color:var(--lk-burgundy,#7A243F);font-weight:900}
  nav.axis-nav .dev-options[open]>summary::before{content:'−'}

  .v01-safety-note{padding:0!important;margin-bottom:22px!important;border-left:3px solid var(--lk-burgundy,#7A243F)!important}
  .v01-safety-note>summary{cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;color:#454A50;font-size:11.5px;font-weight:780;list-style:none}
  .v01-safety-note>summary::-webkit-details-marker{display:none}
  .v01-safety-note>summary::after{content:'보기';color:var(--lk-burgundy,#7A243F);font-size:10px;font-weight:850}
  .v01-safety-note[open]>summary{border-bottom:1px solid #ECEDEF}
  .v01-safety-note[open]>summary::after{content:'닫기'}
  .v01-safety-body{padding:11px 12px 12px;color:#666C73;font-size:11.5px;line-height:1.62}

  section.v01-workflow-section>h2[data-step]{margin-bottom:7px!important}
  section.v01-workflow-section>h2[data-step]::before{content:attr(data-step);display:block;margin-bottom:5px;color:var(--lk-burgundy,#7A243F);font-size:9.5px;font-weight:850;letter-spacing:.12em}
  section.v01-workflow-section>.section-note{max-width:920px;margin-bottom:18px!important;color:#686E75!important;line-height:1.55!important}
  #overview.v01-workflow-section>.section-note{margin-bottom:14px!important}

  @media(max-width:1100px){
    .v01-header-main{align-items:flex-start}
    .v01-header-meta{max-width:320px}
  }

  @media(max-width:720px){
    .app-header.v01-header{position:relative!important;padding:14px 14px 12px!important;border-top-width:3px!important}
    .v01-header-main{display:block}
    .v01-eyebrow{display:none}
    .app-header.v01-header h1{font-size:20px!important;gap:7px}
    .app-header.v01-header p{font-size:11.5px!important;line-height:1.45!important;margin-top:5px!important}
    .v01-header-meta{justify-content:flex-start;gap:5px;margin-top:9px;overflow-x:auto;flex-wrap:nowrap;padding-bottom:1px;-webkit-overflow-scrolling:touch}
    .v01-meta-chip{min-height:24px;padding:4px 7px;font-size:10px}

    nav.axis-nav,.axis-nav{position:sticky!important;top:0!important;z-index:60!important;width:100%!important;max-width:100%!important;height:auto!important;margin:0!important;padding:6px 9px!important;border:0!important;border-top:1px solid #E6E8EB!important;border-bottom:1px solid #DADDE1!important;border-radius:0!important;background:rgba(255,255,255,.97)!important;box-shadow:0 5px 14px rgba(32,33,36,.06)!important;display:flex!important;align-items:center!important;gap:3px!important;overflow-x:auto!important;overflow-y:hidden!important;-webkit-overflow-scrolling:touch}
    nav.axis-nav .group-label{display:none!important}
    nav.axis-nav>button[data-section]{flex:0 0 auto!important;min-height:38px!important;margin:0!important;padding:8px 10px!important;border:0!important;border-bottom:2px solid transparent!important;border-radius:5px!important;background:transparent!important;font-size:12px!important;font-weight:700!important;white-space:nowrap!important}
    nav.axis-nav>button[data-section].active{border-bottom-color:var(--lk-burgundy,#7A243F)!important;background:#FCF7F9!important;color:var(--lk-burgundy,#7A243F)!important}

    nav.axis-nav .dev-options{position:relative;flex:0 0 auto;margin:0 0 0 2px!important;padding:0!important;border:0!important}
    nav.axis-nav .dev-options>summary{display:grid;place-items:center;min-width:44px;min-height:38px;padding:0 8px!important;border:1px solid #D8DBE0;border-radius:5px;background:#FAFAFB;color:#555B62;font-size:0!important;white-space:nowrap}
    nav.axis-nav .dev-options>summary::before{content:'도구';width:auto;font-size:11px;color:#555B62}
    nav.axis-nav .dev-options[open]{position:fixed;left:10px;right:10px;top:10px;bottom:10px;z-index:120;margin:0!important;padding:10px!important;border:1px solid #D8DBE0!important;border-radius:10px!important;background:#fff!important;box-shadow:0 18px 60px rgba(32,33,36,.22)!important;overflow:auto!important}
    nav.axis-nav .dev-options[open]>summary{position:sticky;top:0;z-index:2;width:100%;min-height:42px;background:#F8EEF2;color:var(--lk-burgundy,#7A243F);font-size:12px!important;font-weight:850!important}
    nav.axis-nav .dev-options[open]>summary::before{content:'고급 도구 닫기';font-size:12px;color:var(--lk-burgundy,#7A243F)}
    nav.axis-nav .dev-options[open]>button[data-section]{display:block!important;width:100%!important;min-height:42px!important;margin:5px 0!important;padding:10px 12px!important;border:1px solid #ECEDEF!important;border-radius:6px!important;background:#FAFAFB!important;color:#3F444A!important;text-align:left!important;font-size:12px!important;white-space:normal!important}

    main{padding-top:14px!important}
    .v01-safety-note{margin-bottom:15px!important}
    .v01-safety-note>summary{padding:9px 10px;font-size:11px}
    .v01-safety-body{padding:10px;font-size:11px}
    section.v01-workflow-section>h2[data-step]{font-size:21px!important;margin-top:2px!important}
    section.v01-workflow-section>.section-note{font-size:12px!important;margin-bottom:13px!important}
  }

  @media(max-width:390px){
    nav.axis-nav>button[data-section]{padding-left:9px!important;padding-right:9px!important;font-size:11.5px!important}
    .app-header.v01-header h1{font-size:19px!important}
    .app-header.v01-header .version-chip{font-size:10px!important}
  }
`;

function ensureBsoV01Style() {
  if (document.getElementById(BSO_V01_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = BSO_V01_STYLE_ID;
  style.textContent = BSO_V01_CSS;
  document.head.appendChild(style);
}

function upgradeBsoV01Header() {
  const header = document.querySelector('.app-header');
  if (!header || header.classList.contains('v01-header')) return;
  header.classList.add('v01-header');
  header.innerHTML = `
    <div class="v01-header-main">
      <div class="v01-header-copy">
        <span class="v01-eyebrow">LAND COMPENSATION REVIEW WORKBENCH</span>
        <h1>보상전략 OS <span class="version-chip">v0.1 MVP</span></h1>
        <p>감정평가서 분석부터 지도·수치표·검토 결과까지 한 흐름으로 정리하는 토지보상 실무 워크벤치입니다.</p>
      </div>
      <div class="v01-header-meta" aria-label="제품 상태">
        <span class="v01-meta-chip primary">검토 보조</span>
        <span class="v01-meta-chip">원문 로컬 처리</span>
        <span class="v01-meta-chip">UI stable16</span>
      </div>
    </div>`;
  document.title = '보상전략 OS v0.1 MVP';
}

function upgradeBsoV01SafetyNotice() {
  const notice = document.querySelector('.top-notice');
  if (!notice || notice.classList.contains('v01-safety-note')) return;
  const details = document.createElement('details');
  details.className = `${notice.className} v01-safety-note`;
  details.innerHTML = `
    <summary>안전 경계 · 개인정보 처리 · 외부 조회</summary>
    <div class="v01-safety-body">본 도구는 감정평가서 검토 보조 도구입니다. 법률자문·감정평가 업무를 대체하지 않습니다. 보상금 증감을 단정하지 않습니다. 원본 문서는 현재 브라우저 세션에서 처리되며 앱 서버에 저장하지 않습니다. 단, VWorld 조회 시 PNU 등 조회 파라미터는 해당 API로 전송될 수 있습니다. 최종 판단은 전문가 확인 후 진행해야 합니다.</div>`;
  notice.replaceWith(details);
}

// v1.0 LTR: 사건처리 흐름 6단계 그룹(data-stage)이 있으면 v0.1 5단계 chrome을 덮어쓰지 않는다.
// 하나의 화면에 5단계/6단계 두 가지 번호체계가 동시에 보이는 혼선을 막기 위한 가드다.
function bsoLtrStageNavActive() {
  return Boolean(document.querySelector('nav.axis-nav > .group-label[data-stage]'));
}

function upgradeBsoV01WorkflowChrome() {
  const ltrStageNav = bsoLtrStageNavActive();
  const label = document.querySelector('nav.axis-nav > .group-label');
  if (label && !ltrStageNav) label.textContent = 'BSO v0.1 · Workflow';
  const devSummary = document.querySelector('nav.axis-nav .dev-options > summary');
  if (devSummary) devSummary.textContent = '고급 도구 — JSON·API·OCR';

  [
    ['overview', 'STEP 1 / 5'],
    ['workflowBase', 'STEP 2 / 5'],
    ['workflowLogic', 'STEP 3 / 5'],
    ['workflowValue', 'STEP 4 / 5'],
    ['workflowOutput', 'STEP 5 / 5'],
  ].forEach(([id, step]) => {
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.add('v01-workflow-section');
    const title = section.querySelector(':scope > h2');
    if (title && !ltrStageNav) title.dataset.step = step;
  });
}

function applyBsoV01UiOverlay() {
  ensureBsoV01Style();
  upgradeBsoV01Header();
  upgradeBsoV01SafetyNotice();
  upgradeBsoV01WorkflowChrome();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyBsoV01UiOverlay, { once: true });
} else {
  applyBsoV01UiOverlay();
}
