const {chromium}=require("playwright");const assert=require("node:assert/strict");
(async()=>{
  const browser=await chromium.launch({headless:true});
  for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on("pageerror",e=>errors.push(e.message));
    const token="a".repeat(64);let booking={id:"booking",storeId:"store",storeName:"テスト店舗",customerName:"確認用",serviceId:"service",serviceName:"整体",staffId:"staff",staffName:"担当",startAt:"2030-01-01T01:00:00Z",endAt:"2030-01-01T02:00:00Z",status:"confirmed",updatedAt:"2030-01-01T00:00:00Z",canManage:true};
    const operations=[];
    await page.route("**/api/customer-booking",async route=>{
      const body=route.request().postDataJSON();assert.equal(body.token,token);let data;
      if(body.action==="view")data={booking,bounds:{minDate:"2030-01-01",maxDate:"2030-01-31"}};
      else if(body.action==="slots")data={staffSlots:[{staffId:"staff",staffName:"担当",starts:["2030-01-02T01:15:00Z"]},{staffId:"second",staffName:"別担当",starts:["2030-01-02T01:15:00Z"]}]};
      else{assert.equal(body.expectedUpdatedAt,booking.updatedAt);operations.push(body.action);
        if(body.action==="reschedule"){assert.equal(body.staffId,"second");booking={...booking,staffId:body.staffId,staffName:"別担当",startAt:body.startAt,endAt:"2030-01-02T02:15:00Z",updatedAt:"2030-01-01T00:01:00Z"};}
        else booking={...booking,status:"cancelled",updatedAt:"2030-01-01T00:02:00Z",canManage:false};
        data={booking};
      }
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
    });
    let lineLinked=false,lineIssues=0;
    await page.route("**/api/customer-booking/line",async route=>{
      const body=route.request().postDataJSON();
      const data=body.action==="status"?{linked:lineLinked,available:true}:
        {message:"予約連携 "+"b".repeat(32),friendUrl:"https://line.me/R/ti/p/@shop",chatUrl:"http://localhost:3000/reservation#"+token+"-line",expiresInMinutes:10};
      if(body.action==="issue")lineIssues++;
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
    });
    await page.goto("http://localhost:3000/reservation#"+token);
    await page.getByRole("button",{name:"LINEを開いて予約を連携",exact:true}).click();
    await page.getByText("友だち追加はできましたか？",{exact:false}).waitFor();
    await page.getByRole("button",{name:"トークを開いて連携を完了",exact:true}).click();
    assert.equal(lineIssues,1,"resuming must keep the valid linking code");
    lineLinked=true;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await page.getByRole("status").filter({hasText:"この予約はLINEと連携済み"}).waitFor();
    assert.equal(await page.getByRole("button",{name:"トークを開いて連携を完了",exact:true}).count(),0);
    await page.evaluate(token=>history.replaceState(null,"","/reservation#"+token),token);
    await page.getByRole("button",{name:"予約日時を変更",exact:true}).click();
    await page.getByLabel("変更先の予約日").fill("2030-01-02");
    await page.getByRole("button",{name:/10:15.*別担当/}).click();
    await page.getByRole("button",{name:"変更内容を確認",exact:true}).click();
    assert.equal(operations.length,0);
    await page.getByRole("button",{name:"変更を確定",exact:true}).click();
    await page.getByRole("status").filter({hasText:"予約日時を変更しました"}).waitFor();
    await page.reload();await page.getByText(/2030\/1\/2 10:15/).waitFor();
    await page.getByRole("button",{name:"予約をキャンセル",exact:true}).click();
    assert.deepEqual(operations,["reschedule"]);
    await page.getByRole("button",{name:"キャンセルを確定",exact:true}).click();
    await page.getByText("状態：キャンセル済み",{exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"予約日時を変更",exact:true}).count(),0);
    assert.deepEqual(operations,["reschedule","cancel"]);assert.deepEqual(errors,[]);
    console.log("PASS "+width+"px customer view, change confirmation, persistence, cancellation and disabled terminal actions");
    await page.close();
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
