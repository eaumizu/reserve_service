import { NextRequest, NextResponse } from "next/server";
import { authorizeStaff } from "../../../../lib/admin-auth";
import { supabaseServer } from "../../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const user = await authorizeStaff(request.headers.get("authorization"));
    if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
    const db = supabaseServer();
    const [services, staff, links] = await Promise.all([
      db.from("services").select("id,name,duration_minutes,price").eq("store_id", user.storeId).eq("active", true).order("name"),
      db.from("staff").select("id,name").eq("store_id", user.storeId).eq("active", true).order("name"),
      db.from("staff_services").select("staff_id,service_id,staff!inner(store_id),services!inner(store_id)")
        .eq("staff.store_id", user.storeId).eq("services.store_id", user.storeId),
    ]);
    if (services.error || staff.error || links.error) throw new Error("Catalog query failed");
    return NextResponse.json({ storeId: user.storeId, services: services.data, staff: staff.data,
      links: (links.data ?? []).map(link => ({ staffId: link.staff_id, serviceId: link.service_id })) }, { headers });
  } catch {
    return NextResponse.json({ error: "予約設定を取得できませんでした。" }, { status: 503, headers });
  }
}
