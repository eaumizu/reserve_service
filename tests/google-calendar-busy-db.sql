begin;
do $$
declare s uuid:='11111111-1111-1111-1111-111111111111';sv uuid:='44444444-4444-4444-4444-444444444444';st uuid:='22222222-2222-2222-2222-222222222222';rev uuid;ticket uuid;old_ticket uuid;day date;t timestamptz;r reservations;
begin
 day:=(clock_timestamp() at time zone 'Asia/Tokyo')::date+12;t:=(day+time '13:00') at time zone 'Asia/Tokyo';
 insert into business_hours(store_id,weekday,start_time,end_time) select s,extract(dow from day)::smallint,'09:00','18:00' where not exists(select 1 from business_hours where store_id=s and weekday=extract(dow from day)::smallint);
 perform save_store_calendar_connection(s,gen_random_uuid(),'cal','店舗予約','cipher');perform set_store_calendar_busy(s,true);
 select revision into rev from store_calendar_connections where store_id=s;
 begin perform create_reservation_atomic(s,sv,st,t,'予定確認','09000000261','phone',null);raise exception 'unchecked booking allowed';exception when others then if sqlerrm<>'calendar_busy_unavailable' then raise;end if;end;
 old_ticket:=begin_store_calendar_busy(s,day,rev);ticket:=begin_store_calendar_busy(s,day,rev);
 if save_store_calendar_busy(s,day,rev,old_ticket,'[]') then raise exception 'old refresh overwrote newer one';end if;
 if not save_store_calendar_busy(s,day,rev,ticket,jsonb_build_array(jsonb_build_object('start',t,'end',t+interval '1 hour'))) then raise exception 'snapshot not saved';end if;
 begin perform create_reservation_with_email_atomic(s,sv,st,t,'予定確認','09000000261','web',null,'test@example.com');raise exception 'busy booking allowed';exception when others then if sqlerrm<>'time_slot_unavailable' then raise;end if;end;
 -- The actual public booking RPC must reject a slot that was selected before Google changed.
 begin perform create_customer_booking_atomic(s,sv,st,t,'Google重複テスト','','web',null,'busy@example.com',repeat('b',64));raise exception 'public customer booking bypassed Google busy';exception when others then if sqlerrm<>'time_slot_unavailable' then raise;end if;end;
 -- A cleanup interval that reaches a Google event must also be blocked.
 update services set duration_minutes=30,buffer_before=0,buffer_after=15 where id=sv;
 begin perform create_reservation_atomic(s,sv,st,t-interval '30 minutes','予定確認','09000000261','phone',null);raise exception 'cleanup overlap allowed';exception when others then if sqlerrm<>'time_slot_unavailable' then raise;end if;end;
 r:=create_reservation_atomic(s,sv,st,t-interval '45 minutes','予定確認','09000000261','phone',null);
 -- Exact adjacency at the cleanup end is permitted; a later move into busy time is not.
 begin update reservations set start_at=t,end_at=t+interval '30 minutes' where id=r.id;raise exception 'move into Google busy allowed';exception when others then if sqlerrm<>'time_slot_unavailable' then raise;end if;end;
 begin perform reschedule_reservation_atomic(s,r.id,st,t,r.updated_at);raise exception 'admin move bypassed Google busy';exception when others then if sqlerrm<>'time_slot_unavailable' then raise;end if;end;
 perform issue_customer_booking_access(s,r.id,repeat('c',64));
 begin perform manage_customer_booking_with_staff_atomic(repeat('c',64),'reschedule',r.updated_at,t,st);raise exception 'customer move bypassed Google busy';exception when others then if sqlerrm<>'time_slot_unavailable' then raise;end if;end;
 update store_calendar_busy_days set started_at=clock_timestamp()-interval '2 minutes' where store_id=s;
 begin perform create_reservation_atomic(s,sv,st,t+interval '2 hours','別予約','09000000262','phone',null);raise exception 'stale snapshot allowed';exception when others then if sqlerrm<>'calendar_busy_unavailable' then raise;end if;end;
 update reservations set status='cancelled' where id=r.id;
 perform set_store_calendar_busy(s,false);
 r:=create_reservation_atomic(s,sv,st,t,'停止解除','09000000263','phone',null);
 if has_function_privilege('anon','set_store_calendar_busy(uuid,boolean)','execute') or has_table_privilege('authenticated','store_calendar_busy_days','select') then raise exception 'public busy data access';end if;
 perform disconnect_store_calendar(s);if exists(select 1 from store_calendar_busy_days where store_id=s) then raise exception 'disconnected cache retained';end if;
end $$;
rollback;
