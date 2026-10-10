"use client";
import {useState} from "react";
export function CustomerLineLink(){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[linked,setLinked]=useState(false),[code,setCode]=useState<{message:string;friendUrl:string;chatUrl:string}>();
 async function request(action:string){
  if(busy)return;setBusy(true);setError("");
  try{const response=await fetch("/api/customer-booking/line",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,token:window.location.hash.slice(1)})});const data=await response.json();if(!response.ok)throw new Error(data.error);
   if(action==="issue"){setCode(data);window.location.assign(data.chatUrl);}else{setLinked(data.linked);if(!data.linked)setError("まだ連携されていません。公式アカウントへコードを送り、再度確認してください。");}
  }catch(e){setError(e instanceof Error?e.message:"連携を確認できません。");}finally{setBusy(false);}
 }
 return <section aria-label="LINEとの予約連携"><h3>LINEと予約を連携する（任意）</h3>
 <p>LINEを使わなくても予約を操作できます。ボタンを押すと店舗のLINEトークが開き、連携コードが入力されます。ご本人のLINEで送信ボタンを押してください。コードは他の方に共有しないでください。</p>
 {error&&<p role="alert" className="error">{error}</p>}
 {linked?<p role="status">この予約はLINEと連携済みです。予約通知は今後追加予定です。</p>:<>
 <button disabled={busy} onClick={()=>void request("issue")}>{busy?"準備中…":"LINEを開いて予約を連携"}</button>
 {code&&<><p>LINEで入力済みの文章を10分以内に送信してください。開かない場合は下のリンクから再度開けます。再発行すると前のコードは無効になります。</p>
 <a href={code.chatUrl} rel="noreferrer">コードを入力してLINEを開く</a>
 <details><summary>LINEが開かない場合</summary><p>スマートフォンのLINEでお試しください。必要な場合は以下の文章をコピーして送信できます。</p>
 <label>送信する文章<input readOnly value={code.message} onFocus={e=>e.target.select()}/></label>
 <a href={code.friendUrl} target="_blank" rel="noopener noreferrer">店舗のLINE公式アカウントを開く</a></details></>}
 <button disabled={busy} onClick={()=>void request("status")}>連携結果を確認</button></>}
 </section>;
}
