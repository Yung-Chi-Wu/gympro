-- The week whose recap the user has seen (components/WeeklyRecap.tsx).
--
-- Each Monday, Today opens a short recap of the week that just ended, once: closing it keeps the
-- week's first day here, so the recap is shown once per user, on any device, and never a week late.
--   recap_seen_week   the period_start of the last week whose recap was seen; null before the first
-- The user writes it on their own row, as with their other settings (row level security).
--
-- Applied by hand in the SQL Editor, before the deploy: the app after it reads this column with the
-- rest of the profile, and that read fails without it. It is one DO block, so it applies all or
-- nothing, and it is safe to run twice. "Success. No rows returned" means it worked; a wrong state
-- ends in an exception that says what is wrong.

do $$
begin
    alter table public.user_profiles add column if not exists recap_seen_week date;

    if (select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'recap_seen_week') is distinct from 'date' then
        raise exception 'user_profiles.recap_seen_week is missing or not a date';
    end if;
    if not has_column_privilege('authenticated', 'public.user_profiles', 'recap_seen_week', 'update') then
        raise exception 'a signed-in user cannot update user_profiles.recap_seen_week';
    end if;
end $$;
