-- Apply after 0015. Customer links may move to another eligible staff member.
begin;
create or replace function customer_booking_staff_choices(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_booking jsonb; v_result jsonb;
begin
  v_booking := read_customer_booking(p_token_hash);
  select coalesce(jsonb_agg(jsonb_build_object('id',st.id,'name',st.name) order by st.name,st.id),'[]'::jsonb)
  into v_result from staff st join staff_services ss on ss.staff_id=st.id
  where st.store_id=(v_booking->>'storeId')::uuid and st.active
    and ss.service_id=(v_booking->>'serviceId')::uuid;
  return v_result;
end; $$;
create or replace function manage_customer_booking_with_staff_atomic(
  p_token_hash text, p_action text, p_expected_updated_at timestamptz,
  p_start_at timestamptz, p_staff_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_access customer_booking_access; v_original reservations; v_result reservations;
  v_days integer; v_cutoff integer; v_now timestamptz;
begin
  select * into v_access from customer_booking_access where token_hash=p_token_hash and expires_at>clock_timestamp();
  if not found then raise exception 'booking_not_found'; end if;
  -- Same store/staff lock order as booking creation.
  select advance_days,cutoff_minutes into v_days,v_cutoff from stores where id=v_access.store_id for no key update;
  select * into v_original from reservations where id=v_access.reservation_id and store_id=v_access.store_id;
  if not found then raise exception 'booking_not_found'; end if;
  if v_original.status <> 'confirmed' or v_original.updated_at is distinct from p_expected_updated_at then raise exception 'booking_changed'; end if;
  if p_action = 'reschedule' then
    if p_start_at is null or not isfinite(p_start_at) then raise exception 'invalid_start_time'; end if;
    -- Existing RPC handles 15-minute grid, buffers, assignments, hours and conflicts.
    v_result := reschedule_reservation_atomic(v_access.store_id,v_original.id,coalesce(p_staff_id,v_original.staff_id),p_start_at,p_expected_updated_at);
    v_now := clock_timestamp();
    if v_original.start_at <= v_now then raise exception 'booking_closed'; end if;
    if p_start_at <= v_now or p_start_at < v_now + make_interval(mins=>v_cutoff)
      or (p_start_at at time zone 'Asia/Tokyo')::date > (v_now at time zone 'Asia/Tokyo')::date + v_days then
      raise exception 'booking_window_closed';
    end if;
  elsif p_action = 'cancel' then
    select * into v_original from reservations where id=v_access.reservation_id and store_id=v_access.store_id for update;
    if v_original.status <> 'confirmed' or v_original.updated_at is distinct from p_expected_updated_at then raise exception 'booking_changed'; end if;
    if v_original.start_at <= clock_timestamp() then raise exception 'booking_closed'; end if;
    update reservations set status='cancelled',updated_at=clock_timestamp()
      where id=v_original.id and store_id=v_access.store_id returning * into v_result;
  else raise exception 'invalid_action';
  end if;
  -- Re-check revocation/expiry after waits. A concurrent reissue invalidates this operation.
  perform 1 from customer_booking_access where token_hash=p_token_hash and expires_at>clock_timestamp();
  if not found then raise exception 'booking_not_found'; end if;
  return read_customer_booking(p_token_hash);
end; $$;

revoke all on function customer_booking_staff_choices(text) from public,anon,authenticated;
grant execute on function customer_booking_staff_choices(text) to service_role;
revoke all on function manage_customer_booking_with_staff_atomic(text,text,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function manage_customer_booking_with_staff_atomic(text,text,timestamptz,timestamptz,uuid) to service_role;
commit;
