begin;
-- Refresh settings locking to coexist with booking foreign-key KEY SHARE locks.
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
  select timezone into v_timezone from stores where id = p_store_id for no key update;
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

-- Store row first, then the same ordered staff locks used by settings and bookings.
-- This also serializes staff additions with a store-wide closure.
create or replace function manage_availability_block_atomic(
  p_store_id uuid, p_action text, p_block_id uuid, p_staff_id uuid,
  p_start_at timestamptz, p_end_at timestamptz, p_reason text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lock bigint;
  v_id uuid;
begin
  perform 1 from stores where id = p_store_id for no key update;
  if not found then raise exception 'invalid_store' using errcode = 'P0001'; end if;
  for v_lock in
    select distinct hashtextextended(id::text, 0) from staff
    where store_id = p_store_id order by 1
  loop
    perform pg_advisory_xact_lock(v_lock);
  end loop;

  if p_action = 'create' then
    if p_start_at is null or p_end_at is null or not isfinite(p_start_at) or not isfinite(p_end_at)
      or p_start_at >= p_end_at or p_end_at <= now()
      or p_end_at - p_start_at > interval '366 days'
      or mod(extract(epoch from p_start_at), 1800) <> 0
      or mod(extract(epoch from p_end_at), 1800) <> 0
      or length(coalesce(p_reason, '')) > 200 then
      raise exception 'invalid_block' using errcode = 'P0001';
    end if;
    if p_staff_id is not null and not exists (
      select 1 from staff where id = p_staff_id and store_id = p_store_id and active
    ) then raise exception 'invalid_staff' using errcode = 'P0001'; end if;

    -- Include preparation and cleanup, matching booking creation and rescheduling.
    if exists (
      select 1 from reservations r join services s on s.id = r.service_id
      where r.store_id = p_store_id and r.status = 'confirmed'
        and (p_staff_id is null or r.staff_id = p_staff_id)
        and tstzrange(r.start_at - make_interval(mins => s.buffer_before),
          r.end_at + make_interval(mins => s.buffer_after), '[)')
          && tstzrange(p_start_at, p_end_at, '[)')
    ) then raise exception 'block_has_reservations' using errcode = 'P0001'; end if;

    insert into availability_blocks(store_id, staff_id, start_at, end_at, reason)
    values(p_store_id, p_staff_id, p_start_at, p_end_at, nullif(btrim(p_reason), ''))
    returning id into v_id;
  elsif p_action = 'delete' then
    delete from availability_blocks where id = p_block_id and store_id = p_store_id
    returning id into v_id;
    if not found then raise exception 'block_not_found' using errcode = 'P0001'; end if;
  else
    raise exception 'invalid_block_action' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function manage_availability_block_atomic(uuid,text,uuid,uuid,timestamptz,timestamptz,text) from public;
grant execute on function manage_availability_block_atomic(uuid,text,uuid,uuid,timestamptz,timestamptz,text) to service_role;
commit;
