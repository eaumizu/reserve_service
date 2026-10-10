begin;
create table if not exists customer_line_links (
 reservation_id uuid primary key references reservations(id) on delete cascade,
 store_id uuid not null references stores(id), line_user_id text not null,
 linked_at timestamptz not null default now()
);
create table if not exists customer_line_link_codes (
 code_hash text primary key check(code_hash ~ '^[a-f0-9]{64}$'),
 reservation_id uuid not null unique references reservations(id) on delete cascade,
 store_id uuid not null references stores(id), token_hash text not null,
 expires_at timestamptz not null
);
alter table customer_line_links enable row level security;
alter table customer_line_link_codes enable row level security;
revoke all on customer_line_links,customer_line_link_codes from public,anon,authenticated,service_role;
grant select on customer_line_links to service_role;
create or replace function issue_customer_line_code(p_token_hash text,p_code_hash text) returns void
language plpgsql security definer set search_path=public as $$
declare a customer_booking_access;
begin
 select * into a from customer_booking_access where token_hash=p_token_hash and expires_at>clock_timestamp() for update;
 if not found then raise exception 'booking_not_found'; end if;
 if exists(select 1 from customer_line_links where reservation_id=a.reservation_id) then raise exception 'already_linked'; end if;
 if not exists(select 1 from reservations where id=a.reservation_id and status='confirmed' and start_at>clock_timestamp()) then raise exception 'booking_closed'; end if;
 delete from customer_line_link_codes where reservation_id=a.reservation_id;
 insert into customer_line_link_codes values(p_code_hash,a.reservation_id,a.store_id,a.token_hash,clock_timestamp()+interval '10 minutes');
end $$;
create or replace function consume_customer_line_code(p_store_id uuid,p_code_hash text,p_line_user_id text) returns boolean
language plpgsql security definer set search_path=public as $$
declare c customer_line_link_codes;
begin
 if p_line_user_id !~ '^U[0-9a-f]{32}$' then return false; end if;
 select * into c from customer_line_link_codes where code_hash=p_code_hash and store_id=p_store_id for update;
 if not found then return false; end if;
 if c.expires_at<=clock_timestamp() or not exists(select 1 from customer_booking_access where token_hash=c.token_hash and reservation_id=c.reservation_id and expires_at>clock_timestamp()) then return false; end if;
 if not exists(select 1 from reservations where id=c.reservation_id and store_id=c.store_id and status='confirmed' and start_at>clock_timestamp()) then return false; end if;
 insert into customer_line_links(reservation_id,store_id,line_user_id) values(c.reservation_id,c.store_id,p_line_user_id) on conflict(reservation_id) do nothing;
 delete from customer_line_link_codes where code_hash=p_code_hash;
 return true;
end $$;
revoke all on function issue_customer_line_code(text,text),consume_customer_line_code(uuid,text,text) from public,anon,authenticated;
grant execute on function issue_customer_line_code(text,text),consume_customer_line_code(uuid,text,text) to service_role;
commit;
