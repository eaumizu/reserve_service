begin;
-- Email aliases have a separate key namespace; never match all empty phone numbers.
insert into customer_identity_aliases(store_id,phone_key,name_key,customer_id)
 select r.store_id,'email:'||lower(btrim(r.customer_email)),customer_name_key(r.customer_name),r.customer_id
 from reservations r join customers c on c.id=r.customer_id and c.store_id=r.store_id
 where nullif(btrim(r.customer_email),'') is not null and customer_name_key(r.customer_name)<>''
 order by r.created_at,r.id on conflict do nothing;
create or replace function resolve_booking_customer_contact(p_store_id uuid,p_name text,p_phone text,p_email text) returns uuid
language plpgsql security definer set search_path=public as $$
declare pk text:=customer_phone_key(p_phone);nk text:=customer_name_key(p_name);ek text:=case when nullif(btrim(p_email),'') is not null then 'email:'||lower(btrim(p_email)) else null end;cid uuid;email_cid uuid;existing_phone text;
begin
 if nk='' or length(p_name)>100 or length(coalesce(p_phone,''))>50 or (pk='' and ek is null) then raise exception 'invalid_customer_identity';end if;
 perform pg_advisory_xact_lock(hashtextextended('customer:'||p_store_id::text||':'||pk,0));
 if ek is not null then perform pg_advisory_xact_lock(hashtextextended('customer-email:'||p_store_id::text||':'||ek,0));end if;
 if pk<>'' then
  select a.customer_id into cid from customer_identity_aliases a join customers c on c.id=a.customer_id and c.store_id=a.store_id where a.store_id=p_store_id and a.phone_key=pk and a.name_key=nk;
 end if;
 if cid is null and ek is not null then
  select a.customer_id,customer_phone_key(c.phone) into email_cid,existing_phone from customer_identity_aliases a join customers c on c.id=a.customer_id and c.store_id=a.store_id where a.store_id=p_store_id and a.phone_key=ek and a.name_key=nk;
  if found and (pk='' or existing_phone='' or existing_phone=pk) then cid:=email_cid;end if;
 end if;
 if cid is null then insert into customers(store_id,name,phone) values(p_store_id,btrim(p_name),coalesce(btrim(p_phone),'')) returning id into cid;end if;
 if pk<>'' then
  insert into customer_identity_aliases values(p_store_id,pk,nk,cid) on conflict do nothing;
  update customers set phone=btrim(p_phone),profile_revision=gen_random_uuid() where id=cid and store_id=p_store_id and nullif(btrim(phone),'') is null;
 end if;
 if ek is not null then insert into customer_identity_aliases values(p_store_id,ek,nk,cid) on conflict do nothing;end if;
 return cid;
end $$;
create or replace function create_reservation_contact_atomic(p_store_id uuid, p_service_id uuid, p_staff_id uuid, p_start_at timestamptz, p_customer_name text, p_customer_phone text, p_source reservation_source, p_note text, p_customer_email text)
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
  if p_source='web' and nullif(btrim(p_customer_email),'') is null then raise exception 'email_required';end if;
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

  v_customer_id := resolve_booking_customer_contact(p_store_id,p_customer_name,p_customer_phone,p_customer_email);
  insert into reservations(store_id, customer_id, service_id, staff_id, start_at, end_at, status, source, note, customer_name, customer_email)
  values (p_store_id, v_customer_id, p_service_id, p_staff_id, p_start_at, v_end_at, 'confirmed', p_source, p_note, btrim(p_customer_name),p_customer_email)
  returning * into v_reservation;
  return v_reservation;
end; $$;

create or replace function create_reservation_atomic(p_store_id uuid,p_service_id uuid,p_staff_id uuid,p_start_at timestamptz,p_customer_name text,p_customer_phone text,p_source reservation_source,p_note text default null)
returns reservations language sql security definer set search_path=public as $$
 select create_reservation_contact_atomic(p_store_id,p_service_id,p_staff_id,p_start_at,p_customer_name,p_customer_phone,p_source,p_note,null)
