import {NextRequest,NextResponse} from "next/server";
import {supabaseServer} from "../../../../../lib/supabase-server";
import {decryptLineCredential} from "../../../../../lib/line-settings-secret";
import {validLineSignature,lineLinkCode} from "../../../../../lib/line-webhook";
import {hashCustomerToken} from "../../../../../lib/customer-booking";
export async function POST(request:NextRequest,{params}:{params:Promise<{storeId:string}>}){
 const respond=(status:number)=>new NextResponse(null,{status,headers:{"Cache-Control":"no-store"}});
 try{
  const {storeId}=await params;if(!/^[0-9a-f-]{36}$/i.test(storeId))return respond(404);
  const body=await request.text();if(Buffer.byteLength(body)>262144)return respond(413);
  const db=supabaseServer();const settings=await db.from("store_line_settings").select("channel_secret_cipher").eq("store_id",storeId).maybeSingle();
  if(settings.error||!settings.data?.channel_secret_cipher)return respond(503);
  const secret=decryptLineCredential(storeId,settings.data.channel_secret_cipher);
  if(!validLineSignature(body,request.headers.get("x-line-signature"),secret))return respond(401);
  const payload=JSON.parse(body);if(!Array.isArray(payload.events))return respond(400);
  for(const event of payload.events){
   if(event.type!=="message"||event.message?.type!=="text"||event.source?.type!=="user"||typeof event.source.userId!=="string")continue;
   const code=lineLinkCode(event.message.text);if(!code)continue;
   const result=await db.rpc("consume_customer_line_code",{p_store_id:storeId,p_code_hash:hashCustomerToken(code),p_line_user_id:event.source.userId});
   if(result.error)return respond(503);
  }
  return respond(200);
 }catch{return respond(503);}
}
