-- Row Level Security on every table. Users only ever see and change their own rows.

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.devices enable row level security;
alter table public.task_log enable row level security;
alter table public.model_config enable row level security;
alter table public.digest_log enable row level security;

-- profiles
create policy "profiles: read own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- user_settings
create policy "settings: read own" on public.user_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "settings: insert own" on public.user_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "settings: update own" on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- devices: clients may register/refresh their own devices but never un-revoke one.
create policy "devices: read own" on public.devices for select to authenticated using ((select auth.uid()) = user_id);
create policy "devices: insert own" on public.devices for insert to authenticated
  with check ((select auth.uid()) = user_id and revoked = false);
create policy "devices: update own" on public.devices for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke update on public.devices from authenticated;
grant update (user_id, device_id, name, platform, push_token, app_version, session_id, last_seen_at) on public.devices to authenticated;

-- task_log (metadata only)
create policy "task_log: read own" on public.task_log for select to authenticated using ((select auth.uid()) = user_id);
create policy "task_log: insert own" on public.task_log for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "task_log: update own" on public.task_log for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- model_config: readable by the app, writable only with the service role.
create policy "model_config: read" on public.model_config for select to anon, authenticated using (true);

-- digest_log: service role only (no client policies).
