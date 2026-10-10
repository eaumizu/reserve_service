import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const {authorize,rpc}=vi.hoisted(()=>({authorize:vi.fn(),rpc:vi.fn()}));
vi.mock("../lib/admin-auth",()=>({authorizeStaff:authorize}));
vi.mock("../lib/supabase-server",()=>({supabaseServer:()=>({rpc})}));
import {POST} from "../app/api/admin/reservations/[id]/customer-link/route";
import {hashCustomerToken} from "../lib/customer-booking";
const id="11111111-1111-4111-8111-111111111111",request=new NextRequest("http://localhost/api/admin/reservations/"+id+"/customer-link",{method:"POST",headers:{Authorization:"Bearer token"}});
beforeEach(()=>{vi.resetAllMocks();authorize.mockResolvedValue({storeId:"trusted",role:"staff"});rpc.mockResolvedValue({data:null,error:null});});
describe("staff customer link issuance",()=>{
  it("requires authentication",async()=>{authorize.mockResolvedValue(null);expect((await POST(request,{params:Promise.resolve({id})})).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
  it("stores a hash for only the staff tenant",async()=>{const response=await POST(request,{params:Promise.resolve({id})});const body=await response.json();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");const token=body.managePath.split("#")[1];expect(rpc).toHaveBeenCalledWith("issue_customer_booking_access",{p_store_id:"trusted",p_reservation_id:id,p_token_hash:hashCustomerToken(token)});});
  it("does not reveal a different tenant's booking",async()=>{rpc.mockResolvedValue({data:null,error:{message:"booking_not_found"}});expect((await POST(request,{params:Promise.resolve({id})})).status).toBe(404);});
  it("rejects invalid IDs before writing",async()=>{expect((await POST(request,{params:Promise.resolve({id:"bad"})})).status).toBe(404);expect(rpc).not.toHaveBeenCalled();});
});
