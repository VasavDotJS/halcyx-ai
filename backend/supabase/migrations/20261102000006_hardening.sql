-- Security advisor follow-up: handle_new_user only runs as the auth.users trigger;
-- it must not be callable over the REST API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
