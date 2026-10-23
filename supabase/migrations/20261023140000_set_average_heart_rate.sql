-- A cardio set's average heart rate, in beats per minute, typed from a watch or the machine.
-- Optional: the app leaves it null when the field is empty (lib/set-log.ts OPTIONAL_FIELDS), and
-- the weekly report rates a set's intensity from it only when it is there. The range matches
-- MIN_AVG_HR and STORED_MAX.avgHr in lib/set-log.ts (scripts/check-limits.ts compares them).
--
-- Applied by hand in the SQL Editor before the app that reads it is deployed. One DO block, so it
-- applies all or nothing, and it is safe to run twice.

do $$
begin
    alter table public.workout_sets add column if not exists avg_hr smallint;

    alter table public.workout_sets drop constraint if exists workout_sets_avg_hr_range;
    alter table public.workout_sets add constraint workout_sets_avg_hr_range
        check (avg_hr is null or avg_hr between 30 and 250);

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'workout_sets' and column_name = 'avg_hr'
    ) then
        raise exception 'workout_sets.avg_hr is missing after the migration';
    end if;
end
$$;
