import { supabaseServer } from "@/lib/supabase-server";
export const dynamic = "force-dynamic";
export default async function AdminPage(){
  let rows: any[]=[]; let unavailable=false;
  try { const db=supabaseServer(); const storeId=process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!; const {data,error}=await db.from("reservations").select("id,start_at,end_at,status,source,customers(name,phone),services(name),staff(name)").eq("store_id",storeId).order("start_at",{ascending:true}).limit(100); if(error)throw error; rows=data??[]; } catch { unavailable=true; }
  return <main><p className="eyebrow">STORE ADMIN</p><h1>予約一覧</h1><p className="muted">電話・店頭の予約は、認証済みスタッフ用画面から同じ予約作成 API に <code>phone</code> / <code>walk_in</code> / <code>admin</code> を指定して登録します。認証導入前のため、この画面の書き込み操作は公開していません。</p>{unavailable?<section className="card"><p>Supabase の接続情報を設定すると予約一覧を表示できます。</p></section>:<section className="card"><table className="admin-table"><thead><tr><th>日時</th><th>お客様</th><th>メニュー</th><th>担当</th><th>経路</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{new Date(r.start_at).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}</td><td>{r.customers?.name}</td><td>{r.services?.name}</td><td>{r.staff?.name}</td><td>{r.source}</td></tr>)}</tbody></table>{!rows.length&&<p className="muted">予約はまだありません。</p>}</section>}</main>;
}
