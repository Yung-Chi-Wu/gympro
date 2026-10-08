-- Phase B of Ronnie: routine changes become proposals the user confirms, and the
-- conversation is kept on the server. Applied by hand in the SQL Editor.

-- ---------------------------------------------------------------------------
-- Proposals. Ronnie writes one; nothing changes until the user confirms it in
-- the app (a removal asks twice, in the UI). resolve_ronnie_action applies it.
-- action is one of:
--   { change: 'remove_exercise', exerciseId, exerciseName, routineIds, routineNames }
--   { change: 'add_exercise', exerciseId, exerciseName, routineIds, routineNames, targetSets, targetReps }
create table if not exists public.ronnie_pending_actions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    action jsonb not null,
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    resolved_at timestamptz
);

create index if not exists ronnie_pending_actions_user_created_idx
    on public.ronnie_pending_actions (user_id, created_at desc);

alter table public.ronnie_pending_actions enable row level security;

-- Users read and create their own proposals. No update or delete policy: only
-- resolve_ronnie_action changes a proposal, so a client can't mark one confirmed
-- without the change being applied.
create policy "Users read their own Ronnie actions"
    on public.ronnie_pending_actions
    for select
    using (auth.uid() = user_id);

create policy "Users create their own pending Ronnie actions"
    on public.ronnie_pending_actions
    for insert
    with check (auth.uid() = user_id and status = 'pending' and resolved_at is null);

-- Confirms or cancels one proposal and, on confirm, applies it - all in one
-- transaction, and only once (the row is locked, and only a pending, unexpired
-- proposal is applied). Whatever the stored action says, it only touches
-- routines the caller owns and exercises the caller can see.
-- Returns { status } plus, on confirm, the rows removed or added, for the
-- event Ronnie reads afterwards ("removed from 腿日, was 3 x 10, 4th").
create or replace function public.resolve_ronnie_action(p_action_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_row public.ronnie_pending_actions;
    v_exercise uuid;
    v_routines uuid[];
    v_rows jsonb;
begin
    if p_decision not in ('confirm', 'cancel') then
        raise exception 'p_decision must be confirm or cancel';
    end if;

    select * into v_row
    from ronnie_pending_actions
    where id = p_action_id and user_id = auth.uid()
    for update;

    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;
    if v_row.status <> 'pending' then
        return jsonb_build_object('status', v_row.status, 'already_resolved', true);
    end if;
    if v_row.expires_at < now() then
        return jsonb_build_object('status', 'expired');
    end if;

    if p_decision = 'cancel' then
        update ronnie_pending_actions set status = 'cancelled', resolved_at = now() where id = v_row.id;
        return jsonb_build_object('status', 'cancelled');
    end if;

    v_exercise := (v_row.action ->> 'exerciseId')::uuid;
    if not exists (
        select 1 from exercises e
        where e.id = v_exercise and (e.created_by is null or e.created_by = auth.uid())
    ) then
        return jsonb_build_object('status', 'invalid', 'reason', 'unknown exercise');
    end if;

    select coalesce(array_agg(r.id), '{}') into v_routines
    from routines r
    where r.user_id = auth.uid()
      and r.id in (select jsonb_array_elements_text(v_row.action -> 'routineIds')::uuid);

    if v_row.action ->> 'change' = 'remove_exercise' then
        with removed as (
            delete from routine_exercises re
            where re.routine_id = any (v_routines) and re.exercise_id = v_exercise
            returning re.routine_id, re.target_sets, re.target_reps, re.order_index
        )
        select coalesce(jsonb_agg(jsonb_build_object(
            'routineName', r.name, 'targetSets', x.target_sets, 'targetReps', x.target_reps, 'position', x.order_index + 1
        )), '[]'::jsonb) into v_rows
        from removed x join routines r on r.id = x.routine_id;

        update ronnie_pending_actions set status = 'confirmed', resolved_at = now() where id = v_row.id;
        return jsonb_build_object('status', 'confirmed', 'removed', v_rows);

    elsif v_row.action ->> 'change' = 'add_exercise' then
        -- At the end of each routine; a routine that already has it is skipped
        with added as (
            insert into routine_exercises (routine_id, exercise_id, target_sets, target_reps, order_index)
            select rid, v_exercise,
                   nullif(v_row.action ->> 'targetSets', '')::int,
                   nullif(v_row.action ->> 'targetReps', '')::int,
                   coalesce((select max(re.order_index) + 1 from routine_exercises re where re.routine_id = rid), 0)
            from unnest(v_routines) as rid
            where not exists (select 1 from routine_exercises re where re.routine_id = rid and re.exercise_id = v_exercise)
            returning routine_id, target_sets, target_reps, order_index
        )
        select coalesce(jsonb_agg(jsonb_build_object(
            'routineName', r.name, 'targetSets', x.target_sets, 'targetReps', x.target_reps, 'position', x.order_index + 1
        )), '[]'::jsonb) into v_rows
        from added x join routines r on r.id = x.routine_id;

        update ronnie_pending_actions set status = 'confirmed', resolved_at = now() where id = v_row.id;
        return jsonb_build_object('status', 'confirmed', 'added', v_rows);
    end if;

    return jsonb_build_object('status', 'invalid', 'reason', 'unknown change');
end;
$function$;

revoke all on function public.resolve_ronnie_action(uuid, text) from public;
grant execute on function public.resolve_ronnie_action(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- One conversation per user per local day. messages is what the model sees
-- (tool calls and results included, so an ID looked up earlier stays usable);
-- display is what the chat window shows (bubbles, cards, app events).
-- The coach route deletes a user's conversations older than 30 days.
create table if not exists public.ronnie_conversations (
    user_id uuid not null references auth.users (id) on delete cascade,
    conversation_date date not null,
    messages jsonb not null default '[]'::jsonb,
    display jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (user_id, conversation_date)
);

alter table public.ronnie_conversations enable row level security;

create policy "Users manage their own Ronnie conversations"
    on public.ronnie_conversations
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Appends to a day's conversation in one statement, so an app event written by
-- the confirm API while Ronnie is answering is not overwritten by the reply.
create or replace function public.append_ronnie_conversation(p_date date, p_messages jsonb, p_display jsonb)
returns void
language sql
security invoker
set search_path = public
as $function$
    insert into ronnie_conversations (user_id, conversation_date, messages, display)
    values (auth.uid(), p_date, p_messages, p_display)
    on conflict (user_id, conversation_date) do update
        set messages = ronnie_conversations.messages || excluded.messages,
            display = ronnie_conversations.display || excluded.display,
            updated_at = now();
$function$;

revoke all on function public.append_ronnie_conversation(date, jsonb, jsonb) from public;
grant execute on function public.append_ronnie_conversation(date, jsonb, jsonb) to authenticated;
