-- Saving Coach G's plan becomes one transaction: save_coach_routines(cycle_length, start_date,
-- routines) replaces the signed-in user's cycle and routines with the plan, or changes nothing.
--
-- The app did this in many statements and ignored their errors. It deleted the old cycle and
-- each routine's exercises before creating anything, so a failure partway (a bad exercise id, a
-- dropped connection) left the user with fewer routines than before, or none. A routine that a
-- logged workout pointed at couldn't be deleted (the foreign key has no on-delete action), so
-- it stayed behind, empty, next to the new ones. This unlinks the workouts first, as deleting a
-- routine on the Routines page does.
--
-- It runs as the user (security invoker), so their row level security applies to every
-- statement. p_routines is what the save-routine route checked (lib/coach-g.ts):
--   [{ "name": "Push Day", "day_indices": [1, 4],
--      "exercises": [{ "exercise_id": "<uuid>", "target_sets": 4, "target_reps": 8 }] }]
-- Days no routine has are rest days. It answers { cycle_id, routines: [{ id, name }] }.
--
-- Applied by hand in the SQL Editor, before the app that calls it. It is one DO block, so it
-- applies all or nothing, and it is safe to run twice. "Success. No rows returned" means it
-- worked; a wrong state ends in an exception that says what is wrong.

do $$
begin
    create or replace function public.save_coach_routines(p_cycle_length integer, p_start_date date, p_routines jsonb)
    returns jsonb
    language plpgsql
    security invoker
    set search_path = ''
    as $fn$
    declare
        v_user uuid := auth.uid();
        v_cycle uuid;
        v_routine jsonb;
        v_routine_id uuid;
        v_saved jsonb := '[]'::jsonb;
    begin
        if v_user is null then
            raise exception 'not signed in';
        end if;
        if jsonb_typeof(p_routines) is distinct from 'array' then
            raise exception 'p_routines must be an array';
        end if;
        if exists (
            select 1 from jsonb_array_elements(p_routines) r, jsonb_array_elements_text(r -> 'day_indices') d
            where d::integer not between 1 and p_cycle_length
        ) then
            raise exception 'a day is outside the % day cycle', p_cycle_length;
        end if;

        -- The old plan: workouts keep their sets but no longer point at a routine
        update public.workouts set routine_id = null where user_id = v_user and routine_id is not null;
        delete from public.cycle_days where training_cycle_id in (select id from public.training_cycles where user_id = v_user);
        delete from public.training_cycles where user_id = v_user;
        delete from public.routine_exercises where routine_id in (select id from public.routines where user_id = v_user);
        delete from public.routines where user_id = v_user;

        insert into public.training_cycles (user_id, cycle_length, start_date)
        values (v_user, p_cycle_length, p_start_date)
        returning id into v_cycle;

        for v_routine in select value from jsonb_array_elements(p_routines) loop
            insert into public.routines (user_id, name)
            values (v_user, v_routine ->> 'name')
            returning id into v_routine_id;

            insert into public.routine_exercises (routine_id, exercise_id, order_index, target_sets, target_reps)
            select v_routine_id, (e ->> 'exercise_id')::uuid, (n - 1)::integer, (e ->> 'target_sets')::integer, (e ->> 'target_reps')::integer
            from jsonb_array_elements(v_routine -> 'exercises') with ordinality as x (e, n);

            insert into public.cycle_days (training_cycle_id, day_index, routine_id)
            select v_cycle, d::integer, v_routine_id
            from jsonb_array_elements_text(v_routine -> 'day_indices') d;

            v_saved := v_saved || jsonb_build_array(jsonb_build_object('id', v_routine_id, 'name', v_routine ->> 'name'));
        end loop;

        insert into public.cycle_days (training_cycle_id, day_index, routine_id)
        select v_cycle, i, null
        from generate_series(1, p_cycle_length) i
        where not exists (select 1 from public.cycle_days c where c.training_cycle_id = v_cycle and c.day_index = i);

        return jsonb_build_object('cycle_id', v_cycle, 'routines', v_saved);
    end
    $fn$;

    revoke all on function public.save_coach_routines(integer, date, jsonb) from public, anon;
    grant execute on function public.save_coach_routines(integer, date, jsonb) to authenticated;

    if (select prosecdef from pg_proc where oid = 'public.save_coach_routines(integer, date, jsonb)'::regprocedure) then
        raise exception 'save_coach_routines must run as the user (security invoker), so their row level security applies';
    end if;
    if has_function_privilege('anon', 'public.save_coach_routines(integer, date, jsonb)', 'execute') then
        raise exception 'anon can call save_coach_routines';
    end if;
    if not has_function_privilege('authenticated', 'public.save_coach_routines(integer, date, jsonb)', 'execute') then
        raise exception 'signed-in users cannot call save_coach_routines';
    end if;
end $$;
