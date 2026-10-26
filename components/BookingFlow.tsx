"use client";
import { parseCustomerEmail,parseCustomerPhone } from "../lib/reservations/email";
import { useEffect, useRef, useState } from "react";
import type { BookingRules } from "../lib/booking-rules";
type Service = { id: string; name: string; duration_minutes: number; price: number };
type Slot = { staffId: string; staffName: string; startAt: string };
type Rules = BookingRules & { minDate: string; maxDate: string };
export function BookingFlow() {
  const [notificationWarning,setNotificationWarning]=useState<string|null>(null);
  const [managePath,setManagePath]=useState<string|null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [rules, setRules] = useState<Rules>();
  const [service, setService] = useState<Service>();
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<"form" | "confirm" | "done">("form");
  const [error, setError] = useState("");
  const [availabilityError,setAvailabilityError]=useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [availabilityVersion,setAvailabilityVersion]=useState(0);
  const submission=useRef<"idle"|"pending"|"done">("idle");
  const availabilityEpoch=useRef(0);
  const selection=useRef({slot,stage});
  useEffect(()=>{selection.current={slot,stage};},[slot,stage]);
  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/catalog", { cache: "no-store" }), fetch("/api/booking-rules", { cache: "no-store" })])
      .then(async ([catalog, policy]) => {
        if (!catalog.ok || !policy.ok) throw new Error();
        const [items, rule] = await Promise.all([catalog.json(), policy.json()]);
        if (active) { setServices(items); if(items.length===1)setService(items[0]); setRules(rule); }
      }).catch(() => { if (active) setError("予約設定を読み込めません。ページを再読み込みしてください。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setSlot(undefined); setSlots([]);setAvailabilityError("");
    if (!service || !date || !rules) {setLoading(false);return;}
    setLoading(true);
    let inFlight=false;
    const controller=new AbortController();
    async function refresh(){
      if(inFlight||submission.current!=="idle"||document.visibilityState==="hidden"||selection.current.stage==="done")return;
      const epoch=availabilityEpoch.current;
      const canApply=()=>active&&submission.current==="idle"&&epoch===availabilityEpoch.current&&selection.current.stage!=="done";
      inFlight=true;
      try{
        const response=await fetch(`/api/availability?serviceId=${service!.id}&date=${date}`,{cache:"no-store",signal:controller.signal});
        const result=await response.json();if(!response.ok)throw new Error(result.error);
        if(!canApply())return;
        const available:Slot[]=result.slots??[];setSlots(available);setAvailabilityError("");
        const current=selection.current;
        if(current.slot&&!available.some(s=>s.staffId===current.slot!.staffId&&s.startAt===current.slot!.startAt)){
          setSlot(undefined);
          if(current.stage==="confirm"){setStage("form");setError("選択した時間は受付できなくなりました。別の空き枠を選択してください。");}
        }
      }catch(e){
        if(!canApply())return;
        setSlots([]);setSlot(undefined);setAvailabilityError(e instanceof Error?e.message:"空き枠を取得できません。");
        if(selection.current.stage==="confirm")setStage("form");
      }finally{inFlight=false;if(active)setLoading(false);}
    }
    const resume=()=>void refresh();
    void refresh();
    const timer=window.setInterval(resume,30000);
    window.addEventListener("focus",resume);window.addEventListener("pageshow",resume);document.addEventListener("visibilitychange",resume);
    return () => { active = false;controller.abort();window.clearInterval(timer);window.removeEventListener("focus",resume);window.removeEventListener("pageshow",resume);document.removeEventListener("visibilitychange",resume); };
  }, [service, date, rules, availabilityVersion]);
  async function submit() {
    if (submission.current!=="idle" || !service || !slot) return;
    // Saving the booking closes its own slot before notification delivery ends.
    // Invalidate earlier availability responses and pause refreshes until the
    // submit result is known, so they cannot send a successful booking backwards.
    submission.current="pending";availabilityEpoch.current++;
    setBusy(true); setError("");setAvailabilityError("");
    try {
      const response = await fetch("/api/reservations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeId: process.env.NEXT_PUBLIC_DEFAULT_STORE_ID, serviceId: service.id, staffId: slot.staffId, startAt: slot.startAt, customerName: name, customerPhone: phone, customerEmail: email.trim(), source: "web" }) });
      if (response.ok) { const result=await response.json();submission.current="done";setManagePath(result.managePath??null);setNotificationWarning(result.notificationWarning??null);setStage("done"); }
      else { setError((await response.json()).error); setStage("form"); setSlot(undefined); setSlots([]);setAvailabilityVersion(v=>v+1); }
    } catch { setError("通信エラーです。予約結果を店舗に確認してください。"); }
    finally { if(submission.current==="pending")submission.current="idle";setBusy(false); }
  }
  if (stage === "done") return <section className="card"><h2>ご予約を承りました</h2>{notificationWarning&&<p role="status">{notificationWarning}</p>}<p>確認のため、店舗からご連絡する場合があります。</p>{managePath?<><p><a href={managePath}>予約を確認・変更・キャンセル</a></p><p>リンクを開いて保存してください。LINEを利用しなくても操作できます。このリンクは他の方に共有しないでください。</p></>:<p>変更・キャンセルは店舗にご連絡ください。</p>}</section>;
  return <section className="card">
    <h2>{stage === "confirm" ? "内容のご確認" : "ご予約"}</h2>
    {rules && <p className="muted">Web予約は日本時間で今日から{rules.advance_days}日先まで、施術開始の{rules.cutoff_minutes === 0 ? "直前" : `${rules.cutoff_minutes}分前`}まで受付します。</p>}
    {(error||availabilityError) && <p className="error" role="alert">{error||availabilityError}</p>}
    {stage === "form" && <>
      <label>施術メニュー<select value={service?.id ?? ""} onChange={e => { setSlot(undefined);setError(""); setService(services.find(s => s.id === e.target.value)); }}><option value="">選んでください</option>{services.map(s => <option key={s.id} value={s.id}>{s.name}（{s.duration_minutes}分・¥{s.price.toLocaleString()}）</option>)}</select></label>
      <label>ご希望の日<input type="date" disabled={!rules} min={rules?.minDate} max={rules?.maxDate} value={date} onChange={e => { setSlot(undefined);setError(""); setDate(e.target.value); }} /></label>
      {loading && <p role="status">空き枠を確認しています…</p>}
      {date && <div className="grid">{slots.map(s => <button className={slot?.startAt === s.startAt && slot.staffId === s.staffId ? "selected" : ""} key={s.staffId + s.startAt} onClick={() => {setSlot(s);setError("");}}>{new Date(s.startAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })}{s.staffName&&<><br /><small>{s.staffName}</small></>}</button>)}</div>}
      {!loading && service && date && !slots.length && !error && !availabilityError && <p>この日に受付できる空き枠はありません。別の日付を選択してください。</p>}
      <label>お名前<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label>電話番号（任意）<input type="tel" autoComplete="tel" maxLength={50} inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label>メールアドレス（必須）<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <p className="muted">予約確認・変更・キャンセルや前日のご案内をメールでお送りします。受信できるメールアドレスをご入力ください。</p>
      {parseCustomerPhone(phone)===undefined&&<p className="error">電話番号を確認してください。</p>}
      {email.trim()&&!parseCustomerEmail(email)&&<p className="error">メールアドレスを確認してください。</p>}
      <button className="primary" disabled={!parseCustomerEmail(email) || parseCustomerPhone(phone)===undefined || !rules || !service || !slot || !name.trim() || loading} onClick={() => setStage("confirm")}>確認画面へ</button>
    </>}
    {stage === "confirm" && <>
      <p>{service?.name}<br />{slot && new Date(slot.startAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}{slot?.staffName&&`／${slot.staffName}`}<br />{name} 様{phone.trim()&&`（${phone}）`}<br />メール：{email.trim() || "記載なし"}</p>
      <div className="grid"><button disabled={busy} onClick={() => setStage("form")}>戻る</button><button className="primary" disabled={busy} onClick={submit}>{busy ? "予約を確定中…" : "予約を確定する"}</button></div>
    </>}
  </section>;
}
