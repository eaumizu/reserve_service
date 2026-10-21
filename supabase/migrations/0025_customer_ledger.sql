begin;
alter table customers add column if not exists staff_note text not null default '';
alter table customers add column if not exists profile_revision uuid not null default gen_random_uuid();
alter table customers drop constraint if exists customers_store_id_phone_key;
revoke insert,update,delete on customers from public,anon,authenticated;
create index if not exists reservations_customer_history on reservations(store_id,customer_id,start_at desc);
create table if not exists customer_identity_aliases (
 store_id uuid not null references stores(id),phone_key text not null,name_key text not null,customer_id uuid not null references customers(id),
 primary key(store_id,phone_key,name_key)
);
alter table customer_identity_aliases enable row level security;
revoke all on customer_identity_aliases from public,anon,authenticated,service_role;
create or replace function customer_phone_key(p_value text) returns text language sql immutable set search_path=public as $$ select regexp_replace(normalize(coalesce(p_value,''),NFKC),'[^0-9+]','','g') $$;
create or replace function customer_name_key(p_value text) returns text language sql immutable set search_path=public as $$ select regexp_replace(lower(normalize(btrim(coalesce(p_value,'')),NFKC)),'[[:space:]　]','','g') $$;
-- Keep every existing profile and booking. Normalized duplicates are not merged.
insert into customer_identity_aliases(store_id,phone_key,name_key,customer_id)
 select store_id,customer_phone_key(phone),customer_name_key(name),id from customers
 where customer_phone_key(phone)<>'' and customer_name_key(name)<>'' order by created_at,id on conflict do nothing;
create or replace function resolve_booking_customer(p_store_id uuid,p_name text,p_phone text) returns uuid
language plpgsql security definer set search_path=public as $$
declare pk text:=customer_phone_key(p_phone);nk text:=customer_name_key(p_name);cid uuid;
begin
 if pk='' or nk='' or length(p_name)>100 or length(p_phone)>50 then raise exception 'invalid_customer_identity';end if;
 perform pg_advisory_xact_lock(hashtextextended('customer:'||p_store_id::text||':'||pk,0));
 select a.customer_id into cid from customer_identity_aliases a join customers c on c.id=a.customer_id and c.store_id=a.store_id
 where a.store_id=p_store_id and a.phone_key=pk and a.name_key=nk;
 if found then return cid;end if;
 insert into customers(store_id,name,phone) values(p_store_id,btrim(p_name),btrim(p_phone)) returning id into cid;
 insert into customer_identity_aliases values(p_store_id,pk,nk,cid);
 return cid;
end $$;
create or replace function customer_ledger_search(p_store_id uuid,p_query text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path=public as $$
declare q text:=lower(btrim(p_query));pk text:=customer_phone_key(p_query);nk text:=customer_name_key(p_query);result jsonb;
begin
 if q is null or length(q)>100 or p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'invalid_customer_query';end if;
 select coalesce(jsonb_agg(x.row),'[]'::jsonb) into result from (
 select jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,
 'visits',(select count(*) from reservations r where r.store_id=c.store_id and r.customer_id=c.id and r.status='completed'),
 'lastVisit',(select max(start_at) from reservations r where r.store_id=c.store_id and r.customer_id=c.id and r.status='completed')) as row
 from customers c where c.store_id=p_store_id and (q='' or position(q in lower(c.name))>0 or (pk<>'' and position(pk in customer_phone_key(c.phone))>0)
 or exists(select 1 from customer_identity_aliases a where a.store_id=c.store_id and a.customer_id=c.id and nk<>'' and position(nk in a.name_key)>0))
 order by c.created_at desc,c.id offset p_offset limit 51
 )x;
 return jsonb_build_object('rows',result);
end $$;
create or replace function customer_ledger_detail(p_store_id uuid,p_customer_id uuid,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c customers;history jsonb;
begin
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'invalid_customer_query';end if;
 select * into c from customers where store_id=p_store_id and id=p_customer_id;
 if not found then raise exception 'customer_not_found';end if;
 select coalesce(jsonb_agg(x.row),'[]'::jsonb) into history from (
 select jsonb_build_object('id',r.id,'startAt',r.start_at,'endAt',r.end_at,'customerName',r.customer_name,'status',r.status,'serviceName',sv.name,'staffName',st.name) as row
 from reservations r join services sv on sv.id=r.service_id join staff st on st.id=r.staff_id where r.store_id=p_store_id and r.customer_id=c.id order by r.start_at desc,r.id offset p_offset limit 21
 )x;
 return jsonb_build_object('customer',jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'note',c.staff_note,'revision',c.profile_revision,
 'visits',(select count(*) from reservations r where r.store_id=p_store_id and r.customer_id=c.id and r.status='completed'),
 'nameVariants',(select count(distinct customer_name_key(customer_name)) from reservations r where r.store_id=p_store_id and r.customer_id=c.id)),
 'reservations',history);
