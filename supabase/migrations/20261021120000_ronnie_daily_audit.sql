-- The daily review of Ronnie's conversations (lambda/ai-worker/src/audit.ts).
--
-- Once a day a Lambda reads each user's Ronnie conversation from a day that has ended in their
-- time zone and asks a model whether any reply got something wrong. A reply it finds is flagged
-- (ai_trace_flags, kind audit), which keeps its trace a year, and the owner gets one email. The
-- review's own model call is traced like the others, as feature audit, so its cost shows in
-- ai_usage_daily and reaches the AI cost alarm. audited_at marks a Ronnie trace the review has
-- read, so a run that stops partway, fails or runs twice reads each turn once.
--
-- Applied by hand in the SQL Editor, before the Lambda. It is one DO block, so it applies all or
-- nothing, and it is safe to run twice. "Success. No rows returned" means it worked; a wrong
-- state ends in an exception that says what is wrong.

do $$
begin
    -- The check from 20261010120000, with audit added
    alter table public.ai_traces drop constraint if exists ai_traces_feature_check;
    alter table public.ai_traces add constraint ai_traces_feature_check
        check (feature in ('ronnie', 'coach_chat', 'coach_routine', 'report', 'audit'));

    alter table public.ai_traces add column if not exists audited_at timestamptz;
    -- What the review reads next: Ronnie turns it hasn't read
    create index if not exists ai_traces_unaudited_idx on public.ai_traces (created_at)
        where feature = 'ronnie' and audited_at is null;

    -- ---------- Checks ----------
    if exists (
        select 1 from pg_constraint
        where conrelid = 'public.ai_traces'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%feature%' and pg_get_constraintdef(oid) not like '%audit%'
    ) then
        raise exception 'a check on ai_traces.feature still leaves out audit';
    end if;
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'ai_traces' and column_name = 'audited_at'
    ) then
        raise exception 'ai_traces.audited_at is missing';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_traces') then
        raise exception 'ai_traces has a policy; only the service role may read or write traces';
    end if;
end $$;
