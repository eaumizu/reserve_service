"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Code={message:string;friendUrl:string;chatUrl:string;expiresAt:number};
export function CustomerLineLink(){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[linked,setLinked]=useState(false),[code,setCode]=useState<Code>();
 const inFlight=useRef(false),pendingCheck=useRef(false);
 const call=useCallback(async(action:string)=>{
  const response=await fetch("/api/customer-booking/line",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,token:window.location.hash.slice(1)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
 },[]);
 const check=useCallback(async function checkStatus(automatic=false){
  if(inFlight.current){if(automatic)pendingCheck.current=true;return;}inFlight.current=true;setBusy(true);
  try{const data=await call("status");setLinked(data.linked);
   if(data.linked){setCode(undefined);setError("");setNotice("");}
   else if(!automatic){setNotice("まだ連携されていません。友だち追加だけでは完了しません。下のボタンからトークを開き、文章を送信してください。");setError("");}
  }catch(e){if(!automatic)setError(e instanceof Error?e.message:"連携を確認できません。");}
  finally{inFlight.current=false;setBusy(false);if(pendingCheck.current){pendingCheck.current=false;void checkStatus(true);}}
 },[call]);
 useEffect(()=>{
  const visible=()=>{if(document.visibilityState==="visible")void check(true);};
  const resume=()=>void check(true);
  void check(true);window.addEventListener("focus",resume);window.addEventListener("pageshow",resume);document.addEventListener("visibilitychange",visible);
  return()=>{window.removeEventListener("focus",resume);window.removeEventListener("pageshow",resume);document.removeEventListener("visibilitychange",visible);};
 },[check]);
 async function openChat(){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setNotice("");
  try{
   const status=await call("status");if(status.linked){setLinked(true);setCode(undefined);return;}
   let next=code;
   if(!next||next.expiresAt<=Date.now()){
    const data=await call("issue");next={...data,expiresAt:Date.now()+data.expiresInMinutes*60000-1000};setCode(next);
   }
   window.location.assign(next!.chatUrl);
  }catch(e){setError(e instanceof Error?e.message:"LINEを開けませんでした。");}
  finally{inFlight.current=false;setBusy(false);if(pendingCheck.current){pendingCheck.current=false;void check(true);}}
 }
 return <section aria-label="LINEとの予約連携"><h3>LINEと予約を連携する（任意）</h3>
 <p>LINEを使わなくても予約を操作できます。友だち追加だけでは予約との連携は完了しません。店舗の「トーク」を開き、入力済みの文章を送信してください。コードは他の方に共有しないでください。</p>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {linked?<p role="status">この予約はLINEと連携済みです。新しく連携した予約には、予約日時と専用リンクをLINEへお送りします。</p>:<>
 {code&&<p>友だち追加はできましたか？連携を完了するには、下のボタンからトークを開き、送信ボタンを押してください。</p>}
 <button disabled={busy} onClick={()=>void openChat()}>{busy?"確認中…":code?"トークを開いて連携を完了":"LINEを開いて予約を連携"}</button>
 {code&&<><p>発行したコードは10分間有効です。期限切れの場合は上のボタンで新しいコードを発行します。</p>
 <details><summary>LINEが開かない場合</summary><p>スマートフォンのLINEでお試しください。必要な場合は以下の文章をコピーして10分以内に送信できます。</p>
 <label>送信する文章<input readOnly value={code.message} onFocus={e=>e.target.select()}/></label>
 <a href={code.friendUrl} target="_blank" rel="noopener noreferrer">店舗のLINE公式アカウントを開く</a></details></>}
 <button disabled={busy} onClick={()=>void check()}>連携結果を確認</button></>}
 </section>;
}