end $$;
create or replace function save_customer_ledger(p_store_id uuid,p_customer_id uuid,p_expected_revision uuid,p_name text,p_note text,p_edit_name boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c customers;pk text;nk text;target uuid;
begin
 if p_note is null or length(p_note)>4000 or p_edit_name is null or (p_edit_name and (p_name is null or length(p_name)>100 or customer_name_key(p_name)='')) then raise exception 'invalid_customer_profile';end if;
 select * into c from customers where store_id=p_store_id and id=p_customer_id;
 if not found then raise exception 'customer_not_found';end if;
 pk:=customer_phone_key(c.phone);perform pg_advisory_xact_lock(hashtextextended('customer:'||p_store_id::text||':'||pk,0));
 select * into c from customers where store_id=p_store_id and id=p_customer_id for update;
 if c.profile_revision is distinct from p_expected_revision then raise exception 'customer_profile_changed';end if;
 if p_edit_name and pk<>'' then
  nk:=customer_name_key(p_name);
  -- Existing normalized duplicate profiles remain editable without merging them.
  if nk is distinct from customer_name_key(c.name) then
   select customer_id into target from customer_identity_aliases where store_id=p_store_id and phone_key=pk and name_key=nk;
   if found and target<>c.id then raise exception 'customer_name_conflict';end if;
   insert into customer_identity_aliases values(p_store_id,pk,nk,c.id) on conflict do nothing;
  end if;
 end if;
 update customers set name=case when p_edit_name then btrim(p_name) else name end,staff_note=p_note,profile_revision=gen_random_uuid() where id=c.id and store_id=p_store_id;
 return jsonb_build_object('id',c.id);
end $$;
revoke all on function resolve_booking_customer(uuid,text,text),customer_phone_key(text),customer_name_key(text) from public,anon,authenticated,service_role;
revoke all on function customer_ledger_search(uuid,text,integer),customer_ledger_detail(uuid,uuid,integer),save_customer_ledger(uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function customer_ledger_search(uuid,text,integer),customer_ledger_detail(uuid,uuid,integer),save_customer_ledger(uuid,uuid,uuid,text,text,boolean) to service_role;
create or replace function create_reservation_atomic(p_store_id uuid, p_service_id uuid, p_staff_id uuid, p_start_at timestamptz, p_customer_name text, p_customer_phone text, p_source reservation_source, p_note text default null)
returns reservations language plpgsql security definer set search_path = public as $$
declare
  v_service services;
  v_customer_id uuid;
  v_end_at timestamptz;
  v_window tstzrange;
  v_reservation reservations;
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  select timezone into v_timezone from stores where id = p_store_id;
  if not found then raise exception 'invalid_store' using errcode = 'P0001'; end if;

  if p_start_at is null or not isfinite(p_start_at) or mod(extract(epoch from p_start_at), 900) <> 0 then
    raise exception 'invalid_start_time' using errcode = 'P0001';
  end if;

  -- Serializes concurrent requests for one staff member; the exclusion constraint remains a final safeguard.
  perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text, 0));

  select s.* into v_service
  from services s
  join staff_services ss on ss.service_id = s.id
  join staff st on st.id = ss.staff_id
  where s.id = p_service_id
    and s.store_id = p_store_id
    and ss.staff_id = p_staff_id
    and st.store_id = p_store_id
    and st.active
    and s.active;
  if not found then raise exception 'invalid_staff_service' using errcode = 'P0001'; end if;

  v_end_at := p_start_at + make_interval(mins => v_service.duration_minutes);
  v_local_start := p_start_at at time zone v_timezone;
  v_local_end := (v_end_at + make_interval(mins => v_service.buffer_after)) at time zone v_timezone;
  if v_local_start::date <> v_local_end::date or not exists (
    select 1 from business_hours h
    where h.store_id = p_store_id
      and h.weekday = extract(dow from v_local_start)::smallint
      and v_local_start::time >= h.start_time
      and v_local_end::time <= h.end_time
  ) then
    raise exception 'outside_business_hours' using errcode = 'P0001';
  end if;

  v_window := tstzrange(p_start_at - make_interval(mins => v_service.buffer_before), v_end_at + make_interval(mins => v_service.buffer_after), '[)');
  if exists (
    select 1 from reservations r join services s on s.id = r.service_id
    where r.staff_id = p_staff_id and r.status = 'confirmed'
      and tstzrange(r.start_at - make_interval(mins => s.buffer_before), r.end_at + make_interval(mins => s.buffer_after), '[)') && v_window
  ) or exists (
    select 1 from availability_blocks b
    where b.store_id = p_store_id
      and (b.staff_id is null or b.staff_id = p_staff_id)
      and tstzrange(b.start_at, b.end_at, '[)') && v_window
  ) then
    raise exception 'time_slot_unavailable' using errcode = 'P0001';
  end if;

  v_customer_id := resolve_booking_customer(p_store_id,p_customer_name,p_customer_phone);
  insert into reservations(store_id, customer_id, service_id, staff_id, start_at, end_at, status, source, note, customer_name)
  values (p_store_id, v_customer_id, p_service_id, p_staff_id, p_start_at, v_end_at, 'confirmed', p_source, p_note, btrim(p_customer_name))
  returning * into v_reservation;
  return v_reservation;
end; $$;
commit;
