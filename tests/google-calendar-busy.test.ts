import {beforeEach,expect,it,vi} from 'vitest';
const {rpc,fetchCalendar,token}=vi.hoisted(()=>({rpc:vi.fn(),fetchCalendar:vi.fn(),token:vi.fn()}));
vi.mock('../lib/supabase-server',()=>({supabaseServer:()=>({rpc})}));
vi.mock('../lib/google-calendar',async orig=>({...await orig<typeof import('../lib/google-calendar')>(),calendarFetch:fetchCalendar,googleCalendarToken:token,decryptCalendarSecret:()=> 'refresh',calendarPlatformReady:()=>true}));
import {googleBusyRange,refreshCalendarBusy} from '../lib/google-calendar-busy';
import {calendarEventId} from '../lib/google-calendar';
const event={start:{dateTime:'2030-01-01T10:00:00+09:00'},end:{dateTime:'2030-01-01T11:00:00+09:00'}};
beforeEach(()=>{vi.resetAllMocks();token.mockResolvedValue({access_token:'access'});rpc.mockImplementation(async n=>({data:n==='store_calendar_credentials'?{busyEnabled:true,revision:'rev',calendarId:'calendar',refreshCipher:'cipher'}:n==='begin_store_calendar_busy'?'ticket':true,error:null}));fetchCalendar.mockResolvedValue(new Response(JSON.stringify({items:[event],timeZone:'Asia/Tokyo'})));});
it('handles cancelled, free and all-day events with exclusive end dates',()=>{
 expect(googleBusyRange({...event,status:'cancelled'},'store')).toBeNull();expect(googleBusyRange({...event,transparency:'transparent'},'store')).toBeNull();
 expect(googleBusyRange({start:{date:'2030-01-01'},end:{date:'2030-01-02'}},'store')).toEqual({start:'2029-12-31T15:00:00.000Z',end:'2030-01-01T15:00:00.000Z'});
 expect(googleBusyRange({start:{date:'2030-03-10'},end:{date:'2030-03-11'}},'store','America/Los_Angeles')).toEqual({start:'2030-03-10T08:00:00.000Z',end:'2030-03-11T07:00:00.000Z'});
});
it('excludes only system-owned event IDs and metadata, including the booking being moved',()=>{
 const own={id:calendarEventId({storeId:'store',reservationId:'booking'}),extendedProperties:{private:{storeId:'store',reservationId:'booking'}}};
 expect(googleBusyRange({...event,...own},'store')).toBeNull();expect(googleBusyRange({...event,...own,id:'manually-added'},'store')).not.toBeNull();expect(googleBusyRange({...event,...own},'other')).not.toBeNull();
});
it('does not treat malformed busy events as free time',()=>{expect(()=>googleBusyRange({start:{dateTime:'bad'},end:event.end},'store')).toThrow();});
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
