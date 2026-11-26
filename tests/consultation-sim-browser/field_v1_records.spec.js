'use strict';
// V1.0 상담기록 자동저장 E2E — 실제 scripts/field_server.js(+ SQLite) · 합성 색인·합성 워커만(VWorld·키·실명 없음).
// PC 1440 · Fold8 펼침 884 · Fold8 접힘 412 각각: 저장 → 새로고침 → 브라우저 종료 → 서버 재시작 후 복원,
// 다필지 묶음·검색·재열기·수정·내보내기, 자동저장 실패 경고, 인증 만료 → 페어링.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(root, 'tests', 'consultation-sim', 'fixtures', 'synthetic-notice-index.json');
const PAGE = path.join(root, 'dist', 'notice-field', 'v1-records-e2e.html');
const ctxOpts = (info) => { const u = info.project.use; return { viewport: u.viewport, isMobile: u.isMobile, hasTouch: u.hasTouch, acceptDownloads: true }; };
const PORTS = { 'pc-1440': 5611, 'fold-open-884': 5612, 'fold-cover-412': 5613 };

test.describe.configure({ mode: 'serial' });

function startServer(dir, port, extra = []) {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'field_server.js'), '--page', PAGE, '--port', String(port), '--env', path.join(dir, 'none.env'), ...extra], {
    cwd: root, env: { ...process.env, PYTHON: path.join(root, 'tests', 'consultation-sim', 'fixtures', 'fake-traits-worker.js'), BSO_FIELD_STATE_DIR: dir, VWORLD_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { log += d; if (log.includes('BSO field server')) resolve(); });
    child.on('exit', (c) => reject(new Error(`field server exited ${c}: ${log}`)));
    setTimeout(() => reject(new Error('field server start timeout')), 10_000);
  });
  return { ready, log: () => log, stop: () => new Promise((r) => { if (child.exitCode != null) return r(); child.once('exit', r); child.kill('SIGTERM'); }) };
}

let dir; let srv; let port; let baseURL;
test.beforeAll(async ({}, info) => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build_notice_field.js'), '--index', FIXTURE, '--out', PAGE], { cwd: root, stdio: 'ignore' });
  port = PORTS[info.project.name] || 5619; baseURL = `http://127.0.0.1:${port}`;
});
test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bso-v1-e2e-'));
  srv = startServer(dir, port); await srv.ready;
});
test.afterEach(async () => { await srv?.stop(); });

const saved = (page) => expect(page.locator('[data-f-save-badge]')).toHaveAttribute('data-f-save-state', 'SAVED', { timeout: 8000 });
async function openParcel(page, q) {
  await page.locator('[data-f-q]').fill(q); await page.locator('[data-f-go]').click();
  await expect(page.locator('[data-f-card]')).toBeVisible();
}
async function consult(page, { issue = 'stage', memo }) {
  await page.locator('[data-f-step-go="3"]').click();
  const fold = page.locator('[data-f-issues-fold]');
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click();
  const cb = page.locator(`[data-f-issue="${issue}"]`); await cb.scrollIntoViewIfNeeded(); await cb.check();
  const m = page.locator('[data-f-memo]'); await m.scrollIntoViewIfNeeded(); await m.fill(memo);
}
const api = async (page, p) => (await page.request.get(`${baseURL}${p}`)).json();

