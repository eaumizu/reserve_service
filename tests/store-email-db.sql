begin;
do $test$
declare s uuid:='11111111-1111-1111-1111-111111111111'; other uuid:='99999999-9999-9999-9999-999999999999';
 cfg jsonb;rev uuid; old_rev uuid; j jsonb; a reservations;
 st uuid:='77777777-7777-7777-7777-777777777777';
 t timestamptz:=((clock_timestamp() at time zone 'Asia/Tokyo')::date+1+time '13:00') at time zone 'Asia/Tokyo';
begin
 insert into stores(id,name,timezone) values(other,'別店舗','Asia/Tokyo');
 cfg:=save_store_email_settings(s,'{"senderName":"店舗","senderEmail":"booking@example.com","replyTo":"reply@gmail.com","domain":"example.com"}');
 if store_email_ready(s) or store_email_ready(other) then raise exception 'unverified ready';end if;
 begin
 perform save_store_email_settings(other,'{"senderName":"別店舗","senderEmail":"other@example.com","domain":"example.com"}');
 raise exception 'duplicate domain accepted'; exception when unique_violation then null;end;
 rev:=(cfg->>'revision')::uuid;
 if update_store_email_verification(other,rev,'{"domainId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"verified","records":[]}') is not null then raise exception 'tenant changed';end if;
 if not begin_store_email_registration(s,rev) or begin_store_email_registration(s,rev) then raise exception 'registration lease wrong';end if;
 perform update_store_email_verification(s,rev,'{"domainId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"verified","records":[]}');
 if not store_email_ready(s) or store_email_ready(other) then raise exception 'verified isolation';end if;
 insert into staff(id,store_id,name) values(st,s,'メール確認');insert into staff_services values(st,'44444444-4444-4444-4444-444444444444');
 a:=create_reservation_atomic(s,'44444444-4444-4444-4444-444444444444',st,t,'メール対象','09000000039','phone',null);
 update reservations set customer_email='test@example.com' where id=a.id;
 perform set_booking_reminders_enabled(s,true);perform prepare_booking_reminders(s,true);
 j:=claim_booking_reminder(s);
 if j->>'channel'<>'email' or j->'payload'->>'emailFrom'<>'店舗 <booking@example.com>' or j->'payload'->>'emailReplyTo'<>'reply@gmail.com' then raise exception 'sender snapshot missing';end if;
 perform finish_booking_reminder(s,(j->>'id')::uuid,(j->>'leaseId')::uuid,false);
 update booking_reminders set lease_until=clock_timestamp()-interval '1 second' where id=(j->>'id')::uuid;
 old_rev:=rev;
 cfg:=save_store_email_settings(s,'{"senderName":"新店舗名","senderEmail":"booking@example.com","replyTo":"reply@gmail.com","domain":"example.com"}');
 rev:=(cfg->>'revision')::uuid;
 if rev=old_rev or not store_email_ready(s) then raise exception 'sender revision not updated';end if;
 if update_store_email_verification(s,old_rev,'{"domainId":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","status":"verified","records":[]}') is not null then raise exception 'stale verification';end if;
 perform prepare_booking_reminders(s,true);
 if not exists(select 1 from booking_reminders where id=(j->>'id')::uuid and state='phone' and failed) then raise exception 'changed retry sender not stopped';end if;
 if claim_booking_reminder(s) is not null then raise exception 'duplicate changed sender delivery';end if;
 -- A never-attempted phone job upgrades once verified; contacted jobs remain untouched.
 update booking_reminders set first_attempt_at=null,failed=false,state='phone',channel='phone',recipient=null where id=(j->>'id')::uuid;
 perform prepare_booking_reminders(s,true);
 j:=claim_booking_reminder(s);if j->'payload'->>'emailFrom'<>'新店舗名 <booking@example.com>' then raise exception 'new sender not used';end if;
 if has_table_privilege('authenticated','store_email_settings','select') or has_function_privilege('authenticated','save_store_email_settings(uuid,jsonb)','execute') then raise exception 'public sender access';end if;
end $test$;
rollback;
