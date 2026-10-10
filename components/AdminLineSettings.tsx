"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
type Settings={accountName:string;friendUrl:string;channelId:string;hasAccessToken:boolean;hasChannelSecret:boolean;version:string|null;encryptionReady:boolean};
export function AdminLineSettings({auth,onBusy}:{auth:SupabaseClient;onBusy:(busy:boolean)=>void}){
  const [settings,setSettings]=useState<Settings>(),[accessToken,setAccessToken]=useState(""),[channelSecret,setChannelSecret]=useState("");
  const [clear,setClear]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
  const [connection,setConnection]=useState<{displayName:string;basicId:string;premiumId:string|null}>();
  const inFlight=useRef(false);
  const request=useCallback(async (init?:RequestInit,path="/api/admin/line-settings")=>{
    const {data:{session}}=await auth.auth.getSession();if(!session){await auth.auth.signOut();throw new Error("再度ログインしてください。");}
    const r=await fetch(path,{...init,cache:"no-store",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"}});
    const data=await r.json();if(!r.ok){if(r.status===401)await auth.auth.signOut();throw new Error(data.error);}return data;
  },[auth]);
  useEffect(()=>{const controller=new AbortController();let active=true;
    request({signal:controller.signal}).then(data=>{if(active)setSettings(data);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"設定を読み込めません。");});
    return()=>{active=false;controller.abort();};
  },[request]);
  async function check(){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);onBusy(true);setError("");setSuccess("");setConnection(undefined);setConnection(undefined);
    try{setConnection(await request({method:"POST"},"/api/admin/line-settings/check"));}
    catch(e){setError(e instanceof Error?e.message:"接続確認できませんでした。");}
    finally{setBusy(false);onBusy(false);inFlight.current=false;}
  }
  async function save(){
    if(!settings||inFlight.current)return;inFlight.current=true;setBusy(true);onBusy(true);setError("");setSuccess("");setConnection(undefined);
    try{setSettings(await request({method:"POST",body:JSON.stringify({accountName:settings.accountName,friendUrl:settings.friendUrl,
      channelId:settings.channelId,expectedVersion:settings.version,accessToken,channelSecret,clearCredentials:clear})}));
      setAccessToken("");setChannelSecret("");setClear(false);setSuccess("LINE設定を保存しました。自動通知はまだ有効になっていません。");}
    catch(e){setError(e instanceof Error?e.message:"保存できませんでした。");}finally{setBusy(false);onBusy(false);inFlight.current=false;}
  }
  async function reload(){if(inFlight.current)return;inFlight.current=true;setBusy(true);onBusy(true);setError("");setSuccess("");setConnection(undefined);
    try{setSettings(await request());setAccessToken("");setChannelSecret("");setClear(false);}catch(e){setError(e instanceof Error?e.message:"設定を読み込めません。");}
    finally{setBusy(false);onBusy(false);inFlight.current=false;}}
  return <section className="card" aria-label="店舗のLINE連携設定"><h2>店舗のLINE連携設定</h2>
    <p>この店舗の公式アカウントを登録できます。保存済みの秘密情報は表示しません。</p>
    <p>設定の保存と公式アカウントへの接続確認に対応しています。LINEでの通知・本人の予約との紐づけ・LINEからの操作は、公式アカウントでの接続確認後に追加します。Webの予約操作はLINE登録なしで利用できます。</p>
    {error&&<p className="error" role="alert">{error}</p>}{success&&<p role="status">{success}</p>}
    <button disabled={busy} onClick={reload}>LINE設定を再読み込み（未保存の入力は戻ります）</button>
    {settings&&<><p>接続確認は保存済みのアクセストークンを使います。メッセージは送信しません。表示されたアカウント名・IDが店舗のものか確認してください。チャネルシークレットの検証は含みません。</p>
      <button disabled={busy||!settings.hasAccessToken||!settings.encryptionReady} onClick={()=>void check()}>LINEの接続確認</button>
      {connection&&<p role="status">接続できました：{connection.displayName}（{connection.premiumId??connection.basicId}）。自動通知はまだ有効になっていません。</p>}</>}
    {settings&&<form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy} style={{border:0,padding:0}}>
      <label>公式アカウント名<input maxLength={100} value={settings.accountName} onChange={e=>setSettings({...settings,accountName:e.target.value})}/></label>
      <label>友だち追加URL<input type="url" maxLength={500} placeholder="https://lin.ee/…" value={settings.friendUrl} onChange={e=>setSettings({...settings,friendUrl:e.target.value})}/></label>
      <label>Messaging API チャネルID<input inputMode="numeric" maxLength={30} value={settings.channelId} onChange={e=>setSettings({...settings,channelId:e.target.value})}/></label>
      <p>チャネルアクセストークン：{settings.hasAccessToken?"保存済み":"未設定"} ／ チャネルシークレット：{settings.hasChannelSecret?"保存済み":"未設定"}</p>
      {!settings.encryptionReady&&<p>秘密情報の保存には、サーバー側の暗号化キー設定が必要です。公式アカウント名・URLは先に保存できます。</p>}
      <label>チャネルアクセストークン（更新する場合のみ）<input type="password" autoComplete="new-password" disabled={!settings.encryptionReady||clear} maxLength={5000} value={accessToken} onChange={e=>setAccessToken(e.target.value)}/></label>
      <label>チャネルシークレット（更新する場合のみ）<input type="password" autoComplete="new-password" disabled={!settings.encryptionReady||clear} maxLength={500} value={channelSecret} onChange={e=>setChannelSecret(e.target.value)}/></label>
      <label className="checkline"><input type="checkbox" checked={clear} onChange={e=>{setClear(e.target.checked);setAccessToken("");setChannelSecret("");}}/>保存済みの秘密情報を削除する</label>
      <p className="muted">チャネルIDを変更すると、以前のチャネルの秘密情報は削除されます。</p>
      <button className="primary" disabled={busy} type="submit">{busy?"保存中…":"LINE設定を保存"}</button>
    </fieldset></form>}
  </section>;
}
