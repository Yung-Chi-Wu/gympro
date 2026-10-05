-- workout_sets.is_warmup was dropped on 2026-08-21 when the warm-up feature
-- was removed, but this function still filtered on it. plpgsql bodies aren't
-- dependency-checked, so the drop succeeded and every report failed at runtime
-- with "column ws.is_warmup does not exist".
--
-- This is the first database function tracked in the repo; the rest of the
-- schema still lives only in Supabase. Applied by hand in the SQL Editor.

CREATE OR REPLACE FUNCTION public.get_period_training_summary(p_user_id uuid, p_period_start date, p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
begin
  return (
    with

    sets_in_range as (
      select
        ws.reps,
        ws.weight_kg,
        (ws.reps * ws.weight_kg) as tonnage_kg,
        ex.muscle_group,
        w.performed_at::date as performed_date
      from public.workout_sets ws
      join public.workouts w on w.id = ws.workout_id
      join public.exercises ex on ex.id = ws.exercise_id
      where ws.user_id = p_user_id
        and w.performed_at::date between p_period_start and p_period_end
    ),

    muscle_group_breakdown as (
      select
        muscle_group,
        count(*) as sets,
        sum(tonnage_kg) as tonnage_kg
      from sets_in_range
      group by muscle_group
    ),

    latest_weight as (
      select weight_kg, recorded_at
      from public.body_metrics
      where user_id = p_user_id
        and recorded_at::date <= p_period_end
        and weight_kg is not null
      order by recorded_at desc
      limit 1
    ),

    profile as (
      select height_cm
      from public.user_profiles
      where user_id = p_user_id
    )

    select jsonb_build_object(
      'userContext', jsonb_build_object(
        'heightCm', (select height_cm from profile),
        'latestWeightKg', (select weight_kg from latest_weight),
        'weightRecordedAt', (select recorded_at from latest_weight),
        'ageYears', null,
        'sex', null,
        'bmi', null
      ),
      'targetPeriod', jsonb_build_object(
        'periodStart', p_period_start,
        'periodEnd', p_period_end,
        'totalSets', (select count(*) from sets_in_range),
        'totalTonnageKg', coalesce((select sum(tonnage_kg) from sets_in_range), 0),
        'tonnagePerBodyweightKg', case
          when (select weight_kg from latest_weight) > 0
          then round(
            coalesce((select sum(tonnage_kg) from sets_in_range), 0)
            / (select weight_kg from latest_weight), 1
          )
          else null
        end,
        'byMuscleGroup', (
          select coalesce(jsonb_object_agg(
            muscle_group,
            jsonb_build_object('sets', sets, 'tonnageKg', tonnage_kg)
          ), '{}'::jsonb)
          from muscle_group_breakdown
        )
      )
    )
  );
end;
$function$;
