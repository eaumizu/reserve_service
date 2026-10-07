"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SettingsChange, SettingsHour, SettingsService, SettingsStaff, StoreSettings } from "../lib/store-settings";

type Save = (change: SettingsChange) => Promise<boolean>;
const newService = () => ({ name: "", duration_minutes: 30, buffer_before: 0, buffer_after: 10, price: 0, active: true, online_bookable: true });
const weekdays = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
const times = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

function StoreNameEditor({ name, save }: { name: string; save: Save }) {
  const [value, setValue] = useState(name);
  return <form className="card" onSubmit={e => { e.preventDefault(); void save({ kind: "store", data: { name: value } }); }}>
    <h2>店舗名</h2><label>予約サイトに表示する店舗名<input required maxLength={100} value={value} onChange={e => setValue(e.target.value)} /></label>
    <button type="submit" className="primary">店舗名を保存</button>
  </form>;
}

function ServiceEditor({ service, save }: { service?: SettingsService; save: Save }) {
  const [draft, setDraft] = useState<Omit<SettingsService, "id"> & { id?: string }>(service ?? newService());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await save({ kind: "service", data: draft }) && !service) setDraft(newService());
  }
  return <form className="card" onSubmit={submit}>
    <h3>{service ? service.name : "新しいメニューを追加"}</h3>
    <label>メニュー名<input required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    <div className="grid">
      <label>料金（円）<input required type="number" min={0} max={10000000} step={1} value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.valueAsNumber })} /></label>
      <label>施術時間（分）<input required type="number" min={1} max={1440} step={1} value={draft.duration_minutes} onChange={e => setDraft({ ...draft, duration_minutes: e.target.valueAsNumber })} /></label>
      <label>施術前の準備時間（分）<input required type="number" min={0} max={1440} step={1} value={draft.buffer_before} onChange={e => setDraft({ ...draft, buffer_before: e.target.valueAsNumber })} /></label>
      <label>施術後の片付け時間（分）<input required type="number" min={0} max={1440} step={1} value={draft.buffer_after} onChange={e => setDraft({ ...draft, buffer_after: e.target.valueAsNumber })} /></label>
    </div>
    <label className="checkline"><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} />予約受付を有効にする</label>
    <label className="checkline"><input type="checkbox" checked={draft.online_bookable} onChange={e => setDraft({ ...draft, online_bookable: e.target.checked })} />Web予約で公開する</label>
    <button type="submit" className="primary">{service ? "メニューを保存" : "メニューを追加"}</button>
  </form>;
}

function StaffEditor({ person, services, assignments, save }: {
  person?: SettingsStaff; services: SettingsService[]; assignments: string[]; save: Save;
}) {
  const [name, setName] = useState(person?.name ?? "");
  const [active, setActive] = useState(person?.active ?? true);
  const [serviceIds, setServiceIds] = useState(assignments);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await save({ kind: "staff", data: { ...(person ? { id: person.id } : {}), name, active, serviceIds } }) && !person) {
      setName(""); setActive(true); setServiceIds([]);
    }
  }
  return <form className="card" onSubmit={submit}>
    <h3>{person ? person.name : "新しいスタッフを追加"}</h3>
    <label>スタッフ名<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
    <label className="checkline"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />新規予約の担当を有効にする</label>
    <p>対応メニュー</p>
    {services.map(service => <label className="checkline" key={service.id}>
      <input type="checkbox" checked={serviceIds.includes(service.id)} onChange={e => setServiceIds(e.target.checked ? [...serviceIds, service.id] : serviceIds.filter(id => id !== service.id))} />
      {service.name}{!service.active && "（停止中）"}
    </label>)}
    {!serviceIds.length && <p className="muted">対応メニューを選ぶまで、新規予約の担当者として表示されません。</p>}
    <button type="submit" className="primary">{person ? "スタッフを保存" : "スタッフを追加"}</button>
  </form>;
}

