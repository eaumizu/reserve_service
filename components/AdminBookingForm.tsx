"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Options = {
  storeId: string;
  services: { id: string; name: string; duration_minutes: number; price: number }[];
  staff: { id: string; name: string }[];
  links: { staffId: string; serviceId: string }[];
};

export function AdminBookingForm({ auth, onCreated, onBusy }: {
  auth: SupabaseClient; onCreated: () => Promise<void>; onBusy: (busy: boolean) => void;
}) {
  const [options, setOptions] = useState<Options>();
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [slotsVersion, setSlotsVersion] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("phone");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data: { session } } = await auth.auth.getSession();
        if (!session) throw new Error("再度ログインしてください。");
        const response = await fetch("/api/admin/booking-options", {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 401) await auth.auth.signOut();
          throw new Error(result.error);
        }
        if (active) setOptions(result);
      } catch { if (active) setError("予約設定を取得できません。画面の更新後、再度ログインしてください。"); }
    }
    void load();
    return () => { active = false; };
  }, [auth]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setStart(""); setSlots([]); setSlotsError("");
    if (!serviceId || !staffId || !date) { setSlotsLoading(false); return; }
    setSlotsLoading(true);
    async function loadSlots() {
      try {
        const { data: { session } } = await auth.auth.getSession();
        if (!active) return;
        if (!session) { await auth.auth.signOut(); throw new Error("再度ログインしてください。"); }
        const query = new URLSearchParams({ serviceId, staffId, date });
        const response = await fetch(`/api/admin/availability?${query}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal,
        });
        const result = await response.json();
        if (!active) return;
        if (!response.ok) {
          if (response.status === 401) await auth.auth.signOut();
          throw new Error(result.error ?? "空き時間を取得できませんでした。");
        }
        setSlots(result.slots);
      } catch (e) {
        if (active) setSlotsError(e instanceof Error ? e.message : "空き時間を取得できませんでした。");
      } finally { if (active) setSlotsLoading(false); }
    }
    void loadSlots();
    return () => { active = false; controller.abort(); };
  }, [auth, serviceId, staffId, date, slotsVersion]);

  function clearSlot() { setStart(""); setSlots([]); setConfirmed(false); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!options || busy || slotsLoading || !start || !slots.includes(start)) return;
    if (!confirmed) { setError(""); setSuccess(""); setConfirmed(true); return; }
    setBusy(true); onBusy(true); setError(""); setSuccess("");
    try {
      const { data: { session } } = await auth.auth.getSession();
      if (!session) { await auth.auth.signOut(); return; }
      const response = await fetch("/api/admin/reservations", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ storeId: options.storeId, serviceId, staffId,
          startAt: start, customerName: name, customerPhone: phone, source, note }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) await auth.auth.signOut();
        if (response.status === 409) { clearSlot(); setSlotsVersion(version => version + 1); }
        throw new Error(result.error ?? "予約を登録できませんでした。");
      }
      setConfirmed(false); setName(""); setPhone(""); setStart(""); setNote("");
      setSlotsVersion(version => version + 1);
      setSuccess("予約を登録しました。");
      await onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : "通信エラーです。予約一覧を確認してから再操作してください。"); }
    finally { setBusy(false); onBusy(false); }
  }

  const eligibleStaff = options?.staff.filter(person => options.links.some(link => link.serviceId === serviceId && link.staffId === person.id)) ?? [];
  return <form onSubmit={submit}>
    <h2>電話・店頭の予約登録</h2>
    {error && <p className="error" role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
    {!options ? <p>予約設定を読み込み中…</p> : confirmed ? <>
      <p>{options.services.find(service => service.id === serviceId)?.name} ／ {eligibleStaff.find(person => person.id === staffId)?.name}</p>
      <p>{new Date(start).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）</p>
      <p>{name} 様 ／ {phone}</p>
      <p>受付経路：{source === "phone" ? "電話" : source === "walk_in" ? "店頭" : "管理"}</p>
      {note && <p>備考：{note}</p>}
      <div className="grid"><button type="button" disabled={busy} onClick={() => setConfirmed(false)}>戻る</button>
        <button className="primary" disabled={busy} type="submit">{busy ? "登録中…" : "予約を確定する"}</button></div>
    </> : <>
      <label>受付経路<select value={source} onChange={e => setSource(e.target.value)}><option value="phone">電話</option><option value="walk_in">店頭</option><option value="admin">管理</option></select></label>
      <label>メニュー<select required value={serviceId} onChange={e => { clearSlot(); setServiceId(e.target.value); setStaffId(""); }}>
        <option value="">選んでください</option>{options.services.map(service => <option key={service.id} value={service.id}>{service.name}（{service.duration_minutes}分）</option>)}
      </select></label>
      <label>担当者<select required value={staffId} onChange={e => { clearSlot(); setStaffId(e.target.value); }}>
        <option value="">選んでください</option>{eligibleStaff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>予約日（日本時間）<input required type="date" value={date} onChange={e => { clearSlot(); setDate(e.target.value); }} /></label>
      <label>開始時間（日本時間）<select required value={start} disabled={!serviceId || !staffId || !date || slotsLoading || !slots.length} onChange={e => setStart(e.target.value)}>
        <option value="">{slotsLoading ? "空き時間を確認中…" : "空き時間を選んでください"}</option>
        {slots.map(slot => <option key={slot} value={slot}>{new Date(slot).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}</option>)}
      </select></label>
      <p className="muted">15分刻みの空き枠から選択してください。施術時間と前後の準備時間を含めて、予約可能な時間だけ表示します。</p>
      {slotsError && <p className="error" role="alert">{slotsError}</p>}
      {serviceId && staffId && date && !slotsLoading && !slotsError && !slots.length && <p role="status">この日に予約できる時間はありません。</p>}
      <button type="button" disabled={busy || slotsLoading || !serviceId || !staffId || !date} onClick={() => { clearSlot(); setSlotsVersion(version => version + 1); }}>空き時間を更新</button>
      <label>お名前<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>電話番号<input required type="tel" maxLength={50} value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label>備考（任意）<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button className="primary" type="submit" disabled={busy || slotsLoading || !start || !slots.includes(start) || !name.trim() || !phone.trim()}>確認画面へ</button>
    </>}
  </form>;
}
