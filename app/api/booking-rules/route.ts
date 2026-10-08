import { readBookingRules } from "../../../lib/booking-rules-server";
import { NextResponse } from "next/server";
import { bookingDateBounds } from "../../../lib/booking-rules";
export async function GET() {
  try {
    const rules = await readBookingRules(process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!);
    return NextResponse.json({ ...rules, ...bookingDateBounds(rules) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "予約受付ルールを取得できません。" }, { status: 503 }); }
}
