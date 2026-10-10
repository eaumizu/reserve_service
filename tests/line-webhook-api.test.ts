import {beforeEach,expect,it,vi} from "vitest";
import {createHmac} from "node:crypto";
import {NextRequest} from "next/server";
const {query,rpc}=vi.hoisted(()=>({query:{select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn()},rpc:vi.fn()}));
vi.mock("../lib/supabase-server",()=>({supabaseServer:()=>({from:()=>query,rpc})}));
import {encryptLineCredential} from "../lib/line-settings-secret";
import {POST} from "../app/api/line/webhook/[storeId]/route";
const storeId="11111111-1111-1111-1111-111111111111";
const context={params:Promise.resolve({storeId})};
function request(events:unknown[],secret="secret"){const body=JSON.stringify({events});return new NextRequest("http://localhost/api/line/webhook/"+storeId,{method:"POST",body,headers:{"x-line-signature":createHmac("sha256",secret).update(body).digest("base64")}});}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("LINE_SETTINGS_ENCRYPTION_KEY","b".repeat(64));query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.maybeSingle.mockResolvedValue({data:{channel_secret_cipher:encryptLineCredential(storeId,"secret")},error:null});rpc.mockResolvedValue({data:true,error:null});});
it("rejects forged signature before mutations",async()=>{expect((await POST(request([],"wrong"),context)).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
it("accepts LINE verification empty events",async()=>{expect((await POST(request([]),context)).status).toBe(200);expect(rpc).not.toHaveBeenCalled();});
it("uses signed direct-message source and hashes the code",async()=>{const event={type:"message",source:{type:"user",userId:"U"+"a".repeat(32)},message:{type:"text",text:"予約連携 "+"b".repeat(32)}};expect((await POST(request([event]),context)).status).toBe(200);expect(rpc).toHaveBeenCalledWith("consume_customer_line_code",{p_store_id:storeId,p_code_hash:expect.stringMatching(/^[a-f0-9]{64}$/),p_line_user_id:event.source.userId});expect(JSON.stringify(rpc.mock.calls)).not.toContain("b".repeat(32));});
it("ignores group messages and unrelated content",async()=>{expect((await POST(request([{type:"message",source:{type:"group",userId:"U"+"a".repeat(32)},message:{type:"text",text:"予約連携 "+"b".repeat(32)}}]),context)).status).toBe(200);expect(rpc).not.toHaveBeenCalled();});
it("signals database failure for LINE retry without leaking internals",async()=>{rpc.mockResolvedValue({error:{message:"secret"}});const r=await POST(request([{type:"message",source:{type:"user",userId:"U"+"a".repeat(32)},message:{type:"text",text:"予約連携 "+"b".repeat(32)}}]),context);expect(r.status).toBe(503);expect(await r.text()).toBe("");});
