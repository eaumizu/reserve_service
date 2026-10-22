begin;
do $$
declare s uuid:='11111111-1111-1111-1111-111111111111';sv uuid:='44444444-4444-4444-4444-444444444444';st uuid:='22222222-2222-2222-2222-222222222222';a reservations;b reservations;c reservations;t timestamptz;rev uuid;
begin
 t:=((clock_timestamp() at time zone 'Asia/Tokyo')::date+8+time '10:00') at time zone 'Asia/Tokyo';
 insert into business_hours(store_id,weekday,start_time,end_time) select s,extract(dow from t at time zone 'Asia/Tokyo')::smallint,'09:00','18:00' where not exists(select 1 from business_hours where store_id=s and weekday=extract(dow from t at time zone 'Asia/Tokyo'));
 insert into store_email_settings(store_id,sender_name,sender_email,domain,domain_id,status) values(s,'店舗','booking@example.com','example.com','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','verified');
 perform save_store_booking_notification_settings(s,'owner@example.com',true);
 begin perform create_reservation_atomic(s,sv,st,t,'メール必須','09000000270','web',null);raise exception 'web email requirement bypassed';exception when others then if sqlerrm<>'email_required' then raise;end if;end;
 a:=create_reservation_with_email_atomic(s,sv,st,t,'山田 花子','','web',null,'test@example.com');
 if a.customer_email<>'test@example.com' or (select phone from customers where id=a.customer_id)<>'' then raise exception 'email-only booking lost contact';end if;
 if (select payload->>'customerEmail' from store_booking_notifications where reservation_id=a.id)<>'test@example.com' then raise exception 'store notification lost email';end if;
 b:=create_reservation_with_email_atomic(s,sv,st,t+interval '90 minutes','山田　花子',null,'web',null,'TEST@example.com');
 if a.customer_id<>b.customer_id then raise exception 'returning email customer split';end if;
 c:=create_reservation_with_email_atomic(s,sv,st,t+interval '180 minutes','山田 太郎','','web',null,'test@example.com');
 if c.customer_id=a.customer_id then raise exception 'family customers merged by email';end if;
 c:=create_reservation_with_email_atomic(s,sv,st,t+interval '270 minutes','山田 花子','09000000271','web',null,'test@example.com');
 if c.customer_id<>a.customer_id or (select phone from customers where id=a.customer_id)<>'09000000271' then raise exception 'adding optional phone split customer';end if;
 if (customer_ledger_search(s,'TEST@example.com',0)->'rows') is null or jsonb_array_length(customer_ledger_search(s,'test@example.com',0)->'rows')<>2 then raise exception 'email ledger search missing';end if;
 select profile_revision into rev from customers where id=a.customer_id;
 perform save_customer_ledger(s,a.customer_id,rev,'佐藤 花子','メモ',true);
 if resolve_booking_customer_contact(s,'佐藤花子','','test@example.com')<>a.customer_id or resolve_booking_customer_contact(s,'山田花子','','test@example.com')<>a.customer_id then raise exception 'email alias lost after name correction';end if;
 if a.customer_name<>'山田 花子' or (select customer_name from reservations where id=a.id)<>'山田 花子' then raise exception 'history name changed';end if;
 if customer_ledger_detail(s,a.customer_id,0)->'customer'->>'email'<>'test@example.com' then raise exception 'email contact missing from ledger';end if;
 if resolve_booking_customer_contact(s,'別のお客様','','other@example.com')=a.customer_id then raise exception 'empty phones grouped';end if;
 if has_function_privilege('authenticated','resolve_booking_customer_contact(uuid,text,text,text)','execute') then raise exception 'public identity resolver access';end if;
end $$;
rollback;
