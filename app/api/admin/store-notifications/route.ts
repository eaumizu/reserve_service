import {NextRequest,NextResponse} from "next/server";
import {authorizeStaff} from "../../../../lib/admin-auth";
import {supabaseServer} from "../../../../lib/supabase-server";
import {emailPlatformReady} from "../../../../lib/store-email";
import {bookingEmailAddress,dispatchStoreBookingNotifications} from "../../../../lib/store-booking-notifications";
export const maxDuration=60;
const respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
async function handle(req:NextRequest,write:boolean){
 try{
  const actor=await authorizeStaff(req.headers.get("authorization"));if(!actor)return respond({error:"ログインしてください。"},401);
  if(actor.role!=="admin")return respond({error:"店舗向け通知は管理者のみ設定できます。"},403);
  const db=supabaseServer();let delivery;
  if(write){
   let body;try{body=await req.json();}catch{return respond({error:"入力内容を確認してください。"},400);}
   if(body?.action==="save"){
    const recipient=typeof body.recipient==="string"?body.recipient.trim():null;
    if(recipient===null||typeof body.enabled!=="boolean"||(recipient!==""&&!bookingEmailAddress(recipient))||(body.enabled&&!recipient))return respond({error:"受信先メールアドレスを確認してください。"},400);
    const r=await db.rpc("save_store_booking_notification_settings",{p_store_id:actor.storeId,p_recipient:recipient,p_enabled:body.enabled});if(r.error)throw r.error;
   }else if(body?.action==="retry")delivery=await dispatchStoreBookingNotifications(actor.storeId,null,10);
   else return respond({error:"操作を確認してください。"},400);
  }
  const r=await db.rpc("store_booking_notification_dashboard",{p_store_id:actor.storeId});if(r.error)throw r.error;
  return respond({...r.data,platformReady:emailPlatformReady(),delivery});
 }catch{return respond({error:"店舗向け通知を取得できません。0023のSQLとメール設定をご確認ください。"},503);}
}
export async function GET(req:NextRequest){return handle(req,false);}
export async function POST(req:NextRequest){return handle(req,true);}
