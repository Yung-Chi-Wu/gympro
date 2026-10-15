-- The user tables' row level security, written into the repo. Ten of these policies existed only
-- in the dashboard; this one migration is now what they are, and it can be run again. Each table
-- gets one policy, for signed-in users on their own rows, and a write must also point only at
-- what the user owns or can see:
--   workouts                   routine_id is null or one of their routines
--   workout_sets,              workout_id is one of their workouts, and exercise_id an exercise
--   workout_planned_exercises  they can see
--   exercise_log_units         exercise_id an exercise they can see
--   routine_exercises          rows of their routines, with an exercise they can see
--   cycle_days                 rows of their cycle; routine_id is null or one of their routines
-- An exercise they can see is one the exercises policy shows them, read through it: the built-in
-- library (custom exercises were removed on 2026-10-12, and that policy goes in here too).
-- Before this, a row could point at another user's routine by its ID, and the report Lambda,
-- which reads with the service role, then put that routine's name and exercises in the report.
-- anon loses every grant on these tables: the app never reads or writes them signed out.
-- A deleted account no longer fails on an exercise it created: created_by is set to null.
--
-- It stops first, with counts only, if existing rows already break the new write checks: those
-- rows could no longer be changed. Reads of them are not affected either way.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
declare
    t text;
    p record;
    n bigint;
    own_rows constant text[] := array['user_profiles', 'routines', 'training_cycles', 'body_metrics', 'day_notes', 'period_notes'];
    all_tables constant text[] := own_rows || array['workouts', 'workout_sets', 'workout_planned_exercises', 'exercise_log_units', 'routine_exercises', 'cycle_days', 'exercises'];
