-- Text limits, a server-only way to write Ronnie's conversation, and function cleanup. Applied
-- before the app that uses append_ronnie_conversation_for; 20261014150000, once it is live,
-- takes away users' own writes to Ronnie's tables.
--
-- Users could write their own Ronnie conversation (an ALL policy, and append_ronnie_conversation)
-- and their own proposals (an INSERT policy). Both go back to the model as trusted text: the
-- history on every turn, and a proposal's names as an app event once its card is tapped. So a
-- user could store any amount of text, or text shaped like tool results, past the 2000-character
-- message limit. The profile and routine names, which go into every prompt, had no limit at all.
--
--   limits    display name at most 50 characters, training goal 500, a routine's name 1 to 60
--             (lib/text-limits.ts), a stored proposal 8 KB
--   append_ronnie_conversation_for(user, date, messages, display)
--             appends to a day's conversation like append_ronnie_conversation, for the user the
--             server names; only the service role may call it
--   functions get_period_training_summary is dropped (nothing calls it); resolve_ronnie_action
--             searches pg_temp last; anon can no longer call the Ronnie functions (Supabase grants
--             new functions to anon directly, which revoking from public didn't remove)
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it
-- is safe to run twice. It changes no rows: a row already outside a new limit stops it with an
-- exception that says how many. "Success. No rows returned" means it worked.

do $$
declare
    v_bad bigint;
begin
    select count(*) into v_bad from public.user_profiles where char_length(display_name) > 50;
    if v_bad > 0 then
        raise exception 'user_profiles: % display name(s) are over 50 characters; nothing was changed', v_bad;
    end if;
    select count(*) into v_bad from public.user_profiles where char_length(training_goal) > 500;
    if v_bad > 0 then
        raise exception 'user_profiles: % training goal(s) are over 500 characters; nothing was changed', v_bad;
    end if;
    select count(*) into v_bad from public.routines where char_length(name) not between 1 and 60;
    if v_bad > 0 then
        raise exception 'routines: % name(s) are empty or over 60 characters; nothing was changed', v_bad;
    end if;
    select count(*) into v_bad from public.ronnie_pending_actions where octet_length(action::text) > 8192;
    if v_bad > 0 then
        raise exception 'ronnie_pending_actions: % proposal(s) are over 8 KB; nothing was changed', v_bad;
    end if;

    alter table public.user_profiles drop constraint if exists user_profiles_display_name_length;
    alter table public.user_profiles add constraint user_profiles_display_name_length
        check (char_length(display_name) <= 50);
    alter table public.user_profiles drop constraint if exists user_profiles_training_goal_length;
    alter table public.user_profiles add constraint user_profiles_training_goal_length
        check (char_length(training_goal) <= 500);
    alter table public.routines drop constraint if exists routines_name_length;
    alter table public.routines add constraint routines_name_length
        check (char_length(name) between 1 and 60);
    alter table public.ronnie_pending_actions drop constraint if exists ronnie_pending_actions_action_size;
    alter table public.ronnie_pending_actions add constraint ronnie_pending_actions_action_size
        check (octet_length(action::text) <= 8192);

    create or replace function public.append_ronnie_conversation_for(p_user_id uuid, p_date date, p_messages jsonb, p_display jsonb)
    returns void
    language sql
    security invoker
    set search_path = ''
    as $fn$
        insert into public.ronnie_conversations (user_id, conversation_date, messages, display)
        values (p_user_id, p_date, p_messages, p_display)
        on conflict (user_id, conversation_date) do update
            set messages = public.ronnie_conversations.messages || excluded.messages,
                display = public.ronnie_conversations.display || excluded.display,
                updated_at = now();
    $fn$;
    revoke all on function public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb) from public, anon, authenticated;
    grant execute on function public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb) to service_role;

    drop function if exists public.get_period_training_summary(uuid, date, date);
    alter function public.resolve_ronnie_action(uuid, text) set search_path = public, pg_temp;
    revoke all on function public.resolve_ronnie_action(uuid, text) from public, anon;
    revoke all on function public.append_ronnie_conversation(date, jsonb, jsonb) from public, anon;
    revoke all on function public.match_exercises(extensions.vector, integer, text) from public, anon;
    grant execute on function public.resolve_ronnie_action(uuid, text) to authenticated;
    grant execute on function public.match_exercises(extensions.vector, integer, text) to authenticated;
    -- Still granted until 20261014150000: the app live before this change appends with it
    grant execute on function public.append_ronnie_conversation(date, jsonb, jsonb) to authenticated;

    if (select count(*) from pg_constraint where conname in ('user_profiles_display_name_length',
            'user_profiles_training_goal_length', 'routines_name_length', 'ronnie_pending_actions_action_size')) <> 4 then
        raise exception 'a text or size limit is missing';
    end if;
    if has_function_privilege('authenticated', 'public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb)', 'execute')
        or has_function_privilege('anon', 'public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb)', 'execute')
        or not has_function_privilege('service_role', 'public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb)', 'execute') then
        raise exception 'append_ronnie_conversation_for must be callable by the service role only';
    end if;
    if to_regprocedure('public.get_period_training_summary(uuid, date, date)') is not null then
        raise exception 'get_period_training_summary still exists';
    end if;
    if not (select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.resolve_ronnie_action(uuid, text)'::regprocedure) then
        raise exception 'resolve_ronnie_action should search public, then pg_temp';
    end if;
    if has_function_privilege('anon', 'public.resolve_ronnie_action(uuid, text)', 'execute')
        or has_function_privilege('anon', 'public.append_ronnie_conversation(date, jsonb, jsonb)', 'execute')
        or has_function_privilege('anon', 'public.match_exercises(extensions.vector, integer, text)', 'execute') then
        raise exception 'anon can still call a Ronnie function';
    end if;
    if not has_function_privilege('authenticated', 'public.resolve_ronnie_action(uuid, text)', 'execute')
        or not has_function_privilege('authenticated', 'public.match_exercises(extensions.vector, integer, text)', 'execute') then
        raise exception 'signed-in users lost a Ronnie function the app uses';
    end if;
end $$;
