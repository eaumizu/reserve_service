const {notify}=vi.hoisted(()=>({notify:vi.fn()}));
vi.mock("../lib/line-reservation-events",()=>({dispatchLineReservationEvents:notify,LINE_EVENT_WARNING:"pending"}));
import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const {rpc,available,rules}=vi.hoisted(()=>({rpc:vi.fn(),available:vi.fn(),rules:vi.fn()}));
vi.mock("../lib/supabase-server",()=>({supabaseServer:()=>({rpc})}));
vi.mock("../lib/booking-rules-server",()=>({readBookingRules:rules}));
vi.mock("../lib/reservations/admin-availability",()=>({adminAvailableStarts:available,isBookingDate:(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)}));
import {POST} from "../app/api/customer-booking/route";
import {createCustomerToken,hashCustomerToken} from "../lib/customer-booking";
const token="a".repeat(64),booking={id:"booking",storeId:"trusted",serviceId:"service",staffId:"staff",canManage:true,updatedAt:"2030-01-01T01:00:00Z"};
const post=(body:unknown)=>POST(new NextRequest("http://localhost/api/customer-booking",{method:"POST",body:JSON.stringify(body)}));
beforeEach(()=>{vi.resetAllMocks();notify.mockResolvedValue({pending:false});vi.spyOn(Date,"now").mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));rpc.mockImplementation(async(name:string)=>({data:name==="customer_booking_staff_choices"?[{id:"staff",name:"担当"},{id:"second",name:"別担当"}]:booking,error:null}));rules.mockResolvedValue({advance_days:30,cutoff_minutes:60});available.mockResolvedValue(["2030-01-02T01:15:00Z"]);});
describe("customer reservation access",()=>{
  it("generates random 256-bit links",()=>{const a=createCustomerToken(),b=createCustomerToken();expect(a).toMatch(/^[a-f0-9]{64}$/);expect(a).not.toBe(b);expect(hashCustomerToken(a)).not.toBe(a);});
  it.each([{},null,{token:"bad"},{token:"a".repeat(65)}])("rejects invalid links before DB reads",async body=>{expect((await post(body)).status).toBe(404);expect(rpc).not.toHaveBeenCalled();});
  it("hashes the bearer token and returns private results",async()=>{const response=await post({token,action:"view"});expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(rpc).toHaveBeenCalledWith("read_customer_booking",{p_token_hash:hashCustomerToken(token)});});
  it("returns the same error for invalid and expired tokens",async()=>{rpc.mockResolvedValue({data:null,error:{message:"booking_not_found"}});expect((await post({token,action:"view"})).status).toBe(404);});
  it("never trusts posted tenant, reservation or staff identifiers for slots",async()=>{await post({token,action:"slots",date:"2030-01-02",storeId:"other",reservationId:"other",staffId:"other"});expect(available).toHaveBeenCalledWith("trusted","service","staff","2030-01-02","booking");expect(available).toHaveBeenCalledWith("trusted","service","second","2030-01-02","booking");expect(available).not.toHaveBeenCalledWith("other",expect.anything(),expect.anything(),expect.anything(),expect.anything());});
  it("does not reveal slots for a terminal booking",async()=>{rpc.mockResolvedValue({data:{...booking,canManage:false},error:null});expect((await post({token,action:"slots",date:"2030-01-02"})).status).toBe(409);expect(available).not.toHaveBeenCalled();});
  it("uses versioned cancellation without passing untrusted IDs",async()=>{const response=await post({token,action:"cancel",expectedUpdatedAt:booking.updatedAt,storeId:"other",reservationId:"other"});expect(response.status).toBe(200);expect(rpc).toHaveBeenLastCalledWith("manage_customer_booking_atomic",{p_token_hash:hashCustomerToken(token),p_action:"cancel",p_expected_updated_at:booking.updatedAt,p_start_at:null});});
  it("rejects an off-grid change before attempting mutation",async()=>{expect((await post({token,action:"reschedule",expectedUpdatedAt:booking.updatedAt,startAt:"2030-01-02T01:05:00Z"})).status).toBe(400);expect(rpc).toHaveBeenCalledOnce();});
  it("rejects missing version",async()=>expect((await post({token,action:"cancel"})).status).toBe(400));
  it("returns a conflict on an occupied slot",async()=>{rpc.mockResolvedValueOnce({data:booking,error:null}).mockResolvedValueOnce({data:null,error:{message:"time_slot_unavailable"}});expect((await post({token,action:"reschedule",expectedUpdatedAt:booking.updatedAt,startAt:"2030-01-02T01:15:00Z"})).status).toBe(409);});
  it("hides internal database errors",async()=>{rpc.mockResolvedValue({data:null,error:{message:"internal private detail"}});const response=await post({token,action:"view"});expect(response.status).toBe(503);expect(await response.text()).not.toContain("internal private detail");});
});

it("keeps a customer cancellation successful when LINE cannot send",async()=>{notify.mockResolvedValue({pending:true});const r=await post({token,action:"cancel",expectedUpdatedAt:booking.updatedAt,storeId:"other"});expect(r.status).toBe(200);expect((await r.json()).notificationWarning).toContain("予約の操作は完了");expect(notify).toHaveBeenCalledWith("trusted","booking");});

it("passes the selected staff to the atomic reschedule while keeping the token scope",async()=>{const staffId="22222222-2222-2222-2222-222222222223";const response=await post({token,action:"reschedule",staffId,storeId:"other",expectedUpdatedAt:booking.updatedAt,startAt:"2030-01-02T01:15:00Z"});expect(response.status).toBe(200);expect(rpc).toHaveBeenLastCalledWith("manage_customer_booking_with_staff_atomic",{p_token_hash:hashCustomerToken(token),p_action:"reschedule",p_expected_updated_at:booking.updatedAt,p_start_at:"2030-01-02T01:15:00Z",p_staff_id:staffId});});
it("returns staff-labelled slots for every eligible staff",async()=>{const r=await post({token,action:"slots",date:"2030-01-02"});expect((await r.json()).staffSlots).toEqual([{staffId:"staff",staffName:"担当",starts:["2030-01-02T01:15:00Z"]},{staffId:"second",staffName:"別担当",starts:["2030-01-02T01:15:00Z"]}]);});
