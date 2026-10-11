"use client";
import {useEffect,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
type Row={id:string;reservationId:string;channel:string;kind?:string;state:string;customerName:string;phone:string;startAt:string;serviceName:string;staffName:string;failed?:boolean;canRetry?:boolean;canContact?:boolean};
type Dashboard={enabled:boolean;canManage:boolean;reminders:Row[];events:Row[];notice?:string};
const japan=(v:string)=>new Date(v).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
const kind=(r:Row)=>r.kind==="created"?"予約完了":r.kind==="changed"?"予約変更":r.kind==="cancelled"?"キャンセル":"前日連絡";
export function AdminContacts({auth,onBusy}:{auth:SupabaseClient;onBusy:(v:boolean)=>void}){
 const [data,setData]=useState<Dashboard>(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function call(path:string,body?:unknown,signal?:AbortSignal){const {data:{session}}=await auth.auth.getSession();if(!session)throw new Error("ログインしてください。");const r=await fetch(path,{method:body?"POST":"GET",cache:"no-store",signal,headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw new Error(value.error);return value;}
 useEffect(()=>{const c=new AbortController();call("/api/admin/contacts",undefined,c.signal).then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[auth]);
 async function run(row?:Row,action?:string){if(busy)return;setBusy(true);onBusy(true);setError("");setNotice("");try{
  let message="一覧を更新しました。";
  if(row){const reminder=!row.kind;const result=await call(reminder?"/api/admin/reminders":"/api/admin/contacts",reminder?{action:action==="retry"?"send":"contacted",id:row.id}:{action,id:row.id,channel:row.channel});message=result.notice??(action==="contacted"?"電話での連絡済みを記録しました。":"未送信の前日通知を送信しました。");}
  setData(await call("/api/admin/contacts"));setNotice(message);
 }catch(e){setError(e instanceof Error?e.message:"処理できません。一覧を更新してください。");}finally{setBusy(false);onBusy(false);}}
 const rows=[...(data?.reminders??[]),...(data?.events??[])];
 const requiresContact=(r:Row)=>r.kind?["pending","sending","expired"].includes(r.state):r.state==="phone"||r.failed&&r.state==="pending";
 const needs=rows.filter(requiresContact).sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));
 const history=rows.filter(r=>!requiresContact(r));
 return <section className="card" aria-label="連絡管理"><h2>連絡管理</h2><p>連絡が必要な予約を確認し、再送または電話で対応します。</p>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <button disabled={busy} onClick={()=>void run()}>連絡一覧を更新</button>
 {!data?<p>連絡を読み込んでいます…</p>:<>
 <p>前日通知：{data.enabled?"有効":"停止中"}。設定は「店舗設定」で変更できます。</p>
 {!needs.length?<p>連絡が必要な予約はありません。</p>:<><h3>対応が必要な連絡（{needs.length}件）</h3>{needs.map(row=>{
 const reminder=!row.kind,phone=row.state==="phone"||row.state==="expired",sending=row.state==="sending";
 const retry=reminder?row.state==="pending"&&data.enabled:row.canRetry;
 const contact=reminder?row.state==="phone"||row.state==="pending"&&row.failed:row.canContact;
 return <article className="card" key={`${row.channel}:${row.id}`}><strong>{row.customerName}様</strong><p>{japan(row.startAt)} ／ {kind(row)}</p>
 <p>{sending?"送信処理中":phone?"電話連絡が必要":`${row.channel==="line"?"LINE":"メール"}の未送信通知があります`}</p>
 <div className="grid">{retry&&data.canManage&&<button disabled={busy} onClick={()=>{if(window.confirm(reminder?"未送信の前日通知を送信しますか？対象の予約全体に送信します。":"この予約の未送信通知を再送しますか？"))void run(row,"retry");}}>再送</button>}
 {contact&&<button disabled={busy} onClick={()=>{if(window.confirm(`${row.customerName}様に電話で連絡できましたか？不在の場合は記録せず残してください。`))void run(row,"contacted");}}>電話で連絡済みにする</button>}</div>
 <details><summary>詳細</summary><p>{row.serviceName} ／ {row.staffName}</p>{row.phone&&<a href={`tel:${row.phone.replace(/[^+0-9]/g,"")}`}>{row.phone}</a>}</details></article>;
 })}</>}
 <details><summary>通知履歴を見る（{history.length}件）</summary><p className="muted">送信済みは配信サービス受付済みです。受信・既読を保証しません。</p>{history.map(r=><p key={`${r.channel}:${r.id}`}>{r.customerName}様 ／ {japan(r.startAt)} ／ {kind(r)} ／ {r.state==="contacted"?"電話で連絡済み":r.state==="pending"?"自動通知待ち":r.state==="sending"?"送信処理中":`${r.channel==="line"?"LINE":"メール"}配信受付済み`}</p>)}</details>
 <p className="muted">予約通知は対応が必要なものを優先して直近200件、前日連絡は今日・明日の対象を最大200件表示します。再送後も残る場合は約2分待って更新してください。</p>
 </>}
 </section>;
}
