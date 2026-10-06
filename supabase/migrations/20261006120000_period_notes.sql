-- Notes a user writes during a training period ("shoulder felt tight"), before
-- that period's report exists. When the period ends, the report scheduler
-- copies the note into period_reports.user_note and sends it to the AI worker.
create table if not exists public.period_notes (
    user_id uuid not null references auth.users (id) on delete cascade,
    period_start date not null,
    note text not null check (char_length(note) between 1 and 1000),
    updated_at timestamptz not null default now(),
    primary key (user_id, period_start)
);

alter table public.period_notes enable row level security;

-- Users read and write only their own notes; the scheduler uses the service role.
create policy "Users manage their own period notes"
    on public.period_notes
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
