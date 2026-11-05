'use strict';
const {expect}=require('@playwright/test');
// Legacy component tests exercise the user's real full-view transition on
// narrow screens. The default mobile shell has separate UI coverage.
async function openFullView(page){
 if(page.viewportSize().width>820)return;
 const shell=page.locator('#bsoMobileShellV3');
 await expect(shell).toBeVisible();
 await shell.locator('[data-action="legacy-home"]').click();
 await expect(page.locator('body')).toHaveClass(/bso3-legacy/);
 await expect(shell).toBeHidden();
}
module.exports={openFullView};
