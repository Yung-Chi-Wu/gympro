-- App errors: one row per failure the app server hit outside an AI call (a save that failed, a
-- conversation not stored, an uncaught error in a page or route), for the owner to look at. The
-- hourly scheduler Lambda counts the past hour's errors into the gympro-app-errors alarm, and
-- deletes rows older than 90 days. AI calls are not here: ai_traces has them, with their alarms.
--   level    error: something broke, and it alarms; warning: kept for a look, no alarm (an
--            expired sign-in link is the user's, not a bug)
--   source   where it happened, e.g. save-routine or ronnie/actions
--   message  the error's own message, cut to 1000 characters; never the user's own text
--   context  a few short facts for finding it (a status, a route), never the user's own text
-- Written by the app server with the service role (lib/report-error.ts). No policy for users,
-- so they can neither read nor write it. A deleted account keeps its errors, without the user.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
begin
    create table if not exists public.app_errors (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        level text not null check (level in ('error', 'warning')),
        source text not null check (char_length(source) between 1 and 100),
        message text not null check (char_length(message) <= 1000),
        user_id uuid references auth.users (id) on delete set null,
        context jsonb,
        -- The git commit of the app code that ran
        app_version text
    );

    create index if not exists app_errors_created_idx on public.app_errors (created_at desc);

    alter table public.app_errors enable row level security;
    revoke all on public.app_errors from anon, authenticated;

    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_errors') then
        raise exception 'app_errors should have no policies: only the service role reads and writes it';
    end if;
    if not (select relrowsecurity from pg_class where oid = 'public.app_errors'::regclass) then
        raise exception 'app_errors does not have row level security on';
    end if;
    if has_table_privilege('anon', 'public.app_errors', 'select')
        or has_table_privilege('anon', 'public.app_errors', 'insert')
        or has_table_privilege('authenticated', 'public.app_errors', 'select')
        or has_table_privilege('authenticated', 'public.app_errors', 'insert')
        or has_table_privilege('authenticated', 'public.app_errors', 'update')
        or has_table_privilege('authenticated', 'public.app_errors', 'delete') then
        raise exception 'anon or signed-in users can still reach app_errors';
    end if;
    if not has_table_privilege('service_role', 'public.app_errors', 'insert')
        or not has_table_privilege('service_role', 'public.app_errors', 'select')
        or not has_table_privilege('service_role', 'public.app_errors', 'delete') then
        raise exception 'the service role cannot write, count and clean up app_errors';
    end if;
end $$;
