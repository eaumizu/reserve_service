import {NextRequest,NextResponse} from "next/server";
import {authorizeStaff} from "../../../../../lib/admin-auth";
import {supabaseServer} from "../../../../../lib/supabase-server";
import {dispatchLineReservationEvents} from "../../../../../lib/line-reservation-events";
export const maxDuration=30;
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
async function handle(request:NextRequest,retry:boolean){
 try{
  const staff=await authorizeStaff(request.headers.get("authorization"));if(!staff)return respond({error:"ログインが必要です。"},401);if(staff.role!=="admin")return respond({error:"管理者のみ操作できます。"},403);
  const notification=retry?await dispatchLineReservationEvents(staff.storeId):{pending:false};
  const summary=await supabaseServer().rpc("line_reservation_event_summary",{p_store_id:staff.storeId});if(summary.error)throw summary.error;
  return respond({...summary.data,retryPending:notification.pending});
 }catch{return respond({error:"通知の状態を取得できません。0015のSQL適用をご確認ください。"},503);}
}
export async function GET(request:NextRequest){return handle(request,false);}
export async function POST(request:NextRequest){return handle(request,true);}
