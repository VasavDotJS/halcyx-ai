-- Hourly trigger for the optional email digest. The Edge Function decides who is due
-- (daily/weekly preference) and sends metadata-only summaries.
-- Requires two Vault secrets (see README → "Email digest"):
--   project_url    e.g. https://<ref>.supabase.co
--   digest_secret  random string, also set as the DIGEST_SECRET function secret
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'halcyx-email-digest',
  '17 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/email-digest',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-digest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'digest_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
