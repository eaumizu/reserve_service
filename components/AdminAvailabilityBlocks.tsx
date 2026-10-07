"use client";

import { CLOCK_TIMES } from "../lib/reservations/time-grid";
import { adjustBlockEnd, blockEndTimes, minimumBlockEndDate } from "../lib/block-form-times";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAvailabilityBlock, type AvailabilityBlock, type BlockStaff } from "../lib/availability-blocks";

const times = CLOCK_TIMES;
const japanToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const format = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
type Draft = { staffId: string | null; startDate: string; endDate: string; startTime: string; endTime: string; reason: string };
type BlockList = { blocks: AvailabilityBlock[]; staff: BlockStaff[]; truncated: boolean };

export function AdminAvailabilityBlocks({ auth, onBusy }: { auth: SupabaseClient; onBusy: (busy: boolean) => void }) {
  const [date, setDate] = useState(japanToday);
  const [draft, setDraft] = useState<Draft>(() => ({ staffId: null, startDate: japanToday(), endDate: japanToday(), startTime: "12:00", endTime: "13:00", reason: "" }));
  const [allDay, setAllDay] = useState(false);
  const [data, setData] = useState<BlockList>();
  const [review, setReview] = useState<Draft | null>(null);
  const [remove, setRemove] = useState<AvailabilityBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inFlight = useRef(false);

  function changePeriod(changes: Partial<Draft>) {
    setReview(null);
    setDraft(previous => adjustBlockEnd({ ...previous, ...changes }, allDay));
  }
  const endTimes = blockEndTimes(draft);
  const minEndDate = minimumBlockEndDate(draft.startDate, draft.startTime, allDay);

  async function request(path: string, init?: RequestInit) {
    const { data: { session } } = await auth.auth.getSession();
    if (!session) { await auth.auth.signOut(); throw new Error("再度ログインしてください。"); }
    const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` } });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) await auth.auth.signOut();
      throw new Error(result.error ?? "操作できませんでした。");
    }
    return result;
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setData(undefined); setError(""); setRemove(null);
    async function load() {
      try {
        const { data: { session } } = await auth.auth.getSession();
        if (!active) return;
        if (!session) { await auth.auth.signOut(); return; }
        const response = await fetch(`/api/admin/blocks?date=${encodeURIComponent(date)}`, { cache: "no-store", headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal });
        const result = await response.json();
        if (!active) return;
        if (!response.ok) { if (response.status === 401) await auth.auth.signOut(); throw new Error(result.error); }
        setData(result);
      } catch (e) { if (active) setError(e instanceof Error && !(e instanceof TypeError) ? e.message : "受付停止を取得できませんでした。"); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [auth, date]);

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError("");
    try { setData(await request(`/api/admin/blocks?date=${encodeURIComponent(date)}`)); }
    catch (e) { setError(e instanceof Error && !(e instanceof TypeError) ? e.message : "受付停止を取得できませんでした。"); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }

  function preview(event: FormEvent) {
    event.preventDefault(); setError(""); setSuccess("");
    let input = { ...draft };
    if (allDay) {
      const end = new Date(`${draft.endDate}T00:00:00Z`);
      if (!Number.isFinite(end.getTime())) { setError("日付を確認してください。"); return; }
      end.setUTCDate(end.getUTCDate() + 1);
      input = { ...input, startTime: "00:00", endDate: end.toISOString().slice(0, 10), endTime: "00:00" };
    }
    const parsed = parseAvailabilityBlock(input);
    if (!parsed || new Date(parsed.endAt) <= new Date()) { setError("開始・終了日時を確認してください。終了は開始より後の、未来の日時を選択してください。"); return; }
    setReview(input); setRemove(null);
  }

  async function save(action: "create" | "delete") {
    if (inFlight.current || (action === "create" ? !review : !remove)) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError(""); setSuccess("");
    try {
      await request("/api/admin/blocks", { method: action === "create" ? "POST" : "DELETE", body: JSON.stringify(action === "create" ? review : { blockId: remove!.id }) });
      const viewDate = action === "create" ? review!.startDate : date;
      setReview(null); setRemove(null);
      setSuccess(action === "create" ? "受付停止を登録しました。空き枠を再取得すると反映されます。" : "受付停止を解除しました。他の受付停止や予約がなければ、この時間は再び予約可能になります。");
      if (viewDate !== date) setDate(viewDate);
      else {
        try { setData(await request(`/api/admin/blocks?date=${encodeURIComponent(date)}`)); }
        catch { setError("操作は完了しましたが一覧の取得に失敗しました。再読み込みしてください。"); }
      }
    } catch (e) { setError(e instanceof Error && !(e instanceof TypeError) ? e.message : "通信エラーです。一覧を再読み込みして結果を確認してください。"); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }

  const person = (id: string | null) => id === null ? "店舗全体（全スタッフ）" : data?.staff.find(s => s.id === id)?.name ?? "担当者";
  const parsedReview = review ? parseAvailabilityBlock(review) : null;
  return <section aria-label="予約受付の停止">
    <h2>受付停止・臨時休業</h2>
    <p className="muted">すべて日本時間です。登録するとWeb予約・手動予約・予約変更の空き枠から除外されます。既存予約の施術・準備時間と重なる場合は登録できません。</p>
    {error && <p className="error" role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
    <fieldset disabled={busy || loading} style={{ border: 0, margin: 0, padding: 0 }}>
      <form className="card" onSubmit={preview}>
        <h3>受付停止を登録</h3>
        <label>対象<select value={draft.staffId ?? ""} onChange={e => { setReview(null); setDraft({ ...draft, staffId: e.target.value || null }); }}>
          <option value="">店舗全体（全スタッフ）</option>
          {data?.staff.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label className="checkline"><input type="checkbox" checked={allDay} onChange={e => { const checked = e.target.checked; setReview(null); setAllDay(checked); setDraft(previous => adjustBlockEnd(previous, checked)); }} />終日（終了日も含む）</label>
        <div className="grid">
          <label>開始日<input type="date" required value={draft.startDate} onChange={e => changePeriod({ startDate: e.target.value })} /></label>
          <label>終了日<input type="date" required min={minEndDate} value={draft.endDate} onChange={e => changePeriod({ endDate: e.target.value })} /></label>
          {!allDay && <>
            <label>開始時間<select value={draft.startTime} onChange={e => changePeriod({ startTime: e.target.value })}>{times.map(t => <option key={t}>{t}</option>)}</select></label>
            <label>終了時間<select required disabled={!endTimes.length} value={endTimes.includes(draft.endTime) ? draft.endTime : ""} onChange={e => changePeriod({ endTime: e.target.value })}>
              {!endTimes.length && <option value="">開始日と終了日を選択してください</option>}
              {endTimes.map(t => <option key={t}>{t}</option>)}
            </select></label>
          </>}
        </div>
        {!allDay && <p className="muted">終了は開始より後の時刻から選択できます。開始を23:45にすると、終了は翌日0:00以降になります。</p>}
        <label>理由（任意・管理画面のみ表示）<input maxLength={200} placeholder="臨時休業・休憩・研修など" value={draft.reason} onChange={e => { setReview(null); setDraft({ ...draft, reason: e.target.value }); }} /></label>
        <button className="primary" type="submit">内容を確認する</button>
      </form>
      {review && parsedReview && <section className="card" aria-label="受付停止の登録確認">
        <h3>この時間の受付を停止しますか？</h3>
        <p>{person(review.staffId)}</p><p>{format(parsedReview.startAt)} 〜 {format(parsedReview.endAt)}（日本時間）</p>
        {parsedReview.reason && <p>理由：{parsedReview.reason}</p>}
        <div className="grid"><button onClick={() => setReview(null)}>戻る</button><button className="primary" onClick={() => save("create")}>受付停止を確定する</button></div>
      </section>}
      <h3>登録済みの受付停止</h3>
      <label>表示日<input type="date" required value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setSuccess(""); } }} /></label>
      <button type="button" onClick={reload}>一覧を再読み込み</button>
      <p className="muted">選択した日と重なる時間帯を表示します。複数日にまたがる受付停止は、解除すると全期間が解除されます。</p>
      {data?.truncated && <p className="error">200件まで表示しています。解除後に再読み込みすると続きが表示されます。</p>}
      {remove && <section className="card" aria-label="受付停止の解除確認">
        <h3>この受付停止を解除しますか？</h3><p>{person(remove.staff_id)}</p>
        <p>{format(remove.start_at)} 〜 {format(remove.end_at)}（日本時間）</p>{remove.reason && <p>{remove.reason}</p>}
        <div className="grid"><button onClick={() => setRemove(null)}>戻る</button><button onClick={() => save("delete")}>解除を確定する</button></div>
      </section>}
      <div style={{ overflowX: "auto" }}><table className="admin-table">
        <thead><tr><th>期間（日本時間）</th><th>対象</th><th>理由</th><th>操作</th></tr></thead>
        <tbody>{data?.blocks.map(block => <tr key={block.id}>
          <td>{format(block.start_at)} 〜 {format(block.end_at)}</td><td>{person(block.staff_id)}</td><td>{block.reason || "—"}</td>
          <td><button onClick={() => { setRemove(block); setReview(null); setError(""); setSuccess(""); }}>解除</button></td>
        </tr>)}</tbody>
      </table></div>
      {data && !data.blocks.length && <p>この日の受付停止はありません。</p>}
    </fieldset>
    {loading && <p>読み込み中…</p>}
    {busy && <p role="status">処理中…</p>}
  </section>;
}
