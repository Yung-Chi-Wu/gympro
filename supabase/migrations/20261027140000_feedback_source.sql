-- Where feedback came from: app_feedback (20261025120000) took only what users send from Settings.
-- Ronnie now sends one too, kind exercise, when a user names an exercise the library doesn't have
-- (lib/ronnie/executor.ts, suggest_exercise), and the owner's weekly email says which it was.
--   source   settings, or ronnie; rows from before this are settings
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
begin
    alter table public.app_feedback add column if not exists source text not null default 'settings';
    alter table public.app_feedback drop constraint if exists app_feedback_source_check;
    alter table public.app_feedback add constraint app_feedback_source_check check (source in ('settings', 'ronnie'));

    -- ---------- Checks ----------
    if (select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'public.app_feedback'::regclass and conname = 'app_feedback_source_check') is distinct from
        'CHECK ((source = ANY (ARRAY[''settings''::text, ''ronnie''::text])))' then
        raise exception 'app_feedback does not take exactly the sources settings and ronnie';
    end if;
    if exists (select 1 from public.app_feedback where source is null) then
        raise exception 'app_feedback has rows with no source';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_feedback') then
        raise exception 'app_feedback should have no policies: only the service role reads and writes it';
    end if;
end $$;
