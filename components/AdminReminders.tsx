"use client";
import {useEffect,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
type Row={id:string;startAt:string;customerName:string;phone:string;serviceName:string;staffName:string;channel:string;state:string;failed:boolean;sentAt:string|null;contactedAt:string|null};
type Dashboard={enabled:boolean;emailReady:boolean;cronReady:boolean;canManage:boolean;rows:Row[];delivery?:{sent:number;failed:number}};
const japan=(value:string)=>new Date(value).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
export function reminderStateLabel(row:Pick<Row,"state"|"failed">){
 if(row.state==="sent")return "自動通知済み（配信サービス受付済み）";
 if(row.state==="contacted")return "電話で連絡済み";
 if(row.state==="sending")return "送信処理中";
 if(row.failed)return "通知失敗・連絡の確認が必要";
 if(row.state==="phone")return "電話連絡が必要";
 return "通知待ち";
}
export function AdminReminders({auth,onBusy}:{auth:SupabaseClient;onBusy:(value:boolean)=>void}){
 const [data,setData]=useState<Dashboard>(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function call(body?:Record<string,unknown>,signal?:AbortSignal){
  const {data:{session}}=await auth.auth.getSession();if(!session)throw new Error("再度ログインしてください。");
  const r=await fetch("/api/admin/reminders",{method:body?"POST":"GET",cache:"no-store",signal,headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const result=await r.json();if(!r.ok)throw new Error(result.error);return result as Dashboard;
 }
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  call(undefined,controller.signal).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"取得できません。");});
  return()=>{active=false;controller.abort();};
 // The component is remounted when the authenticated view changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[auth]);
 async function run(body?:Record<string,unknown>){
  if(busy)return;setBusy(true);onBusy(true);setError("");setNotice("");
  try{const result=await call(body);setData(result);setNotice(result.delivery?`配信サービス受付：${result.delivery.sent}件 ／ 送信失敗：${result.delivery.failed}件。残っている通知待ちは再度送信してください。`:body?.action==="contacted"?"電話での連絡済みを記録しました。":body?.action==="enable"?"通知設定を保存しました。":"一覧を更新しました。");}
  catch(e){setError(e instanceof Error?e.message:"処理できません。更新して結果をご確認ください。");}
  finally{setBusy(false);onBusy(false);}
 }
 return <section className="card" aria-label="前日連絡">
  <h2>前日連絡</h2>
  <p>明日の確定済み予約が対象です。前日午前9時頃（日本時間）に、LINE連携済みの方へLINE、それ以外でメール登録がある方へメールを送信します。自動通知できない方には店舗から電話してください。</p>
  <p className="muted">送信済みは配信サービスが受け付けた状態です。既読・受信を保証する表示ではありません。予約の変更・キャンセルは次の処理に反映されます。</p>
  {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button disabled={busy} onClick={()=>void run()}>前日連絡を更新</button>
  {!data?<p>前日連絡を読み込んでいます…</p>:<>
   <p>店舗の前日通知：<strong>{data.enabled?"有効":"停止中"}</strong></p>
   {!data.cronReady&&<p>自動実行の認証設定が未完了です。VercelにCRON_SECRETを設定して再デプロイしてください。</p>}
   {!data.emailReady&&<p>メールの自動送信は未設定です。LINE未連携の方は電話連絡の対象になります。メールを使う場合は配信サービスの設定が必要です。</p>}
   {data.canManage&&<div className="grid"><button disabled={busy} onClick={()=>{if(window.confirm(data.enabled?"この店舗の前日通知を停止しますか？":"前日通知を有効にしますか？設定済みのLINE・メールからお客様へ通知します。"))void run({action:"enable",enabled:!data.enabled});}}>{data.enabled?"前日通知を停止":"前日通知を有効にする"}</button>
   <button disabled={busy||!data.enabled} onClick={()=>{if(window.confirm("明日の予約の未送信通知を送信しますか？"))void run({action:"send"});}}>{busy?"処理中…":"未送信の前日通知を送信・再送"}</button></div>}
   <p className="muted">朝の自動処理後に入った翌日予約は、この画面から未送信通知を送信してください。</p>
   <p className="muted">一度の処理で送りきれなかった通知は「通知待ち」に残ります。失敗した通知は約2分後に再送できます。</p>
   {!data.rows.length?<p>対象の予約はありません。通知を停止している場合は新しい連絡対象を作成しません。</p>:<div style={{overflowX:"auto"}}><table className="admin-table"><thead><tr><th>予約日時</th><th>お客様・連絡先</th><th>施術・担当</th><th>通知方法</th><th>連絡状況</th><th>操作</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.id}>
    <td>{japan(row.startAt)}</td><td>{row.customerName}<br/>{row.phone?<a href={`tel:${row.phone.replace(/[^+0-9]/g,"")}`}>{row.phone}</a>:"電話番号なし"}</td>
    <td>{row.serviceName}<br/>{row.staffName}</td><td>{row.channel==="line"?"LINE":row.channel==="email"?"メール":"電話"}</td>
    <td>{reminderStateLabel(row)}{(row.sentAt||row.contactedAt)&&<p>{japan((row.sentAt||row.contactedAt)!)}</p>}</td>
    <td>{(row.state==="phone"||(row.state==="pending"&&row.failed))&&<button disabled={busy} onClick={()=>{if(window.confirm(`${row.customerName}様に電話で予約をお伝えできましたか？不在・留守番電話の場合は連絡済みにせず、そのまま残してください。`))void run({action:"contacted",id:row.id});}}>電話で連絡済みにする</button>}</td>
   </tr>)}</tbody></table></div>}
   <p className="muted">表示は200件までです。LINE連携や電話での連絡は必須ではなく、LINEなし・メールなしでも予約できます。</p>
  </>}
 </section>;
}
