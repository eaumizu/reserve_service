"use client";
import { useEffect, useState } from "react";
import { isBookingMode, type BookingMode } from "../lib/booking-mode";
import { MenuBooking } from "./MenuBooking";
import { DateBooking } from "./DateBooking";

/** The owner chooses the public page. Visitors cannot override it via URL/input. */
export function PublicBooking() {
  const [mode, setMode] = useState<BookingMode>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      setError("");
      try {
        const response = await fetch("/api/booking-mode", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !isBookingMode(result.mode)) throw new Error("予約画面を読み込めません。時間をおいて再度お試しください。");
        if (active) setMode(result.mode);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "予約画面を読み込めません。"); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [version]);
  if (error) return <section className="card" role="alert"><p className="error">{error}</p><button type="button" onClick={() => setVersion(v => v + 1)}>もう一度読み込む</button></section>;
  if (!mode) return <p role="status">予約画面を読み込んでいます…</p>;
  return mode === "date" ? <DateBooking/> : <MenuBooking/>;
}
