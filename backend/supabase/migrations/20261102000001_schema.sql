-- HALCYX backend schema. Metadata only: the backend never stores provider API keys,
-- source code, prompts or diffs. CHECK constraints enforce this at the database level as a
-- second line of defence behind the client-side allow-list (core/backend/metadata.ts).

create extension if not exists pgcrypto;

-- Rejects values that look like provider keys or GitHub tokens.
create or replace function public.looks_secret(v text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(v, '') ~ '(AIza[0-9A-Za-z_-]{35}|sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb
    check (octet_length(prefs::text) < 4096)
    check (not public.looks_secret(prefs::text)),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text not null check (char_length(name) between 1 and 80 and name !~ '[\r\n]'),
  platform text not null check (platform in ('ios', 'android', 'web')),
  push_token text check (push_token is null or push_token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'),
  app_version text not null check (app_version ~ '^[0-9A-Za-z.+-]{1,32}$'),
  session_id uuid,
  last_seen_at timestamptz not null default now(),
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create table public.task_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text not null check (task_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  repo text not null check (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' and char_length(repo) <= 140),
  branch text check (branch is null or (branch ~ '^[A-Za-z0-9._/-]+$' and char_length(branch) <= 255)),
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{40}$'),
  provider text not null check (provider in ('gemini', 'anthropic', 'openai')),
  model text not null check (model ~ '^[a-z0-9][a-z0-9.\-_]{0,79}$'),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 4) not null default 0 check (cost_usd >= 0),
  files_count integer not null default 0 check (files_count >= 0),
  status text not null check (status in ('running', 'completed', 'failed', 'cancelled', 'incomplete', 'pushed', 'expired', 'discarded')),
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, task_id),
  check (not public.looks_secret(coalesce(branch, '') || repo || model || task_id))
);

create index task_log_user_time on public.task_log (user_id, started_at desc);

create table public.model_config (
  version text primary key,
  config jsonb not null,
  created_at timestamptz not null default now()
);

create table public.digest_log (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_sent_at timestamptz not null
);

-- Profiles are created automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
