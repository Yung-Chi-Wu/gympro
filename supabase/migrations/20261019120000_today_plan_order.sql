-- Today's plan keeps its routine's order. start_today_workout (20261017120000) wrote every
-- planned exercise in one insert, so all of them had the same created_at, and the readers didn't
-- order them: the logging card and Ronnie listed today's exercises in whatever order the table
-- returned, which changed from one load to the next. Now each row is written a microsecond after
-- the one before it, in the order given, and the app orders by created_at, then id. An exercise
-- added later (Add an exercise, Ronnie) comes after them. Workouts started before this keep tied
-- rows, which the app shows in a fixed order by id.
--
-- Applied by hand in the SQL Editor, before the app that orders by it. It is one DO block, so it
-- applies all or nothing, and it is safe to run twice. "Success. No rows returned" means it
-- worked; a wrong state ends in an exception that says what is wrong.

do $$
begin
    create or replace function public.start_today_workout(p_day_start timestamptz, p_day_end timestamptz, p_routine_id uuid, p_exercise_ids uuid[])
    returns uuid
    language plpgsql
    security invoker
    set search_path = ''
    as $fn$
    declare
        v_user uuid := auth.uid();
        v_workout uuid;
    begin
        if v_user is null then
            raise exception 'not signed in';
        end if;
        if p_day_start is null or p_day_end is null or p_day_end <= p_day_start or p_day_end - p_day_start > interval '26 hours' then
            raise exception 'p_day_start and p_day_end must be one day';
        end if;
        if now() > p_day_end then
            raise exception 'day_over';
        end if;

        perform pg_advisory_xact_lock(hashtextextended('start_today_workout:' || v_user::text, 0));

        -- The latest, as every reader of today's workout picks
        select w.id into v_workout
        from public.workouts w
        where w.user_id = v_user and w.performed_at >= p_day_start and w.performed_at <= p_day_end
        order by w.performed_at desc
        limit 1;
        if v_workout is not null then
            return v_workout;
        end if;

        insert into public.workouts (user_id, performed_at, routine_id)
        values (v_user, now(), p_routine_id)
        returning id into v_workout;

        -- Each row a microsecond after the one before: one insert gives every row the same now(),
        -- and the readers order by created_at
        insert into public.workout_planned_exercises (workout_id, exercise_id, user_id, created_at)
        select v_workout, x.exercise_id, v_user, now() + (row_number() over (order by x.ord)) * interval '1 microsecond'
        from (
            select distinct on (t.exercise_id) t.exercise_id, t.ord
            from unnest(coalesce(p_exercise_ids, '{}'::uuid[])) with ordinality as t (exercise_id, ord)
            where t.exercise_id is not null
            order by t.exercise_id, t.ord
        ) x
        order by x.ord;

        return v_workout;
    end
    $fn$;

    revoke all on function public.start_today_workout(timestamptz, timestamptz, uuid, uuid[]) from public, anon;
    grant execute on function public.start_today_workout(timestamptz, timestamptz, uuid, uuid[]) to authenticated;

    if (select prosecdef from pg_proc where oid = 'public.start_today_workout(timestamptz, timestamptz, uuid, uuid[])'::regprocedure) then
        raise exception 'start_today_workout must run as the user (security invoker), so their row level security applies';
    end if;
    if has_function_privilege('anon', 'public.start_today_workout(timestamptz, timestamptz, uuid, uuid[])', 'execute') then
        raise exception 'anon can call start_today_workout';
    end if;
    if not has_function_privilege('authenticated', 'public.start_today_workout(timestamptz, timestamptz, uuid, uuid[])', 'execute') then
        raise exception 'signed-in users cannot call start_today_workout';
    end if;
    if position('1 microsecond' in pg_get_functiondef('public.start_today_workout(timestamptz, timestamptz, uuid, uuid[])'::regprocedure)) = 0 then
        raise exception 'start_today_workout does not store the plan''s order';
    end if;
end $$;
