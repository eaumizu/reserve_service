import {NextRequest,NextResponse} from "next/server";
import {authorizeStaff} from "../../../../lib/admin-auth";
import {supabaseServer} from "../../../../lib/supabase-server";
import {reminderEmailReady} from "../../../../lib/booking-reminders";
import {dispatchEmailBookingEvents} from "../../../../lib/email-booking-events";
import {dispatchLineReservationEvents} from "../../../../lib/line-reservation-events";
export const maxDuration=60;
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
async function handle(request:NextRequest,write:boolean){
 try{
  const actor=await authorizeStaff(request.headers.get("authorization"));if(!actor)return respond({error:"ログインしてください。"},401);
  const db=supabaseServer();
  const read=()=>db.rpc("booking_contact_dashboard",{p_store_id:actor.storeId,p_email_ready:reminderEmailReady()});
  const result=await read();if(result.error)throw result.error;
  let notice;
  if(write){
   const body=await request.json();
   if(!body||!["retry","contacted"].includes(body.action)||!["email","line"].includes(body.channel)||typeof body.id!=="string")return respond({error:"操作を確認してください。"},400);
   const row=result.data?.events?.find((r:{id:string;channel:string})=>r.id===body.id&&r.channel===body.channel);
   if(!row)return respond({error:"対象が更新されました。一覧を更新してください。"},409);
   if(body.action==="contacted"){
    if(!row.canContact)return respond({error:"送信中または対応済みです。一覧を更新してください。"},409);
    const done=await db.rpc("record_booking_event_contact",{p_store_id:actor.storeId,p_channel:row.channel,p_event_id:row.id,p_user_id:actor.userId});if(done.error)return respond({error:"対象が更新されました。一覧を更新してください。"},409);
    notice="電話での連絡済みを記録しました。";
   }else{
    if(actor.role!=="admin")return respond({error:"再送は管理者のみ操作できます。"},403);
    if(!row.canRetry)return respond({error:"この通知は再送できません。"},409);
    const sent=row.channel==="email"?await dispatchEmailBookingEvents(actor.storeId,row.reservationId):await dispatchLineReservationEvents(actor.storeId,row.reservationId);
    notice=sent.pending?"未送信が残っています。約2分後に更新するか、電話で連絡してください。":"通知を送信しました。一覧を更新しました。";
   }
   const updated=await read();if(updated.error)throw updated.error;return respond({...updated.data,canManage:actor.role==="admin",notice});
  }
  return respond({...result.data,canManage:actor.role==="admin"});
 }catch{return respond({error:"連絡管理を取得できません。0020のSQL適用をご確認ください。"},503);}
}
export async function GET(request:NextRequest){return handle(request,false);}
export async function POST(request:NextRequest){return handle(request,true);}
