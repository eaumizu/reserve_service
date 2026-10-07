"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminReservation } from "../lib/reservations/types";

type Options = {
  staff: { id: string; name: string }[];
  links: { staffId: string; serviceId: string }[];
};
const japanTime = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

export function AdminRescheduleForm({ auth, reservation, onChanged, onClose, onBusy }: {
  auth: SupabaseClient; reservation: AdminReservation; onChanged: () => Promise<void>;
  onClose: () => void; onBusy: (busy: boolean) => void;
}) {
  const [options, setOptions] = useState<Options>();
  const [staffId, setStaffId] = useState(reservation.staff_id);
  const [date, setDate] = useState(new Date(Date.parse(reservation.start_at) + 9 * 3600000).toISOString().slice(0, 10));
  const [start, setStart] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [version, setVersion] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function loadOptions() {
      try {
        const { data: { session } } = await auth.auth.getSession();
        if (!active) return;
        if (!session) { await auth.auth.signOut(); return; }
        const response = await fetch("/api/admin/booking-options", {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal,
        });
        const result = await response.json();
        if (!active) return;
        if (!response.ok) {
          if (response.status === 401) await auth.auth.signOut();
          throw new Error(result.error);
        }
        setOptions(result);
      } catch { if (active) setOptionsError("担当者を取得できませんでした。一度閉じて開き直してください。"); }
    }
    void loadOptions();
    return () => { active = false; controller.abort(); };
  }, [auth]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setStart(""); setSlots([]); setError(""); setConfirmed(false);
    if (!date || !staffId) { setLoading(false); return; }
    setLoading(true);
    async function loadSlots() {
      try {
        const { data: { session } } = await auth.auth.getSession();
        if (!active) return;
        if (!session) { await auth.auth.signOut(); return; }
        const query = new URLSearchParams({ serviceId: reservation.service_id, staffId, date, reservationId: reservation.id });
        const response = await fetch(`/api/admin/availability?${query}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal,
        });
        const result = await response.json();
        if (!active) return;
        if (!response.ok) {
          if (response.status === 401) await auth.auth.signOut();
          throw new Error(result.error);
        }
        setSlots(result.slots);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "空き時間を取得できませんでした。"); }
      finally { if (active) setLoading(false); }
    }
    void loadSlots();
    return () => { active = false; controller.abort(); };
  }, [auth, reservation.id, reservation.service_id, staffId, date, version]);

  function resetSelection() { setStart(""); setSlots([]); setConfirmed(false); setError(""); }
  const unchanged = staffId === reservation.staff_id && !!start && Date.parse(start) === Date.parse(reservation.start_at);
  const eligibleStaff = options?.staff.filter(person => options.links.some(link => link.staffId === person.id && link.serviceId === reservation.service_id)) ?? [];
  const valid = !!options && eligibleStaff.some(person => person.id === staffId) && !!start && slots.includes(start) && !unchanged;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || !valid) return;
    if (!confirmed) { setError(""); setConfirmed(true); return; }
    setBusy(true); onBusy(true); setError("");
    try {
      const { data: { session } } = await auth.auth.getSession();
      if (!session) { await auth.auth.signOut(); return; }
      const response = await fetch("/api/admin/reservations/reschedule", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ reservationId: reservation.id, staffId, startAt: start, expectedUpdatedAt: reservation.updated_at }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) await auth.auth.signOut();
        if (response.status === 409 || response.status === 404) {
          setConfirmed(false); setStart(""); setSlots([]);
        }
        throw new Error(result.error ?? "変更結果を確認できません。一覧を更新してください。");
      }
      await onChanged();
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : "通信エラーです。一覧を更新して変更結果を確認してください。");
    } finally { setBusy(false); onBusy(false); }
  }

  return <form onSubmit={submit} className="card" aria-label="予約日時・担当者の変更">
    <h2>予約日時・担当者の変更</h2>
    <p>{reservation.customers?.name} 様 ／ {reservation.services?.name}</p>
    <p>変更前：{japanTime(reservation.start_at)}（日本時間） ／ {reservation.staff?.name}</p>
    {optionsError && <p className="error" role="alert">{optionsError}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {confirmed ? <>
      <p>変更後：{japanTime(start)}（日本時間） ／ {eligibleStaff.find(person => person.id === staffId)?.name}</p>
      <p>お客様・メニュー・受付経路はそのままです。</p>
      <div className="grid"><button type="button" disabled={busy} onClick={() => setConfirmed(false)}>戻る</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? "変更中…" : "変更を確定する"}</button></div>
    </> : <>
      <label>変更後の担当者<select required value={staffId} disabled={!options || busy} onChange={e => { resetSelection(); setStaffId(e.target.value); }}>
        <option value="">選んでください</option>{eligibleStaff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>変更後の予約日（日本時間）<input type="date" required value={date} onChange={e => { resetSelection(); setDate(e.target.value); }} /></label>
      <label>変更後の開始時間（日本時間）<select required value={start} disabled={loading || !slots.length || busy} onChange={e => setStart(e.target.value)}>
        <option value="">{loading ? "空き時間を確認中…" : "空き時間を選んでください"}</option>
        {slots.map(slot => <option key={slot} value={slot}>{new Date(slot).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}</option>)}
      </select></label>
      {!loading && !error && date && staffId && !slots.length && <p>この日に変更できる時間はありません。</p>}
      {unchanged && <p>変更後の日時または担当者を選んでください。</p>}
      <p className="muted">15分刻みの空き枠から選択してください。変更に失敗した場合、元の予約はそのまま残ります。</p>
      <button type="button" disabled={busy || loading || !staffId || !date} onClick={() => { resetSelection(); setVersion(value => value + 1); }}>空き時間を更新</button>
      <div className="grid"><button type="button" disabled={busy} onClick={onClose}>閉じる</button>
        <button type="submit" className="primary" disabled={busy || loading || !valid}>変更内容を確認する</button></div>
    </>}
  </form>;
}
