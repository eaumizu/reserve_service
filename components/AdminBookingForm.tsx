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
  const [start, setStart] = useState("");
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!options || busy) return;
    if (!confirmed) { setError(""); setSuccess(""); setConfirmed(true); return; }
    setBusy(true); onBusy(true); setError(""); setSuccess("");
    try {
      const { data: { session } } = await auth.auth.getSession();
      if (!session) { await auth.auth.signOut(); return; }
      const response = await fetch("/api/admin/reservations", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ storeId: options.storeId, serviceId, staffId,
          startAt: `${start}:00+09:00`, customerName: name, customerPhone: phone, source, note }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) await auth.auth.signOut();
        throw new Error(result.error ?? "予約を登録できませんでした。");
      }
      setConfirmed(false); setName(""); setPhone(""); setStart(""); setNote("");
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
      <p>{start.replace("T", " ")}（日本時間）</p>
      <p>{name} 様 ／ {phone}</p>
      <p>受付経路：{source === "phone" ? "電話" : source === "walk_in" ? "店頭" : "管理"}</p>
      {note && <p>備考：{note}</p>}
      <div className="grid"><button type="button" disabled={busy} onClick={() => setConfirmed(false)}>戻る</button>
        <button className="primary" disabled={busy} type="submit">{busy ? "登録中…" : "予約を確定する"}</button></div>
    </> : <>
      <label>受付経路<select value={source} onChange={e => setSource(e.target.value)}><option value="phone">電話</option><option value="walk_in">店頭</option><option value="admin">管理</option></select></label>
      <label>メニュー<select required value={serviceId} onChange={e => { setServiceId(e.target.value); setStaffId(""); }}>
        <option value="">選んでください</option>{options.services.map(service => <option key={service.id} value={service.id}>{service.name}（{service.duration_minutes}分）</option>)}
      </select></label>
      <label>担当者<select required value={staffId} onChange={e => setStaffId(e.target.value)}>
        <option value="">選んでください</option>{eligibleStaff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>開始日時（日本時間）<input required type="datetime-local" step="60" value={start} onChange={e => setStart(e.target.value)} /></label>
      <p className="muted">営業時間外や、既存予約と重なる日時は登録できません。</p>
      <label>お名前<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>電話番号<input required type="tel" maxLength={50} value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label>備考（任意）<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button className="primary" type="submit" disabled={busy || !name.trim() || !phone.trim()}>確認画面へ</button>
    </>}
  </form>;
}
