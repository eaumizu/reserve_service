begin;
alter table customer_line_link_codes add column if not exists booking_token_cipher text;
create table if not exists line_booking_notifications (
 code_hash text primary key, store_id uuid not null references stores(id),
 reservation_id uuid not null references reservations(id) on delete cascade,
 line_user_id text not null, token_hash text not null, booking_token_cipher text,
 retry_key uuid not null default gen_random_uuid(), booking jsonb not null,
 state text not null default 'pending' check(state in ('pending','sent','cancelled')),
 created_at timestamptz not null default now(),sent_at timestamptz
);
alter table line_booking_notifications enable row level security;
revoke all on line_booking_notifications from public,anon,authenticated,service_role;
create or replace function issue_customer_line_notification_code(p_token_hash text,p_code_hash text,p_booking_token_cipher text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_booking_token_cipher is null or length(p_booking_token_cipher)>2000 then raise exception 'invalid_cipher'; end if;
 perform issue_customer_line_code(p_token_hash,p_code_hash);
 update customer_line_link_codes set booking_token_cipher=p_booking_token_cipher where code_hash=p_code_hash;
end $$;
create or replace function consume_customer_line_notification_code(p_store_id uuid,p_code_hash text,p_line_user_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c customer_line_link_codes; n line_booking_notifications; accepted boolean;
begin
 -- Existing pending work is recoverable even after its one-use code was consumed.
 select * into c from customer_line_link_codes where code_hash=p_code_hash and store_id=p_store_id for update;
 if found then
  accepted:=consume_customer_line_code(p_store_id,p_code_hash,p_line_user_id);
  if not accepted then return null; end if;
  if c.booking_token_cipher is null then return null; end if;
  if not exists(select 1 from customer_line_links where reservation_id=c.reservation_id and store_id=p_store_id and line_user_id=p_line_user_id) then return null; end if;
  insert into line_booking_notifications(code_hash,store_id,reservation_id,line_user_id,token_hash,booking_token_cipher,booking)
  values(p_code_hash,p_store_id,c.reservation_id,p_line_user_id,c.token_hash,c.booking_token_cipher,read_customer_booking(c.token_hash)) on conflict do nothing;
 end if;
 select * into n from line_booking_notifications where code_hash=p_code_hash and store_id=p_store_id and line_user_id=p_line_user_id for update;
 if not found or n.state<>'pending' then return null; end if;
 -- LINE retry keys expire after 24h. Never retry outside that safe window.
 if n.created_at<clock_timestamp()-interval '23 hours' or not exists(select 1 from customer_booking_access where token_hash=n.token_hash and reservation_id=n.reservation_id and expires_at>clock_timestamp()) then
  update line_booking_notifications set state='cancelled',booking_token_cipher=null where code_hash=p_code_hash;return null;
 end if;
 return jsonb_build_object('codeHash',n.code_hash,'storeId',n.store_id,'userId',n.line_user_id,'tokenHash',n.token_hash,'tokenCipher',n.booking_token_cipher,'retryKey',n.retry_key,'booking',n.booking);
end $$;
create or replace function mark_line_booking_notification_sent(p_store_id uuid,p_code_hash text,p_retry_key uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 update line_booking_notifications set state='sent',sent_at=clock_timestamp(),booking_token_cipher=null
 where store_id=p_store_id and code_hash=p_code_hash and retry_key=p_retry_key and state='pending';
end $$;
revoke all on function issue_customer_line_notification_code(text,text,text),consume_customer_line_notification_code(uuid,text,text),mark_line_booking_notification_sent(uuid,text,uuid) from public,anon,authenticated;
grant execute on function issue_customer_line_notification_code(text,text,text),consume_customer_line_notification_code(uuid,text,text),mark_line_booking_notification_sent(uuid,text,uuid) to service_role;
commit;
