-- A routine lists each exercise once, and the numbers a user types have limits.
--
-- routine_exercises: nothing stopped the same exercise twice in one routine (a double tap on Add).
-- Today's plan can hold each exercise only once, so starting the day with such a routine failed.
-- The later copies are removed, keeping the first by order, then routine_exercises_routine_exercise_key
-- refuses another. Targets are whole numbers, 1 to 20 sets and 1 to 100 reps (lib/targets.ts);
-- before, any number went in.
--
-- workout_sets: speed and incline already had limits; the rest only had to be 0 or more, so a
-- typo (8000 kg, 80 hours) was saved and counted in the report. workout_sets_amounts_max caps
-- reps at 1000, weight at 1000 kg, assistance at 500 kg, time at 24 hours, a machine's level at
-- 100 and distance at 100 km (lib/set-log.ts STORED_MAX).
--
-- The checks are added not valid, then validated: rows already past a limit stay as they are, and
-- the check stays not valid until they're fixed, while every new or changed row is held to it.
--
-- Applied by hand in the SQL Editor, before the app that keeps to the limits. It is one DO block,
-- so it applies all or nothing, and it is safe to run twice. "Success. No rows returned" means it
-- worked; a wrong state ends in an exception that says what is wrong.

do $$
declare
    v_removed integer;
begin
    -- ---------- Each exercise once per routine ----------
    delete from public.routine_exercises re
    using public.routine_exercises earlier
    where earlier.routine_id = re.routine_id
      and earlier.exercise_id = re.exercise_id
      and (coalesce(earlier.order_index, 0), earlier.id::text) < (coalesce(re.order_index, 0), re.id::text);
    get diagnostics v_removed = row_count;
    if v_removed > 0 then
        raise notice 'Removed % repeated exercises from routines', v_removed;
    end if;

    if not exists (select 1 from pg_constraint where conrelid = 'public.routine_exercises'::regclass and conname = 'routine_exercises_routine_exercise_key') then
        alter table public.routine_exercises add constraint routine_exercises_routine_exercise_key unique (routine_id, exercise_id);
    end if;

    -- ---------- Targets ----------
    alter table public.routine_exercises drop constraint if exists routine_exercises_targets_valid;
    alter table public.routine_exercises add constraint routine_exercises_targets_valid check (
        (target_sets is null or target_sets between 1 and 20)
        and (target_reps is null or target_reps between 1 and 100)
    ) not valid;
    begin
        alter table public.routine_exercises validate constraint routine_exercises_targets_valid;
    exception when check_violation then
        raise notice 'Some routine targets are outside 1-20 sets or 1-100 reps; they stay until changed';
    end;

    -- ---------- Set amounts ----------
    alter table public.workout_sets drop constraint if exists workout_sets_amounts_max;
    alter table public.workout_sets add constraint workout_sets_amounts_max check (
        reps <= 1000 and weight_kg <= 1000
        and (assist_kg is null or assist_kg <= 500)
        and (duration_s is null or duration_s <= 86400)
        and (level is null or level <= 100)
        and (distance_m is null or distance_m <= 100000)
    ) not valid;
    begin
        alter table public.workout_sets validate constraint workout_sets_amounts_max;
    exception when check_violation then
        raise notice 'Some logged sets are past the new limits; they stay until changed';
    end;

    -- ---------- Checks ----------
    if exists (select 1 from public.routine_exercises group by routine_id, exercise_id having count(*) > 1) then
        raise exception 'a routine still lists an exercise twice';
    end if;
    if (select count(*) from pg_constraint
        where (conrelid = 'public.routine_exercises'::regclass and conname in ('routine_exercises_routine_exercise_key', 'routine_exercises_targets_valid'))
           or (conrelid = 'public.workout_sets'::regclass and conname = 'workout_sets_amounts_max')) <> 3 then
        raise exception 'a limit was not added';
    end if;
end $$;
