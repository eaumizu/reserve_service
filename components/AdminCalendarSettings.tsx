"use client";
import {useEffect,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
type BusyCheck={date:string;checkedAt:string;intervals:{start:string;end:string}[]};
type Dashboard={connection:{calendarId:string;calendarName:string}|null;busyEnabled?:boolean;pending:number;failed:number;platformReady:boolean;callbackUrl:string;delivery?:{synced:number;failed:number};busyCheck?:BusyCheck};
export function AdminCalendarSettings({auth,onBusy}:{auth:SupabaseClient;onBusy:(v:boolean)=>void}){
 const [data,setData]=useState<Dashboard>(),[id,setId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [checkDate,setCheckDate]=useState(""),[check,setCheck]=useState<BusyCheck>();
 async function call(body?:unknown,signal?:AbortSignal){const {data:{session}}=await auth.auth.getSession();if(!session)throw new Error("ログインしてください。");const r=await fetch("/api/admin/calendar",{method:body?"POST":"GET",cache:"no-store",signal,headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw new Error(v.error);return v as Dashboard&{url?:string};}
 useEffect(()=>{const c=new AbortController();call(undefined,c.signal).then(v=>{setData(v);setId(v.connection?.calendarId??"");}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[auth]);
 async function run(action?:string){if(busy)return;setBusy(true);onBusy(true);setError("");setNotice("");setCheck(undefined);try{const v=await call(action?{action,calendarId:id.trim(),...(action==="busy"?{enabled:!data?.busyEnabled}:{}),...(action==="check-busy"?{date:checkDate}:{})}:undefined);if(v.url){window.location.assign(v.url);return;}setData(v);setId(v.connection?.calendarId??"");setCheck(v.busyCheck);setNotice(action==="check-busy"?"Googleの予定を確認しました。":action==="busy"?"Googleの予定による受付停止設定を保存しました。":action==="disconnect"?"接続を解除しました。Google側に登録済みの予定は残ります。":v.delivery?`カレンダー反映：${v.delivery.synced}件 ／ 失敗：${v.delivery.failed}件。未反映が残る場合は再度実行してください。`:"Google連携を更新しました。");}catch(e){setError(e instanceof Error?e.message:"処理できません。");}finally{setBusy(false);onBusy(false);}}
 return <section aria-label="Googleカレンダー連携"><h3>Googleカレンダー連携</h3><p>店舗共通のカレンダーへ予約を反映します。予約変更・キャンセルは予約管理画面で行ってください。</p>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {data&&!data.platformReady&&<p>Google連携の準備が未完了です。Google Cloudで接続用アプリを設定してください。</p>}
 {data?.connection?<><p>接続先：{data.connection.calendarName}</p><label className="checkline"><input type="checkbox" checked={Boolean(data.busyEnabled)} disabled={busy} onChange={()=>{if(window.confirm(data.busyEnabled?"Googleの予定による受付停止を解除しますか？":"このカレンダーの予定あり・終日予定の時間を、全担当者の受付停止にします。接続エラー中は新規予約・日時変更を停止します。有効にしますか？"))void run("busy");}}/>Googleの予定で予約枠を閉じる</label><p className="muted">空き枠の取得時と予約確定前にGoogleの予定を確認します。変更後は予約画面で日付を選び直してください。「空き時間」の予定は受付を止めません。</p><p>未反映：{data.pending}件 ／ 失敗：{data.failed}件</p><div className="grid"><button disabled={busy||!data.platformReady||!data.pending} onClick={()=>void run("retry")}>未反映の予定を同期</button><button disabled={busy} onClick={()=>{if(window.confirm("Googleカレンダーとの接続を解除しますか？登録済みの予定はGoogle側に残ります。"))void run("disconnect");}}>Google接続を解除</button></div><details><summary>再同期・接続情報</summary><p>{data.connection.calendarId}</p><button disabled={busy||!data.platformReady} onClick={()=>{if(window.confirm("今後の確定予約をGoogleカレンダーへ再同期しますか？"))void run("sync");}}>今後の予約を再同期</button></details></>:<><label>予約用GoogleカレンダーID<input value={id} maxLength={255} disabled={busy} onChange={e=>setId(e.target.value)} placeholder="カレンダー設定の「カレンダーID」"/></label><button disabled={busy||!data?.platformReady||!id.trim()} onClick={()=>void run("connect")}>Googleカレンダーを接続</button></>}
 <details><summary>接続の準備・使い方</summary><p>Google CloudでGoogle Calendar APIとOAuthクライアントを設定し、VercelにGOOGLE_CALENDAR_CLIENT_IDとGOOGLE_CALENDAR_CLIENT_SECRETを登録します。暗号化には既存の暗号鍵を使います。</p>{data?.callbackUrl&&<p>Googleに登録するリダイレクトURI：<br/>{data.callbackUrl}</p>}<p>接続後は「未反映の予定を同期」を押してください。その後の予約操作は自動で反映し、失敗した予定は約2分後から再試行できます。同期が反映するのは施術の開始・終了時刻です。施術前後の準備時間は予約システムで判定します。</p><p>「Googleの予定で予約枠を閉じる」を有効にすると、このカレンダーの予定が店舗全体の受付停止になります。予約システムから反映した予定は除外し、二重に枠を閉じません。Google側から予約そのものを変更する機能ではありません。</p></details>
 {data?.connection&&<details><summary>受付停止の動作確認</summary>
  <p>確認対象：{data.connection.calendarName}。このカレンダーの「予定あり」の時間を確認します。</p>
  <label>Google予定の確認日<input type="date" value={checkDate} disabled={busy} onChange={e=>{setCheckDate(e.target.value);setCheck(undefined);}}/></label>
  <button disabled={busy||!checkDate||!data.busyEnabled||!data.platformReady} onClick={()=>void run("check-busy")}>Googleの受付停止を確認</button>
  {check&&<div><p>{check.date} の受付停止：{check.intervals.length}件</p>
   {check.intervals.length?<ul>{check.intervals.slice(0,50).map((r,i)=><li key={i}>{new Date(r.start).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})} ～ {new Date(r.end).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}</li>)}</ul>:<p>対象の予定はありません。Google側の登録先カレンダーと「予定あり／空き時間」を確認してください。</p>}
   {check.intervals.length>50&&<p>先頭50件を表示しています。</p>}
   <p className="muted">確認日時：{new Date(check.checkedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}（日本時間）。予約システムの確定予約と日時が一致する予定は、予約一覧で管理します。</p>
  </div>}
 </details>}
 <button disabled={busy} onClick={()=>void run()}>Google連携を更新</button>
 </section>;
}
