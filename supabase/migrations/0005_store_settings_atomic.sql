-- Serialize configuration changes with booking creation/moves and keep history.
create or replace function save_store_settings_atomic(p_store_id uuid, p_kind text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lock bigint;
  v_timezone text;
  v_id uuid;
  v_name text;
  v_service services;
  v_staff staff;
  v_hours jsonb;
  v_item jsonb;
  v_service_id uuid;
begin
  select timezone into v_timezone from stores where id = p_store_id for update;
  if not found then raise exception 'invalid_store' using errcode = 'P0001'; end if;
  -- Order by the actual lock keys, matching reservation rescheduling.
  for v_lock in
    select distinct hashtextextended(id::text, 0) from staff
    where store_id = p_store_id order by 1
  loop
    perform pg_advisory_xact_lock(v_lock);
  end loop;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;

  if p_kind = 'store' then
    v_name := btrim(p_data ->> 'name');
    if v_name is null or length(v_name) not between 1 and 100 then
      raise exception 'invalid_settings' using errcode = 'P0001';
    end if;
    update stores set name = v_name where id = p_store_id;
    return jsonb_build_object('id', p_store_id);

  elsif p_kind = 'service' then
    v_id := nullif(p_data ->> 'id', '')::uuid;
    v_name := btrim(p_data ->> 'name');
    if v_name is null or length(v_name) not between 1 and 100
      or not (p_data ?& array['duration_minutes','buffer_before','buffer_after','price','active','online_bookable'])
      or jsonb_typeof(p_data -> 'duration_minutes') is distinct from 'number'
      or jsonb_typeof(p_data -> 'buffer_before') is distinct from 'number'
      or jsonb_typeof(p_data -> 'buffer_after') is distinct from 'number'
      or jsonb_typeof(p_data -> 'price') is distinct from 'number'
      or (p_data ->> 'duration_minutes')::integer not between 1 and 1440
      or (p_data ->> 'buffer_before')::integer not between 0 and 1440
      or (p_data ->> 'buffer_after')::integer not between 0 and 1440
      or (p_data ->> 'price')::integer not between 0 and 10000000
      or jsonb_typeof(p_data -> 'active') <> 'boolean'
      or jsonb_typeof(p_data -> 'online_bookable') <> 'boolean' then
      raise exception 'invalid_settings' using errcode = 'P0001';
    end if;
    if v_id is not null then
      select * into v_service from services where id = v_id and store_id = p_store_id for update;
      if not found then raise exception 'settings_not_found' using errcode = 'P0001'; end if;
      if (v_service.duration_minutes <> (p_data ->> 'duration_minutes')::integer
        or v_service.buffer_before <> (p_data ->> 'buffer_before')::integer
        or v_service.buffer_after <> (p_data ->> 'buffer_after')::integer)
        and exists (select 1 from reservations where service_id = v_id) then
        raise exception 'service_timing_has_reservations' using errcode = 'P0001';
      end if;
      update services set name = v_name,
        duration_minutes = (p_data ->> 'duration_minutes')::integer,
        buffer_before = (p_data ->> 'buffer_before')::integer,
        buffer_after = (p_data ->> 'buffer_after')::integer,
        price = (p_data ->> 'price')::integer,
        active = (p_data ->> 'active')::boolean,
        online_bookable = (p_data ->> 'online_bookable')::boolean
      where id = v_id and store_id = p_store_id;
    else
      insert into services(store_id,name,duration_minutes,buffer_before,buffer_after,price,active,online_bookable)
      values(p_store_id,v_name,(p_data ->> 'duration_minutes')::integer,
        (p_data ->> 'buffer_before')::integer,(p_data ->> 'buffer_after')::integer,
        (p_data ->> 'price')::integer,(p_data ->> 'active')::boolean,
        (p_data ->> 'online_bookable')::boolean) returning id into v_id;
    end if;
    return jsonb_build_object('id', v_id);

  elsif p_kind = 'staff' then
    v_id := nullif(p_data ->> 'id', '')::uuid;
    v_name := btrim(p_data ->> 'name');
    if v_name is null or length(v_name) not between 1 and 100
      or jsonb_typeof(p_data -> 'active') is distinct from 'boolean'
      or jsonb_typeof(p_data -> 'serviceIds') is distinct from 'array' then
      raise exception 'invalid_settings' using errcode = 'P0001';
    end if;
    -- Validate every assignment before changing any rows.
    for v_item in select value from jsonb_array_elements(p_data -> 'serviceIds') loop
      if jsonb_typeof(v_item) <> 'string' then raise exception 'invalid_settings' using errcode = 'P0001'; end if;
      v_service_id := (v_item #>> '{}')::uuid;
      if not exists(select 1 from services where id = v_service_id and store_id = p_store_id) then
        raise exception 'invalid_staff_service' using errcode = 'P0001';
      end if;
    end loop;
    if v_id is not null then
      select * into v_staff from staff where id = v_id and store_id = p_store_id for update;
      if not found then raise exception 'settings_not_found' using errcode = 'P0001'; end if;
      update staff set name = v_name, active = (p_data ->> 'active')::boolean
      where id = v_id and store_id = p_store_id;
    else
      insert into staff(store_id,name,active) values(p_store_id,v_name,(p_data ->> 'active')::boolean)
      returning id into v_id;
    end if;
    delete from staff_services where staff_id = v_id;
    insert into staff_services(staff_id,service_id)
    select distinct v_id, (value #>> '{}')::uuid from jsonb_array_elements(p_data -> 'serviceIds');
    return jsonb_build_object('id', v_id);

  elsif p_kind = 'hours' then
    v_hours := p_data -> 'hours';
    if jsonb_typeof(v_hours) is distinct from 'array' or jsonb_array_length(v_hours) > 28 then
      raise exception 'invalid_settings' using errcode = 'P0001';
    end if;
    for v_item in select value from jsonb_array_elements(v_hours) loop
      if jsonb_typeof(v_item) <> 'object'
        or not (v_item ?& array['weekday','start_time','end_time'])
        or jsonb_typeof(v_item -> 'weekday') is distinct from 'number'
        or jsonb_typeof(v_item -> 'start_time') is distinct from 'string'
        or jsonb_typeof(v_item -> 'end_time') is distinct from 'string'
        or (v_item ->> 'weekday')::integer not between 0 and 6
        or (v_item ->> 'start_time') !~ '^([01][0-9]|2[0-3]):(00|30)$'
        or (v_item ->> 'end_time') !~ '^([01][0-9]|2[0-3]):(00|30)$'
        or (v_item ->> 'start_time')::time >= (v_item ->> 'end_time')::time then
        raise exception 'invalid_settings' using errcode = 'P0001';
      end if;
    end loop;
    if exists (
      select 1 from jsonb_array_elements(v_hours) with ordinality a(value, n)
      cross join jsonb_array_elements(v_hours) with ordinality b(value, n)
      where a.n < b.n and a.value ->> 'weekday' = b.value ->> 'weekday'
        and (a.value ->> 'start_time')::time < (b.value ->> 'end_time')::time
        and (b.value ->> 'start_time')::time < (a.value ->> 'end_time')::time
    ) then raise exception 'overlapping_business_hours' using errcode = 'P0001'; end if;
    -- Existing future/in-progress bookings must still fit after the change.
    if exists (
      select 1 from reservations r join services s on s.id = r.service_id
      where r.store_id = p_store_id and r.status = 'confirmed' and r.end_at > now()
        and not exists (
          select 1 from jsonb_array_elements(v_hours) h
          where (h ->> 'weekday')::integer = extract(dow from r.start_at at time zone v_timezone)::integer
            and (r.start_at at time zone v_timezone)::date =
              ((r.end_at + make_interval(mins => s.buffer_after)) at time zone v_timezone)::date
            and (r.start_at at time zone v_timezone)::time >= (h ->> 'start_time')::time
            and ((r.end_at + make_interval(mins => s.buffer_after)) at time zone v_timezone)::time <= (h ->> 'end_time')::time
        )
    ) then raise exception 'business_hours_have_reservations' using errcode = 'P0001'; end if;
    delete from business_hours where store_id = p_store_id;
    insert into business_hours(store_id,weekday,start_time,end_time)
    select p_store_id,(h ->> 'weekday')::smallint,(h ->> 'start_time')::time,(h ->> 'end_time')::time
    from jsonb_array_elements(v_hours) h;
    return jsonb_build_object('id', p_store_id);
  else
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function save_store_settings_atomic(uuid,text,jsonb) from public;
grant execute on function save_store_settings_atomic(uuid,text,jsonb) to service_role;

-- A stale Web form must not book a menu after online booking is switched off.
create or replace function enforce_web_menu_setting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'web' and not exists (
    select 1 from services where id = new.service_id
      and store_id = new.store_id and active and online_bookable
  ) then raise exception 'menu_not_online_bookable' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function enforce_web_menu_setting() from public;
drop trigger if exists web_menu_setting on reservations;
create trigger web_menu_setting before insert on reservations
for each row execute function enforce_web_menu_setting();

-- Keep existing appointments editable after their menu stops accepting new bookings.
create or replace function reschedule_reservation_atomic(
  p_store_id uuid, p_reservation_id uuid, p_staff_id uuid,
  p_start_at timestamptz, p_expected_updated_at timestamptz
)
returns reservations language plpgsql security definer set search_path = public as $$
declare
  v_original reservations;
  v_result reservations;
  v_service services;
  v_timezone text;
  v_end_at timestamptz;
  v_window tstzrange;
  v_local_start timestamp;
  v_local_end timestamp;
  v_old_lock bigint;
  v_new_lock bigint;
  v_initial_staff_id uuid;
begin
  select * into v_original from reservations
  where id = p_reservation_id and store_id = p_store_id;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;
  if v_original.status <> 'confirmed' or v_original.updated_at is distinct from p_expected_updated_at then
    raise exception 'reservation_changed' using errcode = 'P0001';
  end if;
  if p_start_at is null or not isfinite(p_start_at) or mod(extract(epoch from p_start_at),1800) <> 0 then
    raise exception 'invalid_start_time' using errcode = 'P0001';
  end if;
  v_old_lock := hashtextextended(v_original.staff_id::text,0);
  v_new_lock := hashtextextended(p_staff_id::text,0);
  v_initial_staff_id := v_original.staff_id;
  perform pg_advisory_xact_lock(least(v_old_lock,v_new_lock));
  perform pg_advisory_xact_lock(greatest(v_old_lock,v_new_lock));
  select * into v_original from reservations
  where id = p_reservation_id and store_id = p_store_id for update;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;
  if v_original.status <> 'confirmed' or v_original.updated_at is distinct from p_expected_updated_at
    or v_original.staff_id <> v_initial_staff_id then
    raise exception 'reservation_changed' using errcode = 'P0001';
  end if;
  select timezone into v_timezone from stores where id = p_store_id;
  select s.* into v_service from services s
  join staff_services ss on ss.service_id = s.id join staff st on st.id = ss.staff_id
  where s.id = v_original.service_id and s.store_id = p_store_id
    and ss.staff_id = p_staff_id and st.store_id = p_store_id and st.active;
  if not found then raise exception 'invalid_staff_service' using errcode = 'P0001'; end if;
  v_end_at := p_start_at + make_interval(mins => v_service.duration_minutes);
  v_local_start := p_start_at at time zone v_timezone;
  v_local_end := (v_end_at + make_interval(mins => v_service.buffer_after)) at time zone v_timezone;
  if v_local_start::date <> v_local_end::date or not exists (
    select 1 from business_hours h where h.store_id = p_store_id
      and h.weekday = extract(dow from v_local_start)::smallint
      and v_local_start::time >= h.start_time and v_local_end::time <= h.end_time
  ) then raise exception 'outside_business_hours' using errcode = 'P0001'; end if;
  v_window := tstzrange(p_start_at - make_interval(mins => v_service.buffer_before),
    v_end_at + make_interval(mins => v_service.buffer_after),'[)');
  if exists (
    select 1 from reservations r join services s on s.id = r.service_id
    where r.staff_id = p_staff_id and r.status = 'confirmed' and r.id <> p_reservation_id
      and tstzrange(r.start_at - make_interval(mins => s.buffer_before),
        r.end_at + make_interval(mins => s.buffer_after),'[)') && v_window
  ) or exists (
    select 1 from availability_blocks b where b.store_id = p_store_id
      and (b.staff_id is null or b.staff_id = p_staff_id)
      and tstzrange(b.start_at,b.end_at,'[)') && v_window
  ) then raise exception 'time_slot_unavailable' using errcode = 'P0001'; end if;
  update reservations set staff_id = p_staff_id, start_at = p_start_at,
    end_at = v_end_at, updated_at = clock_timestamp()
  where id = p_reservation_id and store_id = p_store_id returning * into v_result;
  return v_result;
end;
$$;
revoke all on function reschedule_reservation_atomic(uuid,uuid,uuid,timestamptz,timestamptz) from public;
grant execute on function reschedule_reservation_atomic(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
