"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminBookingForm } from "./AdminBookingForm";
import { AdminRescheduleForm } from "./AdminRescheduleForm";
import { AdminStoreSettings } from "./AdminStoreSettings";
import { AdminAvailabilityBlocks } from "./AdminAvailabilityBlocks";
import { CustomerLinkIssuer } from "./CustomerLinkIssuer";
import { StaffNoteEditor } from "./StaffNoteEditor";
import { canRecordOutcome, type ReservationOutcome } from "../lib/reservations/outcome";
import type { AdminReservation as Reservation } from "../lib/reservations/types";

const statuses: Record<string, string> = { confirmed: "確定", cancelled: "キャンセル", completed: "施術完了", no_show: "無断キャンセル" };
const sources: Record<string, string> = { web: "Web", phone: "電話", walk_in: "店頭", admin: "管理" };
const japanToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
type ListFilters = { date: string; staffId: string; search?: string; searchBy?: string; status?: string; scope?: string };
type ReservationView = "list" | "search" | "history" | "unrecorded";
const viewTitles: Record<ReservationView, string> = { list: "予約一覧", search: "予約検索", history: "予約履歴", unrecorded: "結果の記録が必要な予約" };
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
  const [statusTarget, setStatusTarget] = useState<{ reservation: Reservation; status: "cancelled" | ReservationOutcome } | null>(null);
  const [changeTarget, setChangeTarget] = useState<Reservation | null>(null);
  const [detailTarget, setDetailTarget] = useState<Reservation | null>(null);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [view, setView] = useState<ReservationView>("list");
  const [searchStarted, setSearchStarted] = useState(false);
  const listFilters = useRef<ListFilters>({ date: "", staffId: "", scope: "upcoming" });
  const [filters, setFilters] = useState<ListFilters>({ date: "", staffId: "", scope: "upcoming" });
  const [searchText, setSearchText] = useState("");
  const [searchBy, setSearchBy] = useState("name");
  const [listStaff, setListStaff] = useState<ListStaff[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const loadSequence = useRef(0);
  const confirmationRef = useRef<HTMLElement>(null);
  const changeDialogRef = useRef<HTMLDialogElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const target = statusTarget ? confirmationRef.current : success ? successRef.current : null;
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: "center" }); }
  }, [statusTarget, success]);

  useEffect(() => {
    if (changeTarget && changeDialogRef.current && !changeDialogRef.current.open) changeDialogRef.current.showModal();
  }, [changeTarget]);

  useEffect(() => {
    if (detailTarget && detailDialogRef.current && !detailDialogRef.current.open) detailDialogRef.current.showModal();
  }, [detailTarget]);

  useEffect(() => {
    if (!auth) return;
    const { data: { subscription } } = auth.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { loadSequence.current++; setRows([]); setListStaff([]); setHasMore(false); setLoggedIn(false); setStatusTarget(null); setChangeTarget(null); setDetailTarget(null); setSuccess(""); setCanManageSettings(false); setShowSettings(false); setShowBlocks(false); }
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
    if (selected.search) { params.set("q", selected.search); params.set("searchBy", selected.searchBy ?? "name"); }
    if (selected.status) params.set("status", selected.status);
    if (selected.scope) params.set("scope", selected.scope);
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
    setBusy(true); setError(""); setSuccess(""); setStatusTarget(null); setChangeTarget(null); setRows([]);
    try {
      const { error: authError } = await auth.auth.signInWithPassword({ email, password });
      setPassword("");
      if (authError) throw new Error("メールアドレスまたはパスワードを確認してください。");
      await load({ date: "", staffId: "", scope: "upcoming" }, 0);
      setView("list"); setSearchStarted(false); listFilters.current = { date: "", staffId: "", scope: "upcoming" };
      setSearchText(""); setSearchBy("name");
    } catch (e) { setError(e instanceof Error ? e.message : "ログインできませんでした。"); }
    finally { setBusy(false); }
  }

  async function refresh(selected = filters, selectedPage = page) {
    if (view === "search") setSearchStarted(true);
    setDetailTarget(null);
    setBusy(true); setError(""); setSuccess(""); setStatusTarget(null); setChangeTarget(null); setRows([]);
    try { await load(selected, selectedPage); }
    catch (e) { setError(e instanceof Error ? e.message : "予約一覧を取得できませんでした。"); }
    finally { setBusy(false); }
  }

  async function switchView(next: ReservationView) {
    setShowSettings(false); setShowBlocks(false); setStatusTarget(null); setChangeTarget(null); setDetailTarget(null);
    setError(""); setSuccess("");
    if (view === "list") listFilters.current = filters;
    if (next === "search") {
      setView("search"); setSearchStarted(false); setSearchText(""); setSearchBy("name");
      setFilters({ date: "", staffId: "", scope: "all" }); setPage(0); setHasMore(false); setRows([]);
    } else {
      setView(next); setSearchStarted(false);
      await refresh(next === "list" ? { ...listFilters.current, search: "", searchBy: "name", scope: "upcoming" }
        : { date: "", staffId: "", scope: next === "history" ? "history" : "unrecorded" }, 0);
    }
  }

  async function logout() {
    setDetailTarget(null);
    loadSequence.current++;
    setRows([]); setListStaff([]); setHasMore(false); setLoggedIn(false); setError(""); setSuccess(""); setStatusTarget(null); setChangeTarget(null);
    setCanManageSettings(false); setShowSettings(false); setShowBlocks(false);
    await auth!.auth.signOut();
  }

  async function reservationChanged() {
    setChangeTarget(null); setRows([]); setError("");
    setSuccess("予約日時・担当者を変更しました。");
    try { await load(); }
    catch { setError("変更は完了しましたが、一覧を取得できません。「更新」を押してください。"); }
  }

  function openReservationChange(reservation: Reservation) {
    setError(""); setSuccess(""); setStatusTarget(null); setChangeTarget(reservation);
  }

  async function updateReservationStatus() {
    if (!statusTarget || busy) return;
    const { reservation, status } = statusTarget;
    setBusy(true); setError(""); setSuccess("");
    try {
      const { data: { session } } = await auth!.auth.getSession();
      if (!session) { await logout(); return; }
      const response = await fetch("/api/admin/reservations", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ reservationId: reservation.id, status, expectedUpdatedAt: reservation.updated_at }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) await logout();
        throw new Error(result.error ?? "状態を更新できませんでした。一覧を更新してください。");
      }
      setStatusTarget(null);
      setRows(current => current.map(row => row.id === reservation.id ? { ...row, ...result.reservation } : row));
      setSuccess(`${reservation.customers?.name ?? "お客様"} 様の予約を「${statuses[status]}」として保存しました。一覧の状態と操作欄を更新しました。`);
      try { await load(); }
      catch { setError("状態更新は完了しましたが一覧の取得に失敗しました。「予約一覧を更新」を押してください。"); }
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : "通信エラーです。一覧を更新して予約状態を確認してください。");
    } finally { setBusy(false); }
  }

  if (!auth) return <section className="card"><p>管理画面の接続設定が不足しています。</p></section>;
  return <section className="card">
    {error && <p className="error" role="alert">{error}</p>}
    {success && <p ref={successRef} className="reservation-success" role="status" tabIndex={-1}>{success}</p>}
    {!loggedIn ? <form onSubmit={login}>
      <h2>スタッフログイン</h2>
      <label>メールアドレス<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>パスワード<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="primary" disabled={busy} type="submit">{busy ? "確認中…" : "ログイン"}</button>
    </form> : <>
      <nav className="grid" aria-label="予約画面の切り替え">
        <button type="button" className={view === "list" && !showSettings && !showBlocks ? "selected" : ""} disabled={busy} onClick={() => switchView("list")}>予約一覧</button>
        <button type="button" className={view === "search" && !showSettings && !showBlocks ? "selected" : ""} disabled={busy} onClick={() => switchView("search")}>予約検索</button>
        <button type="button" className={view === "history" && !showSettings && !showBlocks ? "selected" : ""} disabled={busy} onClick={() => switchView("history")}>予約履歴</button>
        <button type="button" className={view === "unrecorded" && !showSettings && !showBlocks ? "selected" : ""} disabled={busy} onClick={() => switchView("unrecorded")}>結果の記録が必要な予約</button>
      </nav>
      <div className="grid">
        <button disabled={busy || (view === "search" && !searchStarted)} onClick={async () => { setShowSettings(false); setShowBlocks(false); await refresh(); }}>{view === "search" ? "検索結果を更新" : "予約一覧を更新"}</button>
        {canManageSettings && <>
          <button className={showSettings ? "selected" : ""} disabled={busy} onClick={() => { if (showSettings) { void switchView("list"); return; } setStatusTarget(null); setChangeTarget(null); setError(""); setSuccess(""); setShowBlocks(false); setShowSettings(true); }}> {showSettings ? "予約一覧に戻る" : "店舗設定"} </button>
          <button className={showBlocks ? "selected" : ""} disabled={busy} onClick={() => { if (showBlocks) { void switchView("list"); return; } setStatusTarget(null); setChangeTarget(null); setError(""); setSuccess(""); setShowSettings(false); setShowBlocks(true); }}> {showBlocks ? "予約一覧に戻る" : "受付停止・臨時休業"} </button>
        </>}
        <button disabled={busy} onClick={logout}>ログアウト</button>
      </div>
      {showSettings && canManageSettings ? <AdminStoreSettings auth={auth} onBusy={setBusy} /> : showBlocks && canManageSettings ? <AdminAvailabilityBlocks auth={auth} onBusy={setBusy} /> : <>
      {changeTarget && <dialog ref={changeDialogRef} className="reservation-change-dialog" aria-label="予約日時・担当者の変更"
        onCancel={event => { event.preventDefault(); if (!busy) setChangeTarget(null); }}>
        <button type="button" className="dialog-close" disabled={busy} onClick={() => setChangeTarget(null)}>変更画面を閉じる</button>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <AdminRescheduleForm key={changeTarget.id} auth={auth} reservation={changeTarget}
            onChanged={reservationChanged} onClose={() => setChangeTarget(null)} onBusy={setBusy} />
        </fieldset>
      </dialog>}
      {detailTarget && <dialog ref={detailDialogRef} className="reservation-change-dialog" aria-labelledby="reservation-detail-title"
        onCancel={event => { event.preventDefault(); if (!busy) setDetailTarget(null); }}>
        <button type="button" className="dialog-close" disabled={busy} onClick={() => setDetailTarget(null)}>詳細を閉じる</button>
        <h2 id="reservation-detail-title">予約の詳細</h2>
        <p className="muted">日時はすべて日本時間です。</p>
        <dl className="reservation-details">
          <dt>お客様</dt><dd>{detailTarget.customers?.name ?? "記載なし"}</dd>
          <dt>電話番号</dt><dd>{detailTarget.customers?.phone || "記載なし"}</dd>
          <dt>メールアドレス</dt><dd>{detailTarget.customer_email ? <><span>{detailTarget.customer_email}</span> ／ <a href={`mailto:${encodeURIComponent(detailTarget.customer_email)}`}>メールを作成</a></> : "記載なし"}</dd>
          <dt>メニュー</dt><dd>{detailTarget.services?.name ?? "記載なし"}</dd>
          <dt>担当者</dt><dd>{detailTarget.staff?.name ?? "記載なし"}</dd>
          <dt>施術開始</dt><dd>{new Date(detailTarget.start_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</dd>
          <dt>施術終了</dt><dd>{new Date(detailTarget.end_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</dd>
          <dt>状態</dt><dd><span className={`reservation-status reservation-status-${detailTarget.status}`}>{statuses[detailTarget.status] ?? detailTarget.status}</span></dd>
          <dt>受付経路</dt><dd>{sources[detailTarget.source] ?? detailTarget.source}</dd>
          <dt>予約時の備考</dt><dd className="reservation-note">{detailTarget.note?.trim() || "記載なし"}</dd>
          <dt>最終更新</dt><dd>{new Date(detailTarget.updated_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</dd>
        </dl>
        <CustomerLinkIssuer key={`link-${detailTarget.id}`} auth={auth} reservationId={detailTarget.id} onBusy={setBusy} />
        <StaffNoteEditor key={detailTarget.id} auth={auth} reservationId={detailTarget.id} onBusy={setBusy} />
      </dialog>}
      {statusTarget && <section ref={confirmationRef} tabIndex={-1} className="card reservation-confirmation" aria-label="予約状態の更新確認">
        <h2>{statusTarget.status === "cancelled" ? "この予約をキャンセルしますか？" : `「${statuses[statusTarget.status]}」を記録しますか？`}</h2>
        <p>{statusTarget.reservation.customers?.name} 様 ／ {statusTarget.reservation.services?.name}</p>
        <p>{new Date(statusTarget.reservation.start_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間） ／ {statusTarget.reservation.staff?.name}</p>
        <p>予約履歴は残ります。</p>
        {statusTarget.status === "completed" && <p>施術と片付け時間の終了後に記録できます。</p>}
        {statusTarget.status === "no_show" && <p>予約開始時刻を過ぎても来店がなかった場合に記録します。この予約による空き枠の占有が解除されます。</p>}
        {statusTarget.status === "cancelled" && <p>この予約による空き枠の占有が解除されます。</p>}
        <div className="grid"><button disabled={busy} onClick={() => setStatusTarget(null)}>戻る</button>
          <button disabled={busy} onClick={updateReservationStatus}>{busy ? "処理中…" : `${statuses[statusTarget.status]}を確定する`}</button></div>
      </section>}
      <section className="card" aria-label="予約一覧の絞り込み">
        <h2>{viewTitles[view]}</h2>
        {view === "list" && <p>施術中・これから施術する確定済み予約を、開始時刻の早い順に表示します。終了時刻を過ぎた予約は「結果の記録が必要な予約」、記録済みの予約は「予約履歴」で確認できます。</p>}
        {view === "history" && <p>施術完了・無断キャンセル・キャンセル済みの予約を、新しい予約日時から表示します。</p>}
        {view === "unrecorded" && <p>施術終了時刻を過ぎ、まだ結果が記録されていない予約です。実際の来店結果を確認して「施術完了」「無断キャンセル」などを記録してください。記録後は予約履歴へ移ります。</p>}
        {view === "search" && <form onSubmit={event => { event.preventDefault(); void refresh({ ...filters, search: searchText.trim(), searchBy }, 0); }}>
          <div className="grid">
            <label>検索対象<select disabled={busy} value={searchBy} onChange={e => setSearchBy(e.target.value)}><option value="name">お客様の名前</option><option value="phone">電話番号</option></select></label>
            <label>検索する文字<input type="search" maxLength={100} disabled={busy} value={searchText} onChange={e => setSearchText(e.target.value)} /></label>
          </div>
          <div className="grid"><button type="submit" disabled={busy}>予約を検索</button>
            <button type="button" disabled={busy} onClick={() => { setSearchText(""); setSearchBy("name"); void refresh({ ...filters, search: "", searchBy: "name", status: "" }, 0); }}>検索・状態条件を解除</button></div>
          <p className="muted">名前・電話番号の一部で検索できます。過去や別日の予約を探すときは「全期間」を選んでください。</p>
        </form>}
        <div className="grid">
          <button type="button" disabled={busy} onClick={() => refresh({ ...filters, date: japanToday() }, 0)}>今日</button>
          <button type="button" disabled={busy} onClick={() => refresh({ ...filters, date: "" }, 0)}>全期間</button>
          <label>予約日（日本時間）<input type="date" disabled={busy} value={filters.date} onChange={e => { if (e.target.value) void refresh({ ...filters, date: e.target.value }, 0); }} /></label>
          <label>担当スタッフ<select disabled={busy} value={filters.staffId} onChange={e => refresh({ ...filters, staffId: e.target.value }, 0)}>
            <option value="">全スタッフ</option>
            {listStaff.map(person => <option key={person.id} value={person.id}>{person.name}{!person.active && "（受付停止中）"}</option>)}
          </select></label>
          {(view === "search" || view === "history") && <label>予約状態<select disabled={busy} value={filters.status ?? ""} onChange={e => refresh({ ...filters, status: e.target.value }, 0)}>
            <option value="">全ての状態</option>{Object.entries(statuses).filter(([value]) => view !== "history" || value !== "confirmed").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
        </div>
        <p className="muted">{filters.date || "全期間"} ／ {filters.staffId ? listStaff.find(person => person.id === filters.staffId)?.name ?? "選択したスタッフ" : "全スタッフ"}。{view === "history" ? "新しい予約日時から" : "開始時刻の早い順で"}表示します。</p>
        {view === "search" && <p className="muted" aria-live="polite">検索：{filters.search ? `${filters.searchBy === "phone" ? "電話番号" : "名前"}「${filters.search}」` : "指定なし"} ／ {filters.status ? statuses[filters.status] : "全ての状態"}</p>}
      </section>
      {view === "search" && !searchStarted ? <p>検索条件を入力し「予約を検索」を押してください。初期設定は全期間です。</p> : <>
      {view === "search" && <h2>検索結果</h2>}
      {busy && <p role="status">予約を読み込み中…</p>}
      <p className="muted">日時はすべて日本時間です。1ページ100件まで表示します。</p>
      <p className="muted">施術完了は片付け時間終了後、無断キャンセルは予約開始時刻以降に記録できます。時刻を過ぎたら「予約一覧を更新」を押してください。</p>
      <div style={{ overflowX: "auto" }}><table className="admin-table">
        <thead><tr><th>日時</th><th>お客様</th><th>メニュー</th><th>担当</th><th>状態</th><th>経路</th><th>操作</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td>{new Date(r.start_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
          <td>{r.customers?.name}</td><td>{r.services?.name}</td><td>{r.staff?.name}</td>
          <td><span className={`reservation-status reservation-status-${r.status}`}>{statuses[r.status] ?? r.status}</span></td><td>{sources[r.source] ?? r.source}</td>
          <td><button type="button" disabled={busy} onClick={() => setDetailTarget(r)}>詳細</button>{r.status === "confirmed" ? <div className="grid">
            <button aria-expanded={changeTarget?.id === r.id} aria-controls={changeTarget?.id === r.id ? "reservation-change-form" : undefined} disabled={busy} onClick={() => openReservationChange(r)}>{changeTarget?.id === r.id ? "変更画面を表示中" : "変更"}</button>
            <button disabled={busy} onClick={() => { setError(""); setSuccess(""); setChangeTarget(null); setStatusTarget({ reservation: r, status: "cancelled" }); }}>キャンセル</button>
            <button disabled={busy || !canRecordOutcome(r, "completed")} title="施術と片付け時間の終了後に操作できます" onClick={() => { setError(""); setSuccess(""); setChangeTarget(null); setStatusTarget({ reservation: r, status: "completed" }); }}>施術完了</button>
            <button disabled={busy || !canRecordOutcome(r, "no_show")} title="予約開始時刻以降に操作できます" onClick={() => { setError(""); setSuccess(""); setChangeTarget(null); setStatusTarget({ reservation: r, status: "no_show" }); }}>無断キャンセル</button>
          </div> : <div className="reservation-record">
            <strong>{statuses[r.status] ?? r.status}・記録済み</strong>
            <span>記録日時：{new Date(r.updated_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）</span>
          </div>}</td>
        </tr>)}</tbody>
      </table></div>
      {!busy && !rows.length && <p>この条件に一致する予約はありません。{filters.date && "別の日の予約は「全期間」で確認できます。"}</p>}
      <div className="grid" aria-label="予約一覧のページ送り">
        <button disabled={busy || page === 0} onClick={() => refresh(filters, page - 1)}>前のページ</button>
        <p aria-live="polite">{page + 1}ページ目{!busy && `・${rows.length}件`}</p>
        <button disabled={busy || !hasMore} onClick={() => refresh(filters, page + 1)}>次のページ</button>
      </div>
      </>}
      {view === "list" && <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <AdminBookingForm auth={auth} onCreated={refresh} onBusy={setBusy} />
      </fieldset>}
      </>}
    </>}
  </section>;
}
