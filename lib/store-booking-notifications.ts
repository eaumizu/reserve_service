import {supabaseServer} from "./supabase-server";
import {emailPlatformReady,verifiedEmailSender} from "./store-email";
import {bookingSiteOrigin} from "./line-booking-notification";
export type StoreBookingNotification={id:string;storeId:string;reservationId:string;leaseId:string;recipient:string;kind:"created"|"changed"|"cancelled";payload:{storeName:string;customerName:string;phone:string;serviceName:string;staffName:string;startAt:string;endAt:string;oldStartAt?:string;oldEndAt?:string;oldStaffName?:string;oldServiceName?:string;from:string;replyTo:string;senderRevision:string;domainId:string}};
export const bookingEmailAddress=(v:unknown):v is string=>typeof v==="string"&&v.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v);
export function storeBookingMessage(job:StoreBookingNotification){
 const p=job.payload,japan=(v:string)=>new Date(v).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
 const labels={created:"新しい予約が入りました。",changed:"予約が変更されました。",cancelled:"予約がキャンセルされました。"};
 const old=job.kind==="changed"&&p.oldStartAt?`\n変更前：${japan(p.oldStartAt)}${p.oldEndAt?` ～ ${japan(p.oldEndAt)}`:""}\n変更前メニュー：${p.oldServiceName??""}${p.oldStaffName?`\n変更前担当：${p.oldStaffName}`:""}\n`:"";
 return `${p.storeName}\n${labels[job.kind]}\n\nお客様：${p.customerName}\n電話番号：${p.phone}${old}\n予約日時：${japan(p.startAt)} ～ ${japan(p.endAt)}（日本時間）\nメニュー：${p.serviceName}${p.staffName?`\n担当：${p.staffName}`:""}\n\n管理画面で確認\n${bookingSiteOrigin()}/admin\n\n店舗スタッフ向けの通知です。予約の操作にはログインが必要です。`;
}
export async function sendStoreBookingNotification(job:StoreBookingNotification){
 if(!bookingEmailAddress(job.recipient))throw new Error("invalid_recipient");
 const sender=await verifiedEmailSender(job.storeId),p=job.payload;
 if(sender.revision!==p.senderRevision||sender.domainId!==p.domainId||`${sender.senderName} <${sender.senderEmail}>`!==p.from)throw new Error("sender_changed");
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","User-Agent":"reserve-service/1.0","Idempotency-Key":job.id},body:JSON.stringify({from:p.from,...(p.replyTo?{reply_to:p.replyTo}:{}),to:[job.recipient],subject:`【店舗向け・${{created:"新規予約",changed:"予約変更",cancelled:"キャンセル"}[job.kind]}】${p.storeName}`,text:storeBookingMessage(job)}),redirect:"error",signal:AbortSignal.timeout(6000)});
 if(!r.ok)throw new Error("delivery_failed");
}
export async function dispatchStoreBookingNotifications(storeId:string,reservationId:string|null=null,limit=2){
 if(!emailPlatformReady())return {pending:false,sent:0,failed:0};
 let sent=0,failed=0;
 try{
  const db=supabaseServer(),deadline=Date.now()+20000;
  for(let n=0;n<limit&&Date.now()<deadline;n++){
   const found=await db.rpc("claim_store_booking_notification",{p_store_id:storeId,p_reservation_id:reservationId});if(found.error)throw found.error;
   const job=found.data as StoreBookingNotification|null;if(!job)break;
   if(job.storeId!==storeId||(reservationId&&job.reservationId!==reservationId))throw new Error("invalid_store");
   let accepted=false;try{await sendStoreBookingNotification(job);accepted=true;sent++;}catch{failed++;}
   const done=await db.rpc("finish_store_booking_notification",{p_store_id:storeId,p_id:job.id,p_lease_id:job.leaseId,p_sent:accepted});if(done.error)throw done.error;
   if(!accepted)break;await new Promise(r=>setTimeout(r,600));
  }
  const d=await db.rpc("store_booking_notification_dashboard",{p_store_id:storeId});if(d.error)throw d.error;
  return {pending:Number(d.data?.pending)>0,sent,failed};
 }catch{return {pending:true,sent,failed:failed+1};}
}
