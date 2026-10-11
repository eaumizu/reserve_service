-- Apply after 0016. Notifications remain disabled until each store enables them.
begin;
create table if not exists store_reminder_settings (
 store_id uuid primary key references stores(id), enabled boolean not null default false
);
create table if not exists booking_reminders (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id),
 reservation_id uuid not null references reservations(id) on delete cascade,
 start_at timestamptz not null, channel text not null check(channel in ('line','email','phone')),
 recipient text, payload jsonb not null,
 state text not null check(state in ('pending','sending','sent','phone','contacted','obsolete')),
 lease_id uuid, lease_until timestamptz, first_attempt_at timestamptz,
 failed boolean not null default false, sent_at timestamptz, contacted_at timestamptz,
 contacted_by uuid, created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists booking_reminders_current on booking_reminders(reservation_id,start_at) where state<>'obsolete';
create index if not exists booking_reminders_pending on booking_reminders(store_id,start_at) where state in ('pending','sending','phone');
alter table store_reminder_settings enable row level security;
alter table booking_reminders enable row level security;
revoke all on store_reminder_settings,booking_reminders from public,anon,authenticated,service_role;

create or replace function invalidate_booking_reminders() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status or new.start_at is distinct from old.start_at
 or new.end_at is distinct from old.end_at or new.staff_id is distinct from old.staff_id
 or new.service_id is distinct from old.service_id or new.customer_email is distinct from old.customer_email then
  update booking_reminders set state='obsolete',lease_id=null,lease_until=null
  where reservation_id=new.id and state<>'obsolete';
 end if;
 return new;
end $$;
drop trigger if exists reservation_reminder_invalidated on reservations;
create trigger reservation_reminder_invalidated after update on reservations for each row execute function invalidate_booking_reminders();

create or replace function prepare_booking_reminders(p_store_id uuid,p_email_ready boolean) returns void
language plpgsql security definer set search_path=public as $$
declare tomorrow date:=(clock_timestamp() at time zone 'Asia/Tokyo')::date+1;
begin
 -- A retry key is safe only within the providers' 24-hour retention window.
 update booking_reminders j set state='phone',failed=true,lease_id=null,lease_until=null
 where (p_store_id is null or j.store_id=p_store_id) and j.state in ('pending','sending')
 and (j.lease_until is null or j.lease_until<clock_timestamp())
 and j.first_attempt_at<clock_timestamp()-interval '23 hours';
 update booking_reminders j set state='obsolete',lease_id=null,lease_until=null
 where (p_store_id is null or j.store_id=p_store_id) and j.state in ('pending','sending','phone')
 and exists(select 1 from reservations r where r.id=j.reservation_id and
 (r.status<>'confirmed' or r.start_at<>j.start_at or r.start_at<=clock_timestamp()));
 update booking_reminders j set state='obsolete',lease_id=null,lease_until=null
 where (p_store_id is null or j.store_id=p_store_id) and j.state in ('pending','sending','phone')
 and exists(select 1 from reservations r where r.id=j.reservation_id and
 ((j.channel='email' and j.recipient is distinct from r.customer_email)
 or (j.channel='line' and not exists(select 1 from customer_line_links l where l.reservation_id=r.id and l.store_id=r.store_id and l.line_user_id=j.recipient))));
 insert into booking_reminders(store_id,reservation_id,start_at,channel,recipient,payload,state)
 select r.store_id,r.id,r.start_at,
 case when l.line_user_id is not null then 'line' when p_email_ready and nullif(r.customer_email,'') is not null then 'email' else 'phone' end,
 case when l.line_user_id is not null then l.line_user_id when p_email_ready then r.customer_email else null end,
 jsonb_build_object('storeName',s.name,'serviceName',sv.name,'staffName',st.name,'startAt',r.start_at,'endAt',r.end_at),
 case when l.line_user_id is not null or (p_email_ready and nullif(r.customer_email,'') is not null) then 'pending' else 'phone' end
 from reservations r join store_reminder_settings cfg on cfg.store_id=r.store_id and cfg.enabled
 join stores s on s.id=r.store_id join services sv on sv.id=r.service_id join staff st on st.id=r.staff_id
 left join customer_line_links l on l.reservation_id=r.id and l.store_id=r.store_id
 where r.status='confirmed' and r.start_at>clock_timestamp()
 and (r.start_at at time zone 'Asia/Tokyo')::date=tomorrow
 and (p_store_id is null or r.store_id=p_store_id)
 on conflict(reservation_id,start_at) where state<>'obsolete' do nothing;
end $$;

