-- Today in one request. The dashboard read its page in about 14 requests, in two rounds: what
-- needs only the user, then, once the profile and the cycle were in, what needs the user's day.
-- Each request costs Supabase's API layer 40-100 ms even for one row, so Today waited about 260 ms
-- for the database. today_page reads the same rows in one call and returns them as the requests
-- did, nested the same way, so the app builds the page with its own code
-- (lib/today-page.ts). The app works out the day again from the profile, and if any of the day's
-- values differ from these, it reads the page the old way and logs which one.
--
-- p_now is the instant the app works the day out from, so both agree on it at midnight.
-- p_report_windows is how many periods back today's aims read (REPORT_WINDOWS in
-- lib/report/progression.ts).
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
    -- A local date's first instant, as startOfLocalDay in lib/time-zone.ts: the zone's offset at a
    -- guess, then at the instant that gives. Where a clock change makes midnight happen twice, it
    -- is the first; where midnight is skipped, the day starts at the jump.
    create or replace function public.local_day_start(p_date date, p_zone text)
    returns timestamptz
    language sql
    stable
    set search_path = ''
    as $fn$
        with m as (select p_date::timestamp at time zone 'UTC' as midnight),
        f as (select midnight, midnight - ((midnight at time zone p_zone) - (midnight at time zone 'UTC')) as first from m),
        s as (select first, midnight - ((first at time zone p_zone) - (first at time zone 'UTC')) as second from f)
        select case when (second at time zone p_zone)::date = p_date then second else first end from s
    $fn$;

    -- What an exercise starts the day with, as exerciseHints in lib/today-workout.ts reads it: the
    -- sets before today (the last session is picked in the app), its own kg/lb, the sets today's
    -- aim works from, and, when asked, what the user's routines ask of it. The same rows, limits
    -- and order as those reads.
    create or replace function public.today_hints(p_ids uuid[], p_before timestamptz, p_recent_from timestamptz, p_targets boolean)
    returns jsonb
    language sql
    stable
    security invoker
    set search_path = ''
    as $fn$
        select jsonb_build_object(
            'previous', coalesce((
                select jsonb_agg(to_jsonb(x) - 'created_at' order by x.created_at desc) from (
                    select s.workout_id, s.exercise_id, s.set_number, s.reps, s.weight_kg, s.duration_s, s.speed_kmh, s.incline_pct, s.level,
                           s.distance_m, s.assist_kg, s.avg_hr, s.input_unit, s.created_at, jsonb_build_object('performed_at', w.performed_at) as workouts
                    from public.workout_sets s join public.workouts w on w.id = s.workout_id
                    where s.user_id = auth.uid() and s.exercise_id = any (p_ids) and w.performed_at < p_before
                    order by s.created_at desc
                    limit 500) x), '[]'::jsonb),
            'log_units', coalesce((
                select jsonb_agg(jsonb_build_object('exercise_id', u.exercise_id, 'unit', u.unit))
                from public.exercise_log_units u where u.user_id = auth.uid() and u.exercise_id = any (p_ids)), '[]'::jsonb),
            'recent', coalesce((
                select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
                    select s.workout_id, s.exercise_id, s.reps, s.weight_kg, s.assist_kg, s.created_at, jsonb_build_object('performed_at', w.performed_at) as workouts
                    from public.workout_sets s join public.workouts w on w.id = s.workout_id
                    where s.user_id = auth.uid() and s.exercise_id = any (p_ids) and w.performed_at >= p_recent_from and w.performed_at < p_before
                    order by s.created_at desc
                    limit 1000) x), '[]'::jsonb),
            'targets', case when p_targets then coalesce((
                select jsonb_agg(jsonb_build_object('exercise_id', re.exercise_id, 'target_sets', re.target_sets, 'target_reps', re.target_reps,
                    'routines', jsonb_build_object('created_at', r.created_at)))
                from public.routine_exercises re join public.routines r on r.id = re.routine_id
                where r.user_id = auth.uid() and re.exercise_id = any (p_ids) and re.target_sets is not null), '[]'::jsonb) end)
    $fn$;

    create or replace function public.today_page(p_now timestamptz, p_report_windows integer)
    returns jsonb
    language plpgsql
    stable
    security invoker
    set search_path = ''
    as $fn$
    declare
        v_user uuid := auth.uid();
        v_tz text;
        v_today date;
        v_day_start timestamptz;
        v_day_end timestamptz;
        v_period_start date;
        v_recent_from timestamptz;
        v_utc_today date;
        v_cycle public.training_cycles%rowtype;
        v_cycle_json jsonb;
        v_routine uuid;
        v_known uuid[];
        v_workout public.workouts%rowtype;
        v_workout_json jsonb;
        v_shown uuid[];
        v_more uuid[];
    begin
        if v_user is null then
            raise exception 'not signed in';
        end if;
        if p_now is null or p_report_windows is null or p_report_windows < 1 or p_report_windows > 52 then
            raise exception 'p_now and p_report_windows (1 to 52) are needed';
        end if;

        -- The zone, as timeZoneOf: the profile's, or UTC when it has none or one Postgres doesn't know
        select p.timezone into v_tz from public.user_profiles p where p.user_id = v_user;
        if v_tz is null or v_tz = '' then
            v_tz := 'UTC';
        else
            begin
                perform p_now at time zone v_tz;
            exception when others then
                v_tz := 'UTC';
            end;
        end if;

        -- The day, the week and where the aims' sets start, as the page works them out
        v_today := (p_now at time zone v_tz)::date;
        v_day_start := public.local_day_start(v_today, v_tz);
        v_day_end := public.local_day_start(v_today + 1, v_tz) - interval '1 millisecond';
        v_period_start := v_today - (extract(isodow from v_today)::int - 1);
        v_recent_from := public.local_day_start(v_period_start - 7 - (p_report_windows - 1) * 7, v_tz);
        -- Today in any zone is within a day of today in UTC: the changed days around it come with the cycle
        v_utc_today := (p_now at time zone 'UTC')::date;

        -- The cycle, with each routine's exercises; none unless there is exactly one, as maybeSingle
        if (select count(*) from public.training_cycles c where c.user_id = v_user) = 1 then
            select * into v_cycle from public.training_cycles c where c.user_id = v_user;
            v_cycle_json := jsonb_build_object(
                'id', v_cycle.id,
                'cycle_length', v_cycle.cycle_length,
                'start_date', v_cycle.start_date,
                'cycle_days', coalesce((
                    select jsonb_agg(jsonb_build_object('day_index', d.day_index, 'routine_id', d.routine_id, 'routines', (
                        select jsonb_build_object('name', r.name, 'routine_exercises', coalesce((
                            select jsonb_agg(jsonb_build_object('exercise_id', re.exercise_id)) from public.routine_exercises re where re.routine_id = r.id), '[]'::jsonb))
                        from public.routines r where r.id = d.routine_id)))
                    from public.cycle_days d where d.training_cycle_id = v_cycle.id), '[]'::jsonb),
                'cycle_date_changes', coalesce((
                    select jsonb_agg(jsonb_build_object('change_date', x.change_date, 'routine_id', x.routine_id, 'routines', (
                        select jsonb_build_object('name', r.name, 'routine_exercises', coalesce((
                            select jsonb_agg(jsonb_build_object('exercise_id', re.exercise_id)) from public.routine_exercises re where re.routine_id = r.id), '[]'::jsonb))
                        from public.routines r where r.id = x.routine_id)))
                    from public.cycle_date_changes x
                    where x.training_cycle_id = v_cycle.id and x.change_date between v_utc_today - 1 and v_utc_today + 1), '[]'::jsonb));

            -- The routine today trains, as plannedRoutineId: none before the cycle starts; a changed
            -- day's pick, which may be a rest day; else the cycle's day
            if v_today >= v_cycle.start_date then
                if exists (select 1 from public.cycle_date_changes x where x.training_cycle_id = v_cycle.id and x.change_date = v_today) then
                    select x.routine_id into v_routine from public.cycle_date_changes x where x.training_cycle_id = v_cycle.id and x.change_date = v_today;
                else
                    select d.routine_id into v_routine from public.cycle_days d
                    where d.training_cycle_id = v_cycle.id
                      and d.day_index = ((((v_today - v_cycle.start_date) % v_cycle.cycle_length) + v_cycle.cycle_length) % v_cycle.cycle_length) + 1;
                end if;
            end if;
        end if;

        -- Today's routine's exercises: last time's sets for them go out with today's workout
        select array_agg(distinct re.exercise_id) into v_known
        from public.routines r join public.routine_exercises re on re.routine_id = r.id
        where r.id = v_routine;
        v_known := coalesce(v_known, '{}');

        -- The latest workout started in today's range, as everything that reads today's workout picks it
        select * into v_workout from public.workouts w
        where w.user_id = v_user and w.performed_at >= v_day_start and w.performed_at <= v_day_end
        order by w.performed_at desc
        limit 1;

        if v_workout.id is not null then
            v_workout_json := jsonb_build_object(
                'id', v_workout.id,
                'routine_id', v_workout.routine_id,
                'workout_planned_exercises', coalesce((
                    select jsonb_agg(jsonb_build_object('id', p.id, 'exercise_id', p.exercise_id,
                        'exercises', (select to_jsonb(e) from (select x.name, x.name_zh_tw, x.muscle_group, x.log_type, x.per_side, x.equipment, x.primary_muscles from public.exercises x where x.id = p.exercise_id) e))
                        order by p.created_at, p.id)
                    from public.workout_planned_exercises p where p.workout_id = v_workout.id), '[]'::jsonb),
                'workout_sets', coalesce((
                    select jsonb_agg(jsonb_build_object('id', s.id, 'exercise_id', s.exercise_id, 'set_number', s.set_number, 'created_at', s.created_at,
                        'reps', s.reps, 'weight_kg', s.weight_kg, 'duration_s', s.duration_s, 'speed_kmh', s.speed_kmh, 'incline_pct', s.incline_pct,
                        'level', s.level, 'distance_m', s.distance_m, 'assist_kg', s.assist_kg, 'avg_hr', s.avg_hr, 'input_unit', s.input_unit,
                        'exercises', (select to_jsonb(e) from (select x.name, x.name_zh_tw, x.muscle_group, x.log_type, x.per_side, x.equipment, x.primary_muscles from public.exercises x where x.id = s.exercise_id) e))
                        order by s.set_number, s.created_at)
                    from public.workout_sets s where s.workout_id = v_workout.id), '[]'::jsonb),
                'routines', (
                    select jsonb_build_object('routine_exercises', coalesce((
                        select jsonb_agg(jsonb_build_object('exercise_id', re.exercise_id, 'target_sets', re.target_sets, 'target_reps', re.target_reps))
                        from public.routine_exercises re where re.routine_id = r.id), '[]'::jsonb))
                    from public.routines r where r.id = v_workout.routine_id));
        end if;

        -- The exercises the card shows: the workout's plan, then any logged off it; before there is a
        -- workout, today's routine. Those outside today's routine take a second set of hints
        if v_workout.id is not null then
            select array_agg(id order by ord) into v_shown from (
                select p.exercise_id as id, min(p.ord) as ord from (
                    select p.exercise_id, row_number() over (order by p.created_at, p.id) as ord
                    from public.workout_planned_exercises p where p.workout_id = v_workout.id
                    union all
                    select s.exercise_id, 1000000 + row_number() over (order by s.set_number, s.created_at)
                    from public.workout_sets s where s.workout_id = v_workout.id
                ) p group by p.exercise_id) x;
        else
            select array_agg(re.exercise_id order by re.order_index) into v_shown
            from public.routine_exercises re where re.routine_id = v_routine;
        end if;
        select array_agg(id order by ord) into v_more from (
            select t.id, min(t.ord) as ord from unnest(coalesce(v_shown, '{}'::uuid[])) with ordinality as t (id, ord)
            where not (t.id = any (v_known)) group by t.id) x;
        v_more := coalesce(v_more, '{}');

        return jsonb_build_object(
            'tz', v_tz,
            'today', v_today,
            'day_start', v_day_start,
            'day_end', v_day_end,
            'period_start', v_period_start,
            'recent_from', v_recent_from,
            'routine_id', v_routine,
            'cycle', v_cycle_json,
            'known', to_jsonb(v_known),
            'more_ids', to_jsonb(v_more),
            'period_note', (select n.note from public.period_notes n where n.user_id = v_user and n.period_start = v_period_start),
            'day_note', (select n.note from public.day_notes n where n.user_id = v_user and n.note_date = v_today),
            'today_weight', (select b.weight_kg from public.body_metrics b
                where b.user_id = v_user and b.recorded_at >= v_day_start and b.recorded_at <= v_day_end and b.weight_kg is not null
                order by b.recorded_at desc limit 1),
            'last_weight', (select b.weight_kg from public.body_metrics b
                where b.user_id = v_user and b.recorded_at < v_day_start and b.weight_kg is not null
                order by b.recorded_at desc limit 1),
            'workout', v_workout_json,
            'routine_exercises', coalesce((
                select jsonb_agg(jsonb_build_object('exercise_id', re.exercise_id, 'target_sets', re.target_sets, 'target_reps', re.target_reps,
                    'exercises', (select to_jsonb(e) from (select x.name, x.name_zh_tw, x.muscle_group, x.log_type, x.per_side, x.equipment, x.primary_muscles from public.exercises x where x.id = re.exercise_id) e))
                    order by re.order_index)
                from public.routine_exercises re where re.routine_id = v_routine), '[]'::jsonb),
            'early', case when cardinality(v_known) > 0 then public.today_hints(v_known, v_day_start, v_recent_from, false) end,
            'more', case when cardinality(v_more) > 0 then public.today_hints(v_more, v_day_start, v_recent_from, true) end,
            'library', coalesce((
                select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'name_zh_tw', e.name_zh_tw, 'muscle_group', e.muscle_group,
                    'equipment', e.equipment, 'log_type', e.log_type, 'per_side', e.per_side) order by e.name)
                from public.exercises e), '[]'::jsonb),
            'recent_ids', coalesce((
                select jsonb_agg(s.exercise_id order by s.created_at desc)
                from (select ws.exercise_id, ws.created_at from public.workout_sets ws where ws.user_id = v_user order by ws.created_at desc limit 300) s), '[]'::jsonb),
            'latest_report', (
                select jsonb_build_object('status', r.status, 'recommendation', r.recommendation, 'period_start', r.period_start, 'queued_at', r.queued_at)
                from public.period_reports r
                where r.user_id = v_user
                  and (r.status <> 'insufficient_data' or r.recommendation is null or r.recommendation -> 'facts' -> 'sessions' ->> 'done' <> '0')
                order by r.created_at desc
                limit 1));
    end
    $fn$;
    revoke all on function public.local_day_start(date, text) from public, anon;
    revoke all on function public.today_hints(uuid[], timestamptz, timestamptz, boolean) from public, anon;
    revoke all on function public.today_page(timestamptz, integer) from public, anon;
    grant execute on function public.local_day_start(date, text) to authenticated;
    grant execute on function public.today_hints(uuid[], timestamptz, timestamptz, boolean) to authenticated;
    grant execute on function public.today_page(timestamptz, integer) to authenticated;

    if (select bool_or(prosecdef) from pg_proc where oid in ('public.today_hints(uuid[], timestamptz, timestamptz, boolean)'::regprocedure, 'public.today_page(timestamptz, integer)'::regprocedure)) then
        raise exception 'today_page and today_hints must run as the user (security invoker), so their row level security applies';
    end if;
    if has_function_privilege('anon', 'public.today_page(timestamptz, integer)', 'execute') or has_function_privilege('anon', 'public.today_hints(uuid[], timestamptz, timestamptz, boolean)', 'execute') then
        raise exception 'anon can call today_page or today_hints';
    end if;
    if not has_function_privilege('authenticated', 'public.today_page(timestamptz, integer)', 'execute') then
        raise exception 'signed-in users cannot call today_page';
    end if;
    -- The midnight rule: New York's day the clocks go back starts at 04:00 UTC and lasts 25 hours
    if public.local_day_start('2026-11-01', 'America/New_York') <> timestamptz '2026-11-01 04:00:00+00'
       or public.local_day_start('2026-11-02', 'America/New_York') <> timestamptz '2026-11-02 05:00:00+00' then
        raise exception 'local_day_start does not give New York''s days around the clock change';
    end if;
end $$;
