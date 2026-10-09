-- One note per day ("slept badly", "right shoulder felt stuck"), written on any day: a
-- training day, a rest day, or a day a session was missed. The report Lambda reads the
-- period's notes and lines each one up with that day's plan and whether the user trained
-- before the model sees it. At most 200 characters, so a week of notes can't drown the
-- rest of the report's brief.
--
-- period_notes (one note for a whole period) stays: reports still read the notes already
-- written there.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and
-- it is safe to run twice. "Success. No rows returned" means it worked; a wrong state ends
-- in an exception that says what is wrong.

do $$
begin
    create table if not exists public.day_notes (
        user_id uuid not null references auth.users (id) on delete cascade,
        -- The day in the user's own time zone, like the report's dates
        note_date date not null,
        note text not null,
        updated_at timestamptz not null default now(),
        primary key (user_id, note_date)
    );

    alter table public.day_notes drop constraint if exists day_notes_note_length;
    alter table public.day_notes add constraint day_notes_note_length check (char_length(note) between 1 and 200);

    alter table public.day_notes enable row level security;

    -- Users read and write only their own notes; the report Lambda uses the service role
    drop policy if exists "Users manage their own day notes" on public.day_notes;
    create policy "Users manage their own day notes"
        on public.day_notes
        for all
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id);

    if not (select relrowsecurity from pg_class where oid = 'public.day_notes'::regclass) then
        raise exception 'day_notes: row level security is off';
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'day_notes') <> 1 then
        raise exception 'day_notes: expected exactly one policy, found %',
            (select count(*) from pg_policies where schemaname = 'public' and tablename = 'day_notes');
    end if;
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'day_notes' and cmd = 'ALL'
          and qual = '(auth.uid() = user_id)' and with_check = '(auth.uid() = user_id)'
    ) then
        raise exception 'day_notes: the policy does not limit every command to the user''s own rows';
    end if;
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.day_notes'::regclass and contype = 'p'
          and conkey = array[
              (select attnum from pg_attribute where attrelid = 'public.day_notes'::regclass and attname = 'user_id'),
              (select attnum from pg_attribute where attrelid = 'public.day_notes'::regclass and attname = 'note_date')
          ]::smallint[]
    ) then
        raise exception 'day_notes: the primary key is not (user_id, note_date), so a day could get two notes';
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.day_notes'::regclass and conname = 'day_notes_note_length') then
        raise exception 'day_notes: the 200-character limit is missing';
    end if;
end
$$;
