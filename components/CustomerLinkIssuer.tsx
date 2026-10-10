"use client";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
export function CustomerLinkIssuer({auth,reservationId,onBusy}:{auth:SupabaseClient;reservationId:string;onBusy:(value:boolean)=>void}){
  const [link,setLink]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[confirmed,setConfirmed]=useState(false);
  async function issue(){
    if(busy)return;setBusy(true);onBusy(true);setError("");
    try{
      const {data:{session}}=await auth.auth.getSession();if(!session){await auth.auth.signOut();throw new Error("再度ログインしてください。");}
      const r=await fetch(`/api/admin/reservations/${reservationId}/customer-link`,{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
      const result=await r.json();if(!r.ok){if(r.status===401)await auth.auth.signOut();throw new Error(result.error);}
      setLink(window.location.origin+result.managePath);setConfirmed(false);
    }catch(e){setError(e instanceof Error?e.message:"予約リンクを発行できませんでした。");}
    finally{setBusy(false);onBusy(false);}
  }
  return <section className="card"><h3>お客様用の予約リンク</h3>
    <p>本人の連絡先へお渡しください。再発行すると以前のリンクは使えなくなります。</p>
    {error&&<p className="error" role="alert">{error}</p>}
    {link&&<><label>予約確認・変更・キャンセルのリンク<input readOnly value={link} onFocus={e=>e.target.select()}/></label><p role="status">発行しました。リンクをコピーしてお渡しください。自動送信は行いません。</p></>}
    {!confirmed?<button disabled={busy} onClick={()=>setConfirmed(true)}>予約リンクを発行・再発行</button>:<><p>既存の予約リンクを無効にして、新しいリンクを発行しますか？</p><button disabled={busy} onClick={()=>setConfirmed(false)}>戻る</button><button disabled={busy} onClick={issue}>{busy?"発行中…":"発行を確定"}</button></>}
  </section>;
}
