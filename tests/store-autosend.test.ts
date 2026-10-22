vi.mock("../lib/google-calendar-busy",()=>({refreshCalendarBusyForStart:async()=>[]}));
import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const {rpc,customer,calendar}=vi.hoisted(()=>({rpc:vi.fn(),customer:vi.fn(),calendar:vi.fn()}));
vi.mock('../lib/supabase-server',()=>({supabaseServer:()=>({rpc})}));
vi.mock('../lib/store-email',()=>({emailPlatformReady:()=>true,configuredEmailSender:async()=>({senderName:'店舗',senderEmail:'booking@example.com',domainId:'domain',revision:'revision',status:'verified'})}));
vi.mock('../lib/line-booking-notification',()=>({bookingSiteOrigin:()=> 'https://booking.example.com'}));
vi.mock('../lib/email-booking-events',()=>({emailBookingTokenCipher:()=>null,dispatchEmailBookingEvents:customer,EMAIL_EVENT_WARNING:'pending'}));
vi.mock('../lib/google-calendar',()=>({dispatchCalendarJobs:calendar}));
vi.mock('../lib/booking-rules-server',()=>({readBookingRules:async()=>({})}));
vi.mock('../lib/booking-rules',()=>({acceptsWebBooking:()=>true}));
import {POST} from '../app/api/reservations/route';
const store='11111111-1111-1111-1111-111111111111';
const job={id:'event',storeId:store,reservationId:'booking',leaseId:'lease',recipient:'owner@example.com',kind:'created',payload:{storeName:'店舗',customerName:'お客様',phone:'09000000000',serviceName:'整体',staffName:'',startAt:'2030-01-02T01:00:00Z',endAt:'2030-01-02T02:00:00Z',from:'店舗 <booking@example.com>',replyTo:'',senderRevision:'revision',domainId:'domain'}};
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('NEXT_PUBLIC_DEFAULT_STORE_ID',store);calendar.mockResolvedValue({pending:false});});
it('sends store mail before customer mail and recovers a transient failure during booking',async()=>{
 let delivered=false,claimed=false;const order:string[]=[];
 vi.stubGlobal('fetch',vi.fn().mockRejectedValueOnce(new TypeError('temporary network failure')).mockImplementation(async()=>{order.push('store');return new Response('{}');}));
 rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='create_customer_booking_atomic')return {data:{id:'booking'},error:null};
  if(name==='claim_store_booking_notification'){if(claimed)return {data:null};claimed=true;return {data:job};}
  if(name==='finish_store_booking_notification'){delivered=args.p_sent===true;return {error:null};}
  if(name==='store_booking_notification_dashboard')return {data:{pending:delivered?0:1}};
  throw new Error('unexpected RPC');
 });
 customer.mockImplementation(async()=>{expect(delivered).toBe(true);order.push('customer');return {pending:false};});
 const r=await POST(new NextRequest('https://booking.example.com/api/reservations',{method:'POST',body:JSON.stringify({storeId:store,source:'web',serviceId:'service',staffId:'staff',customerName:'お客様',customerPhone:'09000000000',customerEmail:'guest@example.com',startAt:'2030-01-02T01:00:00Z'})}));
 expect(r.status).toBe(201);expect((await r.json()).notificationWarning).toBeNull();expect(order).toEqual(['store','customer']);
 expect(fetch).toHaveBeenCalledTimes(2);for(const [url,init] of vi.mocked(fetch).mock.calls){expect(url).toBe('https://api.resend.com/emails');expect(init?.headers).toMatchObject({'Idempotency-Key':'event'});}
 expect(rpc).toHaveBeenCalledWith('finish_store_booking_notification',expect.objectContaining({p_sent:true,p_store_id:store}));
});
