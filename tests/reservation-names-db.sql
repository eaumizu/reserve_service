begin;
do $$
declare s uuid:='11111111-1111-1111-1111-111111111111';sv uuid:='44444444-4444-4444-4444-444444444444';st uuid:='22222222-2222-2222-2222-222222222222';a reservations;b reservations;t timestamptz;hash text;
begin
 t:=((clock_timestamp() at time zone 'Asia/Tokyo')::date+5+time '13:00') at time zone 'Asia/Tokyo';hash:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 a:=create_customer_booking_atomic(s,sv,st,t,'最初のお名前','09000000991','phone',null,'test@example.com',hash,'cipher');
 b:=create_reservation_with_email_atomic(s,sv,st,t+interval '1 day','次のお名前','09000000991','phone',null,'test@example.com');
 if a.customer_id<>b.customer_id then raise exception 'customer history grouping lost';end if;
 if (select name from customers where id=a.customer_id)<>'最初のお名前' then raise exception 'ledger name overwritten';end if;
 if (select customer_name from reservations where id=a.id)<>'最初のお名前' or b.customer_name<>'次のお名前' then raise exception 'reservation name overwritten';end if;
 if read_customer_booking(hash)->>'customerName'<>'最初のお名前' then raise exception 'customer page uses ledger instead of snapshot';end if;
 update customers set name='台帳訂正' where id=a.customer_id;
 if (select customer_name from reservations where id=a.id)<>'最初のお名前' or (select customer_name from reservations where id=b.id)<>'次のお名前' then raise exception 'ledger edit changed reservation names';end if;
end $$;
rollback;
