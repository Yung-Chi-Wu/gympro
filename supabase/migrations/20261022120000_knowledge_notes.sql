-- Vector search for Ronnie's knowledge base (lib/ronnie/knowledge-notes.json). Applied by hand
-- in the SQL Editor; then run `npm run index:knowledge` to fill the vectors.
--
-- The notes themselves live in the repo, where they are reviewed; this table holds only each
-- note's id and the vector of its text, so search can find a note by meaning. The id is the
-- note's (author-year-subtopic), and the app looks the note up in the JSON by it.
--   embedding       Cohere Embed v4 on Bedrock (1536 dimensions), as exercise search uses
--   embedding_text  the text that was embedded (knowledgeDocument in lib/ronnie/knowledge.ts);
--                   the index script re-embeds only notes whose text changed, and removes rows
--                   for notes that are gone
--
-- The notes are public research summaries, so any signed-in user may read the rows; only the
-- service role writes them. There is no vector index: with about 150 rows an exact scan is instant.
--
-- It is one DO block, so it applies all or nothing, and it is safe to run twice.

do $$
begin
    create extension if not exists vector with schema extensions;

    create table if not exists public.knowledge_notes (
        id text primary key,
        embedding extensions.vector(1536),
        embedding_text text,
        updated_at timestamptz not null default now()
    );

    alter table public.knowledge_notes enable row level security;
    drop policy if exists knowledge_notes_read on public.knowledge_notes;
    create policy knowledge_notes_read on public.knowledge_notes for select to authenticated using (true);
    revoke insert, update, delete on public.knowledge_notes from anon, authenticated;

    -- The notes nearest in meaning to the query vector, closest first. Security invoker, like
    -- match_exercises: it reads only what the caller may read.
    execute $fn$
        create or replace function public.match_knowledge(
            p_embedding extensions.vector(1536),
            p_count int default 20
        )
        returns table (id text, similarity double precision)
        language sql
        stable
        security invoker
        set search_path = public, extensions
        as $body$
            select k.id, 1 - (k.embedding <=> p_embedding) as similarity
            from public.knowledge_notes k
            where k.embedding is not null
            order by k.embedding <=> p_embedding
            limit least(greatest(p_count, 1), 50)
        $body$
    $fn$;

    revoke execute on function public.match_knowledge(extensions.vector, int) from public, anon;
    grant execute on function public.match_knowledge(extensions.vector, int) to authenticated;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'knowledge_notes' and policyname = 'knowledge_notes_read') then
        raise exception 'knowledge_notes_read policy missing';
    end if;
end
$$;
