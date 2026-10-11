begin;
create table if not exists booking_contact_records (
 store_id uuid not null references stores(id), channel text not null check(channel in ('email','line')),
 event_id uuid not null,contacted_at timestamptz not null default clock_timestamp(),contacted_by uuid not null,
 primary key(store_id,channel,event_id)
);
alter table booking_contact_records enable row level security;
revoke all on booking_contact_records from public,anon,authenticated,service_role;
create or replace function booking_contact_dashboard(p_store_id uuid,p_email_ready boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare reminders jsonb;events jsonb;
begin
 reminders:=booking_reminder_dashboard(p_store_id,p_email_ready);
 perform expire_email_booking_events(p_store_id);
 perform line_reservation_event_summary(p_store_id);
 update line_booking_notifications set state='cancelled',booking_token_cipher=null where store_id=p_store_id and state='pending' and created_at<clock_timestamp()-interval '23 hours';
 select coalesce(jsonb_agg(x.row),'[]'::jsonb) into events from (
 select jsonb_build_object('id',e.id,'reservationId',e.reservation_id,'channel',e.channel,'kind',e.kind,
 'state',case when c.event_id is not null then 'contacted' else e.state end,'customerName',cu.name,'phone',cu.phone,
 'startAt',e.payload->>'startAt','serviceName',e.payload->>'serviceName','staffName',e.payload->>'staffName',
 'createdAt',e.created_at,'canRetry',c.event_id is null and e.state='pending' and e.channel in ('email','line') and not (e.channel='line' and e.kind='created'),
 'canContact',c.event_id is null and e.state in ('pending','expired') and (e.lease_until is null or e.lease_until<clock_timestamp())) as row
 from (
 select id,store_id,reservation_id,'email'::text channel,kind,state,payload,created_at,lease_until from email_booking_events
 union all
 select id,store_id,reservation_id,'line',kind,state,payload,created_at,null::timestamptz from line_reservation_events
 union all
 select retry_key,store_id,reservation_id,'line','created',case when state='cancelled' then 'expired' else state end,booking,created_at,null::timestamptz from line_booking_notifications
 ) e join reservations r on r.id=e.reservation_id and r.store_id=e.store_id join customers cu on cu.id=r.customer_id
 left join booking_contact_records c on c.store_id=e.store_id and c.channel=e.channel and c.event_id=e.id
 where e.store_id=p_store_id
 order by (c.event_id is null and e.state in ('pending','sending','expired')) desc,e.created_at desc,e.id
 limit 200
 )x;
 return jsonb_build_object('enabled',reminders->'enabled','reminders',reminders->'rows','events',events);
end $$;
create or replace function record_booking_event_contact(p_store_id uuid,p_channel text,p_event_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_channel='email' then
  update email_booking_events set state='expired',payload=payload-'tokenCipher',lease_id=null,lease_until=null
  where store_id=p_store_id and id=p_event_id and state in ('pending','expired') and (lease_until is null or lease_until<clock_timestamp());
 elsif p_channel='line' then
  update line_reservation_events set state='expired' where store_id=p_store_id and id=p_event_id and state in ('pending','expired');
  if not found then
   update line_booking_notifications set state='cancelled',booking_token_cipher=null where store_id=p_store_id and retry_key=p_event_id and state in ('pending','cancelled');
  end if;
 else raise exception 'invalid_channel';end if;
 if not found then raise exception 'contact_changed';end if;
 insert into booking_contact_records(store_id,channel,event_id,contacted_by) values(p_store_id,p_channel,p_event_id,p_user_id) on conflict do nothing;
end $$;
revoke all on function booking_contact_dashboard(uuid,boolean),record_booking_event_contact(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function booking_contact_dashboard(uuid,boolean),record_booking_event_contact(uuid,text,uuid,uuid) to service_role;
commit;
