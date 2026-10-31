import { NextResponse } from "next/server";
import { readBookingMode } from "../../../lib/booking-mode-server";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { mode } = await readBookingMode(process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!);
    return NextResponse.json({ mode }, { headers });
  } catch {
    return NextResponse.json({ error: "予約画面を読み込めません。時間をおいて再度お試しください。" }, { status: 503, headers });
  }
}
