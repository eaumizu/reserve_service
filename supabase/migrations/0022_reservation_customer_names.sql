begin;
alter table reservations add column if not exists customer_name text;
update reservations r set customer_name=c.name from customers c where c.id=r.customer_id and r.customer_name is null;
alter table reservations alter column customer_name set not null;
create or replace function fill_reservation_customer_name() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.customer_name is null then select name into new.customer_name from customers where id=new.customer_id and store_id=new.store_id;end if;
 return new;
end $$;
drop trigger if exists reservation_customer_name on reservations;
create trigger reservation_customer_name before insert on reservations for each row execute function fill_reservation_customer_name();
revoke all on function fill_reservation_customer_name() from public,anon,authenticated,service_role;
create or replace function create_reservation_atomic(p_store_id uuid, p_service_id uuid, p_staff_id uuid, p_start_at timestamptz, p_customer_name text, p_customer_phone text, p_source reservation_source, p_note text default null)
returns reservations language plpgsql security definer set search_path = public as $$
declare
  v_service services;
  v_customer_id uuid;
  v_end_at timestamptz;
  v_window tstzrange;
  v_reservation reservations;
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  select timezone into v_timezone from stores where id = p_store_id;
  if not found then raise exception 'invalid_store' using errcode = 'P0001'; end if;

  if p_start_at is null or not isfinite(p_start_at) or mod(extract(epoch from p_start_at), 900) <> 0 then
    raise exception 'invalid_start_time' using errcode = 'P0001';
  end if;

  -- Serializes concurrent requests for one staff member; the exclusion constraint remains a final safeguard.
  perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text, 0));

  select s.* into v_service
  from services s
  join staff_services ss on ss.service_id = s.id
  join staff st on st.id = ss.staff_id
  where s.id = p_service_id
    and s.store_id = p_store_id
    and ss.staff_id = p_staff_id
    and st.store_id = p_store_id
    and st.active
    and s.active;
  if not found then raise exception 'invalid_staff_service' using errcode = 'P0001'; end if;

  v_end_at := p_start_at + make_interval(mins => v_service.duration_minutes);
  v_local_start := p_start_at at time zone v_timezone;
  v_local_end := (v_end_at + make_interval(mins => v_service.buffer_after)) at time zone v_timezone;
  if v_local_start::date <> v_local_end::date or not exists (
    select 1 from business_hours h
    where h.store_id = p_store_id
      and h.weekday = extract(dow from v_local_start)::smallint
      and v_local_start::time >= h.start_time
      and v_local_end::time <= h.end_time
  ) then
    raise exception 'outside_business_hours' using errcode = 'P0001';
  end if;

  v_window := tstzrange(p_start_at - make_interval(mins => v_service.buffer_before), v_end_at + make_interval(mins => v_service.buffer_after), '[)');
  if exists (
    select 1 from reservations r join services s on s.id = r.service_id
    where r.staff_id = p_staff_id and r.status = 'confirmed'
      and tstzrange(r.start_at - make_interval(mins => s.buffer_before), r.end_at + make_interval(mins => s.buffer_after), '[)') && v_window
  ) or exists (
    select 1 from availability_blocks b
    where b.store_id = p_store_id
      and (b.staff_id is null or b.staff_id = p_staff_id)
      and tstzrange(b.start_at, b.end_at, '[)') && v_window
  ) then
    raise exception 'time_slot_unavailable' using errcode = 'P0001';
  end if;

  insert into customers(store_id, name, phone)
  values (p_store_id, p_customer_name, p_customer_phone)
  on conflict(store_id, phone) do update set name = customers.name
  returning id into v_customer_id;
  insert into reservations(store_id, customer_id, service_id, staff_id, start_at, end_at, status, source, note, customer_name)
  values (p_store_id, v_customer_id, p_service_id, p_staff_id, p_start_at, v_end_at, 'confirmed', p_source, p_note, btrim(p_customer_name))
  returning * into v_reservation;
  return v_reservation;
end; $$;
create or replace function read_customer_booking(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  select jsonb_build_object('id',r.id,'storeId',r.store_id,'storeName',s.name,
    'serviceId',r.service_id,'serviceName',sv.name,'staffId',r.staff_id,'staffName',st.name,
    'customerName',r.customer_name,'startAt',r.start_at,'endAt',r.end_at,
    'status',r.status,'updatedAt',r.updated_at,
    'canManage',r.status='confirmed' and r.start_at>clock_timestamp())
  into v_result from customer_booking_access a join reservations r on r.id=a.reservation_id and r.store_id=a.store_id
  join stores s on s.id=r.store_id join services sv on sv.id=r.service_id
  join staff st on st.id=r.staff_id join customers c on c.id=r.customer_id
  where a.token_hash=p_token_hash and a.expires_at>clock_timestamp();
  if v_result is null then raise exception 'booking_not_found'; end if;
  return v_result;
end; $$;
create or replace function booking_reminder_dashboard(p_store_id uuid,p_email_ready boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform prepare_booking_reminders(p_store_id,p_email_ready);
 select coalesce(jsonb_agg(x.row order by x.start_at,x.id),'[]'::jsonb) into result from (
 select j.id,j.start_at,jsonb_build_object('id',j.id,'reservationId',r.id,'startAt',r.start_at,'customerName',r.customer_name,'phone',c.phone,
 'serviceName',sv.name,'staffName',st.name,'channel',j.channel,'state',j.state,'failed',j.failed,
 'sentAt',j.sent_at,'contactedAt',j.contacted_at) as row
 from booking_reminders j join reservations r on r.id=j.reservation_id and r.store_id=j.store_id
 join customers c on c.id=r.customer_id join services sv on sv.id=r.service_id join staff st on st.id=r.staff_id
 where j.store_id=p_store_id and j.state<>'obsolete' and r.status='confirmed' and r.start_at>clock_timestamp()
 and (r.start_at at time zone 'Asia/Tokyo')::date <= (clock_timestamp() at time zone 'Asia/Tokyo')::date+1
 order by j.start_at,j.id limit 200
 )x;
 return jsonb_build_object('enabled',coalesce((select enabled from store_reminder_settings where store_id=p_store_id),false),'rows',result);
end $$;
create or replace function email_booking_event_summary(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform expire_email_booking_events(p_store_id);
 return (select jsonb_build_object('pending',count(*) filter(where state in ('pending','sending')),'expired',count(*) filter(where state='expired'),
 'rows',(select coalesce(jsonb_agg(x.row),'[]'::jsonb) from (
 select jsonb_build_object('id',e.id,'reservationId',e.reservation_id,'kind',e.kind,'state',e.state,'recipient',e.recipient,'createdAt',e.created_at,'customerName',r.customer_name,'startAt',e.payload->>'startAt') as row
 from email_booking_events e join reservations r on r.id=e.reservation_id join customers c on c.id=r.customer_id
 where e.store_id=p_store_id order by e.created_at desc,e.id desc limit 20
 )x)) from email_booking_events where store_id=p_store_id);
end $$;
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
 'state',case when c.event_id is not null then 'contacted' else e.state end,'customerName',r.customer_name,'phone',cu.phone,
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
commit;
