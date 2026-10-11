import {supabaseServer} from "./supabase-server";
import {emailPlatformReady,verifiedEmailSender} from "./store-email";
import {decryptLineCredential,encryptLineCredential,lineEncryptionReady} from "./line-settings-secret";
import {CUSTOMER_TOKEN,hashCustomerToken} from "./customer-booking";
import {bookingSiteOrigin} from "./line-booking-notification";
import {lineReservationEventMessage,dispatchLineReservationEvents} from "./line-reservation-events";
type Payload={storeName:string;serviceName:string;staffName:string;startAt:string;endAt:string;oldStartAt:string;oldEndAt:string;oldStaffName:string;oldServiceName:string;from:string;replyTo:string;senderRevision:string;domainId:string;tokenCipher?:string;tokenHash?:string};
export type EmailBookingEvent={id:string;storeId:string;reservationId:string;leaseId:string;recipient:string;kind:"created"|"changed"|"cancelled";payload:Payload};
export const EMAIL_EVENT_WARNING="予約の操作は完了しました。メール通知は未送信です。管理画面の店舗メール設定から確認・再送できます。";
export function emailBookingTokenCipher(storeId:string,token:string,email:string|null){return email&&lineEncryptionReady()?encryptLineCredential(storeId,token):null;}
export function emailBookingMessage(job:EmailBookingEvent){
 const p=job.payload;
 const date=(v:string)=>new Date(v).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
 let text=job.kind==="created"?`${p.storeName}\nご予約が確定しました。\n\n日時：${date(p.startAt)} ～ ${date(p.endAt)}（日本時間）\nメニュー：${p.serviceName}\n担当：${p.staffName}`:
 lineReservationEventMessage({id:job.id,storeId:job.storeId,userId:"",kind:job.kind,payload:p});
 if(p.tokenCipher&&p.tokenHash){
  const token=decryptLineCredential(job.storeId,p.tokenCipher);
  if(!CUSTOMER_TOKEN.test(token)||hashCustomerToken(token)!==p.tokenHash)throw new Error("invalid_link");
  text+=`\n\n予約確認・変更・キャンセル\n${bookingSiteOrigin()}/reservation#${token}\n\nこのリンクはご本人専用です。他の方には共有しないでください。`;
 }else if(job.kind==="created")throw new Error("missing_link");
 return text;
}
export async function sendEmailBookingEvent(job:EmailBookingEvent){
 if(!/^\S+@\S+\.\S+$/.test(job.recipient))throw new Error("invalid_recipient");
 const sender=await verifiedEmailSender(job.storeId),p=job.payload;
 if(sender.revision!==p.senderRevision||sender.domainId!==p.domainId||`${sender.senderName} <${sender.senderEmail}>`!==p.from)throw new Error("sender_changed");
 const text=emailBookingMessage(job),titles={created:"ご予約が確定しました",changed:"ご予約を変更しました",cancelled:"ご予約をキャンセルしました"};
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","User-Agent":"reserve-service/1.0","Idempotency-Key":job.id},body:JSON.stringify({from:p.from,...(p.replyTo?{reply_to:p.replyTo}:{}),to:[job.recipient],subject:`${p.storeName}：${titles[job.kind]}`,text}),redirect:"error",signal:AbortSignal.timeout(6000)});
 if(!r.ok)throw new Error("delivery_failed");
}
// Writes have committed. Delivery errors must not undo or mask a successful booking operation.
export async function dispatchEmailBookingEvents(storeId:string,reservationId:string|null=null,limit=2){
 if(!emailPlatformReady())return {pending:false,sent:0,failed:0};
 let sent=0,failed=0;
 try{
  const db=supabaseServer(),deadline=Date.now()+30000;
  for(let n=0;n<limit&&Date.now()<deadline;n++){
   const result=await db.rpc("claim_email_booking_event",{p_store_id:storeId,p_reservation_id:reservationId});if(result.error)throw result.error;
   const job=result.data as EmailBookingEvent|null;if(!job)break;
   if(job.storeId!==storeId||(reservationId&&job.reservationId!==reservationId))throw new Error("invalid_store");
   let accepted=false;try{await sendEmailBookingEvent(job);accepted=true;sent++;}catch{failed++;}
   const finished=await db.rpc("finish_email_booking_event",{p_store_id:storeId,p_id:job.id,p_lease_id:job.leaseId,p_sent:accepted});if(finished.error)throw finished.error;
   if(!accepted)break;
   await new Promise(resolve=>setTimeout(resolve,600));
  }
  const summary=await db.rpc("email_booking_event_summary",{p_store_id:storeId});if(summary.error)throw summary.error;
  return {pending:Number(summary.data?.pending)>0,sent,failed};
 }catch{return {pending:true,sent,failed:failed+1};}
}
export async function dispatchReservationNotifications(storeId:string,reservationId:string){
 const line=await dispatchLineReservationEvents(storeId,reservationId);
 const email=await dispatchEmailBookingEvents(storeId,reservationId);
 return {pending:line.pending||email.pending};
}
