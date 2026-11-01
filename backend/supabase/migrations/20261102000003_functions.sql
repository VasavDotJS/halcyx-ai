-- Device revocation: marks the device revoked and deletes its auth session, which
-- invalidates its refresh tokens immediately (access tokens expire within the JWT TTL).
create or replace function public.revoke_device(p_device uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
begin
  select session_id into v_session
  from public.devices
  where id = p_device and user_id = (select auth.uid());

  if not found then
    raise exception 'device not found' using errcode = 'P0002';
  end if;

  update public.devices set revoked = true where id = p_device;

  if v_session is not null then
    delete from auth.sessions where id = v_session and user_id = (select auth.uid());
  end if;
end;
$$;

revoke all on function public.revoke_device(uuid) from public, anon;
grant execute on function public.revoke_device(uuid) to authenticated;
