import {NextRequest,NextResponse} from "next/server";
import {supabaseServer} from "../../../../../lib/supabase-server";
import {bookingSiteOrigin} from "../../../../../lib/line-booking-notification";
import {CALENDAR_STATE_COOKIE,calendarPlatformReady,hashCalendarState,decryptCalendarSecret,encryptCalendarSecret,googleCalendarToken,calendarFetch,calendarCallbackUrl} from "../../../../../lib/google-calendar";
export const maxDuration=60;
export async function GET(req:NextRequest){
 let status="error";
 try{
  const state=req.nextUrl.searchParams.get("state"),cookie=req.cookies.get(CALENDAR_STATE_COOKIE)?.value,code=req.nextUrl.searchParams.get("code");
  if(!calendarPlatformReady()||!state||!/^[a-f0-9]{64}$/.test(state)||cookie!==state||!code||code.length>4000)throw new Error("invalid_state");
  const db=supabaseServer(),r=await db.rpc("consume_store_calendar_oauth",{p_state_hash:hashCalendarState(state)});if(r.error||!r.data)throw new Error("expired_state");
  const flow=r.data as {storeId:string;userId:string;calendarId:string;verifierCipher:string};
  const user=await db.auth.admin.getUserById(flow.userId);if(user.error||user.data.user?.app_metadata?.role!=="admin"||user.data.user?.app_metadata?.store_id!==flow.storeId)throw new Error("admin_changed");
  const tokens=await googleCalendarToken({grant_type:"authorization_code",code,redirect_uri:calendarCallbackUrl(),code_verifier:decryptCalendarSecret(flow.storeId,flow.verifierCipher)});if(!tokens.refresh_token)throw new Error("missing_refresh_token");
  const calendar=await calendarFetch(tokens.access_token,`/users/me/calendarList/${encodeURIComponent(flow.calendarId)}`);if(!calendar.ok)throw new Error("calendar_missing");const value=await calendar.json();if(!["owner","writer"].includes(value.accessRole)||typeof value.id!=="string")throw new Error("calendar_readonly");
  const saved=await db.rpc("save_store_calendar_connection",{p_store_id:flow.storeId,p_user_id:flow.userId,p_calendar_id:value.id,p_calendar_name:String(value.summary||value.id).slice(0,200),p_refresh_cipher:encryptCalendarSecret(flow.storeId,tokens.refresh_token)});if(saved.error)throw saved.error;status="connected";
 }catch{}
 let origin;try{origin=bookingSiteOrigin();}catch{return NextResponse.json({error:"公開URLの設定を確認してください。"},{status:503});}
 const response=NextResponse.redirect(`${origin}/admin?calendar=${status}`);response.headers.set("Cache-Control","private, no-store");response.headers.set("Referrer-Policy","no-referrer");response.cookies.set(CALENDAR_STATE_COOKIE,"",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/admin/calendar",maxAge:0});return response;
}
