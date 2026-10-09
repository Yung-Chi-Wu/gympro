-- AI traces: one row per user-facing AI call (Ronnie, Coach G, the weekly report) with what the
-- model was given and what came back (tool calls and results included), tokens, cost, time and
-- any error. Written by the app server and the Lambdas with the service role (lib/ai/trace.ts).
-- No policy for users, so they can neither read nor write traces. Kept 90 days: the hourly
-- scheduler Lambda deletes older rows; a deleted account takes its traces with it.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice.

do $$
begin
    create table if not exists public.ai_traces (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        user_id uuid not null references auth.users (id) on delete cascade,
        feature text not null check (feature in ('ronnie', 'coach_chat', 'coach_routine', 'report')),
        -- The model asked for, and the one that answered
        model text not null,
        served_model text,
        status text not null check (status in ('ok', 'error')),
        error text,
        latency_ms integer not null check (latency_ms >= 0),
        -- Summed over the request's API calls (a Ronnie turn makes one per tool round)
        api_calls integer not null default 0,
        input_tokens integer not null default 0,
        output_tokens integer not null default 0,
        cache_write_tokens integer not null default 0,
        cache_read_tokens integer not null default 0,
        -- US$; null for a model the app has no price for
        cost_usd numeric(12, 8),
        -- The git commit of the app code that ran
        app_version text,
        input jsonb not null,
        output jsonb
    );

    create index if not exists ai_traces_created_idx on public.ai_traces (created_at desc);
    create index if not exists ai_traces_user_created_idx on public.ai_traces (user_id, created_at desc);
    create index if not exists ai_traces_feature_created_idx on public.ai_traces (feature, created_at desc);

    alter table public.ai_traces enable row level security;
    revoke all on public.ai_traces from anon, authenticated;

    -- Cost and reliability per UTC day, feature and model, for the SQL Editor and the alarms
    create or replace view public.ai_usage_daily with (security_invoker = true) as
    select
        (created_at at time zone 'utc')::date as day,
        feature,
        coalesce(served_model, model) as model,
        count(*) as calls,
        count(*) filter (where status = 'error') as errors,
        count(distinct user_id) as users,
        sum(input_tokens) as input_tokens,
        sum(output_tokens) as output_tokens,
        sum(cache_read_tokens) as cache_read_tokens,
        sum(cache_write_tokens) as cache_write_tokens,
        round(sum(cost_usd), 4) as cost_usd,
        percentile_cont(0.5) within group (order by latency_ms) as median_latency_ms
    from public.ai_traces
    group by 1, 2, 3;
    revoke all on public.ai_usage_daily from anon, authenticated;

    if not (select relrowsecurity from pg_class where oid = 'public.ai_traces'::regclass) then
        raise exception 'row level security is off on ai_traces';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_traces') then
        raise exception 'ai_traces has a policy; only the service role may read or write traces';
    end if;
    if has_table_privilege('authenticated', 'public.ai_traces', 'select')
        or has_table_privilege('anon', 'public.ai_traces', 'select')
        or has_table_privilege('authenticated', 'public.ai_usage_daily', 'select') then
        raise exception 'users can still select from ai_traces or ai_usage_daily';
    end if;
end
$$;
