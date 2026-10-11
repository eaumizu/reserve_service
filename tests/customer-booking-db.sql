
do $test$
declare store uuid:='11111111-1111-1111-1111-111111111111';
  staff_id uuid:='22222222-2222-2222-2222-222222222222';
  service uuid:='44444444-4444-4444-4444-444444444444';
  start_time timestamptz:=((clock_timestamp() at time zone 'Asia/Tokyo')::date+1+time '09:00') at time zone 'Asia/Tokyo';
  original reservations; occupied reservations; past reservations; result jsonb; version timestamptz; line_version uuid;
begin
  update services set buffer_after=15 where id=service;
  delete from business_hours where store_id=store;
  insert into business_hours(store_id,weekday,start_time,end_time) select store,d,'09:00','18:00' from generate_series(0,6)d;
  original:=create_customer_booking_atomic(store,service,staff_id,start_time,'確認用','09000000000','web',null,'test@example.com',repeat('a',64));
  result:=read_customer_booking(repeat('a',64));
  if (result->>'id')::uuid<>original.id or not (result->>'canManage')::boolean or result?'note' or result?'customer_email' then raise exception 'invalid public projection'; end if;
  if original.customer_email<>'test@example.com' then raise exception 'email lost'; end if;
  occupied:=create_reservation_atomic(store,service,staff_id,start_time+interval '2 hours','別予約','09000000001','phone',null);
  begin
    perform manage_customer_booking_atomic(repeat('a',64),'reschedule',original.updated_at,start_time+interval '1 hour');
    raise exception 'expected occupied slot failure';
  exception when others then if sqlerrm<>'time_slot_unavailable' then raise; end if; end;
  if (select start_at from reservations where id=original.id)<>start_time then raise exception 'failed move modified original'; end if;
  begin
    perform manage_customer_booking_atomic(repeat('a',64),'reschedule',original.updated_at,start_time+interval '40 days');
    raise exception 'expected window failure';
  exception when others then if sqlerrm<>'booking_window_closed' then raise; end if; end;
  if (select start_at from reservations where id=original.id)<>start_time then raise exception 'window rejection did not roll back move'; end if;
  result:=manage_customer_booking_atomic(repeat('a',64),'reschedule',original.updated_at,start_time+interval '3 hours 15 minutes');
  if (result->>'startAt')::timestamptz<>start_time+interval '3 hours 15 minutes' then raise exception 'quarter hour move failed'; end if;
  version:=(result->>'updatedAt')::timestamptz;
  begin
    perform manage_customer_booking_atomic(repeat('a',64),'cancel',original.updated_at,null);
    raise exception 'expected stale version failure';
  exception when others then if sqlerrm<>'booking_changed' then raise; end if; end;
  perform issue_customer_line_notification_code(repeat('a',64),repeat('9',64),'encrypted-test-token');
  if consume_customer_line_notification_code('99999999-9999-9999-9999-999999999999',repeat('9',64),'U'||repeat('a',32)) is not null then raise exception 'wrong store notification'; end if;
  result:=consume_customer_line_notification_code(store,repeat('9',64),'U'||repeat('a',32));
  if result->>'tokenCipher'<>'encrypted-test-token' or result->>'userId'<>'U'||repeat('a',32) then raise exception 'notification projection wrong'; end if;
  if consume_customer_line_notification_code(store,repeat('9',64),'U'||repeat('b',32)) is not null then raise exception 'wrong recipient retry'; end if;
  if consume_customer_line_notification_code(store,repeat('9',64),'U'||repeat('a',32))->>'retryKey'<>result->>'retryKey' then raise exception 'retry key changed'; end if;
  perform mark_line_booking_notification_sent(store,repeat('9',64),(result->>'retryKey')::uuid);
  if consume_customer_line_notification_code(store,repeat('9',64),'U'||repeat('a',32)) is not null then raise exception 'sent job returned'; end if;
  if exists(select 1 from line_booking_notifications where code_hash=repeat('9',64) and booking_token_cipher is not null) then raise exception 'sent cipher retained'; end if;
  delete from customer_line_links where reservation_id=original.id;
  perform issue_customer_line_code(repeat('a',64),repeat('e',64));
  perform issue_customer_line_code(repeat('a',64),repeat('f',64));
  if consume_customer_line_code(store,repeat('e',64),'U'||repeat('a',32)) then raise exception 'old code accepted'; end if;
  if consume_customer_line_code('99999999-9999-9999-9999-999999999999',repeat('f',64),'U'||repeat('a',32)) then raise exception 'cross store code accepted'; end if;
  update customer_line_link_codes set expires_at=clock_timestamp()-interval '1 second';
  if consume_customer_line_code(store,repeat('f',64),'U'||repeat('a',32)) then raise exception 'expired code accepted'; end if;
  perform issue_customer_line_code(repeat('a',64),repeat('f',64));
  if not consume_customer_line_code(store,repeat('f',64),'U'||repeat('a',32)) then raise exception 'valid code rejected'; end if;
  if consume_customer_line_code(store,repeat('f',64),'U'||repeat('b',32)) then raise exception 'used code accepted'; end if;
  if not exists(select 1 from customer_line_links where reservation_id=original.id and line_user_id='U'||repeat('a',32)) then raise exception 'link missing'; end if;
  if has_function_privilege('anon','consume_customer_line_code(uuid,text,text)','execute') or has_table_privilege('authenticated','customer_line_links','select') then raise exception 'LINE privileges leaked'; end if;
  result:=manage_customer_booking_atomic(repeat('a',64),'cancel',version,null);
  if result->>'status'<>'cancelled' or (result->>'canManage')::boolean then raise exception 'cancellation did not change state'; end if;
  perform issue_customer_booking_access(store,original.id,repeat('b',64));
  begin perform read_customer_booking(repeat('a',64));raise exception 'expected old token failure';
  exception when others then if sqlerrm<>'booking_not_found' then raise; end if; end;
  if read_customer_booking(repeat('b',64))->>'status'<>'cancelled' then raise exception 'reissue failed'; end if;
  begin perform issue_customer_booking_access('99999999-9999-9999-9999-999999999999',original.id,repeat('c',64));raise exception 'expected cross-store failure';
  exception when others then if sqlerrm<>'booking_not_found' then raise; end if; end;
  past:=create_customer_booking_atomic(store,service,staff_id,start_time-interval '3 days','過去予約','09000000002','phone',null,null,repeat('d',64));
  begin perform manage_customer_booking_atomic(repeat('d',64),'cancel',past.updated_at,null);raise exception 'expected started booking failure';
  exception when others then if sqlerrm<>'booking_closed' then raise; end if; end;
  update customer_booking_access set expires_at=clock_timestamp()-interval '1 second' where token_hash=repeat('d',64);
  begin perform read_customer_booking(repeat('d',64));raise exception 'expected expiry failure';
  exception when others then if sqlerrm<>'booking_not_found' then raise; end if; end;

  result:=save_store_line_settings_atomic(store,'店舗','https://lin.ee/test','1234567890',null,'cipher-a','cipher-b',false);
  line_version:=(result->>'version')::uuid;
  if not (result->>'hasAccessToken')::boolean or result?'access_token_cipher' then raise exception 'LINE response exposed secrets'; end if;
  begin perform save_store_line_settings_atomic(store,'古い編集','','1234567890',null,null,null,false);raise exception 'expected settings version failure';
  exception when others then if sqlerrm<>'line_settings_changed' then raise; end if; end;
  result:=save_store_line_settings_atomic(store,'店舗','','2234567890',line_version,null,null,false);
  if (result->>'hasAccessToken')::boolean or (result->>'hasChannelSecret')::boolean then raise exception 'old channel credentials retained'; end if;
  if has_function_privilege('anon','read_customer_booking(text)','execute')
    or has_function_privilege('authenticated','manage_customer_booking_atomic(text,text,timestamptz,timestamptz)','execute')
    or has_table_privilege('anon','customer_booking_access','select')
    or has_table_privilege('authenticated','store_line_settings','select') then raise exception 'public privilege leak'; end if;
end; $test$;
