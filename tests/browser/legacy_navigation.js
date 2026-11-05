'use strict';

const { expect } = require('@playwright/test');

// These specs exercise the full review workspace, including its narrow layout.
// Enter it through the same mobile-shell button a user presses. Do not hide the
// shell or force clicks: a broken transition must fail before the tested action.
async function enterLegacyFullScreen(page) {
  const mobileShellExpected = await page.evaluate(() => window.matchMedia('(max-width:820px)').matches);
  if (mobileShellExpected) {
    const shell = page.locator('#bsoMobileShellV3');
    await expect(shell).toBeVisible();
    await shell.getByRole('button', { name: '전체 화면', exact: true }).click();
    await expect(page.locator('body')).toHaveClass(/\bbso3-legacy\b/);
    await expect(shell).toBeHidden();
  }
  await expect(page.locator('nav.axis-nav')).toBeVisible();
}

module.exports = { enterLegacyFullScreen };
