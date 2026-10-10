"use client";
import {useState} from "react";
export function CustomerLineLink(){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[linked,setLinked]=useState(false),[code,setCode]=useState<{message:string;friendUrl:string}>();
 async function request(action:string){
  if(busy)return;setBusy(true);setError("");
  try{const response=await fetch("/api/customer-booking/line",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,token:window.location.hash.slice(1)})});const data=await response.json();if(!response.ok)throw new Error(data.error);
   if(action==="issue"){setCode(data);}else{setLinked(data.linked);if(!data.linked)setError("まだ連携されていません。公式アカウントへコードを送り、再度確認してください。");}
  }catch(e){setError(e instanceof Error?e.message:"連携を確認できません。");}finally{setBusy(false);}
 }
 return <section aria-label="LINEとの予約連携"><h3>LINEと予約を連携する（任意）</h3>
 <p>LINEを使わなくても予約を操作できます。連携コードはご本人のLINEから店舗の公式アカウントへ送ってください。コードは他の方に共有しないでください。</p>
 {error&&<p role="alert" className="error">{error}</p>}
 {linked?<p role="status">この予約はLINEと連携済みです。予約通知は今後追加予定です。</p>:<>
 <button disabled={busy} onClick={()=>void request("issue")}>連携コードを発行</button>
 {code&&<><p>以下の文章をコピーし、10分以内に公式アカウントのトークへ送信してください。再発行すると前のコードは無効になります。</p>
 <label>送信する文章<input readOnly value={code.message} onFocus={e=>e.target.select()}/></label>
 <a href={code.friendUrl} target="_blank" rel="noopener noreferrer">店舗のLINE公式アカウントを開く</a></>}
 <button disabled={busy} onClick={()=>void request("status")}>連携結果を確認</button></>}
 </section>;
}
