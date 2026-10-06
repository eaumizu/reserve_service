-- A failed move leaves the original reservation unchanged; keep its ID and history.
create or replace function reschedule_reservation_atomic(
  p_store_id uuid,
  p_reservation_id uuid,
  p_staff_id uuid,
  p_start_at timestamptz,
  p_expected_updated_at timestamptz
)
returns reservations
language plpgsql security definer set search_path = public
as $$
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
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0001';
  end if;
  if v_original.status <> 'confirmed'
    or v_original.updated_at is distinct from p_expected_updated_at then
    raise exception 'reservation_changed' using errcode = 'P0001';
  end if;
  if p_start_at is null or not isfinite(p_start_at)
    or mod(extract(epoch from p_start_at), 1800) <> 0 then
    raise exception 'invalid_start_time' using errcode = 'P0001';
  end if;

  -- Use the same staff locks as creation; order them to serialize competing moves.
  v_old_lock := hashtextextended(v_original.staff_id::text, 0);
  v_new_lock := hashtextextended(p_staff_id::text, 0);
  v_initial_staff_id := v_original.staff_id;
  perform pg_advisory_xact_lock(least(v_old_lock, v_new_lock));
  perform pg_advisory_xact_lock(greatest(v_old_lock, v_new_lock));

  -- Lock after the staff locks, then recheck changes made while waiting.
  select * into v_original from reservations
  where id = p_reservation_id and store_id = p_store_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0001';
  end if;
  if v_original.status <> 'confirmed'
    or v_original.updated_at is distinct from p_expected_updated_at
    or v_original.staff_id <> v_initial_staff_id then
    raise exception 'reservation_changed' using errcode = 'P0001';
  end if;

  select timezone into v_timezone from stores where id = p_store_id;
  select s.* into v_service
  from services s
  join staff_services ss on ss.service_id = s.id
  join staff st on st.id = ss.staff_id
  where s.id = v_original.service_id and s.store_id = p_store_id
    and s.active and ss.staff_id = p_staff_id
    and st.store_id = p_store_id and st.active;
  if not found then
    raise exception 'invalid_staff_service' using errcode = 'P0001';
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

  v_window := tstzrange(
    p_start_at - make_interval(mins => v_service.buffer_before),
    v_end_at + make_interval(mins => v_service.buffer_after), '[)'
  );
  if exists (
    select 1 from reservations r join services s on s.id = r.service_id
    where r.staff_id = p_staff_id and r.status = 'confirmed'
      and r.id <> p_reservation_id
      and tstzrange(r.start_at - make_interval(mins => s.buffer_before),
        r.end_at + make_interval(mins => s.buffer_after), '[)') && v_window
  ) or exists (
    select 1 from availability_blocks b
    where b.store_id = p_store_id
      and (b.staff_id is null or b.staff_id = p_staff_id)
      and tstzrange(b.start_at, b.end_at, '[)') && v_window
  ) then
    raise exception 'time_slot_unavailable' using errcode = 'P0001';
  end if;

  update reservations set staff_id = p_staff_id, start_at = p_start_at,
    end_at = v_end_at, updated_at = clock_timestamp()
  where id = p_reservation_id and store_id = p_store_id
  returning * into v_result;
  return v_result;
end;
$$;

revoke all on function reschedule_reservation_atomic(uuid,uuid,uuid,timestamptz,timestamptz) from public;
grant execute on function reschedule_reservation_atomic(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
