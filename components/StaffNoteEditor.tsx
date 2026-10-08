"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type SavedNote = { note: string; version: string | null; updatedAt: string | null };
export function StaffNoteEditor({ auth, reservationId, onBusy }: { auth: SupabaseClient; reservationId: string; onBusy: (busy: boolean) => void }) {
  const [saved, setSaved] = useState<SavedNote>();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dirty = !!saved && draft !== saved.note;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(""); setSuccess(""); setSaved(undefined);
    async function load() {
      try {
        const { data: { session } } = await auth.auth.getSession();
        if (!active) return;
        if (!session) { await auth.auth.signOut(); return; }
        const response = await fetch(`/api/admin/reservations/${reservationId}/note`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!active) return;
        if (!response.ok) { if (response.status === 401) await auth.auth.signOut(); throw new Error(result.error); }
        setSaved(result); setDraft(result.note);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "メモを取得できませんでした。"); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [auth, reservationId, reloadVersion]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!saved || !dirty || busy || loading || draft.length > 2000) return;
    setBusy(true); onBusy(true); setError(""); setSuccess("");
    try {
      const { data: { session } } = await auth.auth.getSession();
      if (!session) { await auth.auth.signOut(); return; }
      const response = await fetch(`/api/admin/reservations/${reservationId}/note`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ note: draft, expectedVersion: saved.version }) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 401) await auth.auth.signOut(); throw new Error(result.error); }
      setSaved(result); setDraft(result.note); setSuccess("スタッフ用メモを保存しました。");
    } catch (e) { setError(e instanceof Error && !(e instanceof TypeError) ? e.message : "保存結果を確認できません。入力内容を控えてから再読み込みしてください。"); }
    finally { setBusy(false); onBusy(false); }
  }
  return <form className="card" onSubmit={save} aria-label="スタッフ用メモの編集">
    <h3>スタッフ用メモ</h3>
    <p className="muted">スタッフだけが確認する申し送りです。予約時の備考とは別に保存します。</p>
    {error && <p className="error" role="alert">{error}</p>}
    {success && <p className="reservation-success" role="status">{success}</p>}
    {loading && <p role="status">メモを読み込み中…</p>}
    <label>スタッフ用メモ（2000文字まで）<textarea rows={6} maxLength={2000} disabled={loading || busy || !saved} value={draft} onChange={e => { setDraft(e.target.value); setSuccess(""); }} /></label>
    <p className="muted">{draft.length}/2000文字{dirty && "・未保存の変更があります"}</p>
    {saved?.updatedAt && <p className="muted">メモの最終更新：{new Date(saved.updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）</p>}
    <div className="grid">
      <button type="submit" className="primary" disabled={loading || busy || !dirty}>{busy ? "保存中…" : "スタッフ用メモを保存"}</button>
      <button type="button" disabled={loading || busy} onClick={() => { if (!dirty || window.confirm("未保存の入力を破棄して、保存済みのメモを読み込みますか？")) setReloadVersion(value => value + 1); }}>現在のメモを再読み込み</button>
    </div>
    <p className="muted">保存前に詳細画面を閉じると、入力内容は保存されません。メモを消す場合は空欄にして保存してください。</p>
  </form>;
}