$$;
create or replace function create_reservation_with_email_atomic(p_store_id uuid,p_service_id uuid,p_staff_id uuid,p_start_at timestamptz,p_customer_name text,p_customer_phone text,p_source reservation_source,p_note text default null,p_customer_email text default null)
returns reservations language plpgsql security definer set search_path=public as $$
declare r reservations;e text:=nullif(btrim(p_customer_email),'');
begin
 if e is not null and (length(e)>254 or e!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'invalid_email';end if;
 r:=create_reservation_contact_atomic(p_store_id,p_service_id,p_staff_id,p_start_at,p_customer_name,p_customer_phone,p_source,p_note,e);
 return r;
end $$;
create or replace function customer_ledger_search(p_store_id uuid,p_query text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path=public as $$
declare q text:=lower(btrim(p_query));pk text:=customer_phone_key(p_query);nk text:=customer_name_key(p_query);result jsonb;
begin
 if q is null or length(q)>100 or p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'invalid_customer_query';end if;
 select coalesce(jsonb_agg(x.row),'[]'::jsonb) into result from (
 select jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'email',(select r.customer_email from reservations r where r.store_id=c.store_id and r.customer_id=c.id and r.customer_email is not null order by r.created_at desc,r.id desc limit 1),
 'visits',(select count(*) from reservations r where r.store_id=c.store_id and r.customer_id=c.id and r.status='completed'),
 'lastVisit',(select max(start_at) from reservations r where r.store_id=c.store_id and r.customer_id=c.id and r.status='completed')) as row
 from customers c where c.store_id=p_store_id and (q='' or position(q in lower(c.name))>0 or (pk<>'' and position(pk in customer_phone_key(c.phone))>0)
 or exists(select 1 from customer_identity_aliases a where a.store_id=c.store_id and a.customer_id=c.id and ((nk<>'' and position(nk in a.name_key)>0) or (a.phone_key like 'email:%' and position(q in substring(a.phone_key from 7))>0))))
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
 return jsonb_build_object('customer',jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'email',(select r.customer_email from reservations r where r.store_id=c.store_id and r.customer_id=c.id and r.customer_email is not null order by r.created_at desc,r.id desc limit 1),'note',c.staff_note,'revision',c.profile_revision,
 'visits',(select count(*) from reservations r where r.store_id=p_store_id and r.customer_id=c.id and r.status='completed'),
 'nameVariants',(select count(distinct customer_name_key(customer_name)) from reservations r where r.store_id=p_store_id and r.customer_id=c.id)),
 'reservations',history);
end $$;
create or replace function save_customer_ledger(p_store_id uuid,p_customer_id uuid,p_expected_revision uuid,p_name text,p_note text,p_edit_name boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c customers;pk text;nk text;target uuid;ek text;
begin
 if p_note is null or length(p_note)>4000 or p_edit_name is null or (p_edit_name and (p_name is null or length(p_name)>100 or customer_name_key(p_name)='')) then raise exception 'invalid_customer_profile';end if;
 select * into c from customers where store_id=p_store_id and id=p_customer_id;
 if not found then raise exception 'customer_not_found';end if;
 pk:=customer_phone_key(c.phone);perform pg_advisory_xact_lock(hashtextextended('customer:'||p_store_id::text||':'||pk,0));
 for ek in select distinct phone_key from customer_identity_aliases where store_id=p_store_id and customer_id=c.id and phone_key like 'email:%' order by phone_key loop
  perform pg_advisory_xact_lock(hashtextextended('customer-email:'||p_store_id::text||':'||ek,0));
 end loop;
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
 if p_edit_name and customer_name_key(p_name) is distinct from customer_name_key(c.name) then
  for ek in select distinct phone_key from customer_identity_aliases where store_id=p_store_id and customer_id=c.id and phone_key like 'email:%' loop
   select customer_id into target from customer_identity_aliases where store_id=p_store_id and phone_key=ek and name_key=customer_name_key(p_name);
   if found and target<>c.id then raise exception 'customer_name_conflict';end if;
   insert into customer_identity_aliases values(p_store_id,ek,customer_name_key(p_name),c.id) on conflict do nothing;
  end loop;
 end if;
 update customers set name=case when p_edit_name then btrim(p_name) else name end,staff_note=p_note,profile_revision=gen_random_uuid() where id=c.id and store_id=p_store_id;
 return jsonb_build_object('id',c.id);
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
 select jsonb_build_object('storeName',s.name,'customerName',new.customer_name,'phone',c.phone,'customerEmail',new.customer_email,'serviceName',sv.name,'staffName',st.name,
 'startAt',new.start_at,'endAt',new.end_at,'from',sender.sender_name||' <'||sender.sender_email||'>','replyTo',sender.reply_to,'senderRevision',sender.revision,'domainId',sender.domain_id)
 into details from stores s join customers c on c.id=new.customer_id join services sv on sv.id=new.service_id join staff st on st.id=new.staff_id where s.id=new.store_id;
 if tg_op='UPDATE' then details:=details||jsonb_build_object('oldStartAt',old.start_at,'oldEndAt',old.end_at,'oldStaffName',(select name from staff where id=old.staff_id),'oldServiceName',(select name from services where id=old.service_id));end if;
 insert into store_booking_notifications(store_id,reservation_id,kind,recipient,settings_revision,payload) values(new.store_id,new.id,event_kind,cfg.recipient,cfg.revision,details);
 return new;
end $$;

revoke all on function resolve_booking_customer_contact(uuid,text,text,text),create_reservation_contact_atomic(uuid,uuid,uuid,timestamptz,text,text,reservation_source,text,text) from public,anon,authenticated,service_role;
commit;
