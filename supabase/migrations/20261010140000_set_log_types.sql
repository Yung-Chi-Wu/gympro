-- Sets of every log type in workout_sets, kg/lb chosen per exercise, and a km/mi preference.
-- An exercise's log_type (exercises.log_type, lib/exercise-attributes.ts) decides which
-- columns its sets fill:
--
--   weight_reps   weight_kg, reps
--   bodyweight    weight_kg (the weight added; 0 is bodyweight alone), reps
--   assisted      assist_kg (the machine's help), reps; weight_kg 0
--   duration      duration_s; reps 0, weight_kg 0
--   treadmill     duration_s, speed_kmh, incline_pct (distance is speed x time, not stored)
--   cardio_level  duration_s, level
--   rower         duration_s, distance_m
--   cardio_time   duration_s
--
-- Cardio is logged in sets like strength: each set is one setting of the machine. Everything
-- is stored metric; the app converts for lb and mi. reps and weight_kg stay not null (0 when a
-- type doesn't use them), so every reader of sets keeps working. Sets already logged keep
-- what they have; the new columns are null for them.
--
-- Units: user_profiles.weight_unit stays the reading unit (reports, Ronnie, history), set in
-- Settings. Each exercise is logged in its own kg/lb (some machines are in lb), remembered in
-- exercise_log_units; without a row it is the reading unit. A weighted set keeps the unit it
-- was typed in (input_unit; null for older sets), so it shows again exactly as typed.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it
-- is safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
declare
    v_con record;
    v_missing text;
begin
    alter table public.workout_sets add column if not exists duration_s integer;
    alter table public.workout_sets add column if not exists speed_kmh numeric;
    alter table public.workout_sets add column if not exists incline_pct numeric;
    alter table public.workout_sets add column if not exists level numeric;
    alter table public.workout_sets add column if not exists distance_m numeric;
    alter table public.workout_sets add column if not exists assist_kg numeric;
    alter table public.workout_sets add column if not exists input_unit text;
    alter table public.workout_sets drop constraint if exists workout_sets_input_unit_known;
    alter table public.workout_sets add constraint workout_sets_input_unit_known check (input_unit in ('kg', 'lb'));

    -- A cardio or timed set has 0 reps. An older check on reps (reps > 0, say) would refuse it, so
    -- it is replaced by workout_sets_amounts_valid, which still asks for reps on a set without a
    -- duration. The notice names what was replaced.
    for v_con in
        select conname, pg_get_constraintdef(oid) as def
        from pg_constraint
        where conrelid = 'public.workout_sets'::regclass and contype = 'c'
          and conname <> 'workout_sets_amounts_valid'
          and pg_get_constraintdef(oid) ~ '\mreps\M'
    loop
        execute format('alter table public.workout_sets drop constraint %I', v_con.conname);
        raise notice 'Replaced check % on workout_sets: %', v_con.conname, v_con.def;
    end loop;

    alter table public.workout_sets drop constraint if exists workout_sets_amounts_valid;
    -- not valid: it checks new and changed sets, and leaves the ones already logged as they are
    alter table public.workout_sets add constraint workout_sets_amounts_valid check (
        reps >= 0 and weight_kg >= 0
        and (reps > 0 or duration_s is not null)
        and (duration_s is null or duration_s > 0)
        and (speed_kmh is null or speed_kmh between 0 and 50)
        and (incline_pct is null or incline_pct between 0 and 40)
        and (level is null or level >= 0)
        and (distance_m is null or distance_m >= 0)
        and (assist_kg is null or assist_kg >= 0)
    ) not valid;

    -- The km/mi switch beside kg/lb; like weight_unit, only the display changes
    alter table public.user_profiles add column if not exists distance_unit text not null default 'km';
    alter table public.user_profiles drop constraint if exists user_profiles_distance_unit_known;
    alter table public.user_profiles add constraint user_profiles_distance_unit_known check (distance_unit in ('km', 'mi'));

    -- Each exercise's kg/lb, per user
    create table if not exists public.exercise_log_units (
        user_id uuid not null references auth.users (id) on delete cascade,
        exercise_id uuid not null references public.exercises (id) on delete cascade,
        unit text not null,
        updated_at timestamptz not null default now(),
        primary key (user_id, exercise_id)
    );
    alter table public.exercise_log_units drop constraint if exists exercise_log_units_unit_known;
    alter table public.exercise_log_units add constraint exercise_log_units_unit_known check (unit in ('kg', 'lb'));
    alter table public.exercise_log_units enable row level security;
    drop policy if exists "Users manage their own exercise log units" on public.exercise_log_units;
    create policy "Users manage their own exercise log units"
        on public.exercise_log_units
        for all
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id);

    select string_agg(c, ', ') into v_missing
    from unnest(array['duration_s', 'speed_kmh', 'incline_pct', 'level', 'distance_m', 'assist_kg', 'input_unit']) as c
    where not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'workout_sets' and column_name = c and is_nullable = 'YES'
    );
    if v_missing is not null then
        raise exception 'workout_sets is missing nullable column(s): %', v_missing;
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.workout_sets'::regclass and conname = 'workout_sets_amounts_valid') then
        raise exception 'workout_sets: workout_sets_amounts_valid is missing';
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.workout_sets'::regclass and conname = 'workout_sets_input_unit_known') then
        raise exception 'workout_sets: the kg/lb check on input_unit is missing';
    end if;
    if exists (
        select 1 from pg_constraint
        where conrelid = 'public.workout_sets'::regclass and contype = 'c'
          and conname <> 'workout_sets_amounts_valid' and pg_get_constraintdef(oid) ~ '\mreps\M'
    ) then
        raise exception 'workout_sets: another check on reps would still refuse a cardio set';
    end if;
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'distance_unit'
          and is_nullable = 'NO' and column_default like '''km''%'
    ) then
        raise exception 'user_profiles.distance_unit is missing, nullable, or not defaulting to km';
    end if;
    if exists (select 1 from public.user_profiles where distance_unit not in ('km', 'mi')) then
        raise exception 'user_profiles has a distance_unit other than km or mi';
    end if;
    if not (select relrowsecurity from pg_class where oid = 'public.exercise_log_units'::regclass) then
        raise exception 'exercise_log_units: row level security is off';
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'exercise_log_units') <> 1
        or not exists (
            select 1 from pg_policies
            where schemaname = 'public' and tablename = 'exercise_log_units' and cmd = 'ALL'
              and qual = '(auth.uid() = user_id)' and with_check = '(auth.uid() = user_id)'
        ) then
        raise exception 'exercise_log_units: expected one policy limiting every command to the user''s own rows';
    end if;
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.exercise_log_units'::regclass and contype = 'p'
          and conkey = array[
              (select attnum from pg_attribute where attrelid = 'public.exercise_log_units'::regclass and attname = 'user_id'),
              (select attnum from pg_attribute where attrelid = 'public.exercise_log_units'::regclass and attname = 'exercise_id')
          ]::smallint[]
    ) then
        raise exception 'exercise_log_units: the primary key is not (user_id, exercise_id)';
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.exercise_log_units'::regclass and conname = 'exercise_log_units_unit_known') then
        raise exception 'exercise_log_units: the kg/lb check on unit is missing';
    end if;
end
$$;
