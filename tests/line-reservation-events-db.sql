do $test$
declare store uuid:='11111111-1111-1111-1111-111111111111';staff_id uuid:='22222222-2222-2222-2222-222222222222';service uuid:='44444444-4444-4444-4444-444444444444';r reservations; t timestamptz:=((clock_timestamp() at time zone 'Asia/Tokyo')::date+4+time '09:00') at time zone 'Asia/Tokyo';jobs jsonb; id uuid; n integer;
begin
 r:=create_reservation_atomic(store,service,staff_id,t,'通知確認','09000000009','phone',null);
 update reservations set start_at=t+interval '15 minutes',end_at=end_at+interval '15 minutes' where reservations.id=r.id;
 if exists(select 1 from line_reservation_events where reservation_id=r.id) then raise exception 'unlinked notification created'; end if;
 insert into customer_line_links(reservation_id,store_id,line_user_id) values(r.id,store,'U'||repeat('c',32));
 update reservations set start_at=t+interval '30 minutes',end_at=end_at+interval '15 minutes',updated_at=clock_timestamp() where reservations.id=r.id;
 jobs:=pending_line_reservation_events(store,r.id);
 if jsonb_array_length(jobs)<>1 or jobs->0->>'kind'<>'changed' or jobs->0->>'userId'<>'U'||repeat('c',32) then raise exception 'change not queued'; end if;
 if jsonb_array_length(pending_line_reservation_events('99999999-9999-9999-9999-999999999999',r.id))<>0 then raise exception 'tenant queue leak'; end if;
 update reservations set note='private staff data',updated_at=clock_timestamp() where reservations.id=r.id;
 if jsonb_array_length(pending_line_reservation_events(store,r.id))<>1 then raise exception 'note triggered notification'; end if;
 select count(*) into n from line_reservation_events where reservation_id=r.id;
 begin
  update reservations set start_at=t+interval '45 minutes',end_at=end_at+interval '15 minutes' where reservations.id=r.id;
  raise exception 'rollback_change';
 exception when others then if sqlerrm<>'rollback_change' then raise; end if; end;
 if (select count(*) from line_reservation_events where reservation_id=r.id)<>n then raise exception 'rolled back event persisted'; end if;
 id:=(jobs->0->>'id')::uuid;
 perform mark_line_reservation_event_sent('99999999-9999-9999-9999-999999999999',id);
 if jsonb_array_length(pending_line_reservation_events(store,r.id))<>1 then raise exception 'wrong tenant marked'; end if;
 perform mark_line_reservation_event_sent(store,id);
 if jsonb_array_length(pending_line_reservation_events(store,r.id))<>0 then raise exception 'sent event still pending'; end if;
 update reservations set status='cancelled',updated_at=clock_timestamp() where reservations.id=r.id;
 jobs:=pending_line_reservation_events(store,r.id);if jsonb_array_length(jobs)<>1 or jobs->0->>'kind'<>'cancelled' then raise exception 'cancel not queued'; end if;
 update reservations set status='cancelled',updated_at=clock_timestamp() where reservations.id=r.id;
 if jsonb_array_length(pending_line_reservation_events(store,r.id))<>1 then raise exception 'duplicate cancel'; end if;
 if (jobs::text) like '%private staff data%' or (jobs::text) like '%09000000009%' then raise exception 'private data exposed'; end if;
 update line_reservation_events set created_at=clock_timestamp()-interval '24 hours' where reservation_id=r.id and state='pending';
 if jsonb_array_length(pending_line_reservation_events(store,r.id))<>0 then raise exception 'expired job returned'; end if;
 if not exists(select 1 from line_reservation_events where reservation_id=r.id and state='expired') then raise exception 'expired state missing'; end if;
 if has_table_privilege('anon','line_reservation_events','select') or has_function_privilege('authenticated','pending_line_reservation_events(uuid,uuid)','execute') then raise exception 'event privilege leak'; end if;
end $test$;
