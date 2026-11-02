-- awards_page (migration 20261102120000) gives what the awards changed to need:
--
--   sets       as before, each with the unit it was typed in (input_unit, null before
--              20261010140000) as its sixth item, so a lift's mark counts in the unit the set was
--              typed in and switching units never takes a medal away. A set is left out only for
--              one of the same unit that beats it.
--   exercises  as before
--   workouts   when each workout with a set was, oldest first: training days and training weeks
--              are counted from them, cardio included
--
-- The weekly reports' sessions ("weeks") are no longer read: training weeks count days trained,
-- not the cycle's plan.
--
-- It runs as the user (security invoker), so row level security applies to every read. It only
-- reads.
--
-- Applied by hand in the SQL Editor, after the deploy: the app before it reads "weeks", which this no
-- longer returns, while the app after it reads either shape (until this is run it counts no
-- training days, and judges each set in either unit). It is one DO block, so it applies all or
-- nothing, and it is safe to run twice. "Success. No rows returned"
-- means it worked; a wrong state ends in an exception that says what is wrong.

do $$
begin
    create or replace function public.awards_page()
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

        return jsonb_build_object(
            'sets', coalesce((
                select jsonb_agg(jsonb_build_array(s.exercise_id, w.performed_at, s.weight_kg, s.reps, s.assist_kg, s.input_unit) order by w.performed_at, s.set_number)
                from public.workout_sets s
                join public.workouts w on w.id = s.workout_id
                join public.exercises e on e.id = s.exercise_id
                where s.user_id = v_user
                  and e.log_type in ('weight_reps', 'bodyweight', 'assisted')
                  and not (e.log_type = 'assisted' and s.assist_kg is null)
                  -- Beaten on both by a set of the same unit, or the same set logged again (the earlier id stays)
                  and not exists (
                      select 1 from public.workout_sets t
                      where t.workout_id = s.workout_id and t.exercise_id = s.exercise_id and t.id <> s.id
                        and t.input_unit is not distinct from s.input_unit
                        and not (e.log_type = 'assisted' and t.assist_kg is null)
                        and t.reps >= s.reps
                        and (case when e.log_type = 'assisted' then -t.assist_kg else t.weight_kg end)
                            >= (case when e.log_type = 'assisted' then -s.assist_kg else s.weight_kg end)
                        and (t.reps > s.reps
                            or (case when e.log_type = 'assisted' then -t.assist_kg else t.weight_kg end)
                               > (case when e.log_type = 'assisted' then -s.assist_kg else s.weight_kg end)
                            or t.id < s.id))), '[]'::jsonb),
            'exercises', coalesce((
                select jsonb_agg(jsonb_build_object('id', e.id, 'log_type', e.log_type, 'muscle_group', e.muscle_group))
                from public.exercises e
                where e.id in (select s.exercise_id from public.workout_sets s where s.user_id = v_user)), '[]'::jsonb),
            'workouts', coalesce((
                select jsonb_agg(w.performed_at order by w.performed_at)
                from public.workouts w
                where w.user_id = v_user and exists (select 1 from public.workout_sets s where s.workout_id = w.id)), '[]'::jsonb));
    end;
    $fn$;

    revoke all on function public.awards_page() from public, anon;
    grant execute on function public.awards_page() to authenticated;

    if to_regprocedure('public.awards_page()') is null then
        raise exception 'awards_page was not created';
    end if;
end $$;
