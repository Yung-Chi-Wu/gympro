-- Rest days: a date of the training cycle the user made a rest day from 課表's calendar. That
-- day's routine is not done and not moved: nothing is planned that day (lib/periods.ts,
-- plannedCycleDay), so Today, Ronnie and the calendar show a rest day, and the round's report
-- doesn't count it as missed. The round simply has that session's sets fewer. Reports still go
-- out by the cycle's rounds.
--   training_cycle_id  the cycle; a deleted cycle (or a plan Coach G saves) takes its rest days with it
--   rest_date          the user's local date
-- The user reads and writes their own cycle's rows, like cycle_days; the report Lambda reads them
-- with the service role.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
begin
    create table if not exists public.cycle_rest_days (
        training_cycle_id uuid not null references public.training_cycles (id) on delete cascade,
        rest_date date not null,
        created_at timestamptz not null default now(),
        primary key (training_cycle_id, rest_date)
    );

    alter table public.cycle_rest_days enable row level security;
    drop policy if exists "Users manage their own cycle's rest days" on public.cycle_rest_days;
    create policy "Users manage their own cycle's rest days" on public.cycle_rest_days for all to authenticated
        using (exists (select 1 from public.training_cycles c where c.id = cycle_rest_days.training_cycle_id and c.user_id = (select auth.uid())))
        with check (exists (select 1 from public.training_cycles c where c.id = cycle_rest_days.training_cycle_id and c.user_id = (select auth.uid())));

    -- A day is made a rest day or given back: added or removed, never changed
    revoke all on public.cycle_rest_days from anon, authenticated;
    grant select, insert, delete on public.cycle_rest_days to authenticated;
    grant select on public.cycle_rest_days to service_role;

    -- ---------- Checks ----------
    if not (select relrowsecurity from pg_class where oid = 'public.cycle_rest_days'::regclass) then
        raise exception 'cycle_rest_days does not have row level security on';
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cycle_rest_days') <> 1 then
        raise exception 'cycle_rest_days should have exactly one policy: the user''s own cycle';
    end if;
    if (select confdeltype from pg_constraint
        where conrelid = 'public.cycle_rest_days'::regclass and contype = 'f') is distinct from 'c' then
        raise exception 'cycle_rest_days rows do not go with their cycle when it is deleted';
    end if;
    if has_table_privilege('anon', 'public.cycle_rest_days', 'select, insert, update, delete') then
        raise exception 'anon can still reach cycle_rest_days';
    end if;
    if not has_table_privilege('authenticated', 'public.cycle_rest_days', 'select')
        or not has_table_privilege('authenticated', 'public.cycle_rest_days', 'insert')
        or not has_table_privilege('authenticated', 'public.cycle_rest_days', 'delete')
        or has_table_privilege('authenticated', 'public.cycle_rest_days', 'update') then
        raise exception 'signed-in users should read, add and remove their rest days, and not change them';
    end if;
    if not has_table_privilege('service_role', 'public.cycle_rest_days', 'select') then
        raise exception 'the service role cannot read cycle_rest_days for the report';
    end if;
end $$;
