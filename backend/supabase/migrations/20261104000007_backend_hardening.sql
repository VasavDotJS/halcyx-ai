-- Security audit follow-ups (H-1, L-9, L-11, M-11).

-- ── Rate limiting for Edge Functions (fixed window per key) ─────────────────────────────
create table public.rate_limits (
  key text primary key check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null
);
alter table public.rate_limits enable row level security; -- service role only

create or replace function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ── Audit log for credential-handling functions (metadata only: who, which, outcome) ────
create table public.function_audit (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  fn text not null check (fn ~ '^[a-z-]{1,40}$'),
  status integer not null check (status between 100 and 599),
  at timestamptz not null default now()
);
create index function_audit_at on public.function_audit (at);
create index function_audit_user on public.function_audit (user_id, at desc);
alter table public.function_audit enable row level security; -- service role only

create or replace function public.prune_backend_logs()
returns void
language sql
security definer
set search_path = ''
as $$
  with a as (delete from public.function_audit where at < now() - interval '30 days' returning 1)
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;
revoke all on function public.prune_backend_logs() from public, anon, authenticated;
select cron.schedule('halcyx-prune-backend-logs', '23 3 * * *', 'select public.prune_backend_logs()');

-- ── Least-privilege RLS: users can delete their own rows ─────────────────────────────────
create policy "settings: delete own" on public.user_settings for delete to authenticated using ((select auth.uid()) = user_id);
create policy "task_log: delete own" on public.task_log for delete to authenticated using ((select auth.uid()) = user_id);
create policy "devices: delete own" on public.devices for delete to authenticated using ((select auth.uid()) = user_id);

-- ── Devices: register through one narrow function; no direct writes ──────────────────────
-- Clients could previously UPDATE user_id/session_id directly. Now the server sets user_id
-- from the JWT, session_id from the JWT's session claim, and a revoked device stays revoked.
revoke insert, update on public.devices from authenticated, anon;
alter policy "devices: insert own" on public.devices with check (false);
alter policy "devices: update own" on public.devices using (false) with check (false);

alter table public.devices add constraint devices_name_not_secret check (not public.looks_secret(name));

create or replace function public.register_device(
  p_device_id text,
  p_name text,
  p_platform text,
  p_push_token text,
  p_app_version text
)
returns boolean -- false when this device was revoked
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_session uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  v_revoked boolean;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select revoked into v_revoked from public.devices where user_id = v_user and device_id = p_device_id;
  if v_revoked then
    return false;
  end if;

  insert into public.devices (user_id, device_id, name, platform, push_token, app_version, session_id, last_seen_at)
  values (v_user, p_device_id, p_name, p_platform, p_push_token, p_app_version, v_session, now())
  on conflict (user_id, device_id) do update set
    name = excluded.name,
    platform = excluded.platform,
    push_token = excluded.push_token,
    app_version = excluded.app_version,
    session_id = excluded.session_id,
    last_seen_at = now()
  where public.devices.revoked = false;
  return true;
end;
$$;

revoke all on function public.register_device(text, text, text, text, text) from public, anon;
grant execute on function public.register_device(text, text, text, text, text) to authenticated;
