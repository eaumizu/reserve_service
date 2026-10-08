"use client";
import { useEffect, useState } from "react";
import type { BookingRules } from "../lib/booking-rules";
type Service = { id: string; name: string; duration_minutes: number; price: number };
type Slot = { staffId: string; staffName: string; startAt: string };
type Rules = BookingRules & { minDate: string; maxDate: string };
export function BookingFlow() {
  const [services, setServices] = useState<Service[]>([]);
  const [rules, setRules] = useState<Rules>();
  const [service, setService] = useState<Service>();
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot>();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<"form" | "confirm" | "done">("form");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/catalog", { cache: "no-store" }), fetch("/api/booking-rules", { cache: "no-store" })])
      .then(async ([catalog, policy]) => {
        if (!catalog.ok || !policy.ok) throw new Error();
        const [items, rule] = await Promise.all([catalog.json(), policy.json()]);
        if (active) { setServices(items); setRules(rule); }
      }).catch(() => { if (active) setError("予約設定を読み込めません。ページを再読み込みしてください。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setSlot(undefined); setSlots([]); setError("");
    if (!service || !date || !rules) return;
    setLoading(true);
    fetch(`/api/availability?serviceId=${service.id}&date=${date}`, { cache: "no-store" })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })
      .then(result => { if (active) setSlots(result.slots ?? []); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "空き枠を取得できません。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [service, date, rules]);
  async function submit() {
    if (busy || !service || !slot) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/reservations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeId: process.env.NEXT_PUBLIC_DEFAULT_STORE_ID, serviceId: service.id, staffId: slot.staffId, startAt: slot.startAt, customerName: name, customerPhone: phone, source: "web" }) });
      if (response.ok) setStage("done");
      else { setError((await response.json()).error); setStage("form"); setSlot(undefined); setSlots([]); }
    } catch { setError("通信エラーです。予約結果を店舗に確認してください。"); }
    finally { setBusy(false); }
  }
  if (stage === "done") return <section className="card"><h2>ご予約を承りました</h2><p>確認のため、店舗からご連絡する場合があります。</p></section>;
  return <section className="card">
    <h2>{stage === "confirm" ? "内容のご確認" : "ご予約"}</h2>
    {rules && <p className="muted">Web予約は日本時間で今日から{rules.advance_days}日先まで、施術開始の{rules.cutoff_minutes === 0 ? "直前" : `${rules.cutoff_minutes}分前`}まで受付します。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {stage === "form" && <>
      <label>施術メニュー<select value={service?.id ?? ""} onChange={e => { setSlot(undefined); setService(services.find(s => s.id === e.target.value)); }}><option value="">選んでください</option>{services.map(s => <option key={s.id} value={s.id}>{s.name}（{s.duration_minutes}分・¥{s.price.toLocaleString()}）</option>)}</select></label>
      <label>ご希望の日<input type="date" disabled={!rules} min={rules?.minDate} max={rules?.maxDate} value={date} onChange={e => { setSlot(undefined); setDate(e.target.value); }} /></label>
      {loading && <p role="status">空き枠を確認しています…</p>}
      {date && <div className="grid">{slots.map(s => <button className={slot?.startAt === s.startAt && slot.staffId === s.staffId ? "selected" : ""} key={s.staffId + s.startAt} onClick={() => setSlot(s)}>{new Date(s.startAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })}<br /><small>{s.staffName}</small></button>)}</div>}
      {!loading && service && date && !slots.length && !error && <p>この日に受付できる空き枠はありません。別の日付を選択してください。</p>}
      <label>お名前<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label>電話番号<input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <button className="primary" disabled={!rules || !service || !slot || !name.trim() || !phone.trim() || loading} onClick={() => setStage("confirm")}>確認画面へ</button>
    </>}
    {stage === "confirm" && <>
      <p>{service?.name}<br />{slot && new Date(slot.startAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}／{slot?.staffName}<br />{name} 様（{phone}）</p>
      <div className="grid"><button disabled={busy} onClick={() => setStage("form")}>戻る</button><button className="primary" disabled={busy} onClick={submit}>{busy ? "予約を確定中…" : "予約を確定する"}</button></div>
    </>}
  </section>;
}
