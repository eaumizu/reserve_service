import {NextRequest,NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
import {CUSTOMER_TOKEN,CUSTOMER_HEADERS,hashCustomerToken,type CustomerBooking} from "../../../../lib/customer-booking";
import {supabaseServer} from "../../../../lib/supabase-server";
const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:CUSTOMER_HEADERS});
export async function POST(request:NextRequest){
 try{
  const body=await request.json();if(!body||typeof body.token!=="string"||!CUSTOMER_TOKEN.test(body.token))return respond({error:"予約リンクが無効です。"},404);
  const db=supabaseServer(),hash=hashCustomerToken(body.token);
  const found=await db.rpc("read_customer_booking",{p_token_hash:hash});if(found.error)return respond({error:"予約リンクが無効または期限切れです。"},404);
  const booking=found.data as CustomerBooking;
  const settings=await db.from("store_line_settings").select("friend_url,channel_secret_cipher,access_token_cipher").eq("store_id",booking.storeId).maybeSingle();
  if(settings.error)throw settings.error;
  const linked=await db.from("customer_line_links").select("reservation_id").eq("reservation_id",booking.id).eq("store_id",booking.storeId).maybeSingle();if(linked.error)throw linked.error;
  const available=!!(settings.data?.friend_url&&settings.data?.channel_secret_cipher&&settings.data?.access_token_cipher);
  if(body.action==="status")return respond({linked:!!linked.data,available});
  if(body.action!=="issue")return respond({error:"操作を確認してください。"},400);
  if(!available)return respond({error:"店舗のLINE連携は準備中です。"},409);
  if(linked.data)return respond({error:"この予約はすでにLINEと連携済みです。"},409);
  const code=randomBytes(16).toString("hex");
  const issued=await db.rpc("issue_customer_line_code",{p_token_hash:hash,p_code_hash:hashCustomerToken(code)});
  if(issued.error)return respond({error:"コードを発行できません。予約の状態を再確認してください。"},409);
  return respond({message:`予約連携 ${code}`,friendUrl:settings.data!.friend_url,expiresInMinutes:10});
 }catch{return respond({error:"LINE連携を確認できませんでした。店舗にお問い合わせください。"},503);}
}
