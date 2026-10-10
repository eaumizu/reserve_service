import { NextRequest,NextResponse } from "next/server";
import { authorizeStaff } from "../../../../lib/admin-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { parseLineSettings } from "../../../../lib/line-settings";
import { encryptLineCredential,lineEncryptionReady } from "../../../../lib/line-settings-secret";
const headers={"Cache-Control":"private, no-store"};
const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
export async function GET(request:NextRequest){
  try{
    const user=await authorizeStaff(request.headers.get("authorization"));
    if(!user)return respond({error:"ログインが必要です。"},401);if(user.role!=="admin")return respond({error:"管理者のみ設定できます。"},403);
    const result=await supabaseServer().from("store_line_settings").select("account_name,friend_url,channel_id,access_token_cipher,channel_secret_cipher,version,updated_at").eq("store_id",user.storeId).maybeSingle();
    if(result.error)throw result.error;const row=result.data;
    return respond({accountName:row?.account_name??"",friendUrl:row?.friend_url??"",channelId:row?.channel_id??"",
      hasAccessToken:!!row?.access_token_cipher,hasChannelSecret:!!row?.channel_secret_cipher,version:row?.version??null,
      updatedAt:row?.updated_at??null,encryptionReady:lineEncryptionReady(),messagingActive:false});
  }catch{return respond({error:"LINE設定を取得できませんでした。追加SQLの適用をご確認ください。"},503);}
}
export async function POST(request:NextRequest){
  try{
    const user=await authorizeStaff(request.headers.get("authorization"));
    if(!user)return respond({error:"ログインが必要です。"},401);if(user.role!=="admin")return respond({error:"管理者のみ設定できます。"},403);
    let body;try{body=await request.json();}catch{return respond({error:"入力内容を確認してください。"},400);}
    const value=parseLineSettings(body);if(!value)return respond({error:"LINEのアカウント名・友だち追加URL・チャネルIDをご確認ください。"},400);
    if((value.accessToken?.trim()||value.channelSecret?.trim())&&!lineEncryptionReady())return respond({error:"サーバーのLINE設定暗号化キーが未設定です。秘密情報はまだ保存できません。"},503);
    const result=await supabaseServer().rpc("save_store_line_settings_atomic",{p_store_id:user.storeId,p_account_name:value.accountName,p_friend_url:value.friendUrl,
      p_channel_id:value.channelId,p_expected_version:value.expectedVersion,p_clear_credentials:value.clearCredentials??false,
      p_access_token_cipher:value.accessToken?.trim()?encryptLineCredential(user.storeId,value.accessToken.trim()):null,
      p_channel_secret_cipher:value.channelSecret?.trim()?encryptLineCredential(user.storeId,value.channelSecret.trim()):null});
    if(result.error){
      if(result.error.message.includes("line_settings_changed"))return respond({error:"他の操作で設定が変わりました。再読み込みしてください。"},409);
      if(result.error.code==="23505")return respond({error:"このLINEチャネルは別の店舗で使用されています。"},409);
      throw result.error;
    }
    return respond({...result.data,encryptionReady:lineEncryptionReady(),messagingActive:false});
  }catch{return respond({error:"LINE設定を保存できませんでした。再読み込みして結果をご確認ください。"},503);}
}