test('저장 → 새로고침 → 브라우저 종료 → 서버 재시작 후 같은 상담 복원 (Fold8은 접힘↔펼침 중 입력)', async ({ browser }, info) => {
  const ctx = await browser.newContext({ ...ctxOpts(info), baseURL });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('[data-f-save-line]')).toBeVisible();
  await expect(page.locator('[data-f-save-badge]')).toHaveAttribute('data-f-save-state', 'IDLE');
  await openParcel(page, '바위리 12-3');
  await consult(page, { memo: '합성 상담 메모 1차' });
  if (info.project.name.startsWith('fold')) { // 접힘↔펼침 전환 중에도 입력·저장 유지
    const other = info.project.name === 'fold-cover-412' ? { width: 884, height: 1104 } : { width: 412, height: 915 };
    await page.setViewportSize(other);
    await page.locator('[data-f-memo]').fill('합성 상담 메모 2차(화면 전환 중)');
    await page.setViewportSize(info.project.use.viewport);
  } else await page.locator('[data-f-memo]').fill('합성 상담 메모 2차(화면 전환 중)');
  await saved(page);
  const id = (await page.locator('[data-f-save-id]').textContent()).replace('상담ID ', '').trim();
  expect(id).toMatch(/^C-\d{8}-\d{6}-[a-z0-9]{6}$/);
  let rec = await api(page, `/__field/records/${id}`);
  expect(rec.record.memo).toBe('합성 상담 메모 2차(화면 전환 중)');
  expect(rec.record.issues).toEqual(['절차 단계 확인']);
  expect(rec.record.jibun).toBe('바위리 12-3');
  expect(rec.record.project).toContain('가상 고시 제0000-1호');
  expect(rec.record.followups.length).toBeGreaterThan(0);
  const savedRev = rec.record.rev;

  const check = async (p) => {
    await expect(p.locator('[data-f-card]')).toBeVisible();
    await expect(p.locator('[data-f-memo]')).toHaveValue('합성 상담 메모 2차(화면 전환 중)');
    await expect(p.locator('[data-f-issue="stage"]')).toBeChecked();
    await expect(p.locator('[data-f-save-id]')).toHaveText(`상담ID ${id}`);
    await expect(p.locator('[data-f-save-badge]')).toHaveAttribute('data-f-save-state', 'SAVED');
    await expect(p.locator('[data-f-out]')).toContainText('이전 상담');
  };
  await page.reload(); await check(page);                       // 새로고침
  const state = await ctx.storageState(); await ctx.close();    // 브라우저 종료(쿠키는 남음)
  const ctx2 = await browser.newContext({ ...ctxOpts(info), baseURL, storageState: state });
  const p2 = await ctx2.newPage(); await p2.goto('/'); await check(p2);
  await srv.stop(); srv = startServer(dir, port); await srv.ready;  // 서버 재시작
  expect(srv.log()).toMatch(/consult records: 1 · start backup consult-records-/);
  await p2.reload(); await check(p2);
  rec = await api(p2, `/__field/records/${id}`);
  expect(rec.record.rev).toBe(savedRev); // 복원만으로는 수정차수를 올리지 않음(중복저장 없음)
  // 새 상담 → 다음 접속에서는 복원하지 않음
  await p2.locator('[data-f-new]').click();
  await expect(p2.locator('[data-f-save-id]')).toHaveText('');
  await p2.reload();
  await expect(p2.locator('[data-f-card]')).toHaveAttribute('hidden', ''); // 열린 필지 없음(복원 안 함)
  await expect(p2.locator('[data-f-memo]')).toHaveValue('');
  expect((await api(p2, '/__field/records')).total).toBe(1);
  await ctx2.close();
});

