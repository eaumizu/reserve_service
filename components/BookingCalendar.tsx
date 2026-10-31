"use client";
import { useEffect, useState } from "react";
import type { BookingRules } from "../lib/booking-rules";
import type { DateSlot } from "../lib/reservations/date-availability";

export type BookingService = { id: string; name: string; duration_minutes: number; price: number };
export type CalendarChoice = { service: BookingService; slot: DateSlot; date: string };
type Rules = BookingRules & { minDate: string; maxDate: string };
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const dayLabel = (day: string) => new Date(`${day}T00:00:00+09:00`).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });
const timeLabel = (start: string) => new Date(start).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });

export function BookingCalendar({ services, rules, initialDate, onChoose }: { services: BookingService[]; rules: Rules; initialDate?: string; onChoose: (choice: CalendarChoice) => void }) {
  const firstDay = initialDate && initialDate >= rules.minDate && initialDate <= rules.maxDate ? initialDate : rules.minDate;
  const [date, setDate] = useState(firstDay);
  const [week, setWeek] = useState(firstDay);
  const [slots, setSlots] = useState<DateSlot[]>([]);
  const [start, setStart] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true, inFlight = false;
    const controller = new AbortController();
    setSlots([]); setLoading(true); setError("");
    async function refresh() {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true; setLoading(true);
      try {
        const response = await fetch(`/api/date-availability?date=${date}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.slots)) throw new Error(result.error ?? "空き枠を取得できません。");
        if (active) { setSlots(result.slots); setError(""); }
      } catch (e) {
        if (active) { setSlots([]); setError(e instanceof Error ? e.message : "空き枠を取得できません。"); }
      } finally { inFlight = false; if (active) setLoading(false); }
    }
    const resume = () => void refresh();
    void refresh();
    const timer = window.setInterval(resume, 30000);
    window.addEventListener("focus", resume); window.addEventListener("pageshow", resume); document.addEventListener("visibilitychange", resume);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", resume); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume); };
  }, [date, version]);
  function chooseDay(value: string) { if (value !== date) { setSlots([]); setLoading(true); } setDate(value); setStart(""); setServiceId(""); setStaffId(""); }
  function moveWeek(count: number) {
    const next = addDays(week, count), bounded = next < rules.minDate ? rules.minDate : next;
    setWeek(bounded); chooseDay(bounded);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter(d => d <= rules.maxDate);
  const times = [...new Set(slots.map(s => s.startAt))].sort();
  const menus = services.filter(s => slots.some(slot => slot.startAt === start && slot.serviceId === s.id));
  const staff = slots.filter(s => s.startAt === start && s.serviceId === serviceId);
  const choice = staff.find(s => s.staffId === staffId);
  const menu = menus.find(s => s.id === serviceId);
  return <div className="booking-calendar">
    <h3>1. 日付と空いている時間を選ぶ</h3>
    <p className="muted">日時は日本時間です。空き時間を選ぶと、その時間に予約できるメニューを確認できます。</p>
    <div className="calendar-navigation">
      <button type="button" disabled={week <= rules.minDate} onClick={() => moveWeek(-7)}>前の7日間</button>
      <button type="button" disabled={addDays(week, 7) > rules.maxDate} onClick={() => moveWeek(7)}>次の7日間</button>
    </div>
    <div className="calendar-days" role="group" aria-label="予約日を選択">
      {days.map(day => <button type="button" key={day} aria-label={dayLabel(day)} aria-pressed={date === day} className={date === day ? "selected" : ""} onClick={() => chooseDay(day)}><span aria-hidden="true">{Number(day.slice(5, 7))}/{Number(day.slice(8))}<strong>{new Date(`${day}T00:00:00+09:00`).toLocaleDateString("ja-JP", { weekday: "short", timeZone: "Asia/Tokyo" })}</strong></span></button>)}
    </div>
    <label>日付を指定する<input type="date" min={rules.minDate} max={rules.maxDate} value={date} onChange={e => {
      const value = e.target.value;
      if (value >= rules.minDate && value <= rules.maxDate) { setWeek(value); chooseDay(value); }
    }}/></label>
    <h3>{dayLabel(date)}の空き時間</h3>
    <p className="muted">表示しているのは開始時刻です。予約できるメニューは時間によって異なります。</p>
    {loading && <p role="status">空き枠を確認しています…</p>}
    {error && <div role="alert"><p className="error">{error}</p><button type="button" onClick={() => setVersion(v => v + 1)}>もう一度確認する</button></div>}
    <div className="calendar-times" role="group" aria-label="空いている開始時刻" aria-busy={loading}>
      {times.map(time => <button type="button" key={time} disabled={loading} aria-pressed={start === time} className={start === time ? "selected" : ""} onClick={() => { setStart(time); setServiceId(""); setStaffId(""); }}>{timeLabel(time)}</button>)}
    </div>
    {!loading && !error && !times.length && <p role="status">この日に受付できる空き枠はありません。別の日付を選択してください。</p>}
    {start && <section className="calendar-menu" aria-label="選択した時間のメニュー">
      <h3>2. メニューを確認する</h3>
      <p>{dayLabel(date)} {timeLabel(start)} 開始</p>
      {!menus.length && !loading && !error && <p role="alert" className="error">選択した時間は受付できなくなりました。別の空き時間を選んでください。</p>}
      <div className="calendar-menu-options">
        {menus.map(s => <button type="button" key={s.id} disabled={loading} aria-pressed={serviceId === s.id} className={serviceId === s.id ? "selected" : ""} onClick={() => {
          setServiceId(s.id); const candidates = slots.filter(slot => slot.startAt === start && slot.serviceId === s.id);
          setStaffId(candidates.length === 1 ? candidates[0].staffId : "");
        }}><strong>{s.name}</strong><span>{s.duration_minutes}分・¥{s.price.toLocaleString()}</span></button>)}
      </div>
      {menu && <>
        {staff.length > 1 ? <><label htmlFor="calendar-staff">担当者</label><select id="calendar-staff" value={staffId} disabled={loading} onChange={e => setStaffId(e.target.value)}><option value="">選んでください</option>{staff.map(s => <option key={s.staffId} value={s.staffId}>{s.staffName || "担当者"}</option>)}</select></>
          : choice && choice.staffName && <p>担当：{choice.staffName}</p>}
        <p className="muted">予約はまだ確定していません。次の画面でお客様情報を入力します。</p>
        <button type="button" className="primary" disabled={loading || !choice} onClick={() => { if (choice) onChoose({ service: menu, slot: choice, date }); }}>この内容でお客様情報へ</button>
      </>}
    </section>}
  </div>;
}
