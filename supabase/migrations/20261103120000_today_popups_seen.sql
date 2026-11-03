-- What the user has seen of Today's popups (lib/today-overlay.ts).
--
-- Today opens at most one popup a visit: new medals the day after they are reached
-- (components/MedalCard.tsx), and each Monday a short recap of the week that just ended
-- (components/WeeklyRecap.tsx). Each is shown once per user, on any device:
--   awards_seen_date  the last day whose medals were checked: closing the medals keeps yesterday,
--                     and a check that found none keeps it too, so Today reads the log for medals
--                     at most once a day. Null for an account made since this column: every
--                     medal of theirs is new. Accounts made before start at the day this runs, as
--                     the medals they had were on 成就 already.
--   recap_seen_week   the period_start of the last week whose recap was seen; null before the first
-- The user writes them on their own row, as with their other settings (row level security).
--
-- Applied by hand in the SQL Editor, before the deploy: the app after it reads these columns with
-- the rest of the profile, and that read fails without them. It is one DO block, so it applies all
-- or nothing, and it is safe to run twice (the start day is set only when the column is added).
-- "Success. No rows returned" means it worked; a wrong state ends in an exception that says what
-- is wrong.

do $$
declare
    col text;
begin
    alter table public.user_profiles add column if not exists recap_seen_week date;
    if not exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'awards_seen_date') then
        alter table public.user_profiles add column awards_seen_date date;
        update public.user_profiles set awards_seen_date = current_date;
    end if;

    foreach col in array array['recap_seen_week', 'awards_seen_date'] loop
        if (select data_type from information_schema.columns
            where table_schema = 'public' and table_name = 'user_profiles' and column_name = col) is distinct from 'date' then
            raise exception 'user_profiles.% is missing or not a date', col;
        end if;
        if not has_column_privilege('authenticated', 'public.user_profiles', col, 'update') then
            raise exception 'a signed-in user cannot update user_profiles.%', col;
        end if;
    end loop;
end $$;
