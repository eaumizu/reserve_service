begin;
do $$
declare s uuid:='11111111-1111-1111-1111-111111111111';sv uuid;st uuid;r reservations;d jsonb;
begin
 sv:=(save_store_settings_atomic(s,'service','{"name":"削除試験","duration_minutes":30,"buffer_before":0,"buffer_after":15,"price":1000,"active":true,"online_bookable":true}'::jsonb)->>'id')::uuid;
 st:=(save_store_settings_atomic(s,'staff',jsonb_build_object('name','施術者','active',true,'serviceIds',jsonb_build_array(sv)))->>'id')::uuid;
 r:=create_reservation_atomic(s,sv,st,((clock_timestamp() at time zone 'Asia/Tokyo')::date+3+time '12:00') at time zone 'Asia/Tokyo','削除試験','09000000101','phone',null);
 begin perform archive_booking_setting(s,'service_delete',sv);raise exception 'upcoming menu removed';exception when others then if sqlerrm<>'setting_has_upcoming_reservations' then raise;end if;end;
 begin perform archive_booking_setting(s,'staff_delete',st);raise exception 'upcoming staff removed';exception when others then if sqlerrm<>'setting_has_upcoming_reservations' then raise;end if;end;
 update reservations set status='cancelled' where id=r.id;
 begin perform archive_booking_setting('99999999-9999-9999-9999-999999999999','staff_delete',st);raise exception 'cross store delete';exception when others then if sqlerrm='cross store delete' then raise;end if;end;
 perform archive_booking_setting(s,'service_delete',sv);perform archive_booking_setting(s,'staff_delete',st);
 if not exists(select 1 from reservations where id=r.id) or not exists(select 1 from services where id=sv and not active and archived_at is not null) or not exists(select 1 from staff where id=st and not active and archived_at is not null) then raise exception 'history or archived setting missing';end if;
 begin update staff set active=true where id=st;raise exception 'archive revived';exception when others then if sqlerrm<>'settings_not_found' then raise;end if;end;
 if has_function_privilege('anon','archive_booking_setting(uuid,text,uuid)','execute') then raise exception 'public archive access';end if;
-- No visible staff: one private unnamed capacity, linked to the sole menu.
 insert into stores(id,name) values('88888888-8888-8888-8888-888888888888','一人店舗');
 s:='88888888-8888-8888-8888-888888888888';
 insert into business_hours(store_id,weekday,start_time,end_time) select s,days.weekday,'09:00','18:00' from generate_series(0,6) as days(weekday);
 sv:=(save_store_settings_atomic(s,'service','{"name":"唯一メニュー","duration_minutes":30,"buffer_before":0,"buffer_after":15,"price":1000,"active":true,"online_bookable":true}'::jsonb)->>'id')::uuid;
 select id into st from staff where store_id=s and is_unassigned and active and name='';
 if st is null or not exists(select 1 from staff_services where staff_id=st and service_id=sv) then raise exception 'no anonymous capacity';end if;
 r:=create_reservation_atomic(s,sv,st,((clock_timestamp() at time zone 'Asia/Tokyo')::date+3+time '12:00') at time zone 'Asia/Tokyo','名前なし予約','09000000102','phone',null);
 begin perform create_reservation_atomic(s,sv,st,r.start_at,'重複','09000000103','phone',null);raise exception 'double booking allowed';exception when others then if sqlerrm='double booking allowed' then raise;end if;end;
 d:=save_store_settings_atomic(s,'staff',jsonb_build_object('name','','active',true,'serviceIds',jsonb_build_array(sv)));
 if (d->>'id')::uuid<>st or not exists(select 1 from reservations where id=r.id and staff_id=st) then raise exception 'capacity lost on first staff registration';end if;
end $$;
rollback;
