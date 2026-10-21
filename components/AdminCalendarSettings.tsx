"use client";
import {useEffect,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
type Dashboard={connection:{calendarId:string;calendarName:string}|null;pending:number;failed:number;platformReady:boolean;callbackUrl:string;delivery?:{synced:number;failed:number}};
export function AdminCalendarSettings({auth,onBusy}:{auth:SupabaseClient;onBusy:(v:boolean)=>void}){
 const [data,setData]=useState<Dashboard>(),[id,setId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function call(body?:unknown,signal?:AbortSignal){const {data:{session}}=await auth.auth.getSession();if(!session)throw new Error("ログインしてください。");const r=await fetch("/api/admin/calendar",{method:body?"POST":"GET",cache:"no-store",signal,headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw new Error(v.error);return v as Dashboard&{url?:string};}
 useEffect(()=>{const c=new AbortController();call(undefined,c.signal).then(v=>{setData(v);setId(v.connection?.calendarId??"");}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[auth]);
 async function run(action?:string){if(busy)return;setBusy(true);onBusy(true);setError("");setNotice("");try{const v=await call(action?{action,calendarId:id.trim()}:undefined);if(v.url){window.location.assign(v.url);return;}setData(v);setId(v.connection?.calendarId??"");setNotice(action==="disconnect"?"接続を解除しました。Google側に登録済みの予定は残ります。":v.delivery?`カレンダー反映：${v.delivery.synced}件 ／ 失敗：${v.delivery.failed}件。未反映が残る場合は再度実行してください。`:"Google連携を更新しました。");}catch(e){setError(e instanceof Error?e.message:"処理できません。");}finally{setBusy(false);onBusy(false);}}
 return <section aria-label="Googleカレンダー連携"><h3>Googleカレンダー連携</h3><p>店舗共通のカレンダーへ予約を反映します。予約変更・キャンセルは予約管理画面で行ってください。</p>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {data&&!data.platformReady&&<p>Google連携の準備が未完了です。Google Cloudで接続用アプリを設定してください。</p>}
 {data?.connection?<><p>接続先：{data.connection.calendarName}</p><p>未反映：{data.pending}件 ／ 失敗：{data.failed}件</p><div className="grid"><button disabled={busy||!data.platformReady||!data.pending} onClick={()=>void run("retry")}>未反映の予定を同期</button><button disabled={busy} onClick={()=>{if(window.confirm("Googleカレンダーとの接続を解除しますか？登録済みの予定はGoogle側に残ります。"))void run("disconnect");}}>Google接続を解除</button></div><details><summary>再同期・接続情報</summary><p>{data.connection.calendarId}</p><button disabled={busy||!data.platformReady} onClick={()=>{if(window.confirm("今後の確定予約をGoogleカレンダーへ再同期しますか？"))void run("sync");}}>今後の予約を再同期</button></details></>:<><label>予約用GoogleカレンダーID<input value={id} maxLength={255} disabled={busy} onChange={e=>setId(e.target.value)} placeholder="カレンダー設定の「カレンダーID」"/></label><button disabled={busy||!data?.platformReady||!id.trim()} onClick={()=>void run("connect")}>Googleカレンダーを接続</button></>}
 <details><summary>接続の準備・使い方</summary><p>Google CloudでGoogle Calendar APIとOAuthクライアントを設定し、VercelにGOOGLE_CALENDAR_CLIENT_IDとGOOGLE_CALENDAR_CLIENT_SECRETを登録します。暗号化には既存の暗号鍵を使います。</p>{data?.callbackUrl&&<p>Googleに登録するリダイレクトURI：<br/>{data.callbackUrl}</p>}<p>接続後は「未反映の予定を同期」を押してください。その後の予約操作は自動で反映し、失敗した予定は約2分後から再試行できます。同期が反映するのは施術の開始・終了時刻です。施術前後の準備時間は予約システムで判定します。</p><p>Google側の私用予定を読み取って予約を止める機能や、Google側からの予約変更は、この段階では対応していません。</p></details>
 <button disabled={busy} onClick={()=>void run()}>Google連携を更新</button>
 </section>;
}
