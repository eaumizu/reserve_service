-- Apply after 0007. Existing reservations are preserved.
begin;
alter table stores add column if not exists advance_days integer not null default 30 check (advance_days between 0 and 365);
alter table stores add column if not exists cutoff_minutes integer not null default 60 check (cutoff_minutes between 0 and 1440 and cutoff_minutes % 15 = 0);

create or replace function save_booking_rules_atomic(p_store_id uuid, p_advance_days integer, p_cutoff_minutes integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_advance_days is null or p_cutoff_minutes is null or p_advance_days not between 0 and 365
    or p_cutoff_minutes not between 0 and 1440 or p_cutoff_minutes % 15 <> 0 then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  perform 1 from stores where id = p_store_id for no key update;
  if not found then raise exception 'invalid_store' using errcode = 'P0001'; end if;
  update stores set advance_days = p_advance_days, cutoff_minutes = p_cutoff_minutes where id = p_store_id;
  return jsonb_build_object('id', p_store_id);
end; $$;
revoke all on function save_booking_rules_atomic(uuid,integer,integer) from public;
grant execute on function save_booking_rules_atomic(uuid,integer,integer) to service_role;

create or replace function create_reservation_atomic(p_store_id uuid, p_service_id uuid, p_staff_id uuid, p_start_at timestamptz, p_customer_name text, p_customer_phone text, p_source reservation_source, p_note text default null)
returns reservations language plpgsql security definer set search_path = public as $$
declare
  v_service services;
  v_customer_id uuid;
  v_end_at timestamptz;
  v_window tstzrange;
  v_reservation reservations;
  v_timezone text;
  v_advance_days integer;
  v_cutoff_minutes integer;
  v_now timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  select timezone, advance_days, cutoff_minutes into v_timezone, v_advance_days, v_cutoff_minutes
  from stores where id = p_store_id for no key update;
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

  -- Recheck after waiting for locks, before creating any customer or reservation.
  if p_source = 'web' then
    v_now := clock_timestamp();
    if not v_service.online_bookable then raise exception 'invalid_staff_service' using errcode = 'P0001'; end if;
    if p_start_at <= v_now or p_start_at < v_now + make_interval(mins => v_cutoff_minutes)
      or (p_start_at at time zone 'Asia/Tokyo')::date > (v_now at time zone 'Asia/Tokyo')::date + v_advance_days then
      raise exception 'booking_window_closed' using errcode = 'P0001';
    end if;
  end if;

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
  on conflict(store_id, phone) do update set name = excluded.name
  returning id into v_customer_id;
  insert into reservations(store_id, customer_id, service_id, staff_id, start_at, end_at, status, source, note)
  values (p_store_id, v_customer_id, p_service_id, p_staff_id, p_start_at, v_end_at, 'confirmed', p_source, p_note)
  returning * into v_reservation;
  return v_reservation;
end; $$;

revoke all on function create_reservation_atomic(uuid,uuid,uuid,timestamptz,text,text,reservation_source,text) from public;
grant execute on function create_reservation_atomic(uuid,uuid,uuid,timestamptz,text,text,reservation_source,text) to service_role;

commit;
