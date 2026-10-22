begin;
alter table store_calendar_connections add column if not exists busy_enabled boolean not null default false;
create table if not exists store_calendar_busy_days (
 store_id uuid not null references store_calendar_connections(store_id) on delete cascade,day date not null,
 revision uuid not null,ticket uuid not null,started_at timestamptz not null,checked boolean not null default false,
 intervals jsonb not null default '[]',primary key(store_id,day)
);
alter table store_calendar_busy_days enable row level security;
revoke all on store_calendar_busy_days from public,anon,authenticated,service_role;
create or replace function store_calendar_credentials(p_store_id uuid) returns jsonb
language sql security definer set search_path=public as $$
 select jsonb_build_object('calendarId',calendar_id,'revision',revision,'refreshCipher',refresh_token_cipher,'busyEnabled',busy_enabled) from store_calendar_connections where store_id=p_store_id
$$;
create or replace function set_store_calendar_busy(p_store_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_enabled is null then raise exception 'invalid_calendar_setting';end if;
 update store_calendar_connections set busy_enabled=p_enabled,revision=case when busy_enabled is distinct from p_enabled then gen_random_uuid() else revision end where store_id=p_store_id;
 if not found then raise exception 'calendar_not_connected';end if;
end $$;
create or replace function begin_store_calendar_busy(p_store_id uuid,p_day date,p_revision uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare t uuid:=gen_random_uuid();
begin
 perform 1 from store_calendar_connections where store_id=p_store_id and revision=p_revision and busy_enabled for share;
 if not found then raise exception 'calendar_connection_changed';end if;
 perform pg_advisory_xact_lock(hashtextextended('calendar-busy:'||p_store_id::text||':'||p_day::text,0));
 insert into store_calendar_busy_days(store_id,day,revision,ticket,started_at) values(p_store_id,p_day,p_revision,t,clock_timestamp())
 on conflict(store_id,day) do update set revision=excluded.revision,ticket=excluded.ticket,started_at=excluded.started_at,checked=false,intervals='[]';
 return t;
end $$;
create or replace function save_store_calendar_busy(p_store_id uuid,p_day date,p_revision uuid,p_ticket uuid,p_intervals jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from store_calendar_connections where store_id=p_store_id and revision=p_revision and busy_enabled for share;
 if not found then return false;end if;
 if jsonb_typeof(p_intervals) is distinct from 'array' or jsonb_array_length(p_intervals)>25000 then raise exception 'invalid_calendar_intervals';end if;
 if exists(select 1 from jsonb_array_elements(p_intervals) x where x->>'start' is null or x->>'end' is null or not isfinite((x->>'start')::timestamptz) or not isfinite((x->>'end')::timestamptz) or (x->>'start')::timestamptz >= (x->>'end')::timestamptz) then raise exception 'invalid_calendar_intervals';end if;
 perform pg_advisory_xact_lock(hashtextextended('calendar-busy:'||p_store_id::text||':'||p_day::text,0));
 update store_calendar_busy_days set intervals=p_intervals,checked=true where store_id=p_store_id and day=p_day and revision=p_revision and ticket=p_ticket and started_at>clock_timestamp()-interval '90 seconds';
 return found;
end $$;
create or replace function guard_google_calendar_busy() returns trigger
language plpgsql security definer set search_path=public as $$
declare c store_calendar_connections;d date;s services;snapshot store_calendar_busy_days;w tstzrange;
begin
 if new.status<>'confirmed' then return new;end if;
 if tg_op='UPDATE' and old.status=new.status and old.start_at=new.start_at and old.end_at=new.end_at and old.staff_id=new.staff_id and old.service_id=new.service_id then return new;end if;
 select * into c from store_calendar_connections where store_id=new.store_id for share;
 if not found or not c.busy_enabled then return new;end if;
 d:=(new.start_at at time zone 'Asia/Tokyo')::date;
 perform pg_advisory_xact_lock(hashtextextended('calendar-busy:'||new.store_id::text||':'||d::text,0));
 select * into snapshot from store_calendar_busy_days where store_id=new.store_id and day=d for share;
 if not found or not snapshot.checked or snapshot.revision<>c.revision or snapshot.started_at<clock_timestamp()-interval '90 seconds' then raise exception 'calendar_busy_unavailable';end if;
 select * into s from services where id=new.service_id and store_id=new.store_id;
 w:=tstzrange(new.start_at-make_interval(mins=>s.buffer_before),new.end_at+make_interval(mins=>s.buffer_after),'[)');
 if exists(select 1 from jsonb_array_elements(snapshot.intervals) x where tstzrange((x->>'start')::timestamptz,(x->>'end')::timestamptz,'[)') && w) then raise exception 'time_slot_unavailable';end if;
 return new;
end $$;
drop trigger if exists google_calendar_busy_guard on reservations;
create trigger google_calendar_busy_guard before insert or update on reservations for each row execute function guard_google_calendar_busy();
revoke all on function guard_google_calendar_busy() from public,anon,authenticated,service_role;
revoke all on function set_store_calendar_busy(uuid,boolean),begin_store_calendar_busy(uuid,date,uuid),save_store_calendar_busy(uuid,date,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function set_store_calendar_busy(uuid,boolean),begin_store_calendar_busy(uuid,date,uuid),save_store_calendar_busy(uuid,date,uuid,uuid,jsonb) to service_role;
commit;
