-- Apply after 0009. Contact belongs to this booking, not a shared customer profile.
begin;
alter table public.reservations add column if not exists customer_email text
  check (customer_email is null or length(customer_email) between 3 and 254);

create or replace function public.create_reservation_with_email_atomic(
  p_store_id uuid, p_service_id uuid, p_staff_id uuid, p_start_at timestamptz,
  p_customer_name text, p_customer_phone text, p_source reservation_source,
  p_note text default null, p_customer_email text default null
) returns reservations language plpgsql security definer set search_path = public as $$
declare v_reservation reservations; v_email text := nullif(btrim(p_customer_email), '');
begin
  if v_email is not null and (length(v_email) > 254 or
    v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  v_reservation := create_reservation_atomic(p_store_id, p_service_id, p_staff_id,
    p_start_at, p_customer_name, p_customer_phone, p_source, p_note);
  update reservations set customer_email = v_email
    where id = v_reservation.id and store_id = p_store_id returning * into v_reservation;
  return v_reservation;
end; $$;
revoke all on function public.create_reservation_with_email_atomic(uuid,uuid,uuid,timestamptz,text,text,reservation_source,text,text) from public, anon, authenticated;
grant execute on function public.create_reservation_with_email_atomic(uuid,uuid,uuid,timestamptz,text,text,reservation_source,text,text) to service_role;
commit;
