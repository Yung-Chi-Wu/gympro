-- A demo account with made-up training, for the README's screenshots: the app can be shown
-- signed in without anyone's real data.
--
-- Prerequisite: create the auth user in Supabase Dashboard > Authentication > Users > Add user,
-- with email demo@example.com and "Auto Confirm User" checked. Then run this file in the SQL
-- Editor. example.com is reserved for testing, so no real account can match it. Re-running it
-- wipes and re-seeds only this user's data, relative to the day it runs.
--
-- What it holds, in America/New_York:
--   - Alex, building muscle, the app in English and kg
--   - a 7-day cycle starting on a Monday: Push, Pull, Legs, Push, Legs, Pull, rest
--   - the six full weeks before this one, every session done, the main lifts going up
--   - today's workout half done when today is a training day, a weigh-in and a day note
-- The last full week's report, made by the hourly scheduler within the hour, then has one
-- piece of advice: side delts at 9 sets a week, one short of 10. The same weeks, run through
-- the report's rules offline (analyze() in lambda/ai-worker/src/report), fire only that.
--
-- One DO block, all or nothing. "Success. No rows returned" means it worked.

do $$
declare
    v_tz constant text := 'America/New_York';
    v_user uuid;
    v_today date;
    v_start date;
    v_week constant text[] := array['Push Day', 'Pull Day', 'Leg Day', 'Push Day', 'Leg Day', 'Pull Day', null];
    -- Each exercise's sets and reps, and its weight and reps in each of the six weeks, oldest first
    v_plan constant jsonb := '{
        "Push Day": [
            {"exercise": "Barbell Bench Press", "sets": 4, "reps": 8, "weights": [70, 72.5, 72.5, 75, 75, 77.5], "reps_by_week": [8, 8, 8, 8, 8, 8]},
            {"exercise": "Overhead Press", "sets": 3, "reps": 8, "weights": [40, 40, 42.5, 42.5, 42.5, 45], "reps_by_week": [8, 9, 8, 8, 9, 8]},
            {"exercise": "Incline Dumbbell Bench Press", "sets": 3, "reps": 10, "weights": [22, 22, 24, 24, 24, 26], "reps_by_week": [10, 11, 10, 10, 11, 10]},
            {"exercise": "Lateral Raise", "sets": 3, "reps": 12, "weights": [7.5, 8, 8.5, 9, 9.5, 10], "reps_by_week": [12, 12, 12, 12, 12, 12]},
            {"exercise": "Triceps Pushdown", "sets": 3, "reps": 12, "weights": [25, 26, 27, 28, 29, 30], "reps_by_week": [12, 12, 12, 12, 12, 12]}
        ],
        "Pull Day": [
            {"exercise": "Barbell Row", "sets": 4, "reps": 8, "weights": [60, 62.5, 62.5, 65, 67.5, 67.5], "reps_by_week": [8, 8, 8, 8, 8, 8]},
            {"exercise": "Lat Pulldown", "sets": 3, "reps": 10, "weights": [42.5, 45, 47.5, 50, 52.5, 55], "reps_by_week": [10, 10, 10, 10, 10, 10]},
            {"exercise": "Face Pull", "sets": 3, "reps": 15, "weights": [10, 11, 12, 13, 14, 15], "reps_by_week": [15, 15, 15, 15, 15, 15]},
            {"exercise": "Barbell Curl", "sets": 3, "reps": 10, "weights": [25, 26, 27, 28, 29, 30], "reps_by_week": [10, 10, 10, 10, 10, 10]}
        ],
        "Leg Day": [
            {"exercise": "Barbell Back Squat", "sets": 4, "reps": 6, "weights": [90, 92.5, 95, 95, 97.5, 100], "reps_by_week": [6, 6, 6, 6, 6, 6]},
            {"exercise": "Romanian Deadlift", "sets": 3, "reps": 8, "weights": [80, 82.5, 85, 85, 87.5, 90], "reps_by_week": [8, 8, 8, 8, 8, 8]},
            {"exercise": "Leg Press", "sets": 3, "reps": 10, "weights": [147.5, 150, 152.5, 155, 157.5, 160], "reps_by_week": [10, 10, 10, 10, 10, 10]},
            {"exercise": "Leg Curl", "sets": 3, "reps": 12, "weights": [27.5, 30, 32.5, 35, 37.5, 40], "reps_by_week": [12, 12, 12, 12, 12, 12]}
        ]
    }';
    v_weights constant numeric[] := array[74.2, 74.4, 74.5, 74.8, 74.9, 75.1];
    v_cycle uuid;
    v_routine text;
    v_routine_id uuid;
    v_routine_ids jsonb := '{}';
    v_exercise_ids jsonb := '{}';
    v_id uuid;
    v_workout uuid;
    v_at timestamptz;
    v_order integer;
    e record;
    w integer;
    d integer;
    s integer;
    v_sets integer;
    v_n integer := 0;
