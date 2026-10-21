begin;
do $$
declare s uuid:='11111111-1111-1111-1111-111111111111';r reservations;j jsonb;k jsonb;rev uuid;
begin
 perform issue_store_calendar_oauth(s,gen_random_uuid(),'state','calendar','cipher');
 if consume_store_calendar_oauth('state')->>'storeId'<>s::text or consume_store_calendar_oauth('state') is not null then raise exception 'reused OAuth state';end if;
 perform save_store_calendar_connection(s,gen_random_uuid(),'calendar','予約カレンダー','encrypted-refresh-token');
 select revision into rev from store_calendar_connections where store_id=s;
 r:=create_reservation_atomic(s,'44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',((clock_timestamp() at time zone 'Asia/Tokyo')::date+9+time '13:00') at time zone 'Asia/Tokyo','カレンダー予約','09000000777','phone',null);
 j:=claim_store_calendar_job(s,r.id);if j is null or j->>'customerName'<>'カレンダー予約' then raise exception 'calendar job missing';end if;
 if claim_store_calendar_job(s,r.id) is not null then raise exception 'duplicate calendar lease';end if;
 if claim_store_calendar_job('99999999-9999-9999-9999-999999999999',r.id) is not null then raise exception 'calendar tenant leak';end if;
 update reservations set start_at=start_at+interval '15 minutes',end_at=end_at+interval '15 minutes' where id=r.id;
 perform finish_store_calendar_job(s,r.id,(j->>'version')::uuid,(j->>'leaseId')::uuid,rev,true);
 if (select state from store_calendar_jobs where store_id=s and reservation_id=r.id)<>'pending' then raise exception 'stale calendar result overwrote newer version';end if;
 k:=claim_store_calendar_job(s,r.id);if k is null or k->>'version'=j->>'version' then raise exception 'new version missing';end if;
 perform finish_store_calendar_job(s,r.id,(k->>'version')::uuid,(k->>'leaseId')::uuid,rev,true);
 update reservations set status='cancelled' where id=r.id;
 j:=claim_store_calendar_job(s,r.id);if j->>'status'<>'cancelled' then raise exception 'calendar cancellation missing';end if;
 if store_calendar_dashboard(s)::text like '%encrypted-refresh-token%' then raise exception 'calendar credential leaked';end if;
 perform disconnect_store_calendar(s);if store_calendar_credentials(s) is not null or exists(select 1 from store_calendar_jobs where store_id=s) then raise exception 'calendar disconnect incomplete';end if;
 if has_function_privilege('anon','store_calendar_credentials(uuid)','execute') or has_table_privilege('authenticated','store_calendar_connections','select') then raise exception 'public calendar credentials';end if;
end $$;
rollback;
