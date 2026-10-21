import {createHash,randomBytes} from "node:crypto";
import {supabaseServer} from "./supabase-server";
import {encryptLineCredential,decryptLineCredential,lineEncryptionReady} from "./line-settings-secret";
import {bookingSiteOrigin} from "./line-booking-notification";
export const CALENDAR_STATE_COOKIE="booking_google_state";
export const hashCalendarState=(v:string)=>createHash("sha256").update(v).digest("hex");
export const calendarPlatformReady=()=>Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID&&process.env.GOOGLE_CALENDAR_CLIENT_SECRET&&lineEncryptionReady());
export const calendarCallbackUrl=()=>`${bookingSiteOrigin()}/api/admin/calendar/callback`;
export const validCalendarId=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=255&&!/[\s\x00-\x1f]/.test(v);
export function newCalendarAuthorization(){
 const state=randomBytes(32).toString("hex"),verifier=randomBytes(32).toString("hex");
 const query=new URLSearchParams({client_id:process.env.GOOGLE_CALENDAR_CLIENT_ID!,redirect_uri:calendarCallbackUrl(),response_type:"code",scope:"https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",access_type:"offline",prompt:"consent",state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"});
 return {state,verifier,url:`https://accounts.google.com/o/oauth2/v2/auth?${query}`};
}
export async function googleCalendarToken(fields:Record<string,string>){
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...fields,client_id:process.env.GOOGLE_CALENDAR_CLIENT_ID!,client_secret:process.env.GOOGLE_CALENDAR_CLIENT_SECRET!}),redirect:"error",signal:AbortSignal.timeout(6000)});
 if(!r.ok)throw new Error("google_auth_failed");const v=await r.json();if(typeof v.access_token!=="string")throw new Error("google_auth_failed");return v as {access_token:string;refresh_token?:string};
}
export async function calendarFetch(token:string,path:string,method="GET",body?:unknown){return fetch(`https://www.googleapis.com/calendar/v3${path}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(6000)});}
export {encryptLineCredential as encryptCalendarSecret,decryptLineCredential as decryptCalendarSecret};
export type CalendarJob={storeId:string;reservationId:string;version:string;leaseId:string;connectionRevision:string;status:string;customerName:string;serviceName:string;staffName:string;startAt:string;endAt:string};
export const calendarEventId=(j:Pick<CalendarJob,"storeId"|"reservationId">)=>hashCalendarState(`${j.storeId}:${j.reservationId}`);
export async function syncCalendarJob(token:string,calendarId:string,j:CalendarJob){
 const path=`/calendars/${encodeURIComponent(calendarId)}/events`,id=calendarEventId(j),existing=await calendarFetch(token,`${path}/${id}`);
 if(!existing.ok&&![404,410].includes(existing.status))throw new Error("calendar_read_failed");
 if(existing.ok){const event=await existing.json();const own=event.extendedProperties?.private;if(own?.storeId!==j.storeId||own?.reservationId!==j.reservationId)throw new Error("calendar_event_not_owned");}
 if(j.status==="cancelled"){
  if(!existing.ok)return;const removed=await calendarFetch(token,`${path}/${id}?sendUpdates=none`,"DELETE");if(!removed.ok&&![404,410].includes(removed.status))throw new Error("calendar_delete_failed");return;
 }
 const payload={summary:`${j.serviceName}｜${j.customerName}`,description:`予約管理システムの予定です。変更・キャンセルは管理画面から行ってください。${j.staffName?`\n担当：${j.staffName}`:""}\n${bookingSiteOrigin()}/admin`,start:{dateTime:j.startAt,timeZone:"Asia/Tokyo"},end:{dateTime:j.endAt,timeZone:"Asia/Tokyo"},extendedProperties:{private:{storeId:j.storeId,reservationId:j.reservationId}}};
 const r=existing.ok?await calendarFetch(token,`${path}/${id}?sendUpdates=none`,"PUT",payload):await calendarFetch(token,`${path}?sendUpdates=none`,"POST",{id,...payload});
 if(r.status===409&&!existing.ok){const again=await calendarFetch(token,`${path}/${id}`);if(again.ok){const own=(await again.json()).extendedProperties?.private;if(own?.storeId===j.storeId&&own?.reservationId===j.reservationId){const updated=await calendarFetch(token,`${path}/${id}?sendUpdates=none`,"PUT",payload);if(updated.ok)return;}}}
 if(!r.ok)throw new Error("calendar_sync_failed");
}
export async function dispatchCalendarJobs(storeId:string,reservationId:string|null=null,limit=1){
 if(!calendarPlatformReady())return {pending:false,synced:0,failed:0};let synced=0,failed=0;
 try{
  const db=supabaseServer(),cfg=await db.rpc("store_calendar_credentials",{p_store_id:storeId});if(cfg.error)throw cfg.error;if(!cfg.data)return {pending:false,synced,failed};
  const credentials=cfg.data as {calendarId:string;refreshCipher:string;revision:string};
  let token:string|undefined;const deadline=Date.now()+20000;
  for(let i=0;i<limit&&Date.now()<deadline;i++){
   const r=await db.rpc("claim_store_calendar_job",{p_store_id:storeId,p_reservation_id:reservationId});if(r.error)throw r.error;const j=r.data as CalendarJob|null;if(!j)break;if(j.storeId!==storeId||(reservationId&&j.reservationId!==reservationId))throw new Error("calendar_store_mismatch");
   let accepted=false;try{if(j.connectionRevision!==credentials.revision)throw new Error("calendar_connection_changed");if(!token)token=(await googleCalendarToken({grant_type:"refresh_token",refresh_token:decryptLineCredential(storeId,credentials.refreshCipher)})).access_token;await syncCalendarJob(token,credentials.calendarId,j);accepted=true;synced++;}catch{failed++;}
   const done=await db.rpc("finish_store_calendar_job",{p_store_id:storeId,p_reservation_id:j.reservationId,p_version:j.version,p_lease_id:j.leaseId,p_connection_revision:j.connectionRevision,p_synced:accepted});if(done.error)throw done.error;if(!accepted)break;
  }
  const d=await db.rpc("store_calendar_dashboard",{p_store_id:storeId});if(d.error)throw d.error;return {pending:Number(d.data?.pending)>0,synced,failed};
 }catch{return {pending:true,synced,failed:failed+1};}
}
