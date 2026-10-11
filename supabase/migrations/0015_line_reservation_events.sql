begin;
create table if not exists line_reservation_events (
 id uuid primary key default gen_random_uuid(),store_id uuid not null references stores(id),
 reservation_id uuid not null references reservations(id) on delete cascade,line_user_id text not null,
 kind text not null check(kind in ('changed','cancelled')),payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sent','expired')),
 created_at timestamptz not null default clock_timestamp(),sent_at timestamptz
);
create index if not exists line_reservation_events_pending on line_reservation_events(store_id,created_at) where state='pending';
alter table line_reservation_events enable row level security;
revoke all on line_reservation_events from public,anon,authenticated,service_role;
create or replace function queue_line_reservation_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare target text; kind text; details jsonb;
begin
 if new.status='cancelled' and old.status is distinct from new.status then kind:='cancelled';
 elsif new.status='confirmed' and (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at or new.staff_id is distinct from old.staff_id or new.service_id is distinct from old.service_id) then kind:='changed';
 else return new; end if;
 select line_user_id into target from customer_line_links where reservation_id=new.id and store_id=new.store_id;
 if not found then return new; end if;
 select jsonb_build_object('storeName',s.name,'serviceName',sv.name,'staffName',st.name,
 'oldStartAt',old.start_at,'oldEndAt',old.end_at,'startAt',new.start_at,'endAt',new.end_at,
 'oldStaffName',(select name from staff where id=old.staff_id),'oldServiceName',(select name from services where id=old.service_id))
 into details from stores s join services sv on sv.id=new.service_id join staff st on st.id=new.staff_id where s.id=new.store_id;
 insert into line_reservation_events(store_id,reservation_id,line_user_id,kind,payload) values(new.store_id,new.id,target,kind,details);
 return new;
end $$;
revoke all on function queue_line_reservation_event() from public,anon,authenticated,service_role;
drop trigger if exists reservation_line_event on reservations;
create trigger reservation_line_event after update on reservations for each row execute function queue_line_reservation_event();
create or replace function pending_line_reservation_events(p_store_id uuid,p_reservation_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 update line_reservation_events set state='expired' where store_id=p_store_id and state='pending' and created_at<clock_timestamp()-interval '23 hours';
 select coalesce(jsonb_agg(x.job order by x.created_at),'[]'::jsonb) into result from (
  select e.created_at,jsonb_build_object('id',e.id,'storeId',e.store_id,'userId',e.line_user_id,'kind',e.kind,'payload',e.payload) as job
  from line_reservation_events e join customer_line_links l on l.reservation_id=e.reservation_id and l.store_id=e.store_id and l.line_user_id=e.line_user_id
  where e.store_id=p_store_id and e.state='pending' and (p_reservation_id is null or e.reservation_id=p_reservation_id)
  order by e.created_at,e.id limit 10
 )x;return result;
end $$;
create or replace function mark_line_reservation_event_sent(p_store_id uuid,p_event_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin update line_reservation_events set state='sent',sent_at=clock_timestamp() where store_id=p_store_id and id=p_event_id and state='pending'; end $$;
create or replace function line_reservation_event_summary(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 update line_reservation_events set state='expired' where store_id=p_store_id and state='pending' and created_at<clock_timestamp()-interval '23 hours';
 return (select jsonb_build_object('pending',count(*) filter(where state='pending'),'expired',count(*) filter(where state='expired')) from line_reservation_events where store_id=p_store_id);
end $$;
revoke all on function pending_line_reservation_events(uuid,uuid),mark_line_reservation_event_sent(uuid,uuid),line_reservation_event_summary(uuid) from public,anon,authenticated;
grant execute on function pending_line_reservation_events(uuid,uuid),mark_line_reservation_event_sent(uuid,uuid),line_reservation_event_summary(uuid) to service_role;
commit;
