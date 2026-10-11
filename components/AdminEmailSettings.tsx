"use client";
import {useEffect,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {EmailSettings} from "../lib/store-email";
type EventRow={id:string;reservationId:string;kind:string;state:string;recipient:string;createdAt:string;customerName:string;startAt:string};
type Result={settings:EmailSettings|null;platformReady:boolean;events?:{pending:number;expired:number;rows:EventRow[]}|null;delivery?:{sent:number;failed:number;pending:boolean}};
export function AdminEmailSettings({auth,onBusy}:{auth:SupabaseClient;onBusy:(value:boolean)=>void}){
 const [data,setData]=useState<Result>(),[name,setName]=useState(""),[email,setEmail]=useState(""),[reply,setReply]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function call(body?:unknown,signal?:AbortSignal){
  const {data:{session}}=await auth.auth.getSession();if(!session)throw new Error("ログインしてください。");
  const r=await fetch("/api/admin/email-settings",{method:body?"POST":"GET",signal,cache:"no-store",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const result=await r.json();if(!r.ok)throw new Error(result.error);return result as Result;
 }
 function apply(result:Result){setData(result);setName(result.settings?.senderName??"");setEmail(result.settings?.senderEmail??"");setReply(result.settings?.replyTo??"");}
 useEffect(()=>{const controller=new AbortController();let active=true;call(undefined,controller.signal).then(r=>{if(active)apply(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;controller.abort();};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[auth]);
 async function run(action?:string){
  if(busy)return;setBusy(true);onBusy(true);setError("");setNotice("");
  try{const result=await call(action?{action,...(action==="save"?{senderName:name,senderEmail:email,replyTo:reply}:{})}:undefined);apply(result);setNotice(action==="retry"?`メール配信受付：${result.delivery?.sent??0}件 ／ 失敗：${result.delivery?.failed??0}件。残りがある場合は再送してください。`:action==="save"?"送信元を保存しました。":action==="register"?"ドメインを登録しました。表示されたDNSレコードを設定してください。":action==="verify"?(result.settings?.status==="verified"?"ドメインの認証を確認しました。":"認証待ちです。DNSの反映後に、もう一度確認してください。"):"設定を再読み込みしました。");}
  catch(e){setError(e instanceof Error?e.message:"処理できません。");}finally{setBusy(false);onBusy(false);}
 }
 const settings=data?.settings;
 const dirty=name!==(settings?.senderName??"")||email!==(settings?.senderEmail??"")||reply!==(settings?.replyTo??"");
 const status=settings?.status==="verified"?"認証済み":settings?.status==="registering"?"登録処理中・運営への確認が必要":!settings?.domainId?"未登録":"認証待ち・未認証";
 return <section aria-label="店舗のメール通知設定"><h3>店舗のメール通知設定</h3>
  <p>この店舗専用の送信元を設定します。独自ドメインのDNSを編集できる方が設定してください。Gmailなどは返信先に指定できます。</p>
  {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {data&&!data.platformReady&&<p>運営側のResend設定が未完了です。送信元の保存はできますが、ドメイン登録・認証・メール送信は設定後に利用できます。</p>}
  <label>送信者名<input value={name} maxLength={80} disabled={busy} onChange={e=>setName(e.target.value)} placeholder="店舗名"/></label>
  <label>送信元メールアドレス<input type="email" value={email} maxLength={254} disabled={busy} onChange={e=>setEmail(e.target.value)} placeholder="booking@店舗の独自ドメイン"/></label>
  <label>返信先メールアドレス（任意）<input type="email" value={reply} maxLength={254} disabled={busy} onChange={e=>setReply(e.target.value)} placeholder="店舗が受信できるアドレス"/></label>
  <div className="grid"><button disabled={busy||!data} onClick={()=>void run("save")}>送信元を保存</button><button disabled={busy} onClick={()=>{if(!dirty||window.confirm("未保存の入力を戻して再読み込みしますか？"))void run();}}>メール設定を再読み込み</button></div>
  <p>ドメイン：{settings?.domain??"未設定"} ／ 状態：<strong>{status}</strong></p>
  <div className="grid"><button disabled={busy||dirty||!data?.platformReady||!settings||Boolean(settings.domainId)||settings.status==="registering"} onClick={()=>{if(window.confirm("保存済みの店舗ドメインをメール配信サービスに登録しますか？"))void run("register");}}>ドメインを登録</button>
  <button disabled={busy||dirty||!data?.platformReady||!settings?.domainId} onClick={()=>void run("verify")}>認証を確認</button></div>
  {dirty&&<p>先に送信元を保存してください。</p>}
  {!!settings?.records.length&&<><p>ドメインのDNS管理画面に、以下のレコードを登録してください。既存の受信用MXレコードを削除しないでください。DNSサービスによって名前欄のドメイン部分を省略する場合があります。</p><div style={{overflowX:"auto"}}><table className="admin-table"><thead><tr><th>種類</th><th>名前</th><th>値</th><th>優先度</th><th>TTL</th><th>状態</th></tr></thead><tbody>{settings.records.map((r,i)=><tr key={i}><td>{r.type}</td><td>{r.name}</td><td style={{overflowWrap:"anywhere",minWidth:240}}>{r.value}</td><td>{r.priority??"—"}</td><td>{r.ttl}</td><td>{r.status==="verified"?"認証済み":"認証待ち"}</td></tr>)}</tbody></table></div></>}
  <h3>予約完了・変更・キャンセルのメール通知</h3>
  <p>認証済みの送信元を使い、予約操作の直後に送信します。変更・キャンセルはLINE連携済みならLINEへ通知します。前日通知の有効・停止設定とは別です。</p>
  {!data?.events?<p>通知一覧を利用するには0019のSQLを適用してください。</p>:<>
   <p>未送信：{data.events.pending}件 ／ 自動再送できない通知：{data.events.expired}件</p>
   <button disabled={busy||!data.platformReady||!data.events.pending} onClick={()=>{if(window.confirm("この店舗の未送信メール通知を再送しますか？実際にお客様へ送信します。"))void run("retry");}}>未送信の予約メールを再送</button>
   <p className="muted">失敗後は約2分待って再送してください。配信受付済みは受信・既読を保証しません。23時間を超えた通知や連絡先・送信元・予約リンクが変更された通知は自動再送せず、店舗で連絡を確認してください。表示は直近20件です。</p>
   {!!data.events.rows?.length&&<div style={{overflowX:"auto"}}><table className="admin-table"><thead><tr><th>お客様</th><th>通知</th><th>予約日時</th><th>送信先</th><th>状態</th></tr></thead><tbody>{data.events.rows.map(e=><tr key={e.id}><td>{e.customerName}</td><td>{e.kind==="created"?"予約完了":e.kind==="changed"?"予約変更":"キャンセル"}</td><td>{new Date(e.startAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}</td><td>{e.recipient}</td><td>{e.state==="sent"?"配信受付済み":e.state==="sending"?"送信処理中":e.state==="expired"?"店舗で連絡の確認が必要":"未送信"}</td></tr>)}</tbody></table></div>}
  </>}
  <p className="muted">DNS反映には時間がかかる場合があります。認証済みの店舗だけメールを自動送信します。変更前に送信処理が始まった通知は、以前の送信元で届く場合があります。</p>
 </section>;
}
