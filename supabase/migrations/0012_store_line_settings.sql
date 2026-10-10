-- Per-store LINE settings. This does not activate messaging or account linking.
begin;
create table if not exists store_line_settings(
  store_id uuid primary key references stores(id),account_name text not null default '' check(length(account_name)<=100),
  friend_url text not null default '' check(length(friend_url)<=500),
  channel_id text unique,access_token_cipher text,channel_secret_cipher text,
  version uuid not null default gen_random_uuid(),updated_at timestamptz not null default clock_timestamp()
);
alter table store_line_settings enable row level security;
revoke all on store_line_settings from public,anon,authenticated,service_role;
grant select on store_line_settings to service_role;
create or replace function save_store_line_settings_atomic(
  p_store_id uuid,p_account_name text,p_friend_url text,p_channel_id text,p_expected_version uuid,
  p_access_token_cipher text,p_channel_secret_cipher text,p_clear_credentials boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_old store_line_settings;v_new store_line_settings;
begin
  perform 1 from stores where id=p_store_id for no key update;
  if not found then raise exception 'store_not_found'; end if;
  select * into v_old from store_line_settings where store_id=p_store_id;
  if v_old.version is distinct from p_expected_version then raise exception 'line_settings_changed'; end if;
  if p_account_name is null or length(p_account_name)>100 or p_friend_url is null or length(p_friend_url)>500
    or (nullif(p_channel_id,'') is not null and p_channel_id !~ '^[0-9]{5,30}$') then raise exception 'invalid_line_settings'; end if;
  if p_clear_credentials is null then raise exception 'invalid_line_settings'; end if;
  -- Changing the channel also removes credentials belonging to the previous channel.
  if p_clear_credentials or v_old.channel_id is distinct from nullif(p_channel_id,'') then
    v_old.access_token_cipher:=null;v_old.channel_secret_cipher:=null;
  end if;
  insert into store_line_settings(store_id,account_name,friend_url,channel_id,access_token_cipher,channel_secret_cipher)
    values(p_store_id,p_account_name,p_friend_url,nullif(p_channel_id,''),
      coalesce(p_access_token_cipher,v_old.access_token_cipher),coalesce(p_channel_secret_cipher,v_old.channel_secret_cipher))
  on conflict(store_id) do update set account_name=excluded.account_name,friend_url=excluded.friend_url,channel_id=excluded.channel_id,
    access_token_cipher=excluded.access_token_cipher,channel_secret_cipher=excluded.channel_secret_cipher,version=gen_random_uuid(),updated_at=clock_timestamp()
  returning * into v_new;
  return jsonb_build_object('accountName',v_new.account_name,'friendUrl',v_new.friend_url,'channelId',coalesce(v_new.channel_id,''),
    'hasAccessToken',v_new.access_token_cipher is not null,'hasChannelSecret',v_new.channel_secret_cipher is not null,
    'version',v_new.version,'updatedAt',v_new.updated_at);
end;$$;
revoke all on function save_store_line_settings_atomic(uuid,text,text,text,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function save_store_line_settings_atomic(uuid,text,text,text,uuid,text,text,boolean) to service_role;
commit;
