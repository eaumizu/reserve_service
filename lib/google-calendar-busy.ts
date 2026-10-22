import {supabaseServer} from './supabase-server';
import {calendarFetch,calendarPlatformReady,googleCalendarToken,decryptCalendarSecret,calendarEventId} from './google-calendar';
import {isBookingDate} from './reservations/date';
export type CalendarBusyRange={start:string;end:string};
type Event={id?:string;status?:string;transparency?:string;start?:{date?:string;dateTime?:string;timeZone?:string};end?:{date?:string;dateTime?:string;timeZone?:string};extendedProperties?:{private?:{storeId?:string;reservationId?:string}}};
function calendarMidnight(day:string,timeZone:string){
 const target=Date.parse(`${day}T00:00:00Z`);let value=target;
 const fmt=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<4;i++){
  const p=Object.fromEntries(fmt.formatToParts(value).map(x=>[x.type,x.value]));
  const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  if(local===target)return new Date(value);value+=target-local;
 }
 throw new Error('invalid_google_event_time');
}
export function googleBusyRange(event:Event,storeId:string,timeZone="Asia/Tokyo"):CalendarBusyRange|null{
 if(event.status==='cancelled'||event.transparency==='transparent')return null;
 const own=event.extendedProperties?.private;
 if(own?.storeId===storeId&&own.reservationId&&event.id===calendarEventId({storeId,reservationId:own.reservationId}))return null;
 const parse=(part:Event['start'])=>part?.dateTime&&/(Z|[+-]\d\d:\d\d)$/.test(part.dateTime)?new Date(part.dateTime):part?.date&&isBookingDate(part.date)?calendarMidnight(part.date,part.timeZone??timeZone):null;
 const start=parse(event.start),end=parse(event.end);
 if(!start||!end||!Number.isFinite(+start)||!Number.isFinite(+end)||+start>=+end)throw new Error('invalid_google_event');
 return {start:start.toISOString(),end:end.toISOString()};
}
const inFlight=new Map<string,Promise<CalendarBusyRange[]>>();
export function refreshCalendarBusy(storeId:string,day:string):Promise<CalendarBusyRange[]>{
 if(!isBookingDate(day))return Promise.reject(new Error('invalid_calendar_date'));
 const key=`${storeId}:${day}`;const prior=inFlight.get(key);if(prior)return prior;
 const pending=readBusy(storeId,day).finally(()=>{if(inFlight.get(key)===pending)inFlight.delete(key);});inFlight.set(key,pending);return pending;
}
async function readBusy(storeId:string,day:string){
 const db=supabaseServer(),cfg=await db.rpc('store_calendar_credentials',{p_store_id:storeId});if(cfg.error)throw new Error('calendar_busy_unavailable');
 const c=cfg.data as {busyEnabled?:boolean;revision:string;calendarId:string;refreshCipher:string}|null;
 if(!c?.busyEnabled)return [];
 if(!calendarPlatformReady())throw new Error('calendar_busy_unavailable');
 const begun=await db.rpc('begin_store_calendar_busy',{p_store_id:storeId,p_day:day,p_revision:c.revision});if(begun.error||!begun.data)throw new Error('calendar_busy_unavailable');
 const token=(await googleCalendarToken({grant_type:'refresh_token',refresh_token:decryptCalendarSecret(storeId,c.refreshCipher)})).access_token;
 const dayStart=Date.parse(`${day}T00:00:00+09:00`),ranges:CalendarBusyRange[]=[];let page:string|undefined;
 for(let n=0;n<10;n++){
  const query=new URLSearchParams({singleEvents:'true',showDeleted:'false',maxResults:'2500',timeZone:'Asia/Tokyo',timeMin:new Date(dayStart-86400000).toISOString(),timeMax:new Date(dayStart+2*86400000).toISOString(),...(page?{pageToken:page}:{})});
  const r=await calendarFetch(token,`/calendars/${encodeURIComponent(c.calendarId)}/events?${query}`);if(!r.ok)throw new Error('calendar_busy_unavailable');
  const value=await r.json();if(!Array.isArray(value.items))throw new Error('calendar_busy_unavailable');
  for(const event of value.items){const range=googleBusyRange(event,storeId,value.timeZone??"Asia/Tokyo");if(range)ranges.push(range);}
  page=value.nextPageToken;if(!page)break;if(n===9||typeof page!=='string')throw new Error('calendar_busy_unavailable');
 }
 const saved=await db.rpc('save_store_calendar_busy',{p_store_id:storeId,p_day:day,p_revision:c.revision,p_ticket:begun.data,p_intervals:ranges});if(saved.error||saved.data!==true)throw new Error('calendar_busy_unavailable');
 return ranges;
}
export async function refreshCalendarBusyForStart(storeId:string,start:string){
 const day=new Date(start).toLocaleDateString('en-CA',{timeZone:'Asia/Tokyo'});return refreshCalendarBusy(storeId,day);
}
