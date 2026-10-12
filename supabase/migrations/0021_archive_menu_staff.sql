begin;
alter table services add column if not exists archived_at timestamptz;
alter table staff add column if not exists archived_at timestamptz;
alter table staff add column if not exists is_unassigned boolean not null default false;
create unique index if not exists one_unassigned_staff_per_store on staff(store_id) where is_unassigned;
create or replace function archive_booking_setting(p_store_id uuid,p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare k bigint;
begin
 perform 1 from stores where id=p_store_id for update;
 if not found then raise exception 'invalid_store';end if;
 for k in select distinct hashtextextended(id::text,0) from staff where store_id=p_store_id order by 1 loop perform pg_advisory_xact_lock(k);end loop;
 if p_kind='service_delete' then
  perform 1 from services where store_id=p_store_id and id=p_id and archived_at is null for update;
 elsif p_kind='staff_delete' then
  perform 1 from staff where store_id=p_store_id and id=p_id and archived_at is null and not is_unassigned for update;
 else raise exception 'invalid_settings';end if;
 if not found then raise exception 'settings_not_found';end if;
 if exists(select 1 from reservations r join services sv on sv.id=r.service_id where r.store_id=p_store_id and r.status='confirmed' and r.end_at+make_interval(mins=>sv.buffer_after)>clock_timestamp() and ((p_kind='service_delete' and r.service_id=p_id) or (p_kind='staff_delete' and r.staff_id=p_id))) then raise exception 'setting_has_upcoming_reservations';end if;
 if p_kind='service_delete' then
  update services set active=false,online_bookable=false,archived_at=clock_timestamp() where id=p_id and store_id=p_store_id;
 else
  update staff set active=false,archived_at=clock_timestamp() where id=p_id and store_id=p_store_id;
 end if;
 return jsonb_build_object('id',p_id);
end $$;
create or replace function prevent_archived_setting_update() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.archived_at is not null then raise exception 'settings_not_found';end if;
 return new;
end $$;
drop trigger if exists archived_service_update on services;
create trigger archived_service_update before update on services for each row execute function prevent_archived_setting_update();
drop trigger if exists archived_staff_update on staff;
create trigger archived_staff_update before update on staff for each row execute function prevent_archived_setting_update();
revoke all on function archive_booking_setting(uuid,text,uuid),prevent_archived_setting_update() from public,anon,authenticated;
revoke all on function prevent_archived_setting_update() from service_role;
grant execute on function archive_booking_setting(uuid,text,uuid) to service_role;
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
      -- Retain legacy values only when unchanged; new values use a 15-minute grid.
      if ((p_data ->> 'duration_minutes')::integer % 15 <> 0 and v_service.duration_minutes <> (p_data ->> 'duration_minutes')::integer)
        or ((p_data ->> 'buffer_before')::integer % 15 <> 0 and v_service.buffer_before <> (p_data ->> 'buffer_before')::integer)
        or ((p_data ->> 'buffer_after')::integer % 15 <> 0 and v_service.buffer_after <> (p_data ->> 'buffer_after')::integer) then
        raise exception 'invalid_settings' using errcode = 'P0001';
      end if;
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
      if (p_data ->> 'duration_minutes')::integer % 15 <> 0
        or (p_data ->> 'buffer_before')::integer % 15 <> 0
        or (p_data ->> 'buffer_after')::integer % 15 <> 0 then
        raise exception 'invalid_settings' using errcode = 'P0001';
      end if;
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
    if v_id is null then
      select id into v_id from staff where store_id=p_store_id and is_unassigned and archived_at is null for update;
      if found then update staff set is_unassigned=false where id=v_id;end if;
    end if;
    if v_name is null or length(v_name) not between 0 and 100
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
        or (v_item ->> 'start_time') !~ '^([01][0-9]|2[0-3]):(00|15|30|45)$'
        or (v_item ->> 'end_time') !~ '^([01][0-9]|2[0-3]):(00|15|30|45)$'
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
revoke all on function save_store_settings_atomic(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function save_store_settings_atomic(uuid,text,jsonb) to service_role;
create or replace function sync_unassigned_staff(p_store_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare sid uuid;
begin
 perform 1 from stores where id=p_store_id for update;
 select id into sid from staff where store_id=p_store_id and is_unassigned;
 if not exists(select 1 from staff where store_id=p_store_id and not is_unassigned and archived_at is null) then
  if sid is null then insert into staff(store_id,name,active,is_unassigned) values(p_store_id,'',true,true) returning id into sid;
  else update staff set active=true where id=sid;end if;
  insert into staff_services(staff_id,service_id) select sid,id from services where store_id=p_store_id and active and archived_at is null on conflict do nothing;
 elsif sid is not null then update staff set active=false where id=sid;
 end if;
end $$;
create or replace function sync_unassigned_staff_trigger() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if pg_trigger_depth()=1 then perform sync_unassigned_staff(new.store_id);end if;return new;
end $$;
drop trigger if exists sync_unassigned_staff_change on staff;
create trigger sync_unassigned_staff_change after insert or update on staff for each row execute function sync_unassigned_staff_trigger();
drop trigger if exists sync_unassigned_service_change on services;
create trigger sync_unassigned_service_change after insert or update on services for each row execute function sync_unassigned_staff_trigger();
revoke all on function sync_unassigned_staff(uuid),sync_unassigned_staff_trigger() from public,anon,authenticated,service_role;
do $$ declare s uuid;begin for s in select id from stores loop perform sync_unassigned_staff(s);end loop;end $$;
commit;