test('다필지 묶음 저장 · 검색 · 재열기 · 수정 · 내보내기', async ({ page }) => {
  await page.goto(`${baseURL}/`);
  await openParcel(page, '바위리 12-3');
  await page.locator('[data-f-bundle-add]').click();
  await consult(page, { issue: 'stage', memo: '첫째 필지 합성' });
  await openParcel(page, '새솔리 12-3');
  await page.locator('[data-f-bundle-add]').first().click();
  await consult(page, { issue: 'remainder', memo: '둘째 필지 합성' });
  const common = page.locator('[data-f-bundle-memo]'); await common.scrollIntoViewIfNeeded(); await common.fill('묶음 공통 합성');
  await saved(page);
  const id = (await page.locator('[data-f-save-id]').textContent()).replace('상담ID ', '').trim();
  let rec = (await api(page, `/__field/records/${id}`)).record;
  expect(rec.is_bundle).toBe(true); expect(rec.parcel_count).toBe(2); expect(rec.jibun).toBe('바위리 12-3 · 새솔리 12-3');
  expect(rec.memo).toContain('[공통] 묶음 공통 합성');

  // 새 상담 → 상담기록 검색 → 열기 → 묶음·메모 복원
  await page.locator('[data-f-new]').click();
  await page.locator('[data-f-records-toggle]').click();
  await page.locator('[data-f-records-q]').fill('새솔리');
  await page.locator('[data-f-records-form] button[type="submit"]').click();
  await expect(page.locator(`[data-f-record="${id}"]`)).toBeVisible();
  await page.locator('[data-f-records-q]').fill('없는검색어');
  await page.locator('[data-f-records-form] button[type="submit"]').click();
  await expect(page.locator('[data-f-record]')).toHaveCount(0);
  await page.locator('[data-f-records-q]').fill('공통 합성');
  await page.locator('[data-f-records-form] button[type="submit"]').click();
  await page.locator(`[data-f-record-open="${id}"]`).click();
  await expect(page.locator('[data-f-records]')).toBeHidden();
  await expect(page.locator('[data-f-bundle-pick]')).toHaveCount(2);
  await expect(page.locator('[data-f-bundle-memo]')).toHaveValue('묶음 공통 합성');
  await expect(page.locator('[data-f-memo]')).toHaveValue('둘째 필지 합성');
  await page.locator('[data-f-bundle-pick]').first().click();
  await expect(page.locator('[data-f-memo]')).toHaveValue('첫째 필지 합성');
  await expect(page.locator('[data-f-save-id]')).toHaveText(`상담ID ${id}`);
  // 수정 → 같은 ID에 수정차수 증가
  const before = rec.rev;
  await page.locator('[data-f-step-go="3"]').click();
  await page.locator('[data-f-memo]').fill('첫째 필지 합성 · 수정');
  await saved(page);
  rec = (await api(page, `/__field/records/${id}`)).record;
  expect(rec.rev).toBe(before + 1); expect(rec.memo).toContain('첫째 필지 합성 · 수정');
  expect((await api(page, '/__field/records')).total).toBe(1);
  // 내보내기(CSV·JSON · 기록별)
  await page.locator('[data-f-records-toggle]').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-records-export="csv"]').click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  expect(csv.startsWith('﻿상담ID,상담일시,사업,PNU,지번,상담쟁점,메모,후속조치')).toBe(true);
  expect(csv).toContain(id); expect(csv).toContain('바위리 12-3 · 새솔리 12-3');
  const one = await (await page.request.get(`${baseURL}/__field/records/export?format=json&id=${id}`)).json();
  expect(one.records[0].parcels.length).toBe(2);
  // 지금 백업
  await page.locator('[data-f-records-backup]').click();
  await expect(page.locator('[data-f-records-out]')).toContainText('백업했습니다: consult-records-');
});

