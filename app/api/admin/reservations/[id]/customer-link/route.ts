import { NextRequest,NextResponse } from "next/server";
import { authorizeStaff } from "../../../../../../lib/admin-auth";
import { supabaseServer } from "../../../../../../lib/supabase-server";
import { createCustomerToken,hashCustomerToken,customerManagementPath,CUSTOMER_HEADERS } from "../../../../../../lib/customer-booking";
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
  try{
    const staff=await authorizeStaff(request.headers.get("authorization"));
    if(!staff)return NextResponse.json({error:"ログインが必要です。"},{status:401,headers:CUSTOMER_HEADERS});
    const {id}=await context.params;
    if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return NextResponse.json({error:"予約が見つかりません。"},{status:404,headers:CUSTOMER_HEADERS});
    const token=createCustomerToken();
    const result=await supabaseServer().rpc("issue_customer_booking_access",{p_store_id:staff.storeId,p_reservation_id:id,p_token_hash:hashCustomerToken(token)});
    if(result.error){
      if(result.error.message.includes("booking_not_found"))return NextResponse.json({error:"予約が見つかりません。"},{status:404,headers:CUSTOMER_HEADERS});
      throw result.error;
    }
    return NextResponse.json({managePath:customerManagementPath(token)},{headers:CUSTOMER_HEADERS});
  }catch{return NextResponse.json({error:"予約リンクを発行できませんでした。管理者にDB設定をご確認ください。"},{status:503,headers:CUSTOMER_HEADERS});}
}