create or replace function claim_booking_reminder(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j booking_reminders; result jsonb;
begin
 select q.* into j from booking_reminders q
 join store_reminder_settings cfg on cfg.store_id=q.store_id and cfg.enabled
 join reservations r on r.id=q.reservation_id and r.store_id=q.store_id
 where (p_store_id is null or q.store_id=p_store_id) and r.status='confirmed' and r.start_at=q.start_at
 and q.start_at>clock_timestamp() and (q.start_at at time zone 'Asia/Tokyo')::date=(clock_timestamp() at time zone 'Asia/Tokyo')::date+1
 and q.state in ('pending','sending') and (q.lease_until is null or q.lease_until<clock_timestamp())
 and (q.first_attempt_at is null or q.first_attempt_at>clock_timestamp()-interval '23 hours')
 and ((q.channel='line' and exists(select 1 from customer_line_links l where l.reservation_id=r.id and l.store_id=r.store_id and l.line_user_id=q.recipient))
 or (q.channel='email' and q.recipient=r.customer_email))
 order by q.failed,q.start_at,q.id limit 1 for update of q skip locked;
 if not found then return null; end if;
 update booking_reminders set state='sending',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',
 first_attempt_at=coalesce(first_attempt_at,clock_timestamp()) where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'storeId',j.store_id,'leaseId',j.lease_id,'channel',j.channel,'recipient',j.recipient,'payload',j.payload);
end $$;

create or replace function finish_booking_reminder(p_store_id uuid,p_id uuid,p_lease_id uuid,p_sent boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 update booking_reminders set state=case when p_sent then 'sent' else 'pending' end,
 sent_at=case when p_sent then clock_timestamp() else sent_at end,failed=not p_sent,
 lease_id=null,lease_until=case when p_sent then null else clock_timestamp()+interval '2 minutes' end
 where store_id=p_store_id and id=p_id and lease_id=p_lease_id and state='sending';
end $$;

create or replace function booking_reminder_dashboard(p_store_id uuid,p_email_ready boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform prepare_booking_reminders(p_store_id,p_email_ready);
 select coalesce(jsonb_agg(x.row order by x.start_at,x.id),'[]'::jsonb) into result from (
 select j.id,j.start_at,jsonb_build_object('id',j.id,'reservationId',r.id,'startAt',r.start_at,'customerName',c.name,'phone',c.phone,
 'serviceName',sv.name,'staffName',st.name,'channel',j.channel,'state',j.state,'failed',j.failed,
 'sentAt',j.sent_at,'contactedAt',j.contacted_at) as row
 from booking_reminders j join reservations r on r.id=j.reservation_id and r.store_id=j.store_id
 join customers c on c.id=r.customer_id join services sv on sv.id=r.service_id join staff st on st.id=r.staff_id
 where j.store_id=p_store_id and j.state<>'obsolete' and r.status='confirmed' and r.start_at>clock_timestamp()
 and (r.start_at at time zone 'Asia/Tokyo')::date <= (clock_timestamp() at time zone 'Asia/Tokyo')::date+1
 order by j.start_at,j.id limit 200
 )x;
 return jsonb_build_object('enabled',coalesce((select enabled from store_reminder_settings where store_id=p_store_id),false),'rows',result);
end $$;
create or replace function set_booking_reminders_enabled(p_store_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 insert into store_reminder_settings values(p_store_id,p_enabled) on conflict(store_id) do update set enabled=excluded.enabled;
end $$;
create or replace function record_reminder_contact(p_store_id uuid,p_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 update booking_reminders j set state='contacted',contacted_at=clock_timestamp(),contacted_by=p_user_id,lease_id=null,lease_until=null
 where j.store_id=p_store_id and j.id=p_id and (j.state='phone' or (j.state='pending' and j.failed))
 and (j.lease_until is null or j.lease_until<clock_timestamp())
 and exists(select 1 from reservations r where r.id=j.reservation_id and r.status='confirmed' and r.start_at=j.start_at and r.start_at>clock_timestamp());
 if not found then raise exception 'reminder_changed'; end if;
end $$;
revoke all on function invalidate_booking_reminders() from public,anon,authenticated,service_role;
revoke all on function prepare_booking_reminders(uuid,boolean),claim_booking_reminder(uuid),finish_booking_reminder(uuid,uuid,uuid,boolean),booking_reminder_dashboard(uuid,boolean),set_booking_reminders_enabled(uuid,boolean),record_reminder_contact(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function prepare_booking_reminders(uuid,boolean),claim_booking_reminder(uuid),finish_booking_reminder(uuid,uuid,uuid,boolean),booking_reminder_dashboard(uuid,boolean),set_booking_reminders_enabled(uuid,boolean),record_reminder_contact(uuid,uuid,uuid) to service_role;
commit;