begin
    -- ---------- Rows that already break the new checks ----------
    select count(*) into n from public.cycle_days d
        join public.training_cycles c on c.id = d.training_cycle_id
        join public.routines r on r.id = d.routine_id
        where r.user_id <> c.user_id;
    if n > 0 then raise exception 'cycle_days: % rows point at another user''s routine', n; end if;
    select count(*) into n from public.workouts w join public.routines r on r.id = w.routine_id where r.user_id <> w.user_id;
    if n > 0 then raise exception 'workouts: % rows point at another user''s routine', n; end if;
    select count(*) into n from public.workout_sets s join public.workouts w on w.id = s.workout_id where w.user_id <> s.user_id;
    if n > 0 then raise exception 'workout_sets: % rows sit in another user''s workout', n; end if;
    select count(*) into n from public.workout_planned_exercises s join public.workouts w on w.id = s.workout_id where w.user_id <> s.user_id;
    if n > 0 then raise exception 'workout_planned_exercises: % rows sit in another user''s workout', n; end if;
    select count(*) into n from (
        select exercise_id from public.routine_exercises
        union all select exercise_id from public.workout_sets
        union all select exercise_id from public.workout_planned_exercises
        union all select exercise_id from public.exercise_log_units
    ) x join public.exercises e on e.id = x.exercise_id
    where coalesce(e.is_custom, false) or e.created_by is not null;
    if n > 0 then raise exception '% rows use a custom exercise, which no user can see', n; end if;

    -- ---------- Every table: row level security on, the old policies gone, nothing for anon ----------
    foreach t in array all_tables loop
        execute format('alter table public.%I enable row level security', t);
        for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
            execute format('drop policy %I on public.%I', p.policyname, t);
        end loop;
        execute format('revoke all on public.%I from anon', t);
    end loop;

    -- ---------- Own rows only ----------
    foreach t in array own_rows loop
        execute format('create policy "Users manage their own rows" on public.%I for all to authenticated '
            'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    end loop;

    -- ---------- Own rows, pointing only at what the user owns or can see ----------
    create policy "Users manage their own workouts" on public.workouts for all to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id and (workouts.routine_id is null or exists (
            select 1 from public.routines r where r.id = workouts.routine_id and r.user_id = (select auth.uid()))));

    create policy "Users manage their own sets" on public.workout_sets for all to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id
            and exists (select 1 from public.workouts w where w.id = workout_sets.workout_id and w.user_id = (select auth.uid()))
            and exists (select 1 from public.exercises e where e.id = workout_sets.exercise_id));

    create policy "Users manage their own planned exercises" on public.workout_planned_exercises for all to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id
            and exists (select 1 from public.workouts w where w.id = workout_planned_exercises.workout_id and w.user_id = (select auth.uid()))
            and exists (select 1 from public.exercises e where e.id = workout_planned_exercises.exercise_id));

    create policy "Users manage their own log units" on public.exercise_log_units for all to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id
            and exists (select 1 from public.exercises e where e.id = exercise_log_units.exercise_id));

    create policy "Users manage their own routines' exercises" on public.routine_exercises for all to authenticated
        using (exists (select 1 from public.routines r where r.id = routine_exercises.routine_id and r.user_id = (select auth.uid())))
        with check (exists (select 1 from public.routines r where r.id = routine_exercises.routine_id and r.user_id = (select auth.uid()))
            and exists (select 1 from public.exercises e where e.id = routine_exercises.exercise_id));

    create policy "Users manage their own cycle's days" on public.cycle_days for all to authenticated
        using (exists (select 1 from public.training_cycles c where c.id = cycle_days.training_cycle_id and c.user_id = (select auth.uid())))
        with check (exists (select 1 from public.training_cycles c where c.id = cycle_days.training_cycle_id and c.user_id = (select auth.uid()))
            and (cycle_days.routine_id is null or exists (
                select 1 from public.routines r where r.id = cycle_days.routine_id and r.user_id = (select auth.uid()))));

    -- ---------- The exercise library: read only, the built-in exercises ----------
    create policy "Signed-in users read the built-in library" on public.exercises for select to authenticated
        using (not coalesce(is_custom, false) and created_by is null);
    revoke insert, update, delete, truncate on public.exercises from authenticated;

    -- A deleted account keeps no exercise from being deleted with it
    for p in select conname from pg_constraint
        where conrelid = 'public.exercises'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype <> 'n' loop
        execute format('alter table public.exercises drop constraint %I', p.conname);
    end loop;
    if not exists (select 1 from pg_constraint where conrelid = 'public.exercises'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass) then
        alter table public.exercises add constraint exercises_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
    end if;

    -- ---------- Checks ----------
    foreach t in array all_tables loop
        if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
            raise exception '%: row level security is off', t;
        end if;
        if (select count(*) from pg_policies where schemaname = 'public' and tablename = t) <> 1 then
            raise exception '%: expected exactly one policy', t;
        end if;
        if has_table_privilege('anon', format('public.%I', t), 'select') or has_table_privilege('anon', format('public.%I', t), 'insert')
            or has_table_privilege('anon', format('public.%I', t), 'update') or has_table_privilege('anon', format('public.%I', t), 'delete') then
            raise exception '%: anon still has a grant', t;
        end if;
    end loop;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = any(all_tables) and tablename <> 'exercises'
        and (cmd <> 'ALL' or roles <> '{authenticated}' or qual not like '%auth.uid()%' or with_check not like '%auth.uid()%')) then
        raise exception 'a user table policy is not for all actions by signed-in users on their own rows';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('workouts', 'workout_sets', 'workout_planned_exercises', 'exercise_log_units', 'routine_exercises', 'cycle_days')
        and with_check not like '%EXISTS%') then
        raise exception 'a policy that should check what a row points at does not';
    end if;
    if (select cmd from pg_policies where schemaname = 'public' and tablename = 'exercises') <> 'SELECT'
        or has_table_privilege('authenticated', 'public.exercises', 'insert') or has_table_privilege('authenticated', 'public.exercises', 'update')
        or has_table_privilege('authenticated', 'public.exercises', 'delete') then
        raise exception 'exercises: signed-in users can still change the library';
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.exercises'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype = 'n') then
        raise exception 'exercises: created_by does not become null when its user is deleted';
    end if;
end $$;
