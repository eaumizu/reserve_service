begin;
do $$
declare
  a uuid := 'b0000000-0000-0000-0000-000000000001';
  b uuid := 'b0000000-0000-0000-0000-000000000002';
begin
  insert into stores(id,name) values(a,'Mode test A'),(b,'Mode test B');
  if has_table_privilege('anon','store_booking_preferences','select')
    or has_table_privilege('authenticated','store_booking_preferences','select')
    or has_function_privilege('anon','save_booking_page_mode(uuid,text)','execute')
    or has_function_privilege('authenticated','save_booking_page_mode(uuid,text)','execute')
    or has_table_privilege('service_role','store_booking_preferences','update') then
    raise exception 'unexpected preference privileges';
  end if;
  if not has_table_privilege('service_role','store_booking_preferences','select')
    or not has_function_privilege('service_role','save_booking_page_mode(uuid,text)','execute') then
    raise exception 'missing service privileges';
  end if;
  perform save_booking_page_mode(a,'date');
  perform save_booking_page_mode(b,'menu');
  if (select booking_mode from store_booking_preferences where store_id=a) <> 'date' then raise exception 'date preference not saved'; end if;
  perform save_booking_page_mode(a,'menu');
  if (select count(*) from store_booking_preferences where store_id=a) <> 1
    or (select booking_mode from store_booking_preferences where store_id=a) <> 'menu'
    or (select booking_mode from store_booking_preferences where store_id=b) <> 'menu' then raise exception 'preference scope/upsert mismatch'; end if;
  begin
    perform save_booking_page_mode(a,'both'); raise exception 'accepted invalid mode';
  exception when raise_exception then if sqlerrm <> 'invalid_settings' then raise; end if; end;
  begin
    perform save_booking_page_mode(a,null); raise exception 'accepted null mode';
  exception when raise_exception then if sqlerrm <> 'invalid_settings' then raise; end if; end;
  begin
    perform save_booking_page_mode('b0000000-0000-0000-0000-000000000003','date'); raise exception 'accepted unknown store';
  exception when raise_exception then if sqlerrm <> 'settings_not_found' then raise; end if; end;
  if (select name from stores where id=a) <> 'Mode test A' or (select advance_days from stores where id=a) <> 30 then raise exception 'changed unrelated settings'; end if;
end; $$;
rollback;
