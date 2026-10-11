import {NextRequest,NextResponse} from "next/server";
import {authorizeStaff} from "../../../../lib/admin-auth";
import {supabaseServer} from "../../../../lib/supabase-server";
import {dispatchBookingReminders,reminderEmailReady} from "../../../../lib/booking-reminders";
export const maxDuration=60;
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
async function handle(request:NextRequest,write:boolean){
 try{
  const staff=await authorizeStaff(request.headers.get("authorization"));if(!staff)return respond({error:"ログインが必要です。"},401);
  const db=supabaseServer();let delivery;
  if(write){
   let body;try{body=await request.json();}catch{return respond({error:"入力内容を確認してください。"},400);}
   if(!body)return respond({error:"入力内容を確認してください。"},400);
   if(body.action==="enable"){
    if(staff.role!=="admin")return respond({error:"設定は管理者のみ変更できます。"},403);
    if(typeof body.enabled!=="boolean")return respond({error:"設定を確認してください。"},400);
    const result=await db.rpc("set_booking_reminders_enabled",{p_store_id:staff.storeId,p_enabled:body.enabled});if(result.error)throw result.error;
   }else if(body.action==="send"){
    if(staff.role!=="admin")return respond({error:"送信は管理者のみ操作できます。"},403);
    delivery=await dispatchBookingReminders(staff.storeId);
   }else if(body.action==="contacted"){
    if(typeof body.id!=="string"||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.id))return respond({error:"連絡対象を確認してください。"},400);
    const result=await db.rpc("record_reminder_contact",{p_store_id:staff.storeId,p_id:body.id,p_user_id:staff.userId});
    if(result.error)return respond({error:"対象の状態が変わりました。一覧を更新してください。"},409);
   }else return respond({error:"操作を確認してください。"},400);
  }
  const dashboard=await db.rpc("booking_reminder_dashboard",{p_store_id:staff.storeId,p_email_ready:reminderEmailReady()});if(dashboard.error)throw dashboard.error;
  const email=await db.rpc("store_email_ready",{p_store_id:staff.storeId});if(email.error)throw email.error;
  return respond({...dashboard.data,emailReady:reminderEmailReady()&&email.data===true,cronReady:(process.env.CRON_SECRET?.length??0)>=32,canManage:staff.role==="admin",delivery});
 }catch{return respond({error:"前日連絡を取得できません。0017のSQLと通知設定をご確認ください。"},503);}
}
export async function GET(request:NextRequest){return handle(request,false);}
export async function POST(request:NextRequest){return handle(request,true);}
