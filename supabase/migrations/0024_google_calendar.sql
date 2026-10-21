begin;
create table if not exists store_calendar_connections (
 store_id uuid primary key references stores(id),calendar_id text not null,calendar_name text not null,
 refresh_token_cipher text not null,revision uuid not null default gen_random_uuid(),connected_by uuid not null
);
create table if not exists store_calendar_oauth (
 state_hash text primary key,store_id uuid not null references stores(id),user_id uuid not null,calendar_id text not null,
 verifier_cipher text not null,expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create table if not exists store_calendar_jobs (
 store_id uuid not null references stores(id),reservation_id uuid not null references reservations(id) on delete cascade,
 version uuid not null default gen_random_uuid(),state text not null default 'pending' check(state in ('pending','sending','synced')),
 lease_id uuid,lease_until timestamptz,failed boolean not null default false,updated_at timestamptz not null default clock_timestamp(),
 primary key(store_id,reservation_id)
);
alter table store_calendar_connections enable row level security;
alter table store_calendar_oauth enable row level security;
alter table store_calendar_jobs enable row level security;
revoke all on store_calendar_connections,store_calendar_oauth,store_calendar_jobs from public,anon,authenticated,service_role;
create or replace function issue_store_calendar_oauth(p_store_id uuid,p_user_id uuid,p_state_hash text,p_calendar_id text,p_verifier_cipher text) returns void
language plpgsql security definer set search_path=public as $$
begin
 delete from store_calendar_oauth where expires_at<clock_timestamp();
 insert into store_calendar_oauth(state_hash,store_id,user_id,calendar_id,verifier_cipher) values(p_state_hash,p_store_id,p_user_id,p_calendar_id,p_verifier_cipher);
end $$;
create or replace function consume_store_calendar_oauth(p_state_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v store_calendar_oauth;
begin
 delete from store_calendar_oauth where state_hash=p_state_hash returning * into v;
 if not found or v.expires_at<clock_timestamp() then return null;end if;
 return jsonb_build_object('storeId',v.store_id,'userId',v.user_id,'calendarId',v.calendar_id,'verifierCipher',v.verifier_cipher);
end $$;
create or replace function queue_store_calendar_resync(p_store_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from store_calendar_connections where store_id=p_store_id) then raise exception 'calendar_not_connected';end if;
 insert into store_calendar_jobs(store_id,reservation_id) select store_id,id from reservations where store_id=p_store_id and status='confirmed' and end_at>clock_timestamp()
 on conflict(store_id,reservation_id) do update set version=gen_random_uuid(),state='pending',failed=false,updated_at=clock_timestamp();
end $$;
create or replace function save_store_calendar_connection(p_store_id uuid,p_user_id uuid,p_calendar_id text,p_calendar_name text,p_refresh_cipher text) returns void
language plpgsql security definer set search_path=public as $$
begin
 insert into store_calendar_connections(store_id,calendar_id,calendar_name,refresh_token_cipher,connected_by) values(p_store_id,p_calendar_id,p_calendar_name,p_refresh_cipher,p_user_id)
 on conflict(store_id) do update set calendar_id=excluded.calendar_id,calendar_name=excluded.calendar_name,refresh_token_cipher=excluded.refresh_token_cipher,connected_by=excluded.connected_by,revision=gen_random_uuid();
 perform queue_store_calendar_resync(p_store_id);
end $$;
create or replace function disconnect_store_calendar(p_store_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 delete from store_calendar_connections where store_id=p_store_id;
 delete from store_calendar_jobs where store_id=p_store_id;
 delete from store_calendar_oauth where store_id=p_store_id;
end $$;
create or replace function store_calendar_credentials(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin return (select jsonb_build_object('calendarId',calendar_id,'revision',revision,'refreshCipher',refresh_token_cipher) from store_calendar_connections where store_id=p_store_id);end $$;
create or replace function queue_store_calendar_update() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and not (new.status='cancelled' and old.status is distinct from new.status) and not (new.status='confirmed' and (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at or new.staff_id is distinct from old.staff_id or new.service_id is distinct from old.service_id)) then return new;end if;
 if exists(select 1 from store_calendar_connections where store_id=new.store_id) then
 insert into store_calendar_jobs(store_id,reservation_id) values(new.store_id,new.id)
 on conflict(store_id,reservation_id) do update set version=gen_random_uuid(),state='pending',failed=false,updated_at=clock_timestamp();
 end if;return new;
end $$;
drop trigger if exists store_calendar_update on reservations;
create trigger store_calendar_update after insert or update on reservations for each row execute function queue_store_calendar_update();
create or replace function claim_store_calendar_job(p_store_id uuid,p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j store_calendar_jobs;
begin
 if not exists(select 1 from store_calendar_connections where store_id=p_store_id) then return null;end if;
 select * into j from store_calendar_jobs where store_id=p_store_id and (p_reservation_id is null or reservation_id=p_reservation_id) and state in ('pending','sending') and (lease_until is null or lease_until<clock_timestamp()) order by updated_at,reservation_id limit 1 for update skip locked;
 if not found then return null;end if;
 update store_calendar_jobs set state='sending',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where store_id=j.store_id and reservation_id=j.reservation_id returning * into j;
 return (select jsonb_build_object('storeId',j.store_id,'reservationId',j.reservation_id,'version',j.version,'leaseId',j.lease_id,'connectionRevision',(select revision from store_calendar_connections where store_id=j.store_id),'status',r.status,'customerName',r.customer_name,'serviceName',sv.name,'staffName',st.name,'startAt',r.start_at,'endAt',r.end_at) from reservations r join services sv on sv.id=r.service_id join staff st on st.id=r.staff_id where r.id=j.reservation_id and r.store_id=j.store_id);
end $$;
create or replace function finish_store_calendar_job(p_store_id uuid,p_reservation_id uuid,p_version uuid,p_lease_id uuid,p_connection_revision uuid,p_synced boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 update store_calendar_jobs set state=case when version=p_version and p_synced and exists(select 1 from store_calendar_connections c where c.store_id=p_store_id and c.revision=p_connection_revision) then 'synced' else 'pending' end,
 failed=case when version=p_version then not p_synced else false end,lease_id=null,
 lease_until=case when version=p_version and not p_synced then clock_timestamp()+interval '2 minutes' else null end
 where store_id=p_store_id and reservation_id=p_reservation_id and lease_id=p_lease_id;
end $$;
create or replace function store_calendar_dashboard(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin return jsonb_build_object('connection',(select jsonb_build_object('calendarId',calendar_id,'calendarName',calendar_name) from store_calendar_connections where store_id=p_store_id),
 'pending',(select count(*) from store_calendar_jobs where store_id=p_store_id and state in ('pending','sending')),
 'failed',(select count(*) from store_calendar_jobs where store_id=p_store_id and failed));end $$;
revoke all on function queue_store_calendar_update() from public,anon,authenticated,service_role;
revoke all on function issue_store_calendar_oauth(uuid,uuid,text,text,text),consume_store_calendar_oauth(text),queue_store_calendar_resync(uuid),save_store_calendar_connection(uuid,uuid,text,text,text),disconnect_store_calendar(uuid),store_calendar_credentials(uuid),claim_store_calendar_job(uuid,uuid),finish_store_calendar_job(uuid,uuid,uuid,uuid,uuid,boolean),store_calendar_dashboard(uuid) from public,anon,authenticated;
grant execute on function issue_store_calendar_oauth(uuid,uuid,text,text,text),consume_store_calendar_oauth(text),queue_store_calendar_resync(uuid),save_store_calendar_connection(uuid,uuid,text,text,text),disconnect_store_calendar(uuid),store_calendar_credentials(uuid),claim_store_calendar_job(uuid,uuid),finish_store_calendar_job(uuid,uuid,uuid,uuid,uuid,boolean),store_calendar_dashboard(uuid) to service_role;
commit;
