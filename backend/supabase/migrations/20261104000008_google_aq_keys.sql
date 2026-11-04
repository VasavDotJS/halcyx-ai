-- Google now issues "AQ." API keys alongside "AIza…" ones; reject both in backend metadata.
create or replace function public.looks_secret(v text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(v, '') ~ '(AIza[0-9A-Za-z_-]{35}|AQ\.[A-Za-z0-9._-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
$$;
