'use strict';
const {test,expect}=require('@playwright/test');

function fakePack() {
  const counts={T:46,S:11,B:12,R:6,Y:12,N:10,L:9,H:9,P:83};
  const issues=[];
  for(const [p,n] of Object.entries(counts)) for(let i=1;i<=n;i++){
    const code=`${p}-${String(i).padStart(2,'0')}`;
    const title=code==='T-01'?'비교표준지 선정 확인용 합성 자료':`모의 지식 항목 ${code}`;
    issues.push({code,title,book_page_start:142,pdf_page_start:143,pdf_page_end:143,
      sections:{'쟁점':'가상 자료', '판단기준':'법률 판단은 원문 확인', '근거':'가상 법령',
        '확인자료':'현장 사진', '편람쪽':'가상'}});
  }
  return {schema:'LK_BSO_PRIVATE_MANUAL_KNOWLEDGE_PACK/0.1',
    classification:'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB',
    source:{review_status:'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL',source_pdf_sha256:'SYNTHETIC'},
    all_pages_text:Array.from({length:320},(_,i)=>({pdf_page:i+1,text:'합성'})), issue_codes:issues};
}
test('비공개 지식팩을 사용자가 선택하면 로컬 검색·참조만 하고 브라우저 저장·외부 전송은 없음',async({page},testInfo)=>{
  const apiRequests=[];page.on('request',(r)=>{if(!r.url().startsWith('http://127.0.0.1:'))apiRequests.push(r.url().split('?')[0]);});
  await page.goto('/');
  await page.locator('[data-context]').fill('가상특별시 누리구 새솔동');
  await page.locator('[data-lot]').fill('123-4');
  await page.locator('[data-lookup]').click();
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached();
  if(testInfo.project.name!=='pc-1440')await page.locator('[data-tab="analysis"]').click();
  await page.locator('[data-manual-panel] > summary').click();
  await page.locator('[data-manual-file]').setInputFiles({name:'private-knowledge.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fakePack()),'utf8')});
  await expect(page.locator('[data-manual-status]')).toContainText('198개 쟁점');
  await expect(page.locator('[data-manual-hints]')).toContainText('T-01');
  await expect(page.locator('[data-manual-gates]')).toContainText('T-09');
  await expect(page.locator('[data-manual-gates]')).toContainText('지목·조사용 이용상황 명칭만으로 쟁점 성립하지 않음');
  await expect(page.locator('[data-manual-gates]')).toContainText('T-05');
  await page.locator('[data-manual-query]').fill('T-01');
  await page.locator('[data-manual-search]').click();
  const link=page.locator('[data-manual-results] button').first();
  await expect(link).toContainText('T-01');
  await link.click();
  await expect(page.locator('[data-manual-results]')).toContainText('출처: 내부 실무기본서');
  await expect(page.locator('[data-manual-results]')).toContainText('가상 자료');
  await page.locator('[data-copy]').click();
  const report = await page.locator('[data-summary]').inputValue();
  expect(report).toContain('■ 내부 실무기본서 증빙 게이트');
  expect(report).toContain('T-01');
  expect(report).toContain('T-05');
  expect(report).toContain('T-09');
  expect(report).toContain('T-12');
  expect(report).toContain('최종 비교표준지 선정');
  const persistent=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
  expect(persistent.local).toEqual([]);expect(persistent.session).toEqual([]);
  expect(apiRequests).toEqual([]);
});