function HoursEditor({ hours, save }: { hours: SettingsHour[]; save: Save }) {
  const [draft, setDraft] = useState(hours);
  function change(index: number, field: "start_time" | "end_time", value: string) {
    setDraft(draft.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }
  return <form className="card" onSubmit={e => { e.preventDefault(); void save({ kind: "hours", data: { hours: draft } }); }}>
    <h2>営業時間・定休日</h2>
    <p className="muted">すべて日本時間です。昼休みがある日は時間帯を分けて登録できます。</p>
    {[1, 2, 3, 4, 5, 6, 0].map(day => <section key={day}>
      <h3>{weekdays[day]}</h3>
      <label className="checkline"><input type="checkbox" checked={!draft.some(row => row.weekday === day)}
        onChange={e => setDraft(e.target.checked ? draft.filter(row => row.weekday !== day) : [...draft, { weekday: day, start_time: "09:00", end_time: "18:00" }])} />定休日</label>
      {draft.map((row, index) => row.weekday === day && <div className="grid" key={index}>
        <label>開始<select value={row.start_time} onChange={e => change(index, "start_time", e.target.value)}>
          {!times.includes(row.start_time) && <option value={row.start_time}>{row.start_time}</option>}
          {times.map(time => <option key={time}>{time}</option>)}
        </select></label>
        <label>終了<select value={row.end_time} onChange={e => change(index, "end_time", e.target.value)}>
          {!times.includes(row.end_time) && <option value={row.end_time}>{row.end_time}</option>}
          {times.map(time => <option key={time}>{time}</option>)}
        </select></label>
        <button type="button" onClick={() => setDraft(draft.filter((_, i) => i !== index))}>この時間帯を削除</button>
      </div>)}
      {draft.some(row => row.weekday === day) && <button type="button" onClick={() => setDraft([...draft, { weekday: day, start_time: "13:00", end_time: "18:00" }])}>時間帯を追加</button>}
    </section>)}
    {!draft.length && <p className="error">全曜日が定休日です。保存すると新しい空き枠は表示されません。</p>}
    <p className="muted">既存予約が営業時間外になる変更は保存できません。</p>
    <button type="submit" className="primary">営業時間を保存</button>
  </form>;
}

export function AdminStoreSettings({ auth, onBusy }: { auth: SupabaseClient; onBusy: (busy: boolean) => void }) {
  const [settings, setSettings] = useState<StoreSettings>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editorVersion, setEditorVersion] = useState(0);
  const inFlight = useRef(false);

  async function request(init?: RequestInit) {
    const { data: { session } } = await auth.auth.getSession();
    if (!session) { await auth.auth.signOut(); throw new Error("再度ログインしてください。"); }
    const response = await fetch("/api/admin/settings", {
      ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) await auth.auth.signOut();
      throw new Error(result.error ?? "設定を取得できませんでした。");
    }
    return result;
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const { data: { session } } = await auth.auth.getSession();
        if (!active) return;
        if (!session) { await auth.auth.signOut(); return; }
        const response = await fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!active) return;
        if (!response.ok) { if (response.status === 401) await auth.auth.signOut(); throw new Error(result.error); }
        setSettings(result);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "店舗設定を取得できませんでした。"); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [auth]);

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError(""); setSuccess("");
    try { setSettings(await request()); setEditorVersion(value => value + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "店舗設定を取得できませんでした。"); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }

  async function save(change: SettingsChange) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); onBusy(true); setError(""); setSuccess("");
    try {
      await request({ method: "POST", body: JSON.stringify(change) });
      setSuccess("設定を保存しました。");
      try { setSettings(await request()); }
      catch { setError("保存は完了しましたが再取得に失敗しました。設定を再読み込みして確認してください。"); }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "通信エラーです。保存結果を確認してから再操作してください。"); return false; }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }

  return <section aria-label="店舗設定">
    <h2>店舗設定</h2>
    <p className="muted">各項目の「保存」で反映します。新しいメニューを追加した後は、スタッフの対応メニューも設定してください。</p>
    {error && <p className="error" role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
    <button type="button" disabled={busy || loading} onClick={reload}>設定を再読み込み（未保存の入力は戻ります）</button>
    {loading ? <p>設定を読み込み中…</p> : settings && <fieldset disabled={busy} key={editorVersion} style={{ border: 0, padding: 0, margin: 0 }}>
      <StoreNameEditor name={settings.store.name} save={save} />
      <h2>メニュー</h2>
      <p className="muted">予約履歴があるメニューの施術時間・準備時間は変更できません。時間を変える場合は新しいメニューを追加してください。受付を停止しても予約履歴は残ります。</p>
      {settings.services.map(service => <ServiceEditor key={service.id} service={service} save={save} />)}
      <ServiceEditor save={save} />
      <h2>スタッフ・対応メニュー</h2>
      <p className="muted">スタッフを停止しても既存予約は残ります。Supabaseのログインアカウントとは別の担当者設定です。</p>
      {settings.staff.map(person => <StaffEditor key={person.id} person={person} services={settings.services} assignments={settings.links.filter(link => link.staff_id === person.id).map(link => link.service_id)} save={save} />)}
      <StaffEditor services={settings.services} assignments={[]} save={save} />
      <HoursEditor hours={settings.hours} save={save} />
    </fieldset>}
  </section>;
}
