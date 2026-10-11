begin;
-- Keep the existing management link encrypted; never rotate it merely to send a notification.
create table if not exists email_booking_tokens (
 token_hash text primary key references customer_booking_access(token_hash) on delete cascade,
 store_id uuid not null references stores(id), reservation_id uuid not null references reservations(id) on delete cascade,
 token_cipher text not null
);
create table if not exists email_booking_events (
 id uuid primary key default gen_random_uuid(),store_id uuid not null references stores(id),
 reservation_id uuid not null references reservations(id) on delete cascade,recipient text not null,
 kind text not null check(kind in ('created','changed','cancelled')),payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','expired')),
 lease_id uuid,lease_until timestamptz,created_at timestamptz not null default clock_timestamp(),
 first_attempt_at timestamptz,sent_at timestamptz
);
create index if not exists email_booking_events_pending on email_booking_events(store_id,created_at) where state in ('pending','sending');
alter table email_booking_tokens enable row level security;
alter table email_booking_events enable row level security;
revoke all on email_booking_tokens,email_booking_events from public,anon,authenticated,service_role;
create or replace function queue_email_booking_event(p_store_id uuid,p_reservation_id uuid,p_kind text,p_old jsonb default null) returns void
language plpgsql security definer set search_path=public as $$
declare r reservations;e store_email_settings;t email_booking_tokens;details jsonb;
begin
 select * into r from reservations where id=p_reservation_id and store_id=p_store_id;
 if not found or nullif(r.customer_email,'') is null then return;end if;
 if exists(select 1 from customer_line_links where reservation_id=r.id and store_id=r.store_id) then return;end if;
 select * into e from store_email_settings where store_id=r.store_id and status='verified';
 if not found then return;end if;
 select et.* into t from email_booking_tokens et join customer_booking_access a on a.token_hash=et.token_hash
 where et.reservation_id=r.id and et.store_id=r.store_id and a.expires_at>clock_timestamp();
 select jsonb_build_object('storeName',s.name,'serviceName',sv.name,'staffName',st.name,
 'startAt',r.start_at,'endAt',r.end_at,'staffId',r.staff_id,'serviceId',r.service_id,
 'oldStartAt',p_old->>'startAt','oldEndAt',p_old->>'endAt','oldStaffName',p_old->>'staffName','oldServiceName',p_old->>'serviceName',
 'from',e.sender_name||' <'||e.sender_email||'>','replyTo',e.reply_to,'senderRevision',e.revision,'domainId',e.domain_id,
 'tokenHash',t.token_hash,'tokenCipher',t.token_cipher)
 into details from stores s join services sv on sv.id=r.service_id join staff st on st.id=r.staff_id where s.id=r.store_id;
 insert into email_booking_events(store_id,reservation_id,recipient,kind,payload) values(r.store_id,r.id,r.customer_email,p_kind,details);
end $$;
-- Required extra argument selects this overload unambiguously. The existing overload remains available.
create or replace function create_customer_booking_atomic(
 p_store_id uuid,p_service_id uuid,p_staff_id uuid,p_start_at timestamptz,
 p_customer_name text,p_customer_phone text,p_source reservation_source,p_note text,
 p_customer_email text,p_token_hash text,p_token_cipher text
) returns reservations language plpgsql security definer set search_path=public as $$
declare r reservations;
begin
 r:=create_customer_booking_atomic(p_store_id,p_service_id,p_staff_id,p_start_at,p_customer_name,p_customer_phone,p_source,p_note,p_customer_email,p_token_hash);
 if nullif(p_customer_email,'') is not null and nullif(p_token_cipher,'') is not null then
  insert into email_booking_tokens values(p_token_hash,p_store_id,r.id,p_token_cipher);
  perform queue_email_booking_event(p_store_id,r.id,'created',null);
 end if;
 return r;
end $$;
create or replace function queue_email_booking_update() returns trigger
language plpgsql security definer set search_path=public as $$
declare kind text; old_details jsonb;
begin
 if new.status='cancelled' and old.status is distinct from new.status then kind:='cancelled';
 elsif new.status='confirmed' and (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at or new.staff_id is distinct from old.staff_id or new.service_id is distinct from old.service_id) then kind:='changed';
 else return new;end if;
 old_details:=jsonb_build_object('startAt',old.start_at,'endAt',old.end_at,'staffName',(select name from staff where id=old.staff_id),'serviceName',(select name from services where id=old.service_id));
 perform queue_email_booking_event(new.store_id,new.id,kind,old_details);
 return new;
