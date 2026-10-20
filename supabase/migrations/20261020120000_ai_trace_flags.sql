-- A Ronnie turn that may have gone wrong is flagged, and its trace is kept past the 90 days.
--
-- ai_trace_flags holds one row per signal on a trace: the reply check fired before the reply was
-- shown (reply_check), the user's next message says it was wrong (correction), the user edited
-- the message it answered (edit), cancelled its card or cleared the chat within two minutes of it
-- (card_cancelled, cleared), or tapped 👎 on it (thumbs_down). audit is for the daily review to
-- come. One row per trace and kind; detail says what was seen. The first flag sets the trace's
-- flagged_at, and the hourly scheduler keeps a flagged trace 365 days instead of 90: these are
-- the conversations that become eval cases. Like ai_traces, only the service role reads or writes
-- flags, and they go with the trace and the user's account.
--
-- Applied by hand in the SQL Editor, before the app that writes flags. It is one DO block, so it
-- applies all or nothing, and it is safe to run twice. "Success. No rows returned" means it
-- worked; a wrong state ends in an exception that says what is wrong.

do $$
begin
    alter table public.ai_traces add column if not exists flagged_at timestamptz;
    create index if not exists ai_traces_flagged_idx on public.ai_traces (flagged_at desc) where flagged_at is not null;

    create table if not exists public.ai_trace_flags (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        trace_id uuid not null references public.ai_traces (id) on delete cascade,
        user_id uuid not null references auth.users (id) on delete cascade,
        kind text not null check (kind in ('reply_check', 'correction', 'edit', 'card_cancelled', 'cleared', 'thumbs_down', 'audit')),
        detail jsonb,
        unique (trace_id, kind)
    );
    create index if not exists ai_trace_flags_created_idx on public.ai_trace_flags (created_at desc);
    alter table public.ai_trace_flags enable row level security;
    revoke all on public.ai_trace_flags from anon, authenticated;

    -- The first flag marks its trace, which the scheduler then keeps longer
    create or replace function public.ai_trace_flag_marks()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    begin
        update public.ai_traces set flagged_at = coalesce(flagged_at, new.created_at) where id = new.trace_id;
        return new;
    end
    $fn$;
    revoke all on function public.ai_trace_flag_marks() from public, anon, authenticated;
    drop trigger if exists ai_trace_flag_marks on public.ai_trace_flags;
    create trigger ai_trace_flag_marks after insert on public.ai_trace_flags
        for each row execute function public.ai_trace_flag_marks();

    -- ---------- Checks ----------
    if not (select relrowsecurity from pg_class where oid = 'public.ai_trace_flags'::regclass) then
        raise exception 'row level security is off on ai_trace_flags';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_trace_flags') then
        raise exception 'ai_trace_flags has a policy; only the service role may read or write flags';
    end if;
    if has_table_privilege('authenticated', 'public.ai_trace_flags', 'select')
        or has_table_privilege('anon', 'public.ai_trace_flags', 'select')
        or has_table_privilege('authenticated', 'public.ai_trace_flags', 'insert') then
        raise exception 'users can still read or write ai_trace_flags';
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = 'public.ai_trace_flags'::regclass and tgname = 'ai_trace_flag_marks') then
        raise exception 'the trigger that marks a flagged trace is missing';
    end if;
end $$;
