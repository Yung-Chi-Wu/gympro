-- Changed days: a date of the training cycle the user gave another routine, or made a rest day,
-- from 課表's calendar. The cycle itself doesn't move: the days around it keep their routines
-- (lib/periods.ts, plannedRoutineId). Today, Ronnie and the calendar show the routine picked, and
-- the round's report counts it as that day's plan, so the routine it replaced is simply not done
-- that round: its sets are that many fewer. A rest day made one plans nothing, so it isn't missed.
--   training_cycle_id  the cycle; a deleted cycle (or a plan Coach G saves) takes its changes with it
--   change_date        the user's local date
--   routine_id         the routine the date trains instead; null for a rest day. A deleted routine
--                      leaves the date a rest day, as it does the cycle's days it was on.
-- The user reads and writes their own cycle's rows, pointing only at their own routines, like
-- cycle_days; the report Lambda reads them with the service role.
--
-- This takes over from cycle_rest_days (20261025130000): its rows are copied in as rest days, and
-- until a later migration drops it, a rest day a page still on the old app adds or removes there
-- is copied here too.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
declare
    -- The first run copies the rest days; a later one leaves alone the days given back since
    v_first_run constant boolean := to_regclass('public.cycle_date_changes') is null;
begin
    create table if not exists public.cycle_date_changes (
        training_cycle_id uuid not null references public.training_cycles (id) on delete cascade,
        change_date date not null,
        routine_id uuid references public.routines (id) on delete set null,
        created_at timestamptz not null default now(),
        primary key (training_cycle_id, change_date)
    );

    alter table public.cycle_date_changes enable row level security;
    drop policy if exists "Users manage their own cycle's changed days" on public.cycle_date_changes;
    create policy "Users manage their own cycle's changed days" on public.cycle_date_changes for all to authenticated
        using (exists (select 1 from public.training_cycles c where c.id = cycle_date_changes.training_cycle_id and c.user_id = (select auth.uid())))
        with check (exists (select 1 from public.training_cycles c where c.id = cycle_date_changes.training_cycle_id and c.user_id = (select auth.uid()))
            and (cycle_date_changes.routine_id is null or exists (
                select 1 from public.routines r where r.id = cycle_date_changes.routine_id and r.user_id = (select auth.uid()))));

    -- A day is changed, changed again (an upsert) or given back to the cycle
    revoke all on public.cycle_date_changes from anon, authenticated;
    grant select, insert, update, delete on public.cycle_date_changes to authenticated;
    grant select on public.cycle_date_changes to service_role;

    -- The rest days made so far
    if v_first_run then
        insert into public.cycle_date_changes (training_cycle_id, change_date, routine_id, created_at)
        select training_cycle_id, rest_date, null, created_at from public.cycle_rest_days
        on conflict (training_cycle_id, change_date) do nothing;
    end if;

    -- A page still on the old app writes rest days to cycle_rest_days: they come here too. The
    -- trigger runs as the user, so this table's policy holds for it as for the app.
    create or replace function public.cycle_rest_days_to_changes() returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    begin
        if tg_op = 'INSERT' then
            insert into public.cycle_date_changes (training_cycle_id, change_date, routine_id)
            values (new.training_cycle_id, new.rest_date, null)
            on conflict (training_cycle_id, change_date) do update set routine_id = null;
            return new;
        end if;
        delete from public.cycle_date_changes
        where training_cycle_id = old.training_cycle_id and change_date = old.rest_date and routine_id is null;
        return old;
    end
    $fn$;
    revoke all on function public.cycle_rest_days_to_changes() from public, anon, authenticated;
    drop trigger if exists cycle_rest_days_to_changes on public.cycle_rest_days;
    create trigger cycle_rest_days_to_changes after insert or delete on public.cycle_rest_days
        for each row execute function public.cycle_rest_days_to_changes();

    -- ---------- Checks ----------
    if not (select relrowsecurity from pg_class where oid = 'public.cycle_date_changes'::regclass) then
        raise exception 'cycle_date_changes does not have row level security on';
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cycle_date_changes') <> 1 then
        raise exception 'cycle_date_changes should have exactly one policy: the user''s own cycle';
    end if;
    if (select with_check from pg_policies where schemaname = 'public' and tablename = 'cycle_date_changes') not like '%routines%' then
        raise exception 'cycle_date_changes'' policy does not hold a changed day to the user''s own routines';
    end if;
    if (select confdeltype from pg_constraint
        where conrelid = 'public.cycle_date_changes'::regclass and contype = 'f' and confrelid = 'public.training_cycles'::regclass) is distinct from 'c' then
        raise exception 'cycle_date_changes rows do not go with their cycle when it is deleted';
    end if;
    if (select confdeltype from pg_constraint
        where conrelid = 'public.cycle_date_changes'::regclass and contype = 'f' and confrelid = 'public.routines'::regclass) is distinct from 'n' then
        raise exception 'a deleted routine does not leave its changed days rest days';
    end if;
    if has_table_privilege('anon', 'public.cycle_date_changes', 'select, insert, update, delete') then
        raise exception 'anon can still reach cycle_date_changes';
    end if;
    if not has_table_privilege('authenticated', 'public.cycle_date_changes', 'select')
        or not has_table_privilege('authenticated', 'public.cycle_date_changes', 'insert')
        or not has_table_privilege('authenticated', 'public.cycle_date_changes', 'update')
        or not has_table_privilege('authenticated', 'public.cycle_date_changes', 'delete') then
        raise exception 'signed-in users should read, add, change and remove their changed days';
    end if;
    if not has_table_privilege('service_role', 'public.cycle_date_changes', 'select') then
        raise exception 'the service role cannot read cycle_date_changes for the report';
    end if;
    if v_first_run and exists (select 1 from public.cycle_rest_days r where not exists (
        select 1 from public.cycle_date_changes c where c.training_cycle_id = r.training_cycle_id and c.change_date = r.rest_date)) then
        raise exception 'a rest day in cycle_rest_days was not copied to cycle_date_changes';
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = 'public.cycle_rest_days'::regclass and tgname = 'cycle_rest_days_to_changes' and not tgisinternal) then
        raise exception 'rest days the old app writes would not reach cycle_date_changes';
    end if;
end $$;
