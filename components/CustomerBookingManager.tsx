"use client";
import { useEffect,useRef,useState } from "react";
import type { CustomerBooking } from "../lib/customer-booking";
import {CustomerLineLink} from "./CustomerLineLink";
type Mode="view"|"change"|"cancel"|"confirmChange";
const statuses:Record<string,string>={confirmed:"予約確定",cancelled:"キャンセル済み",completed:"施術完了",no_show:"無断キャンセル"};
const japan=(value:string)=>new Date(value).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
export function CustomerBookingManager(){
  const token=useRef(""),sequence=useRef(0),inFlight=useRef(false);
  const [booking,setBooking]=useState<CustomerBooking>(),[bounds,setBounds]=useState({minDate:"",maxDate:""});
  const [mode,setMode]=useState<Mode>("view"),[date,setDate]=useState(""),[slots,setSlots]=useState<string[]>([]),[start,setStart]=useState("");
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
  async function request(body:Record<string,unknown>,signal?:AbortSignal){
    const r=await fetch("/api/customer-booking",{method:"POST",cache:"no-store",signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,token:token.current})});
    const result=await r.json();if(!r.ok)throw new Error(result.error);return result;
  }
  useEffect(()=>{
    token.current=window.location.hash.slice(1);
    const controller=new AbortController();let active=true;
    request({action:"view"},controller.signal).then(result=>{if(active){setBooking(result.booking);setBounds(result.bounds);}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"予約を取得できません。");});
    return()=>{active=false;controller.abort();};
  },[]);
  async function reload(){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setSuccess("");setMode("view");setSlots([]);setStart("");
    try{const result=await request({action:"view"});setBooking(result.booking);setBounds(result.bounds);}
    catch(e){setError(e instanceof Error?e.message:"予約を取得できません。");}finally{setBusy(false);inFlight.current=false;}
  }
  async function loadSlots(value:string){
    const seq=++sequence.current;setDate(value);setSlots([]);setStart("");setError("");
    if(!value){setLoading(false);return;}setLoading(true);
    try{const result=await request({action:"slots",date:value});if(seq===sequence.current)setSlots(result.slots);}
    catch(e){if(seq===sequence.current)setError(e instanceof Error?e.message:"空き枠を取得できません。");}
    finally{if(seq===sequence.current)setLoading(false);}
  }
  async function save(action:"cancel"|"reschedule"){
    if(!booking||inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setSuccess("");
    try{const result=await request({action,expectedUpdatedAt:booking.updatedAt,...(action==="reschedule"?{startAt:start}:{})});
      setBooking(result.booking);setMode("view");setSlots([]);setStart("");if(result.notificationWarning)setError(result.notificationWarning);setSuccess(action==="cancel"?"予約をキャンセルしました。":"予約日時を変更しました。");}
    catch(e){setError(e instanceof Error?e.message:"通信エラーです。予約を再読み込みして結果をご確認ください。");}
    finally{setBusy(false);inFlight.current=false;}
  }
  return <section className="card">
    <p>このページのリンクを保存してください。リンクを持つ方は予約を操作できますので、他の方には共有しないでください。</p>
    {error&&<p className="error" role="alert">{error}</p>}{success&&<p role="status">{success}</p>}
    <button disabled={busy||loading} onClick={reload}>予約を再読み込み</button>
    {!booking?<p>予約リンクから開いてください。見つからない場合は店舗にお問い合わせください。</p>:<>
      <h2>{booking.storeName}</h2><p>{booking.customerName} 様</p>
      <p>{booking.serviceName} ／ {booking.staffName}</p><p>{japan(booking.startAt)} ～ {japan(booking.endAt)}（日本時間）</p>
      <p>状態：{statuses[booking.status]??booking.status}</p>
      {!booking.canManage&&<p>この予約はWebから変更・キャンセルできません。必要な場合は店舗にお問い合わせください。</p>}
      {booking.canManage&&mode==="view"&&<div className="grid"><button disabled={busy} onClick={()=>{setMode("change");setDate("");setSlots([]);setStart("");setSuccess("");}}>予約日時を変更</button>
      <button disabled={busy} onClick={()=>{setMode("cancel");setSuccess("");}}>予約をキャンセル</button></div>}
      {booking.canManage&&mode==="change"&&<>
        <h3>変更先の日時を選択</h3><p>同じメニュー・担当者の空き枠から選択できます。</p>
        <label>変更先の予約日<input type="date" min={bounds.minDate} max={bounds.maxDate} disabled={busy} value={date} onChange={e=>void loadSlots(e.target.value)}/></label>
        {loading?<p role="status">空き枠を確認しています…</p>:<div className="grid">{slots.map(value=><button key={value} className={start===value?"selected":""} onClick={()=>setStart(value)}>{japan(value)}</button>)}</div>}
        {date&&!loading&&!slots.length&&!error&&<p>予約可能な空き枠がありません。別の日を選択してください。</p>}
        <button disabled={!start||loading||busy} onClick={()=>setMode("confirmChange")}>変更内容を確認</button>
        <button disabled={busy||loading} onClick={()=>setMode("view")}>戻る</button>
      </>}
      {booking.canManage&&(mode==="cancel"||mode==="confirmChange")&&<>
        <h3>{mode==="cancel"?"この予約をキャンセルしますか？":"この日時に変更しますか？"}</h3>
        {mode==="confirmChange"&&<p>{japan(start)}（日本時間）</p>}
        <div className="grid"><button disabled={busy} onClick={()=>setMode(mode==="cancel"?"view":"change")}>戻る</button>
        <button className="primary" disabled={busy} onClick={()=>void save(mode==="cancel"?"cancel":"reschedule")}>{busy?"処理中…":mode==="cancel"?"キャンセルを確定":"変更を確定"}</button></div>
      </>}
      {booking.canManage&&<CustomerLineLink/>}
      <p className="muted">変更・キャンセルは施術開始前までです。変更先は店舗の予約受付期間・締め切りに従います。LINEを利用しなくても操作できます。</p>
    </>}
  </section>;
}