begin
    select id into v_user from auth.users where email = 'demo@example.com';
    if v_user is null then
        raise exception 'Create the auth user demo@example.com first (Authentication > Users > Add user, Auto Confirm User)';
    end if;

    v_today := (now() at time zone v_tz)::date;
    -- Six full weeks before this one, from a Monday
    v_start := v_today - (extract(isodow from v_today)::integer - 1) - 42;

    -- The library's own exercises, by name
    for e in select distinct t.x ->> 'exercise' as name from jsonb_each(v_plan) r, jsonb_array_elements(r.value) as t (x) loop
        select id into v_id from public.exercises where name = e.name and not coalesce(is_custom, false) limit 1;
        if v_id is null then
            raise exception 'The library has no exercise named %', e.name;
        end if;
        v_exercise_ids := v_exercise_ids || jsonb_build_object(e.name, v_id);
    end loop;

    -- ---------- Only this user's data, from a clean slate ----------
    delete from public.workout_sets where user_id = v_user;
    delete from public.workout_planned_exercises where user_id = v_user;
    delete from public.workouts where user_id = v_user;
    delete from public.body_metrics where user_id = v_user;
    delete from public.day_notes where user_id = v_user;
    delete from public.period_notes where user_id = v_user;
    delete from public.period_reports where user_id = v_user;
    delete from public.ronnie_conversations where user_id = v_user;
    delete from public.ronnie_memories where user_id = v_user;
    delete from public.ronnie_pending_actions where user_id = v_user;
    delete from public.exercise_log_units where user_id = v_user;
    delete from public.cycle_days where training_cycle_id in (select id from public.training_cycles where user_id = v_user);
    delete from public.training_cycles where user_id = v_user;
    delete from public.routine_exercises where routine_id in (select id from public.routines where user_id = v_user);
    delete from public.routines where user_id = v_user;

    -- ---------- Profile: update, since sign-up may have made the row ----------
    update public.user_profiles set
        display_name = 'Alex', training_goal = 'Build muscle', height_cm = 178, date_of_birth = '1997-04-12', sex = 'male',
        language = 'en', timezone = v_tz, weight_unit = 'kg', distance_unit = 'km', onboarding_completed = true
    where user_id = v_user;
    if not found then
        insert into public.user_profiles (user_id, display_name, training_goal, height_cm, date_of_birth, sex, language, timezone, weight_unit, distance_unit, onboarding_completed)
        values (v_user, 'Alex', 'Build muscle', 178, '1997-04-12', 'male', 'en', v_tz, 'kg', 'km', true);
    end if;

    -- ---------- Routines and the cycle ----------
    foreach v_routine in array array['Push Day', 'Pull Day', 'Leg Day'] loop
        -- A moment apart, so they list in this order
        v_n := v_n + 1;
        insert into public.routines (user_id, name, created_at) values (v_user, v_routine, now() + v_n * interval '1 millisecond') returning id into v_routine_id;
        v_routine_ids := v_routine_ids || jsonb_build_object(v_routine, v_routine_id);
        insert into public.routine_exercises (routine_id, exercise_id, order_index, target_sets, target_reps)
        select v_routine_id, (v_exercise_ids ->> (x ->> 'exercise'))::uuid, (n - 1)::integer, (x ->> 'sets')::integer, (x ->> 'reps')::integer
        from jsonb_array_elements(v_plan -> v_routine) with ordinality as t (x, n);
    end loop;

    insert into public.training_cycles (user_id, cycle_length, start_date) values (v_user, 7, v_start) returning id into v_cycle;
    insert into public.cycle_days (training_cycle_id, day_index, routine_id)
    select v_cycle, i, (v_routine_ids ->> v_week[i])::uuid from generate_series(1, 7) i;

    -- ---------- Six weeks of training, at 6 pm ----------
    for w in 0..5 loop
        for d in 1..7 loop
            v_routine := v_week[d];
            continue when v_routine is null;
            v_at := ((v_start + w * 7 + d - 1) + time '18:00') at time zone v_tz;
            insert into public.workouts (user_id, performed_at, routine_id, created_at)
            values (v_user, v_at, (v_routine_ids ->> v_routine)::uuid, v_at)
            returning id into v_workout;
            v_order := 0;
            for e in select t.x from jsonb_array_elements(v_plan -> v_routine) as t (x) loop
                v_id := (v_exercise_ids ->> (e.x ->> 'exercise'))::uuid;
                insert into public.workout_planned_exercises (workout_id, exercise_id, user_id, created_at) values (v_workout, v_id, v_user, v_at + v_order * interval '1 millisecond');
                -- Logged in the routine's order, three minutes apart
                for s in 1..(e.x ->> 'sets')::integer loop
                    insert into public.workout_sets (workout_id, exercise_id, user_id, set_number, reps, weight_kg, input_unit, created_at)
                    values (v_workout, v_id, v_user, s, (e.x -> 'reps_by_week' ->> w)::integer, (e.x -> 'weights' ->> w)::numeric, 'kg', v_at + v_order * interval '3 minutes');
                    v_order := v_order + 1;
                end loop;
            end loop;
        end loop;
        insert into public.body_metrics (user_id, weight_kg, recorded_at)
        values (v_user, v_weights[w + 1], ((v_start + w * 7 + 6) + time '08:00') at time zone v_tz);
    end loop;

    -- ---------- Today: under way when it is a training day ----------
    v_routine := v_week[extract(isodow from v_today)::integer];
    if v_routine is not null then
        v_at := greatest(now() - interval '45 minutes', (v_today + time '00:01') at time zone v_tz);
        insert into public.workouts (user_id, performed_at, routine_id, created_at)
        values (v_user, v_at, (v_routine_ids ->> v_routine)::uuid, v_at)
        returning id into v_workout;
        v_order := 0;
        for e in select x, n from jsonb_array_elements(v_plan -> v_routine) with ordinality as t (x, n) loop
            v_id := (v_exercise_ids ->> (e.x ->> 'exercise'))::uuid;
            insert into public.workout_planned_exercises (workout_id, exercise_id, user_id, created_at) values (v_workout, v_id, v_user, v_at + e.n * interval '1 millisecond');
            -- The first exercise done, 2.5 kg up on last week; two sets of the second; the rest to come
            v_sets := case e.n when 1 then (e.x ->> 'sets')::integer when 2 then 2 else 0 end;
            for s in 1..v_sets loop
                insert into public.workout_sets (workout_id, exercise_id, user_id, set_number, reps, weight_kg, input_unit, created_at)
                values (v_workout, v_id, v_user, s, (e.x -> 'reps_by_week' ->> 5)::integer,
                        (e.x -> 'weights' ->> 5)::numeric + case e.n when 1 then 2.5 else 0 end, 'kg', v_at + v_order * interval '3 minutes');
                v_order := v_order + 1;
            end loop;
        end loop;
    end if;
    insert into public.body_metrics (user_id, weight_kg, recorded_at)
    values (v_user, 75.2, least(now(), (v_today + time '08:00') at time zone v_tz));
    insert into public.day_notes (user_id, note_date, note, updated_at)
    values (v_user, v_today, 'Slept well. The bench felt fast today.', now());

    -- ---------- Checks ----------
    if (select count(*) from public.workouts where user_id = v_user) <> 36 + (v_routine is not null)::integer then
        raise exception 'expected % workouts', 36 + (v_routine is not null)::integer;
    end if;
    if (select count(*) from public.workout_sets where user_id = v_user and created_at < (v_today + time '00:00') at time zone v_tz) <> 504 then
        raise exception 'expected 504 sets in the six weeks';
    end if;
    if (select count(*) from public.cycle_days where training_cycle_id = v_cycle) <> 7 then
        raise exception 'expected a 7-day cycle';
    end if;
end $$;
