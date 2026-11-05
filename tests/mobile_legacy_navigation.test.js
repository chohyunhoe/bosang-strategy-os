'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

// Load the actual navigation labels and mobile runtime. This catches label
// drift without forcing the shell closed or calling private route functions.
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  url: 'http://127.0.0.1:4173', runScripts: 'outside-only',
});
const { window } = dom;
window.innerWidth = 768;
window.matchMedia = () => ({ matches: true });
window.requestAnimationFrame = () => 0;
const document = window.document;
const routes = [];
document.querySelector('nav.axis-nav').addEventListener('click', event => {
  const button = event.target.closest('button[data-section]');
  if (button) routes.push(button.dataset.section);
});
// Keep the same runtime order as build_release_candidate.js. Both capture
// handlers must respect the user's full-screen choice.
for (const runtime of ['mobile-review-p0.js', 'mobile-review-router.js']) {
  window.eval(fs.readFileSync(path.join(root, 'browser', runtime), 'utf8'));
}
window.dispatchEvent(new window.Event('DOMContentLoaded'));
try {
  document.querySelector('#bsoMobileShellV3 [data-action="legacy-home"]').click();
  assert.equal(document.body.classList.contains('bso3-legacy'), true, 'Full screen must open through the visible control');
  assert.equal(routes.at(-1), 'overview', 'Full screen must select the real overview section');

  let reviewClicks = 0;
  const review = document.createElement('button');
  review.textContent = '전체 검수 시작';
  review.onclick = () => { reviewClicks++; };
  document.body.appendChild(review);
  review.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
  review.click();
  assert.equal(document.querySelector('#bsoMobileReviewDirect'), null, 'Full-screen input must not open the mobile overlay');
  assert.equal(reviewClicks, 1, 'Full-screen review must reach the existing parser/review handler');
  assert.equal(document.body.classList.contains('bso3-legacy'), true);

  for (const [key, section] of [['case', 'uploadHub'], ['data', 'lands'], ['analysis', 'landCompare'], ['map', 'workflowLogic'], ['output', 'outputCenter']]) {
    document.querySelector('.bso3-legacybar .back').click();
    assert.equal(document.body.classList.contains('bso3-legacy'), false, 'Returning to the mobile menu must remain available');
    document.querySelector(`#bsoMobileShellV3 [data-nav="${key}"]`).click();
    assert.equal(document.body.classList.contains('bso3-legacy'), true, `${key} must enter its full-screen section`);
    assert.equal(routes.at(-1), section, `${key} must use stable section identity rather than a heading label`);
  }
  document.querySelector('.bso3-legacybar .back').click();
  review.click();
  assert.equal(reviewClicks, 1, 'The mobile review route still owns review clicks outside full-screen mode');
  assert.equal(document.querySelector('#bsoMobileReviewDirect').hidden, false, 'The mobile review overlay must still open in mobile mode');
  assert.equal(document.body.classList.contains('bso3-legacy'), false);
  console.log('Mobile/full-screen navigation and review-handler boundaries passed.');
} finally {
  window.close();
}
