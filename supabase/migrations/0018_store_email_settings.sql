-- Apply after 0017. No existing shared sender is automatically trusted.
begin;
create table if not exists store_email_settings (
 store_id uuid primary key references stores(id), sender_name text not null,
 sender_email text not null, reply_to text not null default '', domain text not null unique,
 domain_id text unique, revision uuid not null default gen_random_uuid(),
 status text not null default 'not_registered', records jsonb not null default '[]',
 checked_at timestamptz
);
alter table store_email_settings enable row level security;
revoke all on store_email_settings from public,anon,authenticated,service_role;
create or replace function get_store_email_settings(p_store_id uuid) returns jsonb
language sql security definer set search_path=public as $$
 select jsonb_build_object('senderName',sender_name,'senderEmail',sender_email,'replyTo',reply_to,
 'domain',domain,'domainId',domain_id,'revision',revision,'status',status,'records',records)
 from store_email_settings where store_id=p_store_id
$$;
create or replace function save_store_email_settings(p_store_id uuid,p_settings jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old_settings store_email_settings;
begin
 -- Serialise settings and registration changes for the same store.
 perform 1 from stores where id=p_store_id for update;
 select * into old_settings from store_email_settings where store_id=p_store_id for update;
 if p_settings->>'senderName' is null or p_settings->>'senderEmail' is null or p_settings->>'domain' is null
 or split_part(p_settings->>'senderEmail','@',2)<>p_settings->>'domain' then raise exception 'invalid_sender'; end if;
 if old_settings.status='registering' then
 raise exception 'registration_in_progress'; end if;
 insert into store_email_settings(store_id,sender_name,sender_email,reply_to,domain)
 values(p_store_id,p_settings->>'senderName',p_settings->>'senderEmail',coalesce(p_settings->>'replyTo',''),p_settings->>'domain')
 on conflict(store_id) do update set sender_name=excluded.sender_name,sender_email=excluded.sender_email,reply_to=excluded.reply_to,
 domain=excluded.domain,revision=gen_random_uuid(),
 domain_id=case when store_email_settings.domain=excluded.domain then store_email_settings.domain_id else null end,
 status=case when store_email_settings.domain=excluded.domain then store_email_settings.status else 'not_registered' end,
 records=case when store_email_settings.domain=excluded.domain then store_email_settings.records else '[]'::jsonb end,
 checked_at=case when store_email_settings.domain=excluded.domain then store_email_settings.checked_at else null end;
 return get_store_email_settings(p_store_id);
end $$;
create or replace function begin_store_email_registration(p_store_id uuid,p_revision uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update store_email_settings set status='registering' where store_id=p_store_id and revision=p_revision
 and domain_id is null and status='not_registered';
 return found;
end $$;
create or replace function update_store_email_verification(p_store_id uuid,p_revision uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 update store_email_settings set domain_id=p_result->>'domainId',status=p_result->>'status',
 records=p_result->'records',checked_at=clock_timestamp()
 where store_id=p_store_id and revision=p_revision;
 if not found then return null; end if;
 return get_store_email_settings(p_store_id);
end $$;
create or replace function store_email_ready(p_store_id uuid) returns boolean
language sql security definer set search_path=public as $$
 select exists(select 1 from store_email_settings where store_id=p_store_id and status='verified' and domain_id is not null)
$$;
create or replace function prepare_booking_reminders(p_store_id uuid,p_email_ready boolean) returns void
language plpgsql security definer set search_path=public as $$
declare tomorrow date:=(clock_timestamp() at time zone 'Asia/Tokyo')::date+1;
begin
 -- A retry key is safe only within the providers' 24-hour retention window.
 update booking_reminders j set state='phone',failed=true,lease_id=null,lease_until=null
 where (p_store_id is null or j.store_id=p_store_id) and j.state in ('pending','sending')
 and (j.lease_until is null or j.lease_until<clock_timestamp())
 and (j.first_attempt_at<clock_timestamp()-interval '23 hours'
 or (j.start_at at time zone 'Asia/Tokyo')::date<tomorrow);
 update booking_reminders j set state='obsolete',lease_id=null,lease_until=null
 where (p_store_id is null or j.store_id=p_store_id) and j.state in ('pending','sending','phone')
 and exists(select 1 from reservations r where r.id=j.reservation_id and
 (r.status<>'confirmed' or r.start_at<>j.start_at or r.start_at<=clock_timestamp()));
 update booking_reminders j set state='obsolete',lease_id=null,lease_until=null
 where (p_store_id is null or j.store_id=p_store_id) and j.state in ('pending','sending','phone')
 and exists(select 1 from reservations r where r.id=j.reservation_id and
 ((j.channel='email' and j.recipient is distinct from r.customer_email)
 or (j.channel='line' and not exists(select 1 from customer_line_links l where l.reservation_id=r.id and l.store_id=r.store_id and l.line_user_id=j.recipient))));
 update booking_reminders j set state=case when j.first_attempt_at is null then 'obsolete' else 'phone' end,
 failed=(j.first_attempt_at is not null),lease_id=null,lease_until=null
 where j.channel='email' and j.state in ('pending','sending')
 and (p_store_id is null or j.store_id=p_store_id)
 and (j.lease_until is null or j.lease_until<clock_timestamp())
 and not exists(select 1 from store_email_settings e where e.store_id=j.store_id and e.status='verified'
 and j.payload->>'emailRevision'=e.revision::text);
 -- Re-evaluate untouched phone tasks after the store authenticates its sender.
 update booking_reminders j set state='obsolete'
 where j.channel='phone' and j.state='phone' and not j.failed and j.first_attempt_at is null
 and (p_store_id is null or j.store_id=p_store_id) and p_email_ready and store_email_ready(j.store_id)
 and (j.start_at at time zone 'Asia/Tokyo')::date=tomorrow
 and exists(select 1 from reservations r where r.id=j.reservation_id and nullif(r.customer_email,'') is not null);
 insert into booking_reminders(store_id,reservation_id,start_at,channel,recipient,payload,state)
 select r.store_id,r.id,r.start_at,
 case when l.line_user_id is not null then 'line' when p_email_ready and store_email_ready(r.store_id) and nullif(r.customer_email,'') is not null then 'email' else 'phone' end,
 case when l.line_user_id is not null then l.line_user_id when p_email_ready and store_email_ready(r.store_id) then r.customer_email else null end,
 jsonb_build_object('storeName',s.name,'serviceName',sv.name,'staffName',st.name,'startAt',r.start_at,'endAt',r.end_at,'emailFrom',case when ec.status='verified' then ec.sender_name||' <'||ec.sender_email||'>' end,'emailReplyTo',ec.reply_to,'emailDomainId',ec.domain_id,'emailRevision',ec.revision),
 case when l.line_user_id is not null or (p_email_ready and store_email_ready(r.store_id) and nullif(r.customer_email,'') is not null) then 'pending' else 'phone' end
 from reservations r join store_reminder_settings cfg on cfg.store_id=r.store_id and cfg.enabled
 join stores s on s.id=r.store_id join services sv on sv.id=r.service_id join staff st on st.id=r.staff_id
 left join store_email_settings ec on ec.store_id=r.store_id
 left join customer_line_links l on l.reservation_id=r.id and l.store_id=r.store_id
 where r.status='confirmed' and r.start_at>clock_timestamp()
 and (r.start_at at time zone 'Asia/Tokyo')::date=tomorrow
 and (p_store_id is null or r.store_id=p_store_id)
 on conflict(reservation_id,start_at) where state<>'obsolete' do nothing;
end $$;

revoke all on function get_store_email_settings(uuid),save_store_email_settings(uuid,jsonb),begin_store_email_registration(uuid,uuid),update_store_email_verification(uuid,uuid,jsonb),store_email_ready(uuid) from public,anon,authenticated;
grant execute on function get_store_email_settings(uuid),save_store_email_settings(uuid,jsonb),begin_store_email_registration(uuid,uuid),update_store_email_verification(uuid,uuid,jsonb),store_email_ready(uuid) to service_role;
commit;
