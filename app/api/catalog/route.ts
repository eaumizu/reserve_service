import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
export async function GET() {
  try { const db = supabaseServer(); const storeId = process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!;
    const { data, error } = await db.from("services").select("id,name,duration_minutes,price").eq("store_id", storeId).eq("active", true).eq("online_bookable", true);
    if (error) throw error; return NextResponse.json(data);
  } catch { return NextResponse.json({ error: "予約設定を読み込めません。" }, { status: 503 }); }
}
