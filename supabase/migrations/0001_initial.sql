create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type reservation_status as enum ('confirmed','cancelled','completed','no_show');
create type reservation_source as enum ('web','phone','walk_in','admin');
create table stores (id uuid primary key default gen_random_uuid(), name text not null, timezone text not null default 'Asia/Tokyo', created_at timestamptz not null default now());
create table customers (id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id), name text not null, phone text not null, created_at timestamptz not null default now(), unique(store_id, phone));
create table staff (id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id), name text not null, active boolean not null default true, created_at timestamptz not null default now());
create table services (id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id), name text not null, duration_minutes integer not null check(duration_minutes > 0), buffer_before integer not null default 0 check(buffer_before >= 0), buffer_after integer not null default 0 check(buffer_after >= 0), price integer not null check(price >= 0), active boolean not null default true, online_bookable boolean not null default true, created_at timestamptz not null default now());
create table staff_services (staff_id uuid not null references staff(id) on delete cascade, service_id uuid not null references services(id) on delete cascade, primary key(staff_id,service_id));
create table business_hours (id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id), weekday smallint not null check(weekday between 0 and 6), start_time time not null, end_time time not null, check(start_time < end_time));
create table availability_blocks (id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id), staff_id uuid references staff(id), start_at timestamptz not null, end_at timestamptz not null, reason text, check(start_at < end_at));
create table reservations (id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id), customer_id uuid not null references customers(id), service_id uuid not null references services(id), staff_id uuid not null references staff(id), start_at timestamptz not null, end_at timestamptz not null, status reservation_status not null default 'confirmed', source reservation_source not null, note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(start_at < end_at));
create index reservations_staff_time_idx on reservations(staff_id, start_at, end_at) where status = 'confirmed';
alter table reservations add constraint no_staff_treatment_overlap exclude using gist (staff_id with =, tstzrange(start_at,end_at,'[)') with &&) where (status = 'confirmed');

-- The authenticated JWT must carry app_metadata.store_id. Service-role calls bypass RLS only from server code.
alter table stores enable row level security; alter table customers enable row level security; alter table staff enable row level security; alter table services enable row level security; alter table staff_services enable row level security; alter table business_hours enable row level security; alter table reservations enable row level security; alter table availability_blocks enable row level security;
create or replace function current_store_id() returns uuid language sql stable as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'store_id','')::uuid $$;
create policy store_isolation on customers using (store_id = current_store_id()) with check (store_id = current_store_id());
create policy store_isolation on staff using (store_id = current_store_id()) with check (store_id = current_store_id());
create policy store_isolation on services using (store_id = current_store_id()) with check (store_id = current_store_id());
create policy store_isolation on business_hours using (store_id = current_store_id()) with check (store_id = current_store_id());
create policy store_isolation on reservations using (store_id = current_store_id()) with check (store_id = current_store_id());
create policy store_isolation on availability_blocks using (store_id = current_store_id()) with check (store_id = current_store_id());
create policy store_isolation on stores using (id = current_store_id());
create policy staff_service_isolation on staff_services using (exists(select 1 from staff s where s.id=staff_id and s.store_id=current_store_id()));

create or replace function create_reservation_atomic(p_store_id uuid, p_service_id uuid, p_staff_id uuid, p_start_at timestamptz, p_customer_name text, p_customer_phone text, p_source reservation_source, p_note text default null)
returns reservations language plpgsql security definer set search_path = public as $$
declare v_service services; v_customer_id uuid; v_end_at timestamptz; v_window tstzrange; v_reservation reservations;
begin
  -- serializes concurrent requests for one staff member; the exclusion constraint remains a final safeguard.
  perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text, 0));
  select s.* into v_service from services s join staff_services ss on ss.service_id=s.id where s.id=p_service_id and s.store_id=p_store_id and ss.staff_id=p_staff_id and s.active;
  if not found then raise exception 'invalid_staff_service' using errcode='P0001'; end if;
  v_end_at := p_start_at + make_interval(mins => v_service.duration_minutes);
  v_window := tstzrange(p_start_at - make_interval(mins => v_service.buffer_before), v_end_at + make_interval(mins => v_service.buffer_after), '[)');
  if exists (select 1 from reservations r join services s on s.id=r.service_id where r.staff_id=p_staff_id and r.status='confirmed' and tstzrange(r.start_at-make_interval(mins=>s.buffer_before),r.end_at+make_interval(mins=>s.buffer_after),'[)') && v_window) or exists (select 1 from availability_blocks b where (b.staff_id is null or b.staff_id=p_staff_id) and tstzrange(b.start_at,b.end_at,'[)') && v_window) then raise exception 'time_slot_unavailable' using errcode='P0001'; end if;
  insert into customers(store_id,name,phone) values(p_store_id,p_customer_name,p_customer_phone) on conflict(store_id,phone) do update set name=excluded.name returning id into v_customer_id;
  insert into reservations(store_id,customer_id,service_id,staff_id,start_at,end_at,status,source,note) values(p_store_id,v_customer_id,p_service_id,p_staff_id,p_start_at,v_end_at,'confirmed',p_source,p_note) returning * into v_reservation;
  return v_reservation;
end; $$;
revoke all on function create_reservation_atomic from public;
grant execute on function create_reservation_atomic(uuid,uuid,uuid,timestamptz,text,text,reservation_source,text) to service_role;
