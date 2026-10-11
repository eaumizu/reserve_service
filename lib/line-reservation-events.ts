import {supabaseServer} from "./supabase-server";
import {decryptLineCredential} from "./line-settings-secret";
type Payload={storeName:string;serviceName:string;staffName:string;oldStartAt:string;oldEndAt:string;startAt:string;endAt:string;oldStaffName:string;oldServiceName:string};
export type LineReservationEvent={id:string;storeId:string;userId:string;kind:"changed"|"cancelled";payload:Payload};
export const LINE_EVENT_WARNING="予約の保存は完了しました。LINE通知は未送信です。店舗設定の「未送信LINE通知を再送」から確認してください。";
export function lineReservationEventMessage(job:LineReservationEvent){
 const p=job.payload,japan=(value:string)=>new Date(value).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
 const details=job.kind==="cancelled"?`予約をキャンセルしました。\n\n対象日時：${japan(p.oldStartAt)} ～ ${japan(p.oldEndAt)}\nメニュー：${p.oldServiceName}\n担当：${p.oldStaffName}`:
 `予約内容を変更しました。\n\n変更前：${japan(p.oldStartAt)} ～ ${japan(p.oldEndAt)}\nメニュー：${p.oldServiceName}\n担当：${p.oldStaffName}\n\n変更後：${japan(p.startAt)} ～ ${japan(p.endAt)}\nメニュー：${p.serviceName}\n担当：${p.staffName}`;
 return `${p.storeName}\n${details}\n（日本時間）\n\n予約の確認は、保存済みの予約専用リンクから行えます。`;
}
export async function sendLineReservationEvent(job:LineReservationEvent,accessToken:string){
 const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json","X-Line-Retry-Key":job.id},body:JSON.stringify({to:job.userId,messages:[{type:"text",text:lineReservationEventMessage(job)}]}),redirect:"error",signal:AbortSignal.timeout(8000)});
 if(!r.ok&&!(r.status===409&&r.headers.get("x-line-accepted-request-id")))throw new Error("line_push_failed");
}
// Reservation writes are already committed. Sending must never turn a successful write into an API failure.
export async function dispatchLineReservationEvents(storeId:string,reservationId:string|null=null){
 try{
  const db=supabaseServer(),result=await db.rpc("pending_line_reservation_events",{p_store_id:storeId,p_reservation_id:reservationId});
  if(result.error)throw result.error;const jobs=result.data as LineReservationEvent[];
  if(!Array.isArray(jobs))throw new Error("invalid_jobs");
  if(!jobs.length)return {pending:false};
  const settings=await db.from("store_line_settings").select("access_token_cipher").eq("store_id",storeId).maybeSingle();
  if(settings.error||!settings.data?.access_token_cipher)throw new Error("missing_line_token");
  const token=decryptLineCredential(storeId,settings.data.access_token_cipher);
  for(const job of jobs.slice(0,2)){
   if(job.storeId!==storeId||!/^U[a-f0-9]{32}$/.test(job.userId))throw new Error("invalid_event");
   await sendLineReservationEvent(job,token);
   const marked=await db.rpc("mark_line_reservation_event_sent",{p_store_id:storeId,p_event_id:job.id});if(marked.error)throw marked.error;
  }
  return {pending:jobs.length>2};
 }catch{return {pending:true};}
}
