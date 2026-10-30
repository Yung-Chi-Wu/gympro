-- Push subscriptions, for the daily reminder at 21:00 in the user's time zone (lib/push.ts).
--
-- One row per device that turned the reminder on: the push service's endpoint and the keys that
-- encrypt for it. The reminder Lambda reads them with the service role and marks the local date it
-- reminded on, so an hour's run that repeats sends nothing twice. Signed-in users never read or
-- write the table: two functions save and delete their own device's row.
--   endpoint      the push service URL; only the services browsers use (Chrome and Android, Firefox,
--                 Safari and iOS, Edge on Windows), so a row can't make the Lambda post elsewhere
--   p256dh, auth  the subscription's keys, base64url
--   reminded_on   the user's local date of the last reminder sent to it
-- A device that subscribes under another account moves to that account. At most 10 devices a user:
-- saving an 11th drops the oldest.
--
-- Applied by hand in the SQL Editor, before the app that calls it. It is one DO block, so it
-- applies all or nothing, and it is safe to run twice. "Success. No rows returned" means it
-- worked; a wrong state ends in an exception that says what is wrong.

do $$
begin
    create table if not exists public.push_subscriptions (
        endpoint text primary key,
        user_id uuid not null references auth.users (id) on delete cascade,
        p256dh text not null,
        auth text not null,
        created_at timestamptz not null default now(),
        reminded_on date
    );
    create index if not exists push_subscriptions_user_id on public.push_subscriptions (user_id);

    -- The same services as lib/push.ts isPushEndpoint
    alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_service;
    alter table public.push_subscriptions add constraint push_subscriptions_endpoint_service check (
        char_length(endpoint) <= 1024
        and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[!-~]+$'
    );
    alter table public.push_subscriptions drop constraint if exists push_subscriptions_keys;
    alter table public.push_subscriptions add constraint push_subscriptions_keys check (
        p256dh ~ '^[A-Za-z0-9_-]{16,128}={0,2}$' and auth ~ '^[A-Za-z0-9_-]{16,64}={0,2}$'
    );

    alter table public.push_subscriptions enable row level security;
    revoke all on public.push_subscriptions from anon, authenticated;

    -- ---------- This device's row, for the signed-in user ----------
    execute $fn$
        create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
        returns void
        language plpgsql
        security definer
        set search_path = ''
        as $body$
        begin
            if auth.uid() is null then
                raise exception 'not signed in';
            end if;
            insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
            values (p_endpoint, auth.uid(), p_p256dh, p_auth)
            on conflict (endpoint) do update set
                user_id = excluded.user_id,
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                -- A device that moves to another account is that account's to remind today
                reminded_on = case when public.push_subscriptions.user_id = excluded.user_id then public.push_subscriptions.reminded_on end;
            delete from public.push_subscriptions
            where user_id = auth.uid() and endpoint in (
                select endpoint from public.push_subscriptions
                where user_id = auth.uid()
                order by created_at desc
                offset 10
            );
        end
        $body$
    $fn$;

    execute $fn$
        create or replace function public.delete_push_subscription(p_endpoint text)
        returns void
        language sql
        security definer
        set search_path = ''
        as $body$
            delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
        $body$
    $fn$;

    revoke all on function public.save_push_subscription(text, text, text) from public, anon;
    revoke all on function public.delete_push_subscription(text) from public, anon;
    grant execute on function public.save_push_subscription(text, text, text) to authenticated;
    grant execute on function public.delete_push_subscription(text) to authenticated;

    -- ---------- Checks ----------
    if not (select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass) then
        raise exception 'row level security is off on push_subscriptions';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions') then
        raise exception 'push_subscriptions should have no policies: signed-in users reach it only through its functions';
    end if;
    if has_table_privilege('authenticated', 'public.push_subscriptions', 'select')
        or has_table_privilege('authenticated', 'public.push_subscriptions', 'insert')
        or has_table_privilege('anon', 'public.push_subscriptions', 'select') then
        raise exception 'a signed-in or anonymous user can still read or write push_subscriptions';
    end if;
    if (select count(*) from pg_constraint where conrelid = 'public.push_subscriptions'::regclass
            and conname in ('push_subscriptions_endpoint_service', 'push_subscriptions_keys')) <> 2 then
        raise exception 'a push_subscriptions check is missing';
    end if;
    if (select count(*) from pg_proc
            where oid in ('public.save_push_subscription(text, text, text)'::regprocedure, 'public.delete_push_subscription(text)'::regprocedure)
              and prosecdef and proconfig @> array['search_path=""']) <> 2 then
        raise exception 'the push subscription functions must be security definer with an empty search_path';
    end if;
    if has_function_privilege('anon', 'public.save_push_subscription(text, text, text)', 'execute')
        or has_function_privilege('anon', 'public.delete_push_subscription(text)', 'execute') then
        raise exception 'anon can still call the push subscription functions';
    end if;
    if not has_function_privilege('authenticated', 'public.save_push_subscription(text, text, text)', 'execute')
        or not has_function_privilege('authenticated', 'public.delete_push_subscription(text)', 'execute') then
        raise exception 'signed-in users cannot call the push subscription functions';
    end if;
end $$;
