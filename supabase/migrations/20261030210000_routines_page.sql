-- Routines in one request. The Routines tab read its page in 10 requests beside the profile, all
-- at once, and each costs Supabase's API layer 40-100 ms even for one row. routines_page reads
-- the same rows in one call and returns them as the requests did, nested the same way, so the app
-- builds the page with its own code (lib/routines-page.ts).
--
-- p_start and p_end are the dates the calendar's month is read for (calendarReadAhead in
-- lib/cycle-calendar.ts): the workouts a day wider on each side, in UTC, as readHistoryRows asks,
-- and the day notes and reports of those dates. Nothing here needs the user's time zone; the app
-- cuts the month to the user's own after.
--
-- It runs as the user (security invoker), so their row level security applies to every read, as
-- it did to each request. It reads only.
--
-- Applied by hand in the SQL Editor. The app falls back to the old reads when the function is
-- missing, so it can be run before or after the deploy. It is one DO block, so it applies all or
-- nothing, and it is safe to run twice. "Success. No rows returned" means it worked; a wrong
-- state ends in an exception that says what is wrong.

do $$
begin
    create or replace function public.routines_page(p_start date, p_end date)
    returns jsonb
    language plpgsql
    stable
    security invoker
    set search_path = ''
    as $fn$
    declare
        v_user uuid := auth.uid();
    begin
        if v_user is null then
            raise exception 'not signed in';
        end if;
        if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 100 then
            raise exception 'p_start and p_end, at most 100 days apart, are needed';
        end if;

        return jsonb_build_object(
            'exercises', coalesce((
                select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'name_zh_tw', e.name_zh_tw, 'muscle_group', e.muscle_group,
                    'equipment', e.equipment) order by e.name)
                from public.exercises e), '[]'::jsonb),
            -- The exercises in the latest 300 sets, the latest first, each once, as recentExerciseIds
            'recent_ids', coalesce((
                select jsonb_agg(r.exercise_id order by r.first)
                from (
                    select s.exercise_id, min(s.n) as first
                    from (
                        select l.exercise_id, row_number() over () as n
                        from (select ws.exercise_id from public.workout_sets ws where ws.user_id = v_user order by ws.created_at desc limit 300) l) s
                    group by s.exercise_id) r), '[]'::jsonb),
            'routines', coalesce((
                select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'routine_exercises', coalesce((
                    select jsonb_agg(jsonb_build_object('id', re.id, 'exercise_id', re.exercise_id, 'order_index', re.order_index,
                        'target_sets', re.target_sets, 'target_reps', re.target_reps,
                        'exercises', (select jsonb_build_object('name', e.name, 'muscle_group', e.muscle_group) from public.exercises e where e.id = re.exercise_id))
                        order by re.order_index)
                    from public.routine_exercises re where re.routine_id = r.id), '[]'::jsonb)) order by r.created_at)
                from public.routines r where r.user_id = v_user), '[]'::jsonb),
            -- None unless there is exactly one, as maybeSingle
            'cycle', (
                select jsonb_build_object('id', c.id, 'cycle_length', c.cycle_length, 'start_date', c.start_date,
                    'cycle_days', coalesce((
                        select jsonb_agg(jsonb_build_object('day_index', d.day_index, 'routine_id', d.routine_id) order by d.day_index)
                        from public.cycle_days d where d.training_cycle_id = c.id), '[]'::jsonb),
                    'cycle_date_changes', coalesce((
                        select jsonb_agg(jsonb_build_object('change_date', x.change_date, 'routine_id', x.routine_id))
                        from public.cycle_date_changes x where x.training_cycle_id = c.id), '[]'::jsonb))
                from public.training_cycles c
                where c.user_id = v_user and (select count(*) from public.training_cycles o where o.user_id = v_user) = 1),
            'workouts', coalesce((
                select jsonb_agg(jsonb_build_object('id', w.id, 'performed_at', w.performed_at,
                    'routines', (select jsonb_build_object('name', r.name) from public.routines r where r.id = w.routine_id),
                    'workout_sets', coalesce((
                        select jsonb_agg(jsonb_build_object('exercise_id', s.exercise_id, 'set_number', s.set_number, 'created_at', s.created_at,
                            'reps', s.reps, 'weight_kg', s.weight_kg, 'duration_s', s.duration_s, 'speed_kmh', s.speed_kmh, 'incline_pct', s.incline_pct,
                            'level', s.level, 'distance_m', s.distance_m, 'assist_kg', s.assist_kg, 'avg_hr', s.avg_hr, 'input_unit', s.input_unit,
                            'exercises', (select jsonb_build_object('name', e.name, 'name_zh_tw', e.name_zh_tw, 'log_type', e.log_type) from public.exercises e where e.id = s.exercise_id)))
                        from public.workout_sets s where s.workout_id = w.id), '[]'::jsonb))
                    order by w.performed_at)
                from public.workouts w
                where w.user_id = v_user
                  and w.performed_at >= (p_start - 1)::timestamp at time zone 'UTC'
                  and w.performed_at <= ((p_end + 1) + time '23:59:59.999') at time zone 'UTC'), '[]'::jsonb),
            'notes', coalesce((
                select jsonb_agg(jsonb_build_object('note_date', n.note_date, 'note', n.note))
                from public.day_notes n where n.user_id = v_user and n.note_date >= p_start and n.note_date <= p_end), '[]'::jsonb),
            'reports', coalesce((
                select jsonb_agg(jsonb_build_object('period_start', r.period_start, 'status', r.status, 'queued_at', r.queued_at,
                    'trend', r.recommendation -> 'facts' ->> 'status') order by r.period_start)
                from public.period_reports r where r.user_id = v_user and r.period_start >= p_start and r.period_start <= p_end), '[]'::jsonb),
            -- The first workout with a set
            'first_trained_at', (
                select w.performed_at from public.workouts w
                where w.user_id = v_user and exists (select 1 from public.workout_sets s where s.workout_id = w.id)
                order by w.performed_at
                limit 1));
    end
    $fn$;
    revoke all on function public.routines_page(date, date) from public, anon;
    grant execute on function public.routines_page(date, date) to authenticated;

    if (select prosecdef from pg_proc where oid = 'public.routines_page(date, date)'::regprocedure) then
        raise exception 'routines_page must run as the user (security invoker), so their row level security applies';
    end if;
    if has_function_privilege('anon', 'public.routines_page(date, date)', 'execute') then
        raise exception 'anon can call routines_page';
    end if;
    if not has_function_privilege('authenticated', 'public.routines_page(date, date)', 'execute') then
        raise exception 'signed-in users cannot call routines_page';
    end if;
end $$;
