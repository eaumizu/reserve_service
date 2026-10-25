import {NextRequest,NextResponse} from "next/server";
import {authorizeStaff} from "../../../../lib/admin-auth";
import {supabaseServer} from "../../../../lib/supabase-server";
import {refreshCalendarBusy} from "../../../../lib/google-calendar-busy";
import {isBookingDate} from "../../../../lib/reservations/date";
import {CALENDAR_STATE_COOKIE,calendarPlatformReady,calendarCallbackUrl,validCalendarId,newCalendarAuthorization,hashCalendarState,encryptCalendarSecret,dispatchCalendarJobs} from "../../../../lib/google-calendar";
export const maxDuration=60;
const respond=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{"Cache-Control":"private, no-store"}});
async function handle(req:NextRequest,write:boolean){
 try{
  const actor=await authorizeStaff(req.headers.get("authorization"));if(!actor)return respond({error:"ログインしてください。"},401);if(actor.role!=="admin")return respond({error:"カレンダー接続は管理者のみ操作できます。"},403);
  const db=supabaseServer();let delivery,busyCheck;
  if(write){
   let body;try{body=await req.json();}catch{return respond({error:"入力内容を確認してください。"},400);}
   if(body?.action==="connect"){
    if(!calendarPlatformReady())return respond({error:"Google連携の準備が未完了です。設定手順を確認してください。"},409);
    const id=body.calendarId;if(!validCalendarId(id))return respond({error:"カレンダーIDを確認してください。"},400);
    const state=newCalendarAuthorization(),r=await db.rpc("issue_store_calendar_oauth",{p_store_id:actor.storeId,p_user_id:actor.userId,p_state_hash:hashCalendarState(state.state),p_calendar_id:id,p_verifier_cipher:encryptCalendarSecret(actor.storeId,state.verifier)});if(r.error)throw r.error;
    const response=respond({url:state.url});response.cookies.set(CALENDAR_STATE_COOKIE,state.state,{httpOnly:true,secure:true,sameSite:"lax",path:"/api/admin/calendar",maxAge:600});return response;
   }else if(body?.action==="busy"){
    if(typeof body.enabled!=="boolean")return respond({error:"受付停止の設定を確認してください。"},400);
    if(body.enabled&&!calendarPlatformReady())return respond({error:"Google連携の準備が未完了です。"},409);
    const r=await db.rpc("set_store_calendar_busy",{p_store_id:actor.storeId,p_enabled:body.enabled});if(r.error)throw r.error;
   }else if(body?.action==="check-busy"){
    if(typeof body.date!=="string"||!isBookingDate(body.date))return respond({error:"確認する日付を選択してください。"},400);
    const c=await db.rpc("store_calendar_credentials",{p_store_id:actor.storeId});if(c.error)throw c.error;
    if(!c.data?.busyEnabled)return respond({error:"Googleカレンダーを接続し、「Googleの予定で予約枠を閉じる」を有効にしてください。"},409);
    const intervals=await refreshCalendarBusy(actor.storeId,body.date),start=Date.parse(`${body.date}T00:00:00+09:00`);
    busyCheck={date:body.date,checkedAt:new Date().toISOString(),intervals:intervals.filter(r=>Date.parse(r.start)<start+86400000&&Date.parse(r.end)>start)};
   }else if(body?.action==="disconnect"){
    const r=await db.rpc("disconnect_store_calendar",{p_store_id:actor.storeId});if(r.error)throw r.error;
   }else if(body?.action==="sync"){
    if(!calendarPlatformReady())return respond({error:"Google連携の準備が未完了です。"},409);
    const r=await db.rpc("queue_store_calendar_resync",{p_store_id:actor.storeId});if(r.error)return respond({error:"先にGoogleカレンダーを接続してください。"},409);delivery=await dispatchCalendarJobs(actor.storeId,null,5);
   }else if(body?.action==="retry")delivery=await dispatchCalendarJobs(actor.storeId,null,5);
   else return respond({error:"操作を確認してください。"},400);
  }
  const d=await db.rpc("store_calendar_dashboard",{p_store_id:actor.storeId});if(d.error)throw d.error;
  const credentials=await db.rpc("store_calendar_credentials",{p_store_id:actor.storeId});if(credentials.error)throw credentials.error;
  let callbackUrl="";try{callbackUrl=calendarCallbackUrl();}catch{}
  return respond({...d.data,busyEnabled:credentials.data?.busyEnabled===true,platformReady:calendarPlatformReady(),callbackUrl,delivery,busyCheck});
 }catch{return respond({error:"Google連携を確認できません。接続先とアクセス権限を確認し、再接続または時間をおいてお試しください。"},503);}
}
export async function GET(req:NextRequest){return handle(req,false);}
export async function POST(req:NextRequest){return handle(req,true);}
