"use client";
import {useEffect,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
type Dashboard={recipient:string;enabled:boolean;senderReady:boolean;platformReady:boolean;pending:number;expired:number;rows:{id:string;kind:string;state:string;recipient:string;customerName:string;startAt:string}[];delivery?:{sent:number;failed:number;error?:string}};
export function AdminStoreNotifications({auth,onBusy}:{auth:SupabaseClient;onBusy:(v:boolean)=>void}){
 const [data,setData]=useState<Dashboard>(),[recipient,setRecipient]=useState(""),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function call(body?:unknown,signal?:AbortSignal){const {data:{session}}=await auth.auth.getSession();if(!session)throw new Error("ログインしてください。");const r=await fetch("/api/admin/store-notifications",{method:body?"POST":"GET",cache:"no-store",signal,headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw new Error(v.error);return v as Dashboard;}
 function apply(v:Dashboard){setData(v);setRecipient(v.recipient);setEnabled(v.enabled);}
 useEffect(()=>{const c=new AbortController();call(undefined,c.signal).then(apply).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[auth]);
 async function run(action?:string){if(busy)return;setBusy(true);onBusy(true);setError("");setNotice("");try{const v=await call(action?{action,...(action==="save"?{recipient,enabled}:{})}:undefined);apply(v);if(v.delivery?.error)setError(v.delivery.error);setNotice(action==="save"?"店舗向け通知を保存しました。次の予約操作から反映します。":action==="retry"?`店舗向けメール配信受付：${v.delivery?.sent??0}件 ／ 失敗：${v.delivery?.failed??0}件。`:"店舗向け通知を更新しました。");}catch(e){setError(e instanceof Error?e.message:"取得できません。");}finally{setBusy(false);onBusy(false);}}
 return <section aria-label="店舗向け予約通知"><h3>店舗向け予約通知</h3><p>新規予約・変更・キャンセルを、店舗スタッフが受け取るメールアドレスに通知します。</p>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <label>店舗の通知受信先メールアドレス<input type="email" maxLength={254} value={recipient} disabled={busy} onChange={e=>setRecipient(e.target.value)}/></label>
 <label className="checkline"><input type="checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/>店舗への予約通知を有効にする</label>
 {data&&(!data.senderReady||!data.platformReady)&&<p>送信には、下の店舗メール設定で送信元を認証し、メール配信を設定してください。</p>}
 <button disabled={busy||!data} onClick={()=>{if(!enabled||window.confirm("このメールアドレスに店舗の予約情報を通知します。保存しますか？"))void run("save");}}>店舗向け通知を保存</button>
 {data&&<details><summary>店舗向け通知の状況を見る</summary><p>未送信：{data.pending}件 ／ 再送期間を過ぎた通知など：{data.expired}件</p><div className="grid"><button disabled={busy} onClick={()=>void run()}>店舗向け通知を更新</button><button disabled={busy||!data.pending||!data.platformReady||!data.senderReady} onClick={()=>{if(window.confirm("未送信の店舗向けメールを再送しますか？"))void run("retry");}}>店舗向けの未送信メールを再送</button></div><p className="muted">失敗後は約2分待って再送してください。23時間を過ぎた通知や、受信先・送信設定を変更した古い通知は再送せず、予約一覧で内容を確認してください。配信受付済みは受信・既読を保証しません。</p>{data.rows.map(r=><p key={r.id}>{r.customerName}様 ／ {new Date(r.startAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})} ／ {r.kind==="created"?"新規予約":r.kind==="changed"?"予約変更":"キャンセル"} ／ {r.state==="sent"?"配信受付済み":r.state==="sending"?"送信処理中":r.state==="expired"?"予約一覧で確認が必要":"未送信"}</p>)}</details>}
 </section>;
}
