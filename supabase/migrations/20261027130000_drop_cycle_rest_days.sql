-- cycle_rest_days goes: cycle_date_changes (20261027120000) holds the days the user changed, rest
-- days included, and since #108 and its Lambda deploy nothing reads or writes the old table. Its
-- trigger, which copied an old page's rest days over, goes with it, and so does the trigger's
-- function.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
begin
    if to_regclass('public.cycle_date_changes') is null then
        raise exception 'cycle_date_changes is missing: run 20261027120000 first, or the rest days would be lost';
    end if;

    drop table if exists public.cycle_rest_days;
    drop function if exists public.cycle_rest_days_to_changes();

    -- ---------- Checks ----------
    if to_regclass('public.cycle_rest_days') is not null then
        raise exception 'cycle_rest_days is still there';
    end if;
    if exists (select 1 from pg_proc where proname = 'cycle_rest_days_to_changes' and pronamespace = 'public'::regnamespace) then
        raise exception 'the old trigger''s function is still there';
    end if;
end $$;
