-- Apply after 0008. Staff notes are separate from public reservation data.
begin;
create table if not exists reservation_staff_notes (
  reservation_id uuid primary key references reservations(id) on delete cascade,
  store_id uuid not null references stores(id),
  note text not null default '' check (length(note) <= 2000),
  version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null
);
alter table reservation_staff_notes enable row level security;
revoke all on table reservation_staff_notes from public, anon, authenticated, service_role;
grant select on table reservation_staff_notes to service_role;

create or replace function save_reservation_staff_note_atomic(
  p_store_id uuid, p_reservation_id uuid, p_note text, p_expected_version uuid, p_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_current reservation_staff_notes;
  v_saved reservation_staff_notes;
begin
  if p_note is null or length(p_note) > 2000 or p_user_id is null then
    raise exception 'invalid_staff_note' using errcode = 'P0001';
  end if;
  -- Serialize first writes too. Do not change the reservation status or updated_at.
  perform 1 from reservations where id = p_reservation_id and store_id = p_store_id for no key update;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;
  select * into v_current from reservation_staff_notes where reservation_id = p_reservation_id;
  if found then
    if v_current.store_id <> p_store_id or v_current.version is distinct from p_expected_version then
      raise exception 'staff_note_changed' using errcode = 'P0001';
    end if;
    update reservation_staff_notes set note = p_note, version = gen_random_uuid(),
      updated_at = clock_timestamp(), updated_by = p_user_id
      where reservation_id = p_reservation_id returning * into v_saved;
  else
    if p_expected_version is not null then raise exception 'staff_note_changed' using errcode = 'P0001'; end if;
    insert into reservation_staff_notes(reservation_id,store_id,note,updated_by)
      values(p_reservation_id,p_store_id,p_note,p_user_id) returning * into v_saved;
  end if;
  return jsonb_build_object('note',v_saved.note,'version',v_saved.version,'updatedAt',v_saved.updated_at);
end; $$;
revoke all on function save_reservation_staff_note_atomic(uuid,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function save_reservation_staff_note_atomic(uuid,uuid,text,uuid,uuid) to service_role;
commit;
