-- Limits on what the AI may cost (lib/ai/spend-limits.ts, lib/ai/model-client.ts).
--
-- Before a model call the app asks begin_ai_request for a slot. It is refused while the user's
-- last AI request is still running, when the user's AI calls cost their limit over the past 24
-- hours, or when all users' together cost the all-users limit. Cost is ai_traces.cost_usd, so
-- there is no second count to drift from it. A slot is let go (end_ai_request) only after its
-- request's trace is saved, and it is taken before the cost is summed, so each request counts
-- the cost of every one before it: a user can pass their limit by one request at most. A slot
-- whose request died without letting go frees itself after p_slot_seconds.
--
-- Applied by hand in the SQL Editor, before the app code (which lets every request through if
-- the function is missing). It is one DO block, so it applies all or nothing, and it is safe to
-- run twice. "Success. No rows returned" means it worked; a wrong state ends in an exception
-- that says what is wrong.

do $$
begin
    -- A user's AI request that is running: one at a time
    create table if not exists public.ai_request_slots (
        user_id uuid primary key references auth.users (id) on delete cascade,
        request_id uuid not null,
        started_at timestamptz not null default now()
    );
    alter table public.ai_request_slots enable row level security;
    revoke all on public.ai_request_slots from anon, authenticated;

    -- Security invoker: the service role, which reads ai_traces, is the only caller
    execute $fn$
        create or replace function public.begin_ai_request(
            p_user_id uuid,
            p_request_id uuid,
            p_features text[],
            p_user_usd numeric,
            p_all_usd numeric,
            p_slot_seconds integer
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

    execute $fn$
        create or replace function public.end_ai_request(p_user_id uuid, p_request_id uuid)
        returns void
        language sql
        security invoker
        set search_path = ''
        as $body$
            delete from public.ai_request_slots where user_id = p_user_id and request_id = p_request_id;
        $body$
    $fn$;

    -- The app server only, with the service role
    revoke all on function public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer) from public, anon, authenticated;
    revoke all on function public.end_ai_request(uuid, uuid) from public, anon, authenticated;
    grant execute on function public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer) to service_role;
    grant execute on function public.end_ai_request(uuid, uuid) to service_role;

    -- ---------- Checks ----------
    if not (select relrowsecurity from pg_class where oid = 'public.ai_request_slots'::regclass) then
        raise exception 'row level security is off on ai_request_slots';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_request_slots') then
        raise exception 'ai_request_slots has a policy; only the service role may read or write it';
    end if;
    if has_table_privilege('authenticated', 'public.ai_request_slots', 'select, insert, update, delete')
        or has_table_privilege('anon', 'public.ai_request_slots', 'select, insert, update, delete') then
        raise exception 'a signed-in or anonymous user can still use ai_request_slots';
    end if;
    if has_function_privilege('authenticated', 'public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer)', 'execute')
        or has_function_privilege('anon', 'public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer)', 'execute')
        or has_function_privilege('authenticated', 'public.end_ai_request(uuid, uuid)', 'execute')
        or has_function_privilege('anon', 'public.end_ai_request(uuid, uuid)', 'execute') then
        raise exception 'a signed-in or anonymous user can still call begin_ai_request or end_ai_request';
    end if;
    if not has_function_privilege('service_role', 'public.begin_ai_request(uuid, uuid, text[], numeric, numeric, integer)', 'execute') then
        raise exception 'the service role cannot call begin_ai_request';
    end if;
end $$;
