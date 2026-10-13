-- What Ronnie remembers about a user across conversations (lib/ronnie/memory.ts): lasting facts
-- the user said, one row per slot, so the count stays bounded without the user managing it:
--   injury     one per body part (subject: shoulder, elbow, lower_back, knee, wrist, hip, ankle,
--              neck); active, or resolved once it's better (kept, not deleted)
--   exercise   one per exercise (subject: its id); like or dislike
--   equipment  one (no subject): what they train with
--   schedule   one (no subject): when and how long they can train
--   other      anything else lasting (subject: the note's own id), at most 30, which the app
--              keeps to by having a new fact folded into an old note
-- Saving a slot again replaces its row, through the unique key (nulls not distinct, so equipment
-- and schedule are one each too): the code decides what replaces what, not the model.
-- Backend-only, like ai_traces: row level security on and no policy, so users can neither read
-- nor write notes directly. The server reads and writes them with the service role, always for
-- the signed-in user (lib/ronnie/data.ts). A deleted account takes its notes with it.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
begin
    if current_setting('server_version_num')::int < 150000 then
        raise exception 'ronnie_memories needs Postgres 15 or later (unique nulls not distinct)';
    end if;

    create table if not exists public.ronnie_memories (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references auth.users (id) on delete cascade,
        kind text not null check (kind in ('injury', 'exercise', 'equipment', 'schedule', 'other')),
        subject text,
        state text not null,
        note text not null check (char_length(note) between 1 and 200),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint ronnie_memories_slot unique nulls not distinct (user_id, kind, subject),
        constraint ronnie_memories_subject check (
            case kind
                when 'injury' then subject is not null and subject in ('shoulder', 'elbow', 'lower_back', 'knee', 'wrist', 'hip', 'ankle', 'neck')
                when 'exercise' then subject is not null and subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                when 'other' then subject is not null and subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                else subject is null
            end
        ),
        constraint ronnie_memories_state check (
            case kind
                when 'injury' then state in ('active', 'resolved')
                when 'exercise' then state in ('like', 'dislike')
                else state = 'active'
            end
        )
    );

    alter table public.ronnie_memories enable row level security;
    revoke all on public.ronnie_memories from anon, authenticated;

    if not (select relrowsecurity from pg_class where oid = 'public.ronnie_memories'::regclass) then
        raise exception 'row level security is off on ronnie_memories';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ronnie_memories') then
        raise exception 'ronnie_memories has a policy; only the service role may read or write notes';
    end if;
    if has_table_privilege('authenticated', 'public.ronnie_memories', 'select')
        or has_table_privilege('anon', 'public.ronnie_memories', 'select')
        or has_table_privilege('authenticated', 'public.ronnie_memories', 'insert') then
        raise exception 'users can still read or write ronnie_memories';
    end if;
    if (
        select count(*) from pg_constraint
        where conrelid = 'public.ronnie_memories'::regclass
          and conname in ('ronnie_memories_slot', 'ronnie_memories_subject', 'ronnie_memories_state')
    ) <> 3 then
        raise exception 'ronnie_memories is missing its slot, subject or state constraint (an older table by that name?)';
    end if;
    if not exists (
        select 1 from pg_constraint c join pg_index i on i.indexrelid = c.conindid
        where c.conrelid = 'public.ronnie_memories'::regclass and c.conname = 'ronnie_memories_slot' and i.indnullsnotdistinct
    ) then
        raise exception 'ronnie_memories_slot treats nulls as distinct, so equipment and schedule would not be one each';
    end if;
end
$$;
