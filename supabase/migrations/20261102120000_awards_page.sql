-- 紀錄's 成就 tab in one request: what lib/awards.ts needs to work out every medal from the log.
--
--   sets       every strength set (the log types of lib/report/progression.ts STRENGTH_LOG_TYPES)
--              that could be a best: a set another set of the same workout and exercise beats on
--              both weight (or, for an assisted lift, less assist) and reps is left out. The record
--              rule (lib/report/records.ts) orders sets by a value that grows with both, so such a
--              set is never a best, and the heaviest set and the most reps stay in. Each is
--              [exercise_id, performed_at, weight_kg, reps, assist_kg], oldest first, so the answer
--              grows with the days trained, not with every set. An assisted set logged before the
--              exercise had its log type has no assist; the rule skips it, so it is left out here too.
--   exercises  the log type and muscle group of every exercise in those sets
--   weeks      each weekly report's sessions planned and done, where the user had a cycle
--
-- It runs as the user (security invoker), so row level security applies to every read. It only
-- reads.
--
-- Applied by hand in the SQL Editor, before the deploy: the tab reads only this. It is one DO
-- block, so it applies all or nothing, and it is safe to run twice. "Success. No rows returned"
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
                select jsonb_agg(jsonb_build_array(s.exercise_id, w.performed_at, s.weight_kg, s.reps, s.assist_kg) order by w.performed_at, s.set_number)
                from public.workout_sets s
                join public.workouts w on w.id = s.workout_id
                join public.exercises e on e.id = s.exercise_id
                where s.user_id = v_user
                  and e.log_type in ('weight_reps', 'bodyweight', 'assisted')
                  and not (e.log_type = 'assisted' and s.assist_kg is null)
                  -- Beaten on both, or the same set logged again (the earlier id stays)
                  and not exists (
                      select 1 from public.workout_sets t
                      where t.workout_id = s.workout_id and t.exercise_id = s.exercise_id and t.id <> s.id
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
            'weeks', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'end', r.recommendation -> 'facts' -> 'period' ->> 'end',
                    'days', (r.recommendation -> 'facts' -> 'period' ->> 'days')::int,
                    'planned', (r.recommendation -> 'facts' -> 'sessions' ->> 'planned')::int,
                    'done', (r.recommendation -> 'facts' -> 'sessions' ->> 'done')::int) order by r.period_start)
                from public.period_reports r
                where r.user_id = v_user
                  and r.status in ('completed', 'insufficient_data')
                  and r.recommendation -> 'facts' -> 'sessions' ->> 'planned' is not null), '[]'::jsonb));
    end;
    $fn$;

    revoke all on function public.awards_page() from public, anon;
    grant execute on function public.awards_page() to authenticated;

    if to_regprocedure('public.awards_page()') is null then
        raise exception 'awards_page was not created';
    end if;
end $$;
