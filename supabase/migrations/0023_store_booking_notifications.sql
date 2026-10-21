begin;
create table if not exists store_booking_notification_settings (
 store_id uuid primary key references stores(id),recipient text not null default '',enabled boolean not null default false,
 revision uuid not null default gen_random_uuid()
);
create table if not exists store_booking_notifications (
 id uuid primary key default gen_random_uuid(),store_id uuid not null references stores(id),reservation_id uuid not null references reservations(id) on delete cascade,
 kind text not null check(kind in ('created','changed','cancelled')),recipient text not null,settings_revision uuid not null,payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','expired')),lease_id uuid,lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(),sent_at timestamptz
);
create index if not exists store_booking_notification_pending on store_booking_notifications(store_id,created_at) where state in ('pending','sending');
alter table store_booking_notification_settings enable row level security;
alter table store_booking_notifications enable row level security;
revoke all on store_booking_notification_settings,store_booking_notifications from public,anon,authenticated,service_role;
create or replace function save_store_booking_notification_settings(p_store_id uuid,p_recipient text,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_recipient is null or length(p_recipient)>254 or (p_recipient<>'' and p_recipient!~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') or p_enabled is null or (p_enabled and p_recipient='') then raise exception 'invalid_notification_settings';end if;
 insert into store_booking_notification_settings(store_id,recipient,enabled) values(p_store_id,p_recipient,p_enabled)
 on conflict(store_id) do update set recipient=excluded.recipient,enabled=excluded.enabled,
 revision=case when store_booking_notification_settings.recipient is distinct from excluded.recipient or store_booking_notification_settings.enabled is distinct from excluded.enabled then gen_random_uuid() else store_booking_notification_settings.revision end;
end $$;
create or replace function queue_store_booking_notification() returns trigger
language plpgsql security definer set search_path=public as $$
declare cfg store_booking_notification_settings;sender store_email_settings;event_kind text;details jsonb;
begin
 if tg_op='INSERT' then event_kind:='created';
 elsif new.status='cancelled' and old.status is distinct from new.status then event_kind:='cancelled';
 elsif new.status='confirmed' and (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at or new.staff_id is distinct from old.staff_id or new.service_id is distinct from old.service_id) then event_kind:='changed';
 else return new;end if;
 select * into cfg from store_booking_notification_settings where store_id=new.store_id and enabled;
 if not found then return new;end if;
 select * into sender from store_email_settings where store_id=new.store_id and status='verified';
 if not found then return new;end if;
 select jsonb_build_object('storeName',s.name,'customerName',new.customer_name,'phone',c.phone,'serviceName',sv.name,'staffName',st.name,
 'startAt',new.start_at,'endAt',new.end_at,'from',sender.sender_name||' <'||sender.sender_email||'>','replyTo',sender.reply_to,'senderRevision',sender.revision,'domainId',sender.domain_id)
 into details from stores s join customers c on c.id=new.customer_id join services sv on sv.id=new.service_id join staff st on st.id=new.staff_id where s.id=new.store_id;
 if tg_op='UPDATE' then details:=details||jsonb_build_object('oldStartAt',old.start_at,'oldEndAt',old.end_at,'oldStaffName',(select name from staff where id=old.staff_id),'oldServiceName',(select name from services where id=old.service_id));end if;
 insert into store_booking_notifications(store_id,reservation_id,kind,recipient,settings_revision,payload) values(new.store_id,new.id,event_kind,cfg.recipient,cfg.revision,details);
 return new;
end $$;
drop trigger if exists store_booking_notification on reservations;
create trigger store_booking_notification after insert or update on reservations for each row execute function queue_store_booking_notification();
create or replace function expire_store_booking_notifications(p_store_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 update store_booking_notifications n set state='expired',lease_id=null,lease_until=null
 where n.store_id=p_store_id and state in ('pending','sending') and (lease_until is null or lease_until<clock_timestamp())
 and (created_at<clock_timestamp()-interval '23 hours'
 or not exists(select 1 from store_booking_notification_settings c where c.store_id=n.store_id and c.enabled and c.revision=n.settings_revision and c.recipient=n.recipient)
 or not exists(select 1 from store_email_settings s where s.store_id=n.store_id and s.status='verified' and s.revision::text=n.payload->>'senderRevision'));
end $$;
create or replace function claim_store_booking_notification(p_store_id uuid,p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare n store_booking_notifications;
begin
 perform expire_store_booking_notifications(p_store_id);
 select * into n from store_booking_notifications q where q.store_id=p_store_id and (p_reservation_id is null or q.reservation_id=p_reservation_id)
 and q.state in ('pending','sending') and (q.lease_until is null or q.lease_until<clock_timestamp())
 and not exists(select 1 from store_booking_notifications prior where prior.reservation_id=q.reservation_id and prior.store_id=q.store_id and prior.state in ('pending','sending') and (prior.created_at,prior.id)<(q.created_at,q.id))
 order by q.created_at,q.id limit 1 for update skip locked;
 if not found then return null;end if;
 update store_booking_notifications set state='sending',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where id=n.id returning * into n;
 return jsonb_build_object('id',n.id,'storeId',n.store_id,'reservationId',n.reservation_id,'leaseId',n.lease_id,'recipient',n.recipient,'kind',n.kind,'payload',n.payload);
end $$;
create or replace function finish_store_booking_notification(p_store_id uuid,p_id uuid,p_lease_id uuid,p_sent boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 update store_booking_notifications set state=case when p_sent then 'sent' else 'pending' end,lease_id=null,
 lease_until=case when p_sent then null else clock_timestamp()+interval '2 minutes' end,sent_at=case when p_sent then clock_timestamp() else sent_at end
 where store_id=p_store_id and id=p_id and lease_id=p_lease_id and state='sending';
end $$;
create or replace function store_booking_notification_dashboard(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform expire_store_booking_notifications(p_store_id);
 return jsonb_build_object('recipient',coalesce((select recipient from store_booking_notification_settings where store_id=p_store_id),''),
 'enabled',coalesce((select enabled from store_booking_notification_settings where store_id=p_store_id),false),
 'senderReady',exists(select 1 from store_email_settings where store_id=p_store_id and status='verified'),
 'pending',(select count(*) from store_booking_notifications where store_id=p_store_id and state in ('pending','sending')),
 'expired',(select count(*) from store_booking_notifications where store_id=p_store_id and state='expired'),
 'rows',(select coalesce(jsonb_agg(x.row),'[]'::jsonb) from (select jsonb_build_object('id',id,'kind',kind,'state',state,'recipient',recipient,'customerName',payload->>'customerName','startAt',payload->>'startAt') as row from store_booking_notifications where store_id=p_store_id order by created_at desc,id desc limit 20)x));
end $$;
revoke all on function queue_store_booking_notification(),expire_store_booking_notifications(uuid) from public,anon,authenticated,service_role;
revoke all on function save_store_booking_notification_settings(uuid,text,boolean),claim_store_booking_notification(uuid,uuid),finish_store_booking_notification(uuid,uuid,uuid,boolean),store_booking_notification_dashboard(uuid) from public,anon,authenticated;
grant execute on function save_store_booking_notification_settings(uuid,text,boolean),claim_store_booking_notification(uuid,uuid),finish_store_booking_notification(uuid,uuid,uuid,boolean),store_booking_notification_dashboard(uuid) to service_role;
commit;
