import {NextRequest,NextResponse} from "next/server";
import {authorizeStaff} from "../../../../../lib/admin-auth";
import {supabaseServer} from "../../../../../lib/supabase-server";
import {decryptLineCredential} from "../../../../../lib/line-settings-secret";
const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(request:NextRequest){
  try{
    const user=await authorizeStaff(request.headers.get("authorization"));
    if(!user)return respond({error:"ログインが必要です。"},401);
    if(user.role!=="admin")return respond({error:"管理者のみ接続確認できます。"},403);
    const result=await supabaseServer().from("store_line_settings").select("access_token_cipher").eq("store_id",user.storeId).maybeSingle();
    if(result.error)throw result.error;
    if(!result.data?.access_token_cipher)return respond({error:"チャネルアクセストークンを保存してから確認してください。"},400);
    let token:string;
    try{token=decryptLineCredential(user.storeId,result.data.access_token_cipher);}catch{return respond({error:"認証情報を読み取れません。暗号化キーの設定をご確認ください。"},503);}
    const response=await fetch("https://api.line.me/v2/bot/info",{headers:{Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});
    if(response.status===401||response.status===403)return respond({error:"LINEの認証に失敗しました。アクセストークンを確認し、保存し直してください。"},400);
    if(!response.ok)return respond({error:"LINEに接続できませんでした。時間を置いて再度お試しください。"},503);
    const data=await response.json();
    if(typeof data.displayName!=="string"||typeof data.basicId!=="string")throw new Error("invalid_response");
    return respond({displayName:data.displayName,basicId:data.basicId,premiumId:typeof data.premiumId==="string"?data.premiumId:null,checkedAt:new Date().toISOString()});
  }catch{return respond({error:"接続確認できませんでした。時間を置いて再度お試しください。"},503);}
}
