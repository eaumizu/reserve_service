const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  const user={id:'5877c0b4-11fc-4a92-a647-ac0cde8bb2d7',email:'staff@example.com',app_metadata:{store_id:'11111111-1111-1111-1111-111111111111',role:'admin'},user_metadata:{},aud:'authenticated',created_at:'2026-01-01T00:00:00Z'};
  const jwt=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:Math.floor(Date.now()/1000)+3600},{}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  await page.route('**/auth/v1/token*',route=>route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'},contentType:'application/json',body:JSON.stringify({access_token:jwt,refresh_token:'refresh',expires_in:3600,token_type:'bearer',user})}));
  await page.route('**/auth/v1/user*',route=>route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'},contentType:'application/json',body:JSON.stringify(user)}));
  await page.route('**/api/admin/reservations?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({reservations:[],staff:[],hasMore:false,canManageSettings:true})}));
  await page.route('**/api/admin/booking-options',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({storeId:user.app_metadata.store_id,services:[],staff:[],links:[]})}));
  let enabled=false,sends=0;const actions=[];const dialogs=[];page.on('dialog',d=>dialogs.push(d.message()));
  let row={id:'77777777-7777-7777-7777-777777777777',startAt:'2030-01-02T01:15:00Z',customerName:'電話のお客様',phone:'09000000033',staffName:'担当',serviceName:'整体',state:'phone',channel:'phone',failed:false,sentAt:null,contactedAt:null};
  await page.route('**/api/admin/reminders',async route=>{
   const body=route.request().method()==='POST'?route.request().postDataJSON():null;
   if(body)actions.push(body.action);if(body?.action==='enable')enabled=body.enabled;
   if(body?.action==='send')sends++;
   if(body?.action==='contacted'){assert.equal(body.id,row.id);row={...row,state:'contacted',contactedAt:'2030-01-01T02:00:00Z'};}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled,emailReady:false,cronReady:true,canManage:true,rows:[row]})});
  });
  await page.goto('http://localhost:3000/admin');
  await page.getByLabel('メールアドレス',{exact:true}).fill('staff@example.com');await page.getByLabel('パスワード',{exact:true}).fill('test-password');await page.getByRole('button',{name:'ログイン',exact:true}).click();
  await page.getByRole('button',{name:'前日連絡',exact:true}).click();
  await page.getByText('電話連絡が必要',{exact:true}).waitFor();
  assert.equal(sends,0,'opening contact list must never send');
  assert.equal(await page.getByRole('button',{name:'未送信の前日通知を送信・再送',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'前日通知を有効にする',exact:true}).click();await page.getByRole('button',{name:'前日通知を停止',exact:true}).waitFor().catch(async e=>{console.log(JSON.stringify({enabled,actions,dialogs,errors,text:(await page.locator('body').innerText()).slice(-2500)}));throw e;});
  await page.getByRole('button',{name:'電話で連絡済みにする',exact:true}).click();await page.getByText('電話で連絡済み',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'電話で連絡済みにする',exact:true}).count(),0);assert.equal(sends,0);assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'予約一覧',exact:true}).click();await page.getByRole('heading',{name:'予約一覧',exact:true}).waitFor();
  console.log('PASS '+width+'px reminder opt-in, phone contacts, saved status and navigation');await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
