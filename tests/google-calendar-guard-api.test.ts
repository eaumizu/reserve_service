import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const {refresh,rpc}=vi.hoisted(()=>({refresh:vi.fn(),rpc:vi.fn()}));
vi.mock('../lib/google-calendar-busy',()=>({refreshCalendarBusyForStart:refresh}));
vi.mock('../lib/admin-auth',()=>({authorizeStaff:async()=>({storeId:'11111111-1111-1111-1111-111111111111',role:'admin'})}));
vi.mock('../lib/supabase-server',()=>({supabaseServer:()=>({rpc})}));
vi.mock('../lib/booking-rules-server',()=>({readBookingRules:async()=>({advance_days:30,cutoff_minutes:0})}));
vi.mock('../lib/booking-rules',()=>({acceptsWebBooking:()=>true}));
import {POST as web} from '../app/api/reservations/route';
import {POST as manual} from '../app/api/admin/reservations/route';
import {POST as move} from '../app/api/admin/reservations/reschedule/route';
import {POST as customer} from '../app/api/customer-booking/route';
const store='11111111-1111-1111-1111-111111111111',id='22222222-2222-2222-2222-222222222222';
const input={storeId:store,serviceId:id,staffId:id,customerName:'予約者',customerPhone:'09000000000',startAt:'2030-01-02T01:00:00Z',expectedUpdatedAt:'2030-01-01T00:00:00Z',reservationId:id};
const req=(body:unknown)=>new NextRequest('https://booking.example.com/api/test',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('NEXT_PUBLIC_DEFAULT_STORE_ID',store);refresh.mockRejectedValue(new Error('Google unavailable'));});
it.each([['web',web,'web'],['manual',manual,'phone']] as const)('does not write a %s booking if Google cannot be checked',async(_name,handler,source)=>{
 expect((await handler(req({...input,source}))).status).toBe(503);expect(rpc).not.toHaveBeenCalled();expect(refresh).toHaveBeenCalledWith(store,input.startAt);
});
it('does not move an admin booking when Google checks fail',async()=>{expect((await move(req(input))).status).toBe(503);expect(rpc).not.toHaveBeenCalled();});
it('does not move a bearer-link booking when Google checks fail',async()=>{
 rpc.mockResolvedValue({data:{id,storeId:store,staffId:id,canManage:true}});
 expect((await customer(req({...input,action:'reschedule',token:'a'.repeat(64)}))).status).toBe(503);
 expect(rpc).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledWith('read_customer_booking',expect.anything());
});
