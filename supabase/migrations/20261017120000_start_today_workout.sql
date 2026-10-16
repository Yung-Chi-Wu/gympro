-- Starting today's workout becomes one transaction: start_today_workout(day_start, day_end,
-- routine_id, exercise_ids) returns the signed-in user's latest workout in that day, or creates
-- it with its planned exercises, all or nothing.
--
-- The logging card inserted the workout, then its planned exercises, and stopped on an error
-- with nothing undone. A failed second insert (an exercise listed twice, a dropped connection)
-- left an empty workout, which every reader then took as today's, so the day's routine vanished
-- from the card. Ronnie's path undid the workout itself; both now call this.
--
-- Two calls at once (a double tap, the card and Ronnie) make one workout: each user's calls take
-- turns on a transaction lock. A day that is already over is refused ('day_over'), so a page left
-- open overnight can't start yesterday's workout; the app reloads today instead.
--
-- It runs as the user (security invoker), so their row level security applies: the routine
-- must be theirs and each exercise one they can see. Planned exercises keep the order given,
-- each once. A workout that already exists is returned as it is, planned exercises untouched.
--
-- Applied by hand in the SQL Editor, before the app that calls it. It is one DO block, so it
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

        insert into public.workout_planned_exercises (workout_id, exercise_id, user_id)
        select v_workout, x.exercise_id, v_user
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
end $$;
