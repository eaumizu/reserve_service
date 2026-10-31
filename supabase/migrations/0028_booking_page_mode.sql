-- Additive: no existing reservation, menu, staff, or notification data is changed.
begin;
create table if not exists store_booking_preferences (
  store_id uuid primary key references stores(id) on delete cascade,
  booking_mode text not null default 'menu' check (booking_mode in ('menu', 'date'))
);
alter table store_booking_preferences enable row level security;
revoke all on store_booking_preferences from public, anon, authenticated, service_role;
grant select on store_booking_preferences to service_role;

create or replace function save_booking_page_mode(p_store_id uuid, p_booking_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_booking_mode is null or p_booking_mode not in ('menu', 'date') then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  perform 1 from stores where id = p_store_id for no key update;
  if not found then raise exception 'settings_not_found' using errcode = 'P0001'; end if;
  insert into store_booking_preferences(store_id, booking_mode) values(p_store_id, p_booking_mode)
  on conflict(store_id) do update set booking_mode = excluded.booking_mode;
  return jsonb_build_object('id', p_store_id);
end; $$;
revoke all on function save_booking_page_mode(uuid,text) from public, anon, authenticated;
grant execute on function save_booking_page_mode(uuid,text) to service_role;
commit;
