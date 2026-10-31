"use client";
import { BookingFlow } from "./BookingFlow";
export function DateBooking() {
  return <><p className="muted">カレンダーからご希望の日付・時間をお選びください。メニューはその後に確認できます。</p><BookingFlow mode="date"/></>;
}