test('자동저장 실패 경고 → 자동 재시도로 복구 · 같은 내용 중복 저장 없음', async ({ page }) => {
  await page.goto(`${baseURL}/`);
  await openParcel(page, '바위리 12-3');
  await consult(page, { memo: '실패 시험 합성' });
  await saved(page);
  const id = (await page.locator('[data-f-save-id]').textContent()).replace('상담ID ', '').trim();
  let fail = true; let puts = 0;
  await page.route('**/__field/records/C-*', (route) => { if (route.request().method() !== 'PUT') return route.continue(); puts += 1; return fail ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error_code":"RECORD_SAVE_FAILED"}' }) : route.continue(); });
  await page.locator('[data-f-memo]').fill('실패 시험 합성 · 서버 오류 중 입력');
  await expect(page.locator('[data-f-save-badge]')).toHaveAttribute('data-f-save-state', 'FAILED');
  await expect(page.locator('[data-f-save-alert]')).toBeVisible();
  await expect(page.locator('[data-f-save-alert]')).toContainText('자동저장 실패');
  fail = false;
  await page.locator('[data-f-save-retry]').click();
  await saved(page);
  await expect(page.locator('[data-f-save-alert]')).toBeHidden();
  const rec = (await api(page, `/__field/records/${id}`)).record;
  expect(rec.memo).toBe('실패 시험 합성 · 서버 오류 중 입력'); expect(rec.rev).toBe(2);
  const n = puts; await page.locator('[data-f-issue="stage"]').uncheck(); await page.locator('[data-f-issue="stage"]').check();
  await page.waitForTimeout(1500);
  expect(puts - n).toBeLessThanOrEqual(1); // 같은 내용으로 돌아오면 다시 보내지 않음(디바운스 중 한 번 이하)
  expect((await api(page, `/__field/records/${id}`)).record.rev).toBeLessThanOrEqual(3);
});

test('인증 만료: 입력 중이면 이 화면에서 6자리 코드로 다시 연결(입력 보존) · 저장된 상태면 /pair로 이동', async ({ browser }, info) => {
  await srv.stop(); srv = startServer(dir, port, ['--require-token', '--allow-http-token']); await srv.ready;
  const ctx = await browser.newContext({ ...ctxOpts(info), baseURL });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/pair$/); // 토큰 없이 열면 페어링 화면
  const token = fs.readFileSync(path.join(dir, 'access-token.txt'), 'utf8').trim();
  await page.goto(`/?t=${token}`);
  await expect(page.locator('[data-f-save-line]')).toBeVisible();
  await openParcel(page, '바위리 12-3');
  await consult(page, { memo: '인증 시험 합성' });
  await saved(page);
  await ctx.clearCookies({ name: 'bso_field' }); // 인증 만료(쿠키 소멸)
  await page.locator('[data-f-memo]').fill('인증 시험 합성 · 만료 뒤 입력');
  await expect(page.locator('[data-f-save-alert]')).toHaveAttribute('data-f-save-alert', 'PAIR');
  await expect(page.locator('[data-f-memo]')).toHaveValue('인증 시험 합성 · 만료 뒤 입력');
  const code = /코드: (\d{6})/.exec(fs.readFileSync(path.join(dir, 'pair-code.txt'), 'utf8'))[1];
  await page.locator('[data-f-pair-code]').fill(code);
  await page.locator('[data-f-pair-go]').click();
  await saved(page);
  const id = (await page.locator('[data-f-save-id]').textContent()).replace('상담ID ', '').trim();
  expect((await (await page.request.get(`${baseURL}/__field/records/${id}`)).json()).record.memo).toBe('인증 시험 합성 · 만료 뒤 입력');
  // 저장된 상태에서 만료 → 다음 서버 요청에서 /pair로 자연스럽게 이동 → 연결 뒤 같은 상담 복원
  await ctx.clearCookies({ name: 'bso_field' });
  await page.locator('[data-f-records-toggle]').click();
  await expect(page).toHaveURL(/\/pair$/, { timeout: 8000 });
  await page.goto(`/?t=${token}`);
  await expect(page.locator('[data-f-memo]')).toHaveValue('인증 시험 합성 · 만료 뒤 입력');
  await ctx.close();
});

test('기존 현장 UI 유지: 지도 고정·지도 크게·단계 이동·상담 버튼은 그대로', async ({ page }, info) => {
  await page.goto(`${baseURL}/`);
  await openParcel(page, '바위리 12-3');
  await expect(page.locator('[data-f-map-pin]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-f-steps] [data-f-step-go]')).toHaveCount(3);
  for (const sel of ['[data-f-copy-summary]', '[data-f-copy]', '[data-f-save]', '[data-f-print]']) await expect(page.locator(sel)).toHaveCount(1);
  // 저장 줄은 가로 넘침을 만들지 않음
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (info.project.name === 'pc-1440') await expect(page.locator('[data-f-pc-map-toggle]')).toHaveCount(1);
});
