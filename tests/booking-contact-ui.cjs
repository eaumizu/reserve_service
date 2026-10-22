const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(20000);let sent;
  await page.route('**/api/catalog',r=>r.fulfill({json:[{id:'service',name:'整体',duration_minutes:30,price:3000}]}));
  await page.route('**/api/booking-rules',r=>r.fulfill({json:{advance_days:30,cutoff_minutes:0,minDate:'2030-01-01',maxDate:'2030-01-31'}}));
  await page.route('**/api/availability?*',r=>r.fulfill({json:{slots:[{staffId:'staff',staffName:'',startAt:'2030-01-02T01:00:00Z'}]}}));
  await page.route('**/api/reservations',async r=>{sent=r.request().postDataJSON();await r.fulfill({status:201,json:{reservation:{id:'booking'},managePath:'/reservation#'+ 'a'.repeat(64)}});});
  await page.goto('http://127.0.0.1:3000/');await page.getByLabel('ご希望の日',{exact:true}).fill('2030-01-02');await page.getByRole('button',{name:'10:00',exact:true}).click();
  await page.getByLabel('お名前',{exact:true}).fill('確認用');
  const confirm=page.getByRole('button',{name:'確認画面へ',exact:true});assert.equal(await confirm.isDisabled(),true,'email must be required');
  const email=page.getByLabel('メールアドレス（必須）',{exact:true});await email.fill('bad');assert.equal(await confirm.isDisabled(),true);
  await email.fill('guest@example.com');assert.equal(await page.getByLabel('電話番号（任意）',{exact:true}).inputValue(),'');await confirm.click();
  await page.getByRole('button',{name:'予約を確定する',exact:true}).click();await page.getByRole('heading',{name:'ご予約を承りました',exact:true}).waitFor();
  assert.equal(sent.customerEmail,'guest@example.com');assert.equal(sent.customerPhone,'');console.log('PASS '+width+'px required email and optional phone');await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
