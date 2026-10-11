import {decryptLineCredential} from "./line-settings-secret";
import {CUSTOMER_TOKEN,hashCustomerToken,type CustomerBooking} from "./customer-booking";
export type LineBookingNotification={codeHash:string;storeId:string;userId:string;tokenHash:string;tokenCipher:string;retryKey:string;booking:CustomerBooking};
export function bookingSiteOrigin(){
 const value=process.env.LINE_BOOKING_SITE_URL||(process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:"");
 const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new Error("invalid_booking_origin");return url.origin;
}
export function lineBookingMessage(booking:CustomerBooking,url:string){
 const japan=(value:string)=>new Date(value).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
 const state:Record<string,string>={confirmed:"予約が確定しています。",cancelled:"この予約はキャンセル済みです。",completed:"この予約は施術完了です。",no_show:"この予約は無断キャンセルとして記録されています。"};
 return `${booking.storeName}\nLINEとの予約連携が完了しました。\n${state[booking.status]??"予約情報をご確認ください。"}\n\n日時：${japan(booking.startAt)} ～ ${japan(booking.endAt)}（日本時間）\nメニュー：${booking.serviceName}\n担当：${booking.staffName}\n\n予約確認・変更・キャンセル\n${url}\n\nリンクはご本人専用です。他の方には共有しないでください。変更・キャンセルは施術開始前までです。`;
}
export async function sendLineBookingNotification(job:LineBookingNotification,accessToken:string){
 const token=decryptLineCredential(job.storeId,job.tokenCipher);
 if(!CUSTOMER_TOKEN.test(token)||hashCustomerToken(token)!==job.tokenHash||job.booking.storeId!==job.storeId)throw new Error("invalid_booking_token");
 const url=`${bookingSiteOrigin()}/reservation#${token}`;
 const response=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json","X-Line-Retry-Key":job.retryKey},body:JSON.stringify({to:job.userId,messages:[{type:"text",text:lineBookingMessage(job.booking,url)}]}),redirect:"error",signal:AbortSignal.timeout(8000)});
 if(!response.ok&&!(response.status===409&&response.headers.get("x-line-accepted-request-id")))throw new Error("line_push_failed");
}
