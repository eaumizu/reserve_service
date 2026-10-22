import {resendFetch,requireResendResponse,ResendRequestError} from "./resend-request";
import {supabaseServer} from "./supabase-server";
import {emailPlatformReady,configuredEmailSender} from "./store-email";
import {bookingSiteOrigin} from "./line-booking-notification";
export type StoreBookingNotification={id:string;storeId:string;reservationId:string;leaseId:string;recipient:string;kind:"created"|"changed"|"cancelled";payload:{storeName:string;customerName:string;phone:string;customerEmail?:string|null;serviceName:string;staffName:string;startAt:string;endAt:string;oldStartAt?:string;oldEndAt?:string;oldStaffName?:string;oldServiceName?:string;from:string;replyTo:string;senderRevision:string;domainId:string}};
export const bookingEmailAddress=(v:unknown):v is string=>typeof v==="string"&&v.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v);
export function storeBookingMessage(job:StoreBookingNotification){
 const p=job.payload,japan=(v:string)=>new Date(v).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
 const labels={created:"新しい予約が入りました。",changed:"予約が変更されました。",cancelled:"予約がキャンセルされました。"};
 const old=job.kind==="changed"&&p.oldStartAt?`\n変更前：${japan(p.oldStartAt)}${p.oldEndAt?` ～ ${japan(p.oldEndAt)}`:""}\n変更前メニュー：${p.oldServiceName??""}${p.oldStaffName?`\n変更前担当：${p.oldStaffName}`:""}\n`:"";
 return `${p.storeName}\n${labels[job.kind]}\n\nお客様：${p.customerName}\n電話番号：${p.phone||"記載なし"}${p.customerEmail?`\nメール：${p.customerEmail}`:""}${old}\n予約日時：${japan(p.startAt)} ～ ${japan(p.endAt)}（日本時間）\nメニュー：${p.serviceName}${p.staffName?`\n担当：${p.staffName}`:""}\n\n管理画面で確認\n${bookingSiteOrigin()}/admin\n\n店舗スタッフ向けの通知です。予約の操作にはログインが必要です。`;
}
export async function sendStoreBookingNotification(job:StoreBookingNotification){
 if(!bookingEmailAddress(job.recipient))throw new Error("invalid_recipient");
 const sender=await configuredEmailSender(job.storeId),p=job.payload;
 if(sender.revision!==p.senderRevision||sender.domainId!==p.domainId||`${sender.senderName} <${sender.senderEmail}>`!==p.from)throw new Error("sender_changed");
 const r=await resendFetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","User-Agent":"reserve-service/1.0","Idempotency-Key":job.id},body:JSON.stringify({from:p.from,...(p.replyTo?{reply_to:p.replyTo}:{}),to:[job.recipient],subject:`【店舗向け・${{created:"新規予約",changed:"予約変更",cancelled:"キャンセル"}[job.kind]}】${p.storeName}`,text:storeBookingMessage(job)}),redirect:"error"});
 await requireResendResponse(r);
}
export function storeDeliveryFailure(error:unknown){
 if(error instanceof ResendRequestError){
  if(error.status===429)return "メール配信サービスの送信制限に達しました。少し待って再送してください。";
  if(error.status===401||error.status===403)return "メール配信の権限を確認してください。VercelのRESEND_API_KEYとResendのドメイン・送信権限をご確認ください。";
  if(error.status===422||error.status===400)return "配信サービスがメールの内容・送信元・受信先を受け付けませんでした。ResendのLogsをご確認ください。";
  if(error.status===409)return "配信サービスで通知IDの競合が発生しました。ResendのLogsをご確認ください。";
  return "メール配信サービスでエラーが発生しました。少し待って再送してください。";
 }
 const reason=error instanceof Error?error.message:"";
 if(reason==="unverified")return "送信元ドメインが認証済みになっていません。店舗メール設定で認証を確認してください。";
 if(reason==="sender_changed")return "通知作成時と送信元設定が異なります。送信元設定を確認してください。";
 if(reason==="invalid_booking_origin"||error instanceof TypeError&&reason.includes("Invalid URL"))return "管理画面URLを作成できません。VercelのLINE_BOOKING_SITE_URLに公開サイトのURLを設定してください。";
 if(reason==="invalid_recipient")return "店舗の通知受信先メールアドレスを確認してください。";
 if(reason==="database")return "メール設定を取得できません。データベースの設定をご確認ください。";
 return "メール送信が完了しませんでした。接続やタイムアウトの可能性があります。少し待って再送してください。";
}
export async function dispatchStoreBookingNotifications(storeId:string,reservationId:string|null=null,limit=2){
 if(!emailPlatformReady())return {pending:true,sent:0,failed:0,error:"VercelのRESEND_API_KEYが設定されていません。登録して再デプロイしてください。"};
 let sent=0,failed=0;let error:string|undefined;
 try{
  const db=supabaseServer(),deadline=Date.now()+20000;
  for(let n=0;n<limit&&Date.now()<deadline;n++){
   const found=await db.rpc("claim_store_booking_notification",{p_store_id:storeId,p_reservation_id:reservationId});if(found.error)throw found.error;
   const job=found.data as StoreBookingNotification|null;if(!job)break;
   if(job.storeId!==storeId||(reservationId&&job.reservationId!==reservationId))throw new Error("invalid_store");
   let accepted=false;try{await sendStoreBookingNotification(job);accepted=true;sent++;}catch(e){failed++;error=storeDeliveryFailure(e);console.error("store_booking_notification_failed",{notificationId:job.id,reason:e instanceof ResendRequestError?`http_${e.status}`:e instanceof Error&&["unverified","sender_changed","invalid_booking_origin","invalid_recipient","database"].includes(e.message)?e.message:"connection_or_configuration"});}
   const done=await db.rpc("finish_store_booking_notification",{p_store_id:storeId,p_id:job.id,p_lease_id:job.leaseId,p_sent:accepted});if(done.error)throw done.error;
   if(!accepted)break;await new Promise(r=>setTimeout(r,600));
  }
  const d=await db.rpc("store_booking_notification_dashboard",{p_store_id:storeId});if(d.error)throw d.error;
  return {pending:Number(d.data?.pending)>0,sent,failed,error};
 }catch{return {pending:true,sent,failed:failed+1,error:error??"店舗向け通知のデータベース処理に失敗しました。0023のSQL適用をご確認ください。"};}
}
