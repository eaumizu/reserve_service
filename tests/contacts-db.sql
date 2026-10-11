begin;
do $$
declare s uuid:='11111111-1111-1111-1111-111111111111';r reservations;eid uuid;d jsonb;
begin
 select * into r from reservations where store_id=s limit 1;
 insert into email_booking_events(store_id,reservation_id,recipient,kind,payload,state) values(s,r.id,'test@example.com','changed',jsonb_build_object('startAt',r.start_at,'tokenCipher','hidden','tokenHash','hidden'),'expired') returning id into eid;
 d:=booking_contact_dashboard(s,false);
 if not exists(select 1 from jsonb_array_elements(d->'events') e where e->>'id'=eid::text and e->>'canContact'='true') then raise exception 'missing action';end if;
 if d::text like '%tokenCipher%' or d::text like '%tokenHash%' then raise exception 'private projection leak';end if;
 if exists(select 1 from jsonb_array_elements(booking_contact_dashboard('99999999-9999-9999-9999-999999999999',false)->'events') e where e->>'id'=eid::text) then raise exception 'tenant leak';end if;
 begin perform record_booking_event_contact('99999999-9999-9999-9999-999999999999','email',eid,gen_random_uuid());raise exception 'cross contact allowed';exception when others then if sqlerrm='cross contact allowed' then raise;end if;end;
 perform record_booking_event_contact(s,'email',eid,gen_random_uuid());
 d:=booking_contact_dashboard(s,false);
 if not exists(select 1 from jsonb_array_elements(d->'events') e where e->>'id'=eid::text and e->>'state'='contacted' and e->>'canRetry'='false') then raise exception 'contact not recorded';end if;
 update email_booking_events set state='sending',lease_until=clock_timestamp()+interval '2 minutes' where id=eid;
 begin perform record_booking_event_contact(s,'email',eid,gen_random_uuid());raise exception 'sending contact allowed';exception when others then if sqlerrm='sending contact allowed' then raise;end if;end;
 if has_table_privilege('authenticated','booking_contact_records','select') or has_function_privilege('anon','booking_contact_dashboard(uuid,boolean)','execute') then raise exception 'public access';end if;
end $$;
rollback;
