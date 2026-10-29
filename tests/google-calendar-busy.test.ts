import {beforeEach,expect,it,vi} from 'vitest';
const {rpc,fetchCalendar,token,from,decrypt}=vi.hoisted(()=>({rpc:vi.fn(),fetchCalendar:vi.fn(),token:vi.fn(),from:vi.fn(),decrypt:vi.fn()}));
vi.mock('../lib/supabase-server',()=>({supabaseServer:()=>({rpc,from})}));
vi.mock('../lib/google-calendar',async orig=>({...await orig<typeof import('../lib/google-calendar')>(),calendarFetch:fetchCalendar,googleCalendarToken:token,decryptCalendarSecret:decrypt,calendarPlatformReady:()=>true}));
import {CalendarBusyError,CalendarAuthError} from '../lib/calendar-diagnostics';
import {googleBusyRange,refreshCalendarBusy} from '../lib/google-calendar-busy';
import {calendarEventId} from '../lib/google-calendar';
const event={start:{dateTime:'2030-01-01T10:00:00+09:00'},end:{dateTime:'2030-01-01T11:00:00+09:00'}};
beforeEach(()=>{vi.resetAllMocks();decrypt.mockReturnValue('refresh');token.mockResolvedValue({access_token:'access'});rpc.mockImplementation(async n=>({data:n==='store_calendar_credentials'?{busyEnabled:true,revision:'rev',calendarId:'calendar',refreshCipher:'cipher'}:n==='begin_store_calendar_busy'?'ticket':true,error:null}));fetchCalendar.mockResolvedValue(new Response(JSON.stringify({items:[event],timeZone:'Asia/Tokyo'})));});
it('handles cancelled, free and all-day events with exclusive end dates',()=>{
 expect(googleBusyRange({...event,status:'cancelled'},'store')).toBeNull();expect(googleBusyRange({...event,transparency:'transparent'},'store')).toBeNull();
 expect(googleBusyRange({start:{date:'2030-01-01'},end:{date:'2030-01-02'}},'store')).toEqual({start:'2029-12-31T15:00:00.000Z',end:'2030-01-01T15:00:00.000Z'});
 expect(googleBusyRange({start:{date:'2030-03-10'},end:{date:'2030-03-11'}},'store','America/Los_Angeles')).toEqual({start:'2030-03-10T08:00:00.000Z',end:'2030-03-11T07:00:00.000Z'});
});
it('reuses time zone rules without reusing event dates, including both DST transitions',()=>{
 const allDay=(start:string,end:string)=>({start:{date:start},end:{date:end}});
 expect(googleBusyRange(allDay('2030-01-01','2030-01-02'),'store','America/Los_Angeles')).toEqual({start:'2030-01-01T08:00:00.000Z',end:'2030-01-02T08:00:00.000Z'});
 expect(googleBusyRange(allDay('2030-07-01','2030-07-02'),'store','America/Los_Angeles')).toEqual({start:'2030-07-01T07:00:00.000Z',end:'2030-07-02T07:00:00.000Z'});
 expect(googleBusyRange(allDay('2030-11-03','2030-11-04'),'other','America/Los_Angeles')).toEqual({start:'2030-11-03T07:00:00.000Z',end:'2030-11-04T08:00:00.000Z'});
 expect(()=>googleBusyRange(allDay('2030-01-01','2030-01-02'),'store','invalid/timezone')).toThrow();
});
it('excludes only system-owned event IDs and metadata, including the booking being moved',()=>{
 const own={id:calendarEventId({storeId:'store',reservationId:'booking'}),extendedProperties:{private:{storeId:'store',reservationId:'booking'}}};
 const bookings=new Map([['booking',{start_at:event.start.dateTime,end_at:event.end.dateTime}]]);
 expect(googleBusyRange({...event,...own},'store','Asia/Tokyo',bookings)).toBeNull();
 expect(googleBusyRange({...event,...own},'store')).not.toBeNull();
 expect(googleBusyRange({...event,...own,id:'manually-added'},'store','Asia/Tokyo',bookings)).not.toBeNull();expect(googleBusyRange({...event,...own},'other','Asia/Tokyo',bookings)).not.toBeNull();
});
it('does not treat malformed busy events as free time',()=>{expect(()=>googleBusyRange({start:{dateTime:'bad'},end:event.end},'store')).toThrow();});
it('keeps a system event busy when Google moves it away from its booking time',()=>{
 const reservationId='22222222-2222-2222-2222-222222222222';
 const moved={...event,id:calendarEventId({storeId:'store',reservationId}),extendedProperties:{private:{storeId:'store',reservationId}},start:{dateTime:'2030-01-01T12:00:00+09:00'},end:{dateTime:'2030-01-01T13:00:00+09:00'}};
 const bookings=new Map([[reservationId,{start_at:event.start.dateTime,end_at:event.end.dateTime}]]);
 expect(googleBusyRange(moved,'store','Asia/Tokyo',bookings)).toEqual({start:'2030-01-01T03:00:00.000Z',end:'2030-01-01T04:00:00.000Z'});
 expect(googleBusyRange({...moved,start:event.start},'store','Asia/Tokyo',bookings)).not.toBeNull();
});
it('checks the current confirmed booking before excluding an exported event, and keeps moved or stale events occupied',async()=>{
 const reservationId='22222222-2222-2222-2222-222222222222';
 const own={...event,id:calendarEventId({storeId:'store',reservationId}),extendedProperties:{private:{storeId:'store',reservationId}}};
 let rows:{id:string;start_at:string;end_at:string}[]=[{id:reservationId,start_at:event.start.dateTime,end_at:event.end.dateTime}];
 const q={select:vi.fn(),eq:vi.fn(),in:vi.fn()};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);q.in.mockImplementation(async()=>({data:rows,error:null}));from.mockReturnValue(q);
 const read=(item:unknown)=>fetchCalendar.mockResolvedValue(new Response(JSON.stringify({items:[item]})));
 read(own);expect(await refreshCalendarBusy('store','2030-01-01')).toEqual([]);
 expect(q.eq).toHaveBeenCalledWith('store_id','store');expect(q.eq).toHaveBeenCalledWith('status','confirmed');expect(q.in).toHaveBeenCalledWith('id',[reservationId]);
 read({...own,start:{dateTime:'2030-01-01T12:00:00+09:00'},end:{dateTime:'2030-01-01T13:00:00+09:00'}});
 expect(await refreshCalendarBusy('store','2030-01-01')).toEqual([{start:'2030-01-01T03:00:00.000Z',end:'2030-01-01T04:00:00.000Z'}]);
 rows=[];read(own);expect(await refreshCalendarBusy('store','2030-01-01')).toHaveLength(1);
 q.in.mockResolvedValue({data:null,error:{message:'lookup failed'}});
 await expect(refreshCalendarBusy('store','2030-01-01')).rejects.toThrow();
});
it('reads newly added and removed Google appointments on each refresh',async()=>{
 fetchCalendar.mockResolvedValueOnce(new Response(JSON.stringify({items:[]}))).mockResolvedValueOnce(new Response(JSON.stringify({items:[event]}))).mockResolvedValueOnce(new Response(JSON.stringify({items:[]})));
 expect(await refreshCalendarBusy('store','2030-01-01')).toHaveLength(0);
 expect(await refreshCalendarBusy('store','2030-01-01')).toHaveLength(1);
 expect(await refreshCalendarBusy('store','2030-01-01')).toHaveLength(0);
 expect(token).toHaveBeenCalledTimes(3);
});
it('expands recurring events, follows every page and shares simultaneous staff reads',async()=>{
 fetchCalendar.mockResolvedValueOnce(new Response(JSON.stringify({items:[event],nextPageToken:'next'}))).mockResolvedValueOnce(new Response(JSON.stringify({items:[{...event,start:{dateTime:'2030-01-01T12:00:00+09:00'},end:{dateTime:'2030-01-01T13:00:00+09:00'}}]})));
 const [a,b]=await Promise.all([refreshCalendarBusy('store','2030-01-01'),refreshCalendarBusy('store','2030-01-01')]);expect(a).toEqual(b);expect(a).toHaveLength(2);expect(token).toHaveBeenCalledTimes(1);expect(fetchCalendar).toHaveBeenCalledTimes(2);expect(fetchCalendar.mock.calls[0][1]).toContain('singleEvents=true');expect(fetchCalendar.mock.calls[1][1]).toContain('pageToken=next');
 expect(rpc).toHaveBeenCalledWith('save_store_calendar_busy',expect.objectContaining({p_store_id:'store',p_revision:'rev',p_ticket:'ticket',p_intervals:a}));
});
it('fails closed on lost permission and does not replace the snapshot with empty intervals',async()=>{
 fetchCalendar.mockResolvedValue(new Response('{}',{status:403}));await expect(refreshCalendarBusy('store','2030-01-01')).rejects.toThrow();expect(rpc.mock.calls.some(c=>c[0]==='save_store_calendar_busy')).toBe(false);
});
it('rejects a result superseded by a new refresh or connection',async()=>{
 rpc.mockImplementation(async n=>({data:n==='store_calendar_credentials'?{busyEnabled:true,revision:'rev',calendarId:'cal'}:n==='begin_store_calendar_busy'?'ticket':false}));await expect(refreshCalendarBusy('store','2030-01-01')).rejects.toThrow();
});
it('does not contact Google when disconnected or the feature is disabled',async()=>{
 for(const data of [null,{busyEnabled:false}]){rpc.mockResolvedValue({data,error:null});expect(await refreshCalendarBusy('store','2030-01-01')).toEqual([]);}expect(fetchCalendar).not.toHaveBeenCalled();
});
it('does not treat a connected calendar with an unknown busy setting as free',async()=>{
 rpc.mockResolvedValue({data:{calendarId:'calendar',revision:'rev'},error:null});
 await expect(refreshCalendarBusy('store','2030-01-01')).rejects.toThrow('calendar_busy_unavailable');expect(fetchCalendar).not.toHaveBeenCalled();
});
it('identifies decryption failure before contacting Google and does not clear busy times',async()=>{
 decrypt.mockImplementation(()=>{throw new Error('private cipher and token');});
 const failure=await refreshCalendarBusy('store','2030-01-01').catch(e=>e);
 expect(failure).toBeInstanceOf(CalendarBusyError);expect(failure.stage).toBe('decrypt');
 expect(token).not.toHaveBeenCalled();expect(fetchCalendar).not.toHaveBeenCalled();
 expect(rpc.mock.calls.some(c=>c[0]==='save_store_calendar_busy')).toBe(false);
});
it('distinguishes rejected Google client credentials from a revoked refresh grant',async()=>{
 for(const reason of ['invalid_client','invalid_grant'] as const){
  token.mockRejectedValue(new CalendarAuthError(reason));
  const failure=await refreshCalendarBusy('store','2030-01-01').catch(e=>e);
  expect(failure.stage).toBe('google_auth');expect(failure.reason).toBe(reason);
 }
 expect(fetchCalendar).not.toHaveBeenCalled();expect(rpc.mock.calls.some(c=>c[0]==='save_store_calendar_busy')).toBe(false);
});
it('identifies Google read failures and platform subrequest exhaustion',async()=>{
 fetchCalendar.mockRejectedValueOnce(new Error('Too many subrequests.'));
 const limited=await refreshCalendarBusy('store','2030-01-01').catch(e=>e);
 expect(limited.stage).toBe('google_events');expect(limited.reason).toBe('subrequests');
 fetchCalendar.mockResolvedValueOnce(new Response('{}',{status:403}));
 const denied=await refreshCalendarBusy('store','2030-01-01').catch(e=>e);expect(denied.stage).toBe('google_events');
 expect(rpc.mock.calls.some(c=>c[0]==='save_store_calendar_busy')).toBe(false);
});
