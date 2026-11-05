'use strict';
const {test,expect}=require('@playwright/test');
test('모바일 기본 검수와 전체 화면 전환이 각각 실제 버튼으로 동작한다',async({page})=>{
 await page.goto('/',{waitUntil:'networkidle'});
 const shell=page.locator('#bsoMobileShellV3');
 if(page.viewportSize().width>820){await expect(shell).toHaveCount(0);return;}
 await expect(shell).toBeVisible();
 await shell.locator('[data-action="legacy-home"]').click();
 await expect(shell).toBeHidden();
 await page.locator('nav [data-section="workflowValue"]').click();
 await expect(page.locator('#workflowValue')).toHaveClass(/active/);
 await page.locator('.bso3-legacybar .back').click();
 await expect(shell).toBeVisible();
 await page.evaluate(()=>{data.document_uploads=[{upload_id:'UPLOAD_MOBILE',file_name:'synthetic.pdf'}];renderAll();});
 await shell.getByRole('button',{name:/전체 검수.*시작/}).click();
 await expect(page.locator('#bsoMobileReviewDirect')).toBeVisible();
 await page.locator('#bsoMobileReviewDirect .bso-direct-close').click();
 await expect(page.locator('#bsoMobileReviewDirect')).toBeHidden();
 await expect(shell).toBeVisible();
});
