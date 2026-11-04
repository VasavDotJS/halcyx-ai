-- Hourly trigger for the optional email digest. The Edge Function decides who is due
-- (daily/weekly preference) and sends metadata-only summaries.
-- Requires two Vault secrets (see README → "Email digest"):
--   project_url    e.g. https://<ref>.supabase.co
--   digest_secret  random string, also set as the DIGEST_SECRET function secret
-- Until both exist the job does nothing, so a fresh project doesn't log hourly failures.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'halcyx-email-digest',
  '17 * * * *',
  $$
  select net.http_post(
    url := s.url || '/functions/v1/email-digest',
    headers := jsonb_build_object('content-type', 'application/json', 'x-digest-secret', s.secret),
    body := '{}'::jsonb
  )
  from (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'digest_secret') as secret
  ) s
  where s.url is not null and s.secret is not null;
  $$
);
