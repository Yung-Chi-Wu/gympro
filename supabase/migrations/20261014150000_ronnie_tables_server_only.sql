-- Ronnie's conversations and proposals become server-written only.
--   ronnie_conversations    users read and clear their own (the chat window, the clear
--                           button, the 30-day cleanup); the server writes them with the
--                           service role (append_ronnie_conversation_for, 20261014140000).
--                           append_ronnie_conversation, which users could call, is dropped.
--   ronnie_pending_actions  users read their own (a card's status); the server creates them
--                           with the service role, and only resolve_ronnie_action changes them.
-- Then what goes back to the model as trusted text, the day's history and the names in an app
-- event, is only ever what the server wrote.
--
-- Apply only once the app that writes them with the service role is live: the app before it
-- wrote both with the user's own client, which this refuses. It stops if 20261014140000 hasn't
-- been applied.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it
-- is safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
declare
    p record;
begin
    if to_regprocedure('public.append_ronnie_conversation_for(uuid, date, jsonb, jsonb)') is null then
        raise exception 'apply 20261014140000 (append_ronnie_conversation_for) first';
    end if;

    alter table public.ronnie_conversations enable row level security;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'ronnie_conversations' loop
        execute format('drop policy %I on public.ronnie_conversations', p.policyname);
    end loop;
    create policy "Users read their own Ronnie conversations" on public.ronnie_conversations
        for select to authenticated
        using ((select auth.uid()) = user_id);
    create policy "Users clear their own Ronnie conversations" on public.ronnie_conversations
        for delete to authenticated
        using ((select auth.uid()) = user_id);
    revoke insert, update, truncate on public.ronnie_conversations from authenticated;
    revoke all on public.ronnie_conversations from anon;
    drop function if exists public.append_ronnie_conversation(date, jsonb, jsonb);

    alter table public.ronnie_pending_actions enable row level security;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'ronnie_pending_actions' loop
        execute format('drop policy %I on public.ronnie_pending_actions', p.policyname);
    end loop;
    create policy "Users read their own Ronnie actions" on public.ronnie_pending_actions
        for select to authenticated
        using ((select auth.uid()) = user_id);
    revoke insert, update, delete, truncate on public.ronnie_pending_actions from authenticated;
    revoke all on public.ronnie_pending_actions from anon;

    if (select string_agg(cmd, ',' order by cmd) from pg_policies where schemaname = 'public' and tablename = 'ronnie_conversations') <> 'DELETE,SELECT' then
        raise exception 'ronnie_conversations should have only its select and delete policies';
    end if;
    if (select string_agg(cmd, ',' order by cmd) from pg_policies where schemaname = 'public' and tablename = 'ronnie_pending_actions') <> 'SELECT' then
        raise exception 'ronnie_pending_actions should have only its select policy';
    end if;
    if has_table_privilege('authenticated', 'public.ronnie_conversations', 'insert')
        or has_table_privilege('authenticated', 'public.ronnie_conversations', 'update')
        or has_any_column_privilege('authenticated', 'public.ronnie_conversations', 'insert')
        or has_any_column_privilege('authenticated', 'public.ronnie_conversations', 'update')
        or has_table_privilege('authenticated', 'public.ronnie_pending_actions', 'insert')
        or has_table_privilege('authenticated', 'public.ronnie_pending_actions', 'update')
        or has_table_privilege('authenticated', 'public.ronnie_pending_actions', 'delete')
        or has_any_column_privilege('authenticated', 'public.ronnie_pending_actions', 'insert')
        or has_any_column_privilege('authenticated', 'public.ronnie_pending_actions', 'update') then
        raise exception 'signed-in users can still write a Ronnie table';
    end if;
    if not has_table_privilege('authenticated', 'public.ronnie_conversations', 'select')
        or not has_table_privilege('authenticated', 'public.ronnie_conversations', 'delete')
        or not has_table_privilege('authenticated', 'public.ronnie_pending_actions', 'select') then
        raise exception 'signed-in users lost reading or clearing their own Ronnie data';
    end if;
    if has_table_privilege('anon', 'public.ronnie_conversations', 'select')
        or has_table_privilege('anon', 'public.ronnie_pending_actions', 'select') then
        raise exception 'anon can still read a Ronnie table';
    end if;
    if to_regprocedure('public.append_ronnie_conversation(date, jsonb, jsonb)') is not null then
        raise exception 'append_ronnie_conversation still exists';
    end if;
end $$;
