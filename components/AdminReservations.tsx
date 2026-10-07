"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminBookingForm } from "./AdminBookingForm";
import { AdminRescheduleForm } from "./AdminRescheduleForm";
import { AdminStoreSettings } from "./AdminStoreSettings";
import { AdminAvailabilityBlocks } from "./AdminAvailabilityBlocks";
import type { AdminReservation as Reservation } from "../lib/reservations/types";

const statuses: Record<string, string> = { confirmed: "確定", cancelled: "キャンセル", completed: "完了", no_show: "来店なし" };
const sources: Record<string, string> = { web: "Web", phone: "電話", walk_in: "店頭", admin: "管理" };
const japanToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
type ListFilters = { date: string; staffId: string };
type ListStaff = { id: string; name: string; active: boolean };

export function AdminReservations() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [auth] = useState(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  });
  const [loggedIn, setLoggedIn] = useState(false);
  const [rows, setRows] = useState<Reservation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
  const [changeTarget, setChangeTarget] = useState<Reservation | null>(null);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [filters, setFilters] = useState<ListFilters>(() => ({ date: japanToday(), staffId: "" }));
  const [listStaff, setListStaff] = useState<ListStaff[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const loadSequence = useRef(0);

  useEffect(() => {
    if (!auth) return;
    const { data: { subscription } } = auth.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { loadSequence.current++; setRows([]); setListStaff([]); setHasMore(false); setLoggedIn(false); setCancelTarget(null); setChangeTarget(null); setSuccess(""); setCanManageSettings(false); setShowSettings(false); setShowBlocks(false); }
    });
    return () => subscription.unsubscribe();
  }, [auth]);

  async function load(selected = filters, selectedPage = page) {
    const sequence = ++loadSequence.current;
    const { data: { session } } = await auth!.auth.getSession();
    if (sequence !== loadSequence.current) return;
    if (!session) { setRows([]); setLoggedIn(false); throw new Error("再度ログインしてください。"); }
    const params = new URLSearchParams({ page: String(selectedPage) });
    if (selected.date) params.set("date", selected.date);
    if (selected.staffId) params.set("staffId", selected.staffId);
    const response = await fetch(`/api/admin/reservations?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
    });
    const result = await response.json();
    if (sequence !== loadSequence.current) return;
    if (!response.ok) {
      setRows([]);
      if (response.status === 401) { await auth!.auth.signOut(); setLoggedIn(false); }
      throw new Error(result.error ?? "予約一覧を取得できませんでした。");
    }
    if (!result.reservations.length && selectedPage > 0) { await load(selected, 0); return; }
    setRows(result.reservations);
    setListStaff(result.staff);
    setHasMore(result.hasMore === true);
    setPage(selectedPage);
    setFilters(selected);
    setCanManageSettings(result.canManageSettings === true);
    if (!result.canManageSettings) { setShowSettings(false); setShowBlocks(false); }
    setLoggedIn(true);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true); setError(""); setSuccess(""); setCancelTarget(null); setChangeTarget(null); setRows([]);
    try {
      const { error: authError } = await auth.auth.signInWithPassword({ email, password });
      setPassword("");
      if (authError) throw new Error("メールアドレスまたはパスワードを確認してください。");
      await load({ date: japanToday(), staffId: "" }, 0);
    } catch (e) { setError(e instanceof Error ? e.message : "ログインできませんでした。"); }
    finally { setBusy(false); }
  }

  async function refresh(selected = filters, selectedPage = page) {
    setBusy(true); setError(""); setSuccess(""); setCancelTarget(null); setChangeTarget(null); setRows([]);
    try { await load(selected, selectedPage); }
    catch (e) { setError(e instanceof Error ? e.message : "予約一覧を取得できませんでした。"); }
    finally { setBusy(false); }
  }

  async function logout() {
    loadSequence.current++;
    setRows([]); setListStaff([]); setHasMore(false); setLoggedIn(false); setError(""); setSuccess(""); setCancelTarget(null); setChangeTarget(null);
    setCanManageSettings(false); setShowSettings(false); setShowBlocks(false);
    await auth!.auth.signOut();
  }

  async function reservationChanged() {
    setChangeTarget(null); setRows([]); setError("");
    setSuccess("予約日時・担当者を変更しました。");
    try { await load(); }
    catch { setError("変更は完了しましたが、一覧を取得できません。「更新」を押してください。"); }
  }

  async function cancelReservation() {
    if (!cancelTarget || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const { data: { session } } = await auth!.auth.getSession();
      if (!session) { await logout(); return; }
      const response = await fetch("/api/admin/reservations", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ reservationId: cancelTarget.id, status: "cancelled" }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) await logout();
        throw new Error(result.error ?? "キャンセルできませんでした。一覧を更新してください。");
      }
      setCancelTarget(null); setRows([]);
      setSuccess("予約をキャンセルしました。この時間は再び予約可能になります。");
      try { await load(); }
      catch { setError("キャンセルは完了しましたが、一覧の取得に失敗しました。「更新」を押してください。"); }
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : "通信エラーです。一覧を更新して予約状態を確認してください。");
    } finally { setBusy(false); }
  }

  if (!auth) return <section className="card"><p>管理画面の接続設定が不足しています。</p></section>;
  return <section className="card">
    {error && <p className="error" role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
    {!loggedIn ? <form onSubmit={login}>
      <h2>スタッフログイン</h2>
      <label>メールアドレス<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>パスワード<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="primary" disabled={busy} type="submit">{busy ? "確認中…" : "ログイン"}</button>
    </form> : <>
      <div className="grid">
        <button disabled={busy} onClick={async () => { setShowSettings(false); setShowBlocks(false); await refresh(); }}>予約一覧を更新</button>
        {canManageSettings && <>
          <button className={showSettings ? "selected" : ""} disabled={busy} onClick={() => { setCancelTarget(null); setChangeTarget(null); setError(""); setSuccess(""); setShowBlocks(false); setShowSettings(!showSettings); }}> {showSettings ? "予約一覧に戻る" : "店舗設定"} </button>
          <button className={showBlocks ? "selected" : ""} disabled={busy} onClick={() => { setCancelTarget(null); setChangeTarget(null); setError(""); setSuccess(""); setShowSettings(false); setShowBlocks(!showBlocks); }}> {showBlocks ? "予約一覧に戻る" : "受付停止・臨時休業"} </button>
        </>}
        <button disabled={busy} onClick={logout}>ログアウト</button>
      </div>
      {showSettings && canManageSettings ? <AdminStoreSettings auth={auth} onBusy={setBusy} /> : showBlocks && canManageSettings ? <AdminAvailabilityBlocks auth={auth} onBusy={setBusy} /> : <>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <AdminBookingForm auth={auth} onCreated={refresh} onBusy={setBusy} />
      </fieldset>
      {changeTarget && <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <AdminRescheduleForm key={changeTarget.id} auth={auth} reservation={changeTarget}
          onChanged={reservationChanged} onClose={() => setChangeTarget(null)} onBusy={setBusy} />
      </fieldset>}
      {cancelTarget && <section className="card" aria-label="予約キャンセルの確認">
        <h2>この予約をキャンセルしますか？</h2>
        <p>{cancelTarget.customers?.name} 様 ／ {cancelTarget.services?.name}</p>
        <p>{new Date(cancelTarget.start_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間） ／ {cancelTarget.staff?.name}</p>
        <p>予約履歴は残ります。キャンセルすると、この時間は再び予約可能になります。</p>
        <div className="grid"><button disabled={busy} onClick={() => setCancelTarget(null)}>戻る</button>
          <button disabled={busy} onClick={cancelReservation}>{busy ? "処理中…" : "キャンセルを確定する"}</button></div>
      </section>}
      <section className="card" aria-label="予約一覧の絞り込み">
        <h2>予約一覧</h2>
        <div className="grid">
          <button type="button" disabled={busy} onClick={() => refresh({ ...filters, date: japanToday() }, 0)}>今日</button>
          <button type="button" disabled={busy} onClick={() => refresh({ ...filters, date: "" }, 0)}>全期間</button>
          <label>予約日（日本時間）<input type="date" disabled={busy} value={filters.date} onChange={e => { if (e.target.value) void refresh({ ...filters, date: e.target.value }, 0); }} /></label>
          <label>担当スタッフ<select disabled={busy} value={filters.staffId} onChange={e => refresh({ ...filters, staffId: e.target.value }, 0)}>
            <option value="">全スタッフ</option>
            {listStaff.map(person => <option key={person.id} value={person.id}>{person.name}{!person.active && "（受付停止中）"}</option>)}
          </select></label>
        </div>
        <p className="muted">{filters.date || "全期間"} ／ {filters.staffId ? listStaff.find(person => person.id === filters.staffId)?.name ?? "選択したスタッフ" : "全スタッフ"}。開始時刻の早い順で表示します。</p>
      </section>
      <p className="muted">日時はすべて日本時間です。1ページ100件まで表示します。キャンセル済みの予約も含みます。</p>
      <div style={{ overflowX: "auto" }}><table className="admin-table">
        <thead><tr><th>日時</th><th>お客様</th><th>メニュー</th><th>担当</th><th>状態</th><th>経路</th><th>操作</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td>{new Date(r.start_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
          <td>{r.customers?.name}</td><td>{r.services?.name}</td><td>{r.staff?.name}</td>
          <td>{statuses[r.status] ?? r.status}</td><td>{sources[r.source] ?? r.source}</td>
          <td>{r.status === "confirmed" ? <div className="grid">
            <button disabled={busy} onClick={() => { setError(""); setSuccess(""); setCancelTarget(null); setChangeTarget(r); }}>変更</button>
            <button disabled={busy} onClick={() => { setError(""); setSuccess(""); setChangeTarget(null); setCancelTarget(r); }}>キャンセル</button>
          </div> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
      {!busy && !rows.length && <p>この条件に一致する予約はありません。</p>}
      <div className="grid" aria-label="予約一覧のページ送り">
        <button disabled={busy || page === 0} onClick={() => refresh(filters, page - 1)}>前のページ</button>
        <p aria-live="polite">{page + 1}ページ目{!busy && `・${rows.length}件`}</p>
        <button disabled={busy || !hasMore} onClick={() => refresh(filters, page + 1)}>次のページ</button>
      </div>
      </>}
    </>}
  </section>;
}
