-- Today's weight is one weigh-in a day, like the day note: saving it again updates the row,
-- and clearing it deletes the row. body_metrics was made before these migrations, and its
-- policies were only ever needed for reading and inserting; this makes sure users can also
-- update and delete their own rows. The policy is added next to any that exist, and
-- permissive policies add up, so it only widens what a user can do to their own rows.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and
-- it is safe to run twice. "Success. No rows returned" means it worked; a wrong state ends
-- in an exception that says what is wrong.

do $$
begin
    alter table public.body_metrics enable row level security;

    -- Users read and write only their own weigh-ins; the report Lambda uses the service role
    drop policy if exists "Users manage their own body metrics" on public.body_metrics;
    create policy "Users manage their own body metrics"
        on public.body_metrics
        for all
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id);

    if not (select relrowsecurity from pg_class where oid = 'public.body_metrics'::regclass) then
        raise exception 'body_metrics: row level security is off';
    end if;
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'body_metrics' and cmd = 'ALL'
          and qual = '(auth.uid() = user_id)' and with_check = '(auth.uid() = user_id)'
    ) then
        raise exception 'body_metrics: the policy does not limit every command to the user''s own rows';
    end if;
    -- An older policy that isn't about the user's own rows would show everyone's weight
    if exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'body_metrics' and permissive = 'PERMISSIVE'
          and coalesce(qual, with_check, '') not like '%auth.uid()%'
    ) then
        raise exception 'body_metrics: policy % is not limited to the user''s own rows; check it before going on',
            (select string_agg(policyname, ', ') from pg_policies
             where schemaname = 'public' and tablename = 'body_metrics' and permissive = 'PERMISSIVE'
               and coalesce(qual, with_check, '') not like '%auth.uid()%');
    end if;
end
$$;