end $$;
drop trigger if exists reservation_email_event on reservations;
create trigger reservation_email_event after update on reservations for each row execute function queue_email_booking_update();
create or replace function expire_email_booking_events(p_store_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 update email_booking_events e set state='expired',lease_id=null,lease_until=null,payload=payload-'tokenCipher'
 where (p_store_id is null or store_id=p_store_id) and state in ('pending','sending')
 and (lease_until is null or lease_until<clock_timestamp()) and (
 created_at<clock_timestamp()-interval '23 hours'
 or not exists(select 1 from reservations r where r.id=e.reservation_id and r.store_id=e.store_id and r.customer_email=e.recipient)
 or exists(select 1 from customer_line_links l where l.reservation_id=e.reservation_id and l.store_id=e.store_id)
 or not exists(select 1 from store_email_settings s where s.store_id=e.store_id and s.status='verified' and s.revision::text=e.payload->>'senderRevision')
 or (e.payload->>'tokenHash' is not null and not exists(select 1 from customer_booking_access a where a.token_hash=e.payload->>'tokenHash' and a.expires_at>clock_timestamp()))
 or (e.kind='created' and not exists(select 1 from reservations r where r.id=e.reservation_id and r.status='confirmed' and r.start_at=(e.payload->>'startAt')::timestamptz and r.end_at=(e.payload->>'endAt')::timestamptz and r.staff_id::text=e.payload->>'staffId' and r.service_id::text=e.payload->>'serviceId'))
 );
end $$;
create or replace function claim_email_booking_event(p_store_id uuid,p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e email_booking_events;
begin
 perform expire_email_booking_events(p_store_id);
 select * into e from email_booking_events q where (p_store_id is null or q.store_id=p_store_id)
 and (p_reservation_id is null or q.reservation_id=p_reservation_id) and q.state in ('pending','sending')
 and (q.lease_until is null or q.lease_until<clock_timestamp())
 and not exists(select 1 from email_booking_events prior where prior.reservation_id=q.reservation_id and prior.state in ('pending','sending') and (prior.created_at,prior.id)<(q.created_at,q.id))
 order by q.created_at,q.id limit 1 for update skip locked;
 if not found then return null;end if;
 update email_booking_events set state='sending',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,clock_timestamp()) where id=e.id returning * into e;
 return jsonb_build_object('id',e.id,'storeId',e.store_id,'reservationId',e.reservation_id,'leaseId',e.lease_id,'recipient',e.recipient,'kind',e.kind,'payload',e.payload);
end $$;
create or replace function finish_email_booking_event(p_store_id uuid,p_id uuid,p_lease_id uuid,p_sent boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 update email_booking_events set state=case when p_sent then 'sent' else 'pending' end,
 sent_at=case when p_sent then clock_timestamp() else sent_at end,lease_id=null,
 lease_until=case when p_sent then null else clock_timestamp()+interval '2 minutes' end,
 payload=case when p_sent then payload-'tokenCipher' else payload end
 where store_id=p_store_id and id=p_id and lease_id=p_lease_id and state='sending';
end $$;
create or replace function email_booking_event_summary(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform expire_email_booking_events(p_store_id);
 return (select jsonb_build_object('pending',count(*) filter(where state in ('pending','sending')),'expired',count(*) filter(where state='expired'),
 'rows',(select coalesce(jsonb_agg(x.row),'[]'::jsonb) from (
 select jsonb_build_object('id',e.id,'reservationId',e.reservation_id,'kind',e.kind,'state',e.state,'recipient',e.recipient,'createdAt',e.created_at,'customerName',c.name,'startAt',e.payload->>'startAt') as row
 from email_booking_events e join reservations r on r.id=e.reservation_id join customers c on c.id=r.customer_id
 where e.store_id=p_store_id order by e.created_at desc,e.id desc limit 20
 )x)) from email_booking_events where store_id=p_store_id);
end $$;
revoke all on function queue_email_booking_event(uuid,uuid,text,jsonb),queue_email_booking_update(),expire_email_booking_events(uuid) from public,anon,authenticated,service_role;
revoke all on function create_customer_booking_atomic(uuid,uuid,uuid,timestamptz,text,text,reservation_source,text,text,text,text),claim_email_booking_event(uuid,uuid),finish_email_booking_event(uuid,uuid,uuid,boolean),email_booking_event_summary(uuid) from public,anon,authenticated;
grant execute on function create_customer_booking_atomic(uuid,uuid,uuid,timestamptz,text,text,reservation_source,text,text,text,text),claim_email_booking_event(uuid,uuid),finish_email_booking_event(uuid,uuid,uuid,boolean),email_booking_event_summary(uuid) to service_role;
commit;
