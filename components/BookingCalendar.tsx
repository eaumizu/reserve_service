"use client";
import { useEffect, useRef, useState } from "react";
import type { BookingRules } from "../lib/booking-rules";
import type { DateSlot } from "../lib/reservations/date-availability";
import { CLOCK_TIME_PATTERN } from "../lib/reservations/time-grid";

export type BookingService = { id: string; name: string; duration_minutes: number; price: number };
export type CalendarChoice = { service: BookingService; slot: DateSlot; date: string };
type Rules = BookingRules & { minDate: string; maxDate: string };
type Day = { status: "loading" | "ready" | "error"; slots: DateSlot[]; times: string[] };
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const localTime = (start: string) => new Date(Date.parse(start) + 9 * 3600000).toISOString();
const dayLabel = (day: string) => new Date(`${day}T00:00:00+09:00`).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });
const fullDayLabel = (day: string) => new Date(`${day}T00:00:00+09:00`).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });
const timeLabel = (start: string) => localTime(start).slice(11, 16);
const monthLabel = (day: string) => `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月`;

export function BookingCalendar({ services, rules, initialDate, onChoose }: { services: BookingService[]; rules: Rules; initialDate?: string; onChoose: (choice: CalendarChoice) => void }) {
  const firstDay = initialDate && initialDate >= rules.minDate && initialDate <= rules.maxDate ? initialDate : rules.minDate;
  const [date, setDate] = useState(firstDay);
  const [week, setWeek] = useState(firstDay);
  const [data, setData] = useState<{ week: string; days: Record<string, Day> }>({ week: firstDay, days: {} });
  const [start, setStart] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [version, setVersion] = useState(0);
  const menuHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (start) menuHeading.current?.focus(); }, [start]);
  useEffect(() => {
    let active = true, inFlight = false, refreshAgain = false;
    const controller = new AbortController();
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter(d => d >= rules.minDate && d <= rules.maxDate);
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      if (inFlight) { refreshAgain = true; return; }
      inFlight = true;
      setData(prev => ({ week, days: Object.fromEntries(days.map(day => [day, {
        status: "loading" as const, slots: prev.week === week ? prev.days[day]?.slots ?? [] : [], times: prev.week === week ? prev.days[day]?.times ?? [] : [],
      }])) }));
      let next = 0;
      const update = (day: string, value: Day) => { if (active) setData(prev => prev.week === week ? { week, days: { ...prev.days, [day]: value } } : prev); };
      async function worker() {
        while (active && next < days.length) {
          const day = days[next++];
          try {
            const response = await fetch(`/api/date-availability?date=${day}`, { cache: "no-store", signal: controller.signal });
            const result = await response.json();
            if (!response.ok || !Array.isArray(result.slots)) throw new Error("Availability unavailable");
            const slots: DateSlot[] = result.slots.filter((s: DateSlot) => localTime(s.startAt).slice(0, 10) === day);
            const times = (Array.isArray(result.times) ? result.times : slots.map(s => timeLabel(s.startAt))).filter((t: unknown): t is string => typeof t === "string" && CLOCK_TIME_PATTERN.test(t));
            update(day, { status: "ready", slots, times });
          } catch {
            update(day, { status: "error", slots: [], times: [] });
          }
        }
      }
      // Bound parallel calls and keep each day's Google/DB checks in its own
      // request. A busy week must not exceed a single Worker's subrequest limit.
      await Promise.all([worker(), worker()]);
      inFlight = false;
      if (active && refreshAgain) { refreshAgain = false; void refresh(); }
    }
    const resume = () => void refresh();
    // Strict Mode replays effects during development; do not dispatch checks
    // from the immediately discarded first effect.
    queueMicrotask(() => { if (active) void refresh(); });
    const timer = window.setInterval(resume, 60000);
    window.addEventListener("focus", resume); window.addEventListener("pageshow", resume); document.addEventListener("visibilitychange", resume);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", resume); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume); };
  }, [week, version, rules.minDate, rules.maxDate]);
  function moveWeek(count: number) {
    const next = addDays(week, count), bounded = next < rules.minDate ? rules.minDate : next;
    setWeek(bounded); setDate(bounded); setStart(""); setServiceId(""); setStaffId("");
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const current = data.week === week ? data.days : {};
  const rows = [...new Set(Object.values(current).flatMap(d => [...d.times, ...d.slots.map(s => timeLabel(s.startAt))]))].sort();
  const selectedDay = current[date];
  const slots = selectedDay?.slots ?? [];
  const loading = selectedDay?.status !== "ready";
  const pending = days.some(d => d <= rules.maxDate && (!current[d] || current[d].status === "loading"));
  const failed = days.filter(d => current[d]?.status === "error");
  const menus = services.filter(s => slots.some(slot => slot.startAt === start && slot.serviceId === s.id));
  const staff = slots.filter(s => s.startAt === start && s.serviceId === serviceId);
  const choice = staff.find(s => s.staffId === staffId);
  const menu = menus.find(s => s.id === serviceId);
  const month = monthLabel(week) === monthLabel(days[6]) ? monthLabel(week) : `${monthLabel(week)}〜${monthLabel(days[6])}`;
  return <div className="booking-calendar">
    <h3>1. 日時を選択 <span className="calendar-required">必須</span></h3>
    <div className="calendar-week-navigation">
      <button type="button" disabled={week <= rules.minDate} onClick={() => moveWeek(-7)}>前の週</button>
      <strong>{month}</strong>
      <button type="button" disabled={addDays(week, 7) > rules.maxDate} onClick={() => moveWeek(7)}>次の週</button>
    </div>
    <p className="calendar-legend">○：予約可能　×：受付不可<span>日時は日本時間・開始時刻です。</span></p>
    {pending && <p className="muted" role="status">空き枠を確認しています…</p>}
    {failed.length > 0 && <div role="alert"><p className="error">{failed.map(d => dayLabel(d)).join("、")}の空き枠を確認できません。「?」の枠は選択できません。</p><button type="button" onClick={() => setVersion(v => v + 1)}>もう一度確認する</button></div>}
    <div className="calendar-table-scroll" tabIndex={0} role="region" aria-label="週間の空き状況。時刻と日付が交わる丸を選択してください。">
      <table className="calendar-table">
        <caption>予約日時の選択</caption>
        <colgroup><col className="calendar-time-column"/>{days.map(day => <col key={day}/>)}</colgroup>
        <thead><tr><th scope="col">時刻</th>{days.map(day => {
          const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
          return <th key={day} scope="col" className={day > rules.maxDate ? "calendar-outside" : weekday === 0 ? "calendar-sunday" : weekday === 6 ? "calendar-saturday" : ""} aria-label={fullDayLabel(day)}>
            <span>{Number(day.slice(8))}</span><span>{["日", "月", "火", "水", "木", "金", "土"][weekday]}</span>
          </th>;
        })}</tr></thead>
        <tbody>{rows.map(time => <tr key={time}><th scope="row">{time}</th>{days.map(day => {
          const state = current[day], outside = day > rules.maxDate;
          const available = state?.status === "ready" ? state.slots.find(s => timeLabel(s.startAt) === time) : undefined;
          const selected = !!available && date === day && start === available.startAt;
          const label = `${fullDayLabel(day)} ${time}`;
          return <td key={day}>{available ? <button type="button" className="calendar-slot" aria-label={`${label} 予約可能`} aria-pressed={selected} onClick={() => {
            setDate(day); setStart(available.startAt); setServiceId(""); setStaffId("");
          }}><span aria-hidden="true">{selected ? "●" : "○"}</span></button>
            : <span className="calendar-unavailable" aria-label={`${label} ${outside ? "受付期間外" : state?.status === "error" ? "確認できません" : state?.status !== "ready" ? "確認中" : "受付不可"}`}>{outside ? "—" : state?.status === "error" ? "?" : state?.status !== "ready" ? "…" : "×"}</span>}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    {!pending && !failed.length && !Object.values(current).some(d => d.slots.length) && <p role="status">この週に受付できる空き枠はありません。別の週を選択してください。</p>}
    {start && <section className="calendar-menu" aria-label="選択した時間のメニュー">
      <h3 ref={menuHeading} tabIndex={-1}>2. メニューを確認する</h3>
      <p>{dayLabel(date)} {timeLabel(start)} 開始</p>
      {!menus.length && !loading && selectedDay?.status === "ready" && <p role="alert" className="error">選択した時間は受付できなくなりました。別の空き時間を選んでください。</p>}
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
