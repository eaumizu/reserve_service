import {NextRequest,NextResponse} from "next/server";
import {authorizeStaff} from "../../../../lib/admin-auth";
import {supabaseServer} from "../../../../lib/supabase-server";
const respond=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{"Cache-Control":"private, no-store"}});
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
async function handle(req:NextRequest,write:boolean){
 try{
  const actor=await authorizeStaff(req.headers.get("authorization"));if(!actor)return respond({error:"ログインしてください。"},401);
  const db=supabaseServer();let id=req.nextUrl.searchParams.get("id");const pageText=req.nextUrl.searchParams.get("page")??"0";
  if(!/^\d{1,4}$/.test(pageText))return respond({error:"表示ページを確認してください。"},400);const page=Number(pageText);if(page>2000)return respond({error:"表示ページを確認してください。"},400);
  if(write){
   let body;try{body=await req.json();}catch{return respond({error:"入力内容を確認してください。"},400);}
   if(!body||!uuid(body.id)||!uuid(body.revision)||typeof body.note!=="string"||body.note.length>4000||(actor.role==="admin"&&(typeof body.name!=="string"||!body.name.trim()||body.name.length>100)))return respond({error:"氏名・メモの入力内容を確認してください。"},400);
   id=body.id;
   const saved=await db.rpc("save_customer_ledger",{p_store_id:actor.storeId,p_customer_id:id,p_expected_revision:body.revision,p_name:actor.role==="admin"?body.name.trim():"",p_note:body.note,p_edit_name:actor.role==="admin"});
   if(saved.error){const m=saved.error.message??"";if(m.includes("customer_name_conflict"))return respond({error:"同じ電話番号と氏名の別の顧客台帳があります。自動で統合せず、内容を確認してください。"},409);if(m.includes("customer_profile_changed"))return respond({error:"台帳が更新されています。再読み込みしてから保存してください。"},409);if(m.includes("customer_not_found"))return respond({error:"お客様が見つかりません。"},404);throw saved.error;}
  }
  if(id){
   if(!uuid(id))return respond({error:"お客様を選び直してください。"},400);
   const d=await db.rpc("customer_ledger_detail",{p_store_id:actor.storeId,p_customer_id:id,p_offset:page*20});if(d.error){if(d.error.message?.includes("customer_not_found"))return respond({error:"お客様が見つかりません。"},404);throw d.error;}
   return respond({...d.data,reservations:(d.data?.reservations??[]).slice(0,20),hasMore:(d.data?.reservations??[]).length>20,canEditName:actor.role==="admin"});
  }
  const query=req.nextUrl.searchParams.get("q")??"";if(query.length>100)return respond({error:"検索文字は100文字以内で入力してください。"},400);
  const r=await db.rpc("customer_ledger_search",{p_store_id:actor.storeId,p_query:query.trim(),p_offset:page*50});if(r.error)throw r.error;
  return respond({rows:(r.data?.rows??[]).slice(0,50),hasMore:(r.data?.rows??[]).length>50});
 }catch{return respond({error:"顧客台帳を取得できません。0025のSQL適用をご確認ください。"},503);}
}
export async function GET(req:NextRequest){return handle(req,false);}
export async function POST(req:NextRequest){return handle(req,true);}
