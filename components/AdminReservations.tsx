"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";
import { AdminBookingForm } from "./AdminBookingForm";

type Reservation = {
  id: string; start_at: string; status: string; source: string;
  customers: { name: string } | null;
  services: { name: string } | null;
  staff: { name: string } | null;
};
const statuses: Record<string, string> = { confirmed: "確定", cancelled: "キャンセル", completed: "完了", no_show: "来店なし" };
const sources: Record<string, string> = { web: "Web", phone: "電話", walk_in: "店頭", admin: "管理" };

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

  useEffect(() => {
    if (!auth) return;
    const { data: { subscription } } = auth.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { setRows([]); setLoggedIn(false); setCancelTarget(null); setSuccess(""); }
    });
    return () => subscription.unsubscribe();
  }, [auth]);

  async function load() {
    const { data: { session } } = await auth!.auth.getSession();
    if (!session) { setRows([]); setLoggedIn(false); throw new Error("再度ログインしてください。"); }
    const response = await fetch("/api/admin/reservations", {
      headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) {
      setRows([]);
      if (response.status === 401) { await auth!.auth.signOut(); setLoggedIn(false); }
      throw new Error(result.error ?? "予約一覧を取得できませんでした。");
    }
    setRows(result.reservations);
    setLoggedIn(true);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true); setError(""); setSuccess(""); setCancelTarget(null); setRows([]);
    try {
      const { error: authError } = await auth.auth.signInWithPassword({ email, password });
      setPassword("");
      if (authError) throw new Error("メールアドレスまたはパスワードを確認してください。");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ログインできませんでした。"); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setError(""); setSuccess(""); setCancelTarget(null); setRows([]);
    try { await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "予約一覧を取得できませんでした。"); }
    finally { setBusy(false); }
  }

  async function logout() {
    setRows([]); setLoggedIn(false); setError(""); setSuccess(""); setCancelTarget(null);
    await auth!.auth.signOut();
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
      <div className="grid"><button disabled={busy} onClick={refresh}>更新</button><button disabled={busy} onClick={logout}>ログアウト</button></div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <AdminBookingForm auth={auth} onCreated={refresh} onBusy={setBusy} />
      </fieldset>
      {cancelTarget && <section className="card" aria-label="予約キャンセルの確認">
        <h2>この予約をキャンセルしますか？</h2>
        <p>{cancelTarget.customers?.name} 様 ／ {cancelTarget.services?.name}</p>
        <p>{new Date(cancelTarget.start_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間） ／ {cancelTarget.staff?.name}</p>
        <p>予約履歴は残ります。キャンセルすると、この時間は再び予約可能になります。</p>
        <div className="grid"><button disabled={busy} onClick={() => setCancelTarget(null)}>戻る</button>
          <button disabled={busy} onClick={cancelReservation}>{busy ? "処理中…" : "キャンセルを確定する"}</button></div>
      </section>}
      <p className="muted">日時はすべて日本時間です。最新100件を表示しています。</p>
      <div style={{ overflowX: "auto" }}><table className="admin-table">
        <thead><tr><th>日時</th><th>お客様</th><th>メニュー</th><th>担当</th><th>状態</th><th>経路</th><th>操作</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td>{new Date(r.start_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
          <td>{r.customers?.name}</td><td>{r.services?.name}</td><td>{r.staff?.name}</td>
          <td>{statuses[r.status] ?? r.status}</td><td>{sources[r.source] ?? r.source}</td>
          <td>{r.status === "confirmed" ? <button disabled={busy} onClick={() => { setError(""); setSuccess(""); setCancelTarget(r); }}>キャンセル</button> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
      {!busy && !rows.length && <p>予約はまだありません。</p>}
    </>}
  </section>;
}
