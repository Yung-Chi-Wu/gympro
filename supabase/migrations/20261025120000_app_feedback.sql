-- Feedback: what a user sends the owner from Settings (lib/feedback.ts), one row each.
--   kind         bug, idea or other, as the user picked it
--   message      what they wrote, 1 to 2000 characters
--   language     the app's language when they sent it
--   user_agent   their browser, cut to 300 characters: an iPhone's home-screen app or a desktop browser
--   app_version  the git commit of the app code that took it
-- Written by the app server with the service role (app/api/feedback), which also holds a user to a
-- few a day. No policy for users, so they can neither read nor write it directly. It goes with the
-- user's account, since it is their own words.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
begin
    create table if not exists public.app_feedback (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        user_id uuid not null references auth.users (id) on delete cascade,
        kind text not null check (kind in ('bug', 'idea', 'other')),
        message text not null check (char_length(message) between 1 and 2000),
        language text check (language in ('en', 'zh-TW')),
        user_agent text check (char_length(user_agent) <= 300),
        app_version text check (char_length(app_version) <= 64)
    );

    create index if not exists app_feedback_created_idx on public.app_feedback (created_at desc);
    -- The route counts a user's day
    create index if not exists app_feedback_user_created_idx on public.app_feedback (user_id, created_at desc);

    alter table public.app_feedback enable row level security;
    revoke all on public.app_feedback from anon, authenticated;

    -- ---------- Checks ----------
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_feedback') then
        raise exception 'app_feedback should have no policies: only the service role reads and writes it';
    end if;
    if not (select relrowsecurity from pg_class where oid = 'public.app_feedback'::regclass) then
        raise exception 'app_feedback does not have row level security on';
    end if;
    if has_table_privilege('anon', 'public.app_feedback', 'select, insert, update, delete')
        or has_table_privilege('authenticated', 'public.app_feedback', 'select, insert, update, delete') then
        raise exception 'anon or signed-in users can still reach app_feedback';
    end if;
    if not has_table_privilege('service_role', 'public.app_feedback', 'insert')
        or not has_table_privilege('service_role', 'public.app_feedback', 'select') then
        raise exception 'the service role cannot write and count app_feedback';
    end if;
end $$;
