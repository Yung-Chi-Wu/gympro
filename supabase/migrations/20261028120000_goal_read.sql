-- The goal as read, kept with the goal (lib/report/goal-reader.ts).
--
-- A goal was read only by the first report after it, so a goal the reader couldn't make out was
-- seen a week later. Now the app reads it when it is saved (app/api/ai/goal), shows the read under
-- the goal in Settings, and keeps it here; the report reuses it while the text is the same, and
-- keeps here a read it made itself. Only the service role writes it: a signed-in user's own write
-- leaves it as it was (a trigger, like user_profiles_keep_created_at), so what the report
-- tracks is what the reader read. Each user's latest report's read is copied in when it read the
-- goal as it is now, so those users see it in Settings at once.
--   training_goal_read   GoalRead as JSON: { text, kinds, targets, unread, model }
-- ai_traces takes feature goal: the read at save is a request of the user's, under their spend limit.
--
-- Applied by hand in the SQL Editor, before the app that reads it. It is one DO block, so it
-- applies all or nothing, and it is safe to run twice. "Success. No rows returned" means it
-- worked; a wrong state ends in an exception that says what is wrong.

do $$
begin
    alter table public.user_profiles add column if not exists training_goal_read jsonb;
    alter table public.user_profiles drop constraint if exists user_profiles_training_goal_read_size;
    alter table public.user_profiles add constraint user_profiles_training_goal_read_size
        check (octet_length(training_goal_read::text) <= 16384);

    -- ---------- Only the service role writes the read ----------
    execute $fn$
        create or replace function public.user_profiles_keep_goal_read()
        returns trigger
        language plpgsql
        security invoker
        set search_path = ''
        as $body$
        begin
            -- Only a signed-in user's own write: the SQL Editor and the service role may still set it
            if current_user = 'authenticated' then
                new.training_goal_read := case when tg_op = 'INSERT' then null else old.training_goal_read end;
            end if;
            return new;
        end
        $body$
    $fn$;
    revoke all on function public.user_profiles_keep_goal_read() from public, anon, authenticated;
    drop trigger if exists user_profiles_keep_goal_read on public.user_profiles;
    create trigger user_profiles_keep_goal_read before insert or update on public.user_profiles
        for each row execute function public.user_profiles_keep_goal_read();

    -- ---------- The latest report's read, where it read the goal as it is now ----------
    update public.user_profiles p set training_goal_read = r.recommendation -> 'facts' -> 'goal' -> 'read'
    from (
        select distinct on (user_id) user_id, recommendation from public.period_reports
        where status = 'completed' and recommendation ->> 'version' = '3'
        order by user_id, period_start desc
    ) r
    where r.user_id = p.user_id and p.training_goal_read is null
        and jsonb_typeof(r.recommendation -> 'facts' -> 'goal' -> 'read') = 'object'
        and r.recommendation -> 'facts' -> 'goal' -> 'read' ->> 'model' is not null
        and r.recommendation -> 'facts' -> 'goal' -> 'read' ->> 'text' = btrim(p.training_goal, E' \t\r\n');

    -- The check from 20261021120000, with goal added
    alter table public.ai_traces drop constraint if exists ai_traces_feature_check;
    alter table public.ai_traces add constraint ai_traces_feature_check
        check (feature in ('ronnie', 'coach_chat', 'coach_routine', 'report', 'audit', 'goal'));

    -- ---------- Checks ----------
    if (select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'training_goal_read') is distinct from 'jsonb' then
        raise exception 'user_profiles.training_goal_read is missing or not jsonb';
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.user_profiles'::regclass and conname = 'user_profiles_training_goal_read_size') then
        raise exception 'user_profiles.training_goal_read has no size limit';
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = 'public.user_profiles'::regclass and tgname = 'user_profiles_keep_goal_read' and not tgisinternal) then
        raise exception 'the trigger that keeps user_profiles.training_goal_read is missing';
    end if;
    if has_function_privilege('authenticated', 'public.user_profiles_keep_goal_read()', 'execute') then
        raise exception 'a signed-in user can run user_profiles_keep_goal_read()';
    end if;
    if exists (select 1 from public.user_profiles where training_goal_read is not null and jsonb_typeof(training_goal_read) <> 'object') then
        raise exception 'a training_goal_read is not an object';
    end if;
    if exists (
        select 1 from pg_constraint
        where conrelid = 'public.ai_traces'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%feature%' and pg_get_constraintdef(oid) not like '%''goal''%'
    ) then
        raise exception 'a check on ai_traces.feature still leaves out goal';
    end if;
end $$;
