-- Limits that hold however many accounts someone makes, and however much one account writes.
--
-- AI spend (begin_ai_request, 20261024120000). The all-users limit was the only wall above the
-- per-user one, so two new accounts spending theirs switched AI off for every user for a day.
-- Now accounts younger than p_new_days share p_new_usd, and p_all_usd, raised by the app, is
-- the ceiling for everyone. An account's age is user_profiles.created_at, which a signed-in user
-- can no longer set or change (a trigger keeps the database's own time); no profile is new.
-- The new arguments have defaults, so the app from before this keeps working as it did.
--
-- Ronnie's conversation (append_ronnie_conversation_for, 20261014140000): a day's row takes at
-- most 1 MB. What is sent to the model has its own bound in the app (lib/ronnie/agent.ts).
--
-- Rows per user. The project is on Supabase's free plan, which turns read-only at 500 MB, and
-- nothing limited how many rows one account could write. Each table a user writes to and that
-- isn't already bounded by a key (the profile, log units, a routine's exercises, a cycle's days)
-- takes at most a number of rows per user, about ten years of heavy use, and per cycle for the
-- changed days. A statement that passes it fails whole with error 54000. Each count uses an index
-- on user_id, made here where none leads with it. database_size_bytes is for the hourly scheduler,
-- which sends the size to CloudWatch, where gympro-database-size alarms at 400 MB.
--
-- knowledge_notes: a signed-out visitor had SELECT, though its policy showed them no rows; now
-- nothing, like every other table.
--
-- Applied by hand in the SQL Editor, before the app that passes the new arguments. It is one DO
-- block, so it applies all or nothing, and it is safe to run twice. "Success. No rows returned"
-- means it worked; a wrong state ends in an exception that says what is wrong.

do $$
declare
    -- table, the column rows are counted by, the most rows for one
    v_caps constant text[][] := array[
        ['workouts', 'user_id', '5000'],
        ['workout_sets', 'user_id', '60000'],
        ['workout_planned_exercises', 'user_id', '30000'],
        ['body_metrics', 'user_id', '10000'],
        ['day_notes', 'user_id', '5000'],
        ['period_notes', 'user_id', '2000'],
        ['routines', 'user_id', '200'],
        ['training_cycles', 'user_id', '50'],
        ['ronnie_pending_actions', 'user_id', '2000'],
        ['cycle_date_changes', 'training_cycle_id', '2000']
    ];
    v_cap text[];
    v_has_index boolean;
begin
    -- ---------- An account's age is the database's ----------
    execute $fn$
        create or replace function public.user_profiles_keep_created_at()
        returns trigger
        language plpgsql
        security invoker
        set search_path = ''
        as $body$
        begin
            -- Only a signed-in user's own write: the SQL Editor and the service role may still set it
            if current_user = 'authenticated' then
                new.created_at := case when tg_op = 'INSERT' then now() else old.created_at end;
            end if;
            return new;
        end
        $body$
    $fn$;
    revoke all on function public.user_profiles_keep_created_at() from public, anon, authenticated;
    drop trigger if exists user_profiles_keep_created_at on public.user_profiles;
    create trigger user_profiles_keep_created_at before insert or update on public.user_profiles
        for each row execute function public.user_profiles_keep_created_at();

    -- ---------- AI spend: new accounts share a limit ----------
    drop function if exists public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer);
    execute $fn$
        create or replace function public.begin_ai_request(
            p_user_id uuid,
            p_request_id uuid,
            p_features text[],
            p_user_usd numeric,
            p_all_usd numeric,
            p_slot_seconds integer,
            p_new_usd numeric default null,
            p_new_days integer default 7
        )
        returns jsonb
        language plpgsql
        security invoker
        set search_path = ''
        as $body$
        declare
            taken integer;
            spent numeric;
            resets timestamptz;
        begin
            insert into public.ai_request_slots as s (user_id, request_id, started_at)
            values (p_user_id, p_request_id, now())
            on conflict (user_id) do update set request_id = excluded.request_id, started_at = excluded.started_at
                where s.started_at < now() - make_interval(secs => p_slot_seconds);
            get diagnostics taken = row_count;
            if taken = 0 then
                return jsonb_build_object('ok', false, 'reason', 'busy');
            end if;

            -- When over, it resets once enough of the 24 hours' cost is older than 24 hours
            select coalesce(sum(cost_usd), 0) into spent from public.ai_traces
            where user_id = p_user_id and feature = any (p_features) and created_at > now() - interval '24 hours';
            if spent >= p_user_usd then
                select min(created_at) + interval '24 hours' into resets from (
                    select created_at, spent - sum(coalesce(cost_usd, 0)) over (order by created_at, id) as left_after
                    from public.ai_traces
                    where user_id = p_user_id and feature = any (p_features) and created_at > now() - interval '24 hours'
                ) t where left_after < p_user_usd;
                delete from public.ai_request_slots where user_id = p_user_id and request_id = p_request_id;
                return jsonb_build_object('ok', false, 'reason', 'user', 'resets_at', resets);
            end if;

            -- A new account (no profile, or one made within p_new_days) shares p_new_usd with the other new ones
            if p_new_usd is not null and not exists (
                select 1 from public.user_profiles where user_id = p_user_id and created_at < now() - make_interval(days => p_new_days)
            ) then
                select coalesce(sum(t.cost_usd), 0) into spent from public.ai_traces t
                where t.feature = any (p_features) and t.created_at > now() - interval '24 hours'
                    and not exists (select 1 from public.user_profiles p where p.user_id = t.user_id and p.created_at < now() - make_interval(days => p_new_days));
                if spent >= p_new_usd then
                    select min(created_at) + interval '24 hours' into resets from (
                        select t.created_at, spent - sum(coalesce(t.cost_usd, 0)) over (order by t.created_at, t.id) as left_after
                        from public.ai_traces t
                        where t.feature = any (p_features) and t.created_at > now() - interval '24 hours'
                            and not exists (select 1 from public.user_profiles p where p.user_id = t.user_id and p.created_at < now() - make_interval(days => p_new_days))
                    ) t where left_after < p_new_usd;
                    delete from public.ai_request_slots where user_id = p_user_id and request_id = p_request_id;
                    return jsonb_build_object('ok', false, 'reason', 'all', 'resets_at', resets);
                end if;
            end if;

            select coalesce(sum(cost_usd), 0) into spent from public.ai_traces
            where feature = any (p_features) and created_at > now() - interval '24 hours';
            if spent >= p_all_usd then
                select min(created_at) + interval '24 hours' into resets from (
                    select created_at, spent - sum(coalesce(cost_usd, 0)) over (order by created_at, id) as left_after
                    from public.ai_traces
                    where feature = any (p_features) and created_at > now() - interval '24 hours'
                ) t where left_after < p_all_usd;
                delete from public.ai_request_slots where user_id = p_user_id and request_id = p_request_id;
                return jsonb_build_object('ok', false, 'reason', 'all', 'resets_at', resets);
            end if;

            return jsonb_build_object('ok', true);
        end
        $body$
    $fn$;
    revoke all on function public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer, numeric, integer) from public, anon, authenticated;
    grant execute on function public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer, numeric, integer) to service_role;

    -- ---------- Ronnie's conversation: at most 1 MB a day ----------
    execute $fn$
        create or replace function public.append_ronnie_conversation_for(p_user_id uuid, p_date date, p_messages jsonb, p_display jsonb)
        returns void
        language plpgsql
        security invoker
        set search_path = ''
        as $body$
        begin
            if coalesce((select octet_length(c.messages::text) + octet_length(c.display::text) from public.ronnie_conversations c
                    where c.user_id = p_user_id and c.conversation_date = p_date), 0)
                + octet_length(p_messages::text) + octet_length(p_display::text) > 1000000 then
                raise exception 'the day''s conversation is full (1 MB)' using errcode = '54000';
            end if;
            insert into public.ronnie_conversations (user_id, conversation_date, messages, display)
            values (p_user_id, p_date, p_messages, p_display)
            on conflict (user_id, conversation_date) do update
                set messages = public.ronnie_conversations.messages || excluded.messages,
                    display = public.ronnie_conversations.display || excluded.display,
                    updated_at = now();
        end
        $body$
    $fn$;
    revoke all on function public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb) from public, anon, authenticated;
    grant execute on function public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb) to service_role;

    -- ---------- Rows per user ----------
    -- After each insert statement: the owners of the rows it added, each counted once. Security
    -- invoker: a signed-in user's count is of their own rows, which is all RLS shows them
    execute $fn$
        create or replace function public.limit_rows()
        returns trigger
        language plpgsql
        security invoker
        set search_path = ''
        as $body$
        declare
            over text;
        begin
            execute format(
                'select i.k::text from (select distinct %1$I as k from inserted) i
                 where (select count(*) from %2$I.%3$I t where t.%1$I = i.k) > %4$s limit 1',
                tg_argv[0], tg_table_schema, tg_table_name, tg_argv[1]::integer) into over;
            if over is not null then
                raise exception '% holds at most % rows for one %', tg_table_name, tg_argv[1], tg_argv[0] using errcode = '54000';
            end if;
            return null;
        end
        $body$
    $fn$;
    revoke all on function public.limit_rows() from public, anon, authenticated;

    foreach v_cap slice 1 in array v_caps loop
        -- An index whose first column is the one counted, else one is made
        select exists (
            select 1 from pg_index i
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
            where i.indrelid = format('public.%I', v_cap[1])::regclass and a.attname = v_cap[2]
        ) into v_has_index;
        if not v_has_index then
            execute format('create index %I on public.%I (%I)', v_cap[1] || '_' || v_cap[2] || '_idx', v_cap[1], v_cap[2]);
        end if;
        execute format('drop trigger if exists limit_rows on public.%I', v_cap[1]);
        execute format('create trigger limit_rows after insert on public.%I referencing new table as inserted '
            'for each statement execute function public.limit_rows(%L, %L)', v_cap[1], v_cap[2], v_cap[3]);
    end loop;

    -- ---------- The database's size, for the scheduler ----------
    execute $fn$
        create or replace function public.database_size_bytes()
        returns bigint
        language sql
        security invoker
        set search_path = ''
        as $body$
            select pg_database_size(current_database());
        $body$
    $fn$;
    revoke all on function public.database_size_bytes() from public, anon, authenticated;
    grant execute on function public.database_size_bytes() to service_role;

    revoke all on public.knowledge_notes from anon;

    -- ---------- Checks ----------
    if exists (select 1 from pg_proc where proname = 'begin_ai_request' and pronamespace = 'public'::regnamespace and pronargs <> 8) then
        raise exception 'an old begin_ai_request is still there beside the new one';
    end if;
    if has_function_privilege('authenticated', 'public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer, numeric, integer)', 'execute')
        or has_function_privilege('anon', 'public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer, numeric, integer)', 'execute')
        or has_function_privilege('authenticated', 'public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb)', 'execute')
        or has_function_privilege('authenticated', 'public.database_size_bytes()', 'execute')
        or has_function_privilege('anon', 'public.database_size_bytes()', 'execute') then
        raise exception 'a signed-in or anonymous user can call a service-role function';
    end if;
    if not has_function_privilege('service_role', 'public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer, numeric, integer)', 'execute')
        or not has_function_privilege('service_role', 'public.database_size_bytes()', 'execute') then
        raise exception 'the service role cannot call begin_ai_request or database_size_bytes';
    end if;
    if (select count(*) from pg_trigger where tgname = 'limit_rows' and not tgisinternal) <> array_length(v_caps, 1) then
        raise exception 'not every table has its row limit';
    end if;
    if has_table_privilege('anon', 'public.knowledge_notes', 'select') then
        raise exception 'a signed-out visitor can still read knowledge_notes';
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'user_profiles_keep_created_at' and tgrelid = 'public.user_profiles'::regclass) then
        raise exception 'user_profiles.created_at can still be set by a user';
    end if;
end $$;
