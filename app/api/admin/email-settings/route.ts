import {NextRequest,NextResponse} from "next/server";
import {authorizeStaff} from "../../../../lib/admin-auth";
import {supabaseServer} from "../../../../lib/supabase-server";
import {parseEmailSettings,readEmailSettings,emailPlatformReady,resendDomain,domainSnapshot} from "../../../../lib/store-email";
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
async function handle(request:NextRequest,write:boolean){
 try{
  const actor=await authorizeStaff(request.headers.get("authorization"));if(!actor)return respond({error:"ログインが必要です。"},401);
  if(actor.role!=="admin")return respond({error:"メール設定は管理者のみ操作できます。"},403);
  let settings=await readEmailSettings(actor.storeId);
  if(write){
   let body;try{body=await request.json();}catch{return respond({error:"入力内容を確認してください。"},400);}
   if(!body||typeof body!=="object")return respond({error:"入力内容を確認してください。"},400);
   const db=supabaseServer();
   if(body.action==="save"){
    let input;try{input=parseEmailSettings(body);}catch{return respond({error:"送信者名とメールアドレスを確認してください。送信元には店舗が管理する独自ドメインを使用してください。"},400);}
    const saved=await db.rpc("save_store_email_settings",{p_store_id:actor.storeId,p_settings:input});
    if(saved.error)return respond({error:"保存できません。このドメインが別店舗に登録済みでないか確認してください。"},409);
    settings=saved.data;
   }else if(body.action==="register"||body.action==="verify"){
    if(!emailPlatformReady())return respond({error:"運営側でResend APIキー（ドメイン管理権限付き）を設定してください。"},409);
    if(!settings)return respond({error:"先に送信元を保存してください。"},409);
    let snapshot;
    if(body.action==="register"){
     if(settings.domainId)return respond({error:"登録済みです。「認証を確認」を押してください。"},409);
     // Acquire once: an ambiguous provider timeout must not adopt an existing domain.
     const locked=await db.rpc("begin_store_email_registration",{p_store_id:actor.storeId,p_revision:settings.revision});
     if(locked.error||!locked.data)return respond({error:"登録処理済み、または設定が変わりました。再読み込みしてください。登録失敗時は運営にお問い合わせください。"},409);
     snapshot=domainSnapshot(await resendDomain("","POST",{name:settings.domain,open_tracking:false,click_tracking:false}),settings);
    }else{
     if(!settings.domainId)return respond({error:"先にドメインを登録してください。"},409);
     const path=`/${encodeURIComponent(settings.domainId)}`;
     // Verification restarts asynchronously and resets even verified domains to pending.
     snapshot=domainSnapshot(await resendDomain(path),settings);
     if(snapshot.status==="not_started"||snapshot.status==="failed"){
      await resendDomain(`${path}/verify`,"POST");
      snapshot=domainSnapshot(await resendDomain(path),settings);
     }
    }
    const updated=await db.rpc("update_store_email_verification",{p_store_id:actor.storeId,p_revision:settings.revision,p_result:snapshot});
    if(updated.error||!updated.data)return respond({error:"設定が変更されました。再読み込みしてください。"},409);
    settings=updated.data;
   }else return respond({error:"操作を確認してください。"},400);
  }
  return respond({settings,platformReady:emailPlatformReady()});
 }catch{return respond({error:"メール設定を処理できません。0018のSQL・Resendの設定をご確認ください。登録処理が失敗した場合は運営にお問い合わせください。"},503);}
}
export async function GET(request:NextRequest){return handle(request,false);}
export async function POST(request:NextRequest){return handle(request,true);}
