-- The newest entry of 最近更新 the user has seen (lib/releases.ts, components/WhatsNew.tsx).
--
-- After a big update, Today opens what it brought, once (lib/today-overlay.ts): closing it keeps
-- the entry's date here, so it is shown once per user, on any device.
--   release_seen  the date of the newest entry seen; null before the first. An account made on or
--                 after an entry's date never sees it (user_profiles.created_at).
-- The user writes it on their own row, as with their other settings (row level security).
--
-- Applied by hand in the SQL Editor, before the deploy: the app after it reads this column with the
-- rest of the profile, and that read fails without it. It is one DO block, so it applies all or
-- nothing, and it is safe to run twice. "Success. No rows returned" means it worked; a wrong state
-- ends in an exception that says what is wrong.

do $$
begin
    alter table public.user_profiles add column if not exists release_seen date;

    if (select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'release_seen') is distinct from 'date' then
        raise exception 'user_profiles.release_seen is missing or not a date';
    end if;
    if not has_column_privilege('authenticated', 'public.user_profiles', 'release_seen', 'update') then
        raise exception 'a signed-in user cannot update user_profiles.release_seen';
    end if;
end $$;
