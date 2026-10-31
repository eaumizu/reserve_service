"use client";
import { BookingFlow } from "./BookingFlow";
export function MenuBooking() {
  return <><p className="muted">施術メニューを選んでから、ご希望の日付・時間をお選びください。</p><BookingFlow mode="menu"/></>;
}
