import {timingSafeEqual} from "node:crypto";
import {supabaseServer} from "./supabase-server";
import {decryptLineCredential} from "./line-settings-secret";
export type ReminderJob={id:string;storeId:string;leaseId:string;channel:"line"|"email";recipient:string;payload:{storeName:string;serviceName:string;staffName:string;startAt:string;endAt:string}};
export function reminderEmailReady(){return Boolean(process.env.RESEND_API_KEY&&process.env.REMINDER_EMAIL_FROM&&!/[\r\n]/.test(process.env.REMINDER_EMAIL_FROM));}
export function authorizeReminderCron(value:string|null){
 const secret=process.env.CRON_SECRET;if(!secret||secret.length<32||!value)return false;
 const supplied=Buffer.from(value),expected=Buffer.from(`Bearer ${secret}`);
 return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
export function reminderMessage(job:ReminderJob){
 const japan=(value:string)=>new Date(value).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
 const p=job.payload;
 return `${p.storeName}\n明日のご予約のお知らせです。\n\n日時：${japan(p.startAt)} ～ ${japan(p.endAt)}（日本時間）\nメニュー：${p.serviceName}\n担当：${p.staffName}\n\nご予約の確認・変更・キャンセルは、保存済みの予約専用リンクからお願いします。リンクがない場合は店舗にお問い合わせください。\nご来店をお待ちしております。`;
}
export async function sendBookingReminder(job:ReminderJob){
 const text=reminderMessage(job);
 if(job.channel==="line"){
  if(!/^U[a-f0-9]{32}$/.test(job.recipient))throw new Error("invalid_line_recipient");
  const settings=await supabaseServer().from("store_line_settings").select("access_token_cipher").eq("store_id",job.storeId).maybeSingle();
  if(settings.error||!settings.data?.access_token_cipher)throw new Error("line_not_ready");
  const token=decryptLineCredential(job.storeId,settings.data.access_token_cipher);
  const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","X-Line-Retry-Key":job.id},body:JSON.stringify({to:job.recipient,messages:[{type:"text",text}]}),redirect:"error",signal:AbortSignal.timeout(6000)});
  if(!r.ok&&!(r.status===409&&r.headers.get("x-line-accepted-request-id")))throw new Error("line_failed");
 }else if(job.channel==="email"){
  if(!reminderEmailReady()||!/^\S+@\S+\.\S+$/.test(job.recipient))throw new Error("email_not_ready");
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":job.id},body:JSON.stringify({from:process.env.REMINDER_EMAIL_FROM,to:[job.recipient],subject:"明日のご予約のお知らせ",text}),redirect:"error",signal:AbortSignal.timeout(6000)});
  if(!r.ok)throw new Error("email_failed");
 }else throw new Error("unsupported_channel");
}
// One invocation is bounded by the host runtime. Unprocessed jobs remain visible for manual sending.
export async function dispatchBookingReminders(storeId:string|null){
 const db=supabaseServer();
 const prepared=await db.rpc("prepare_booking_reminders",{p_store_id:storeId,p_email_ready:reminderEmailReady()});if(prepared.error)throw new Error("prepare_failed");
 const deadline=Date.now()+40000;let sent=0,failed=0;
 for(let count=0;count<40&&Date.now()<deadline;count++){
  const claimed=await db.rpc("claim_booking_reminder",{p_store_id:storeId});if(claimed.error)throw new Error("claim_failed");
  const job=claimed.data as ReminderJob|null;if(!job)break;
  if(storeId&&job.storeId!==storeId)throw new Error("invalid_store");
  let accepted=false;
  try{await sendBookingReminder(job);accepted=true;}catch{failed++;}
  const finished=await db.rpc("finish_booking_reminder",{p_store_id:job.storeId,p_id:job.id,p_lease_id:job.leaseId,p_sent:accepted});
  if(finished.error)throw new Error("record_failed");if(accepted)sent++;
  // Resend's default limit is two requests per second.
  if(job.channel==="email")await new Promise(resolve=>setTimeout(resolve,600));
 }
 return {sent,failed};
}
