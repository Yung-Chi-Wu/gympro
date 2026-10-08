-- Vector search for exercises, used by Ronnie's search_exercises. Applied by hand
-- in the SQL Editor. Every statement can be run again safely.
--
-- The search eval (evals/search) chose Cohere Embed v4 on Bedrock, which gives
-- 1536-dimension vectors. On the 20 holdout queries it found a right answer in the
-- top 5 for 90% of them; keyword search did for 75%.
--
-- Each exercise stores two things:
--   embedding       the vector of exerciseDocument() in lib/ronnie/search.ts
--   embedding_text  the text that was embedded. The indexing script
--                   (scripts/index-exercise-embeddings.ts) re-embeds only the
--                   exercises whose text has changed.
-- An exercise with no vector yet, such as a custom one added after the last index
-- run, is still found by keyword search.
--
-- There is no vector index. With about 150 rows an exact scan is instant; an
-- approximate index (HNSW) only pays off at many thousands of rows.

create extension if not exists vector with schema extensions;

alter table public.exercises
    add column if not exists embedding extensions.vector(1536),
    add column if not exists embedding_text text;

-- Returns the exercises nearest in meaning to the query vector, closest first.
-- It runs as security invoker, so RLS applies: users see the built-in library and
-- their own custom exercises, never anyone else's.
create or replace function public.match_exercises(
    p_embedding extensions.vector(1536),
    p_count int default 20,
    p_muscle_group text default null
)
returns table (id uuid, similarity double precision)
language sql
stable
security invoker
set search_path = public, extensions
as $$
    select e.id, 1 - (e.embedding <=> p_embedding) as similarity
    from public.exercises e
    where e.embedding is not null
      and (p_muscle_group is null or e.muscle_group = p_muscle_group)
    order by e.embedding <=> p_embedding
    limit least(greatest(p_count, 1), 50)
$$;

grant execute on function public.match_exercises(extensions.vector, int, text) to authenticated;
