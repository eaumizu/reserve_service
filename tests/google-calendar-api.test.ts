import {beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const {auth,rpc,getUser,refreshBusy}=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),getUser:vi.fn(),refreshBusy:vi.fn()}));
vi.mock("../lib/google-calendar-busy",()=>({refreshCalendarBusy:refreshBusy}));
vi.mock("../lib/admin-auth",()=>({authorizeStaff:auth}));vi.mock("../lib/supabase-server",()=>({supabaseServer:()=>({rpc,auth:{admin:{getUserById:getUser}}})}));vi.mock("../lib/line-booking-notification",()=>({bookingSiteOrigin:()=>"https://booking.example.com"}));
import {encryptCalendarSecret} from "../lib/google-calendar";
import {GET,POST} from "../app/api/admin/calendar/route";
import {CalendarBusyError} from "../lib/calendar-diagnostics";
import {GET as callback} from "../app/api/admin/calendar/callback/route";
const req=(b?:unknown)=>new NextRequest('https://booking.example.com/api/admin/calendar',{method:b?'POST':'GET',...(b?{body:JSON.stringify(b)}:{})});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID','client');vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET','secret');vi.stubEnv('LINE_SETTINGS_ENCRYPTION_KEY','a'.repeat(64));auth.mockResolvedValue({role:'admin',storeId:'trusted',userId:'actor'});rpc.mockResolvedValue({data:{connection:null,pending:0,failed:0},error:null});vi.stubGlobal('fetch',vi.fn());});
it('requires an administrator',async()=>{auth.mockResolvedValue(null);expect((await GET(req())).status).toBe(401);auth.mockResolvedValue({role:'staff'});expect((await POST(req({action:'connect',calendarId:'primary'}))).status).toBe(403);expect(rpc).not.toHaveBeenCalled();});
it('never contacts Google on a dashboard GET',async()=>{expect((await GET(req())).status).toBe(200);expect(fetch).not.toHaveBeenCalled();});
it('binds OAuth state to the store, user and secure browser cookie',async()=>{const r=await POST(req({action:'connect',calendarId:'calendar@example.com',storeId:'other'}));expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/i);expect(r.headers.get('set-cookie')).toMatch(/Secure/i);expect(rpc).toHaveBeenCalledWith('issue_store_calendar_oauth',expect.objectContaining({p_store_id:'trusted',p_user_id:'actor',p_calendar_id:'calendar@example.com'}));expect((await r.json()).url).toContain('accounts.google.com');});
it('rejects a callback without matching browser state',async()=>{const r=await callback(new NextRequest('https://booking.example.com/api/admin/calendar/callback?state='+ 'a'.repeat(64)+'&code=secret-code'));expect(r.headers.get('location')).toBe('https://booking.example.com/admin?calendar=error');expect(rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
it('rejects revoked admin access before exchanging credentials',async()=>{rpc.mockResolvedValue({data:{storeId:'trusted',userId:'actor',calendarId:'primary',verifierCipher:'cipher'},error:null});getUser.mockResolvedValue({data:{user:{app_metadata:{role:'staff',store_id:'trusted'}}},error:null});const state='a'.repeat(64);const r=await callback(new NextRequest(`https://booking.example.com/api/admin/calendar/callback?state=${state}&code=secret`,{headers:{cookie:`booking_google_state=${state}`}}));expect(r.headers.get('location')).toContain('calendar=error');expect(fetch).not.toHaveBeenCalled();});

it('saves encrypted refresh credentials after a valid owner consent',async()=>{const state='b'.repeat(64);rpc.mockResolvedValue({data:{storeId:'trusted',userId:'actor',calendarId:'primary',verifierCipher:encryptCalendarSecret('trusted','verifier')},error:null});getUser.mockResolvedValue({data:{user:{app_metadata:{role:'admin',store_id:'trusted'}}},error:null});vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({access_token:'access',refresh_token:'refresh-secret'}))).mockResolvedValueOnce(new Response(JSON.stringify({id:'owned-calendar',summary:'予約',accessRole:'owner'})));const r=await callback(new NextRequest(`https://booking.example.com/api/admin/calendar/callback?state=${state}&code=secret-code`,{headers:{cookie:`booking_google_state=${state}`}}));expect(r.headers.get('location')).toContain('calendar=connected');expect(rpc).toHaveBeenCalledWith('save_store_calendar_connection',expect.objectContaining({p_store_id:'trusted',p_user_id:'actor',p_calendar_id:'owned-calendar'}));const saved=rpc.mock.calls.find(c=>c[0]==='save_store_calendar_connection')?.[1];expect(saved.p_refresh_cipher).not.toContain('refresh-secret');expect(r.headers.get('location')).not.toContain('secret');});
it('only accepts an explicit busy flag and scopes it to the authenticated store',async()=>{
 expect((await POST(req({action:'busy',enabled:'true'}))).status).toBe(400);
 expect((await POST(req({action:'busy',enabled:true,storeId:'other'}))).status).toBe(200);
 expect(rpc).toHaveBeenCalledWith('set_store_calendar_busy',{p_store_id:'trusted',p_enabled:true});
});
it('checks actual Google busy times only for the admin store and selected day without sending notifications',async()=>{
 const credentials={busyEnabled:true,refreshCipher:'private-cipher',revision:'private-revision'};
 rpc.mockImplementation(async n=>({data:n==='store_calendar_credentials'?credentials:{connection:{calendarId:'calendar',calendarName:'店舗予約'},pending:0,failed:0},error:null}));
 refreshBusy.mockResolvedValue([{start:'2030-01-01T01:00:00Z',end:'2030-01-01T02:00:00Z'},{start:'2030-01-02T01:00:00Z',end:'2030-01-02T02:00:00Z'}]);
 const r=await POST(req({action:'check-busy',date:'2030-01-01',storeId:'other'}));expect(r.status).toBe(200);
 const body=await r.json();expect(body.busyCheck.intervals).toEqual([{start:'2030-01-01T01:00:00Z',end:'2030-01-01T02:00:00Z'}]);
 expect(refreshBusy).toHaveBeenCalledExactlyOnceWith('trusted','2030-01-01');expect(JSON.stringify(body)).not.toContain('private-');
 expect(rpc.mock.calls.some(c=>/claim|queue|finish|save/.test(c[0]))).toBe(false);expect(fetch).not.toHaveBeenCalled();
});
it('rejects invalid check dates, disconnected settings, and failed Google reads',async()=>{
 expect((await POST(req({action:'check-busy',date:'2030-02-30'}))).status).toBe(400);expect(refreshBusy).not.toHaveBeenCalled();
 rpc.mockResolvedValue({data:{busyEnabled:false}});expect((await POST(req({action:'check-busy',date:'2030-01-01'}))).status).toBe(409);expect(refreshBusy).not.toHaveBeenCalled();
 rpc.mockResolvedValue({data:{busyEnabled:true}});refreshBusy.mockRejectedValue(new Error('Google permission lost'));
 expect((await POST(req({action:'check-busy',date:'2030-01-01'}))).status).toBe(503);
 auth.mockResolvedValue({role:'staff'});refreshBusy.mockClear();expect((await POST(req({action:'check-busy',date:'2030-01-01'}))).status).toBe(403);expect(refreshBusy).not.toHaveBeenCalled();
});
it('provides actionable, secret-free diagnostics only after admin authorization',async()=>{
 rpc.mockResolvedValue({data:{busyEnabled:true}});
 for(const failure of [new CalendarBusyError('decrypt'),new CalendarBusyError('google_auth','invalid_client'),new CalendarBusyError('google_auth','invalid_grant')]){
  refreshBusy.mockRejectedValueOnce(failure);
  const r=await POST(req({action:'check-busy',date:'2030-01-01'}));expect(r.status).toBe(503);
  const body=await r.json();expect(body.diagnosticCode).toMatch(/^calendar_/);expect(body.error).toBeTruthy();
 }
 refreshBusy.mockRejectedValueOnce(new Error('private refresh-token, calendar-id and secret'));
 const body=await (await POST(req({action:'check-busy',date:'2030-01-01'}))).json();
 expect(body.diagnosticCode).toBe('calendar_check_failed');expect(JSON.stringify(body)).not.toMatch(/private|refresh-token|calendar-id/);
 auth.mockResolvedValue({role:'staff'});refreshBusy.mockClear();
 const denied=await POST(req({action:'check-busy',date:'2030-01-01'}));expect(denied.status).toBe(403);expect(refreshBusy).not.toHaveBeenCalled();
});
