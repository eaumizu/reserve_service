const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(20000);let sent,googleBusy=false,attempts=0;
  await page.route('**/api/catalog',r=>r.fulfill({json:[{id:'service',name:'整体',duration_minutes:30,price:3000}]}));
  await page.route('**/api/booking-rules',r=>r.fulfill({json:{advance_days:30,cutoff_minutes:0,minDate:'2030-01-01',maxDate:'2030-01-31'}}));
  await page.route('**/api/availability?*',r=>r.fulfill({json:{slots:googleBusy?[]:[{staffId:'staff',staffName:'',startAt:'2030-01-02T01:00:00Z'}]}}));
  await page.route('**/api/reservations',async r=>{attempts++;if(googleBusy){await r.fulfill({status:409,json:{error:'その時間は受付できません。空き枠を選び直してください。'}});return;}sent=r.request().postDataJSON();await r.fulfill({status:201,json:{reservation:{id:'booking'},managePath:'/reservation#'+ 'a'.repeat(64)}});});
  await page.goto('http://127.0.0.1:3000/');await page.getByLabel('ご希望の日',{exact:true}).fill('2030-01-02');await page.getByRole('button',{name:'10:00',exact:true}).click();
  await page.getByLabel('お名前',{exact:true}).fill('確認用');
  const confirm=page.getByRole('button',{name:'確認画面へ',exact:true});assert.equal(await confirm.isDisabled(),true,'email must be required');
  const email=page.getByLabel('メールアドレス（必須）',{exact:true});await email.fill('bad');assert.equal(await confirm.isDisabled(),true);
  await email.fill('guest@example.com');assert.equal(await page.getByLabel('電話番号（任意）',{exact:true}).inputValue(),'');
  googleBusy=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('この日に受付できる空き枠はありません。別の日付を選択してください。',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'10:00',exact:true}).count(),0);assert.equal(await confirm.isDisabled(),true);assert.equal(attempts,0);
  googleBusy=false;await page.getByRole('button',{name:'空き枠を更新',exact:true}).click();await page.getByRole('button',{name:'10:00',exact:true}).click();await confirm.click();
  // The event can also be added while the customer is already on the confirmation screen.
  googleBusy=true;await page.getByRole('button',{name:'予約を確定する',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'その時間は受付できません。'}).waitFor();
  await page.getByRole('button',{name:'10:00',exact:true}).waitFor({state:'detached'});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='空き枠を更新'&&!b.disabled));
  assert.equal(await confirm.isDisabled(),true);assert.equal(attempts,1);assert.equal(sent,undefined);
  googleBusy=false;await page.getByRole('button',{name:'空き枠を更新',exact:true}).click();await page.getByRole('button',{name:'10:00',exact:true}).click();await confirm.click();
  await page.getByRole('button',{name:'予約を確定する',exact:true}).click();await page.getByRole('heading',{name:'ご予約を承りました',exact:true}).waitFor();
  assert.equal(sent.customerEmail,'guest@example.com');assert.equal(sent.customerPhone,'');assert.equal(attempts,2);console.log('PASS '+width+'px required email, optional phone, and Google busy refresh');await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
