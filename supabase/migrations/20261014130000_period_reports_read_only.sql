-- Report rows become read-only for users: they read their own and nothing else.
--
-- Only the scheduler and the worker (the service role) create and fill report rows, and a retry
-- goes through claim_report_retry (20261014120000). The INSERT and UPDATE policies left from
-- before let a user write their own rows directly, including a completed report back to
-- pending, and the period and note a run uses. Nothing in the app writes the table as a user
-- any more.
--
-- Apply only once the app and the worker that use claim_report_retry are live: the app before
-- them still claimed retries with a plain UPDATE, which this refuses. It stops if
-- 20261014120000 hasn't been applied.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it
-- is safe to run twice. "Success. No rows returned" means it worked; a wrong state ends in an
-- exception that says what is wrong.

do $$
declare
    p record;
begin
    if to_regprocedure('public.claim_report_retry(date, boolean)') is null then
        raise exception 'apply 20261014120000 (claim_report_retry) first';
    end if;

    alter table public.period_reports enable row level security;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'period_reports' loop
        execute format('drop policy %I on public.period_reports', p.policyname);
    end loop;
    create policy "Users read their own reports" on public.period_reports
        for select to authenticated
        using ((select auth.uid()) = user_id);
    revoke insert, update, delete, truncate on public.period_reports from authenticated;
    revoke all on public.period_reports from anon;

    if not (select relrowsecurity from pg_class where oid = 'public.period_reports'::regclass) then
        raise exception 'row level security is off on period_reports';
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'period_reports') <> 1
        or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'period_reports' and cmd = 'SELECT') then
        raise exception 'period_reports should have only its select policy';
    end if;
    if has_table_privilege('authenticated', 'public.period_reports', 'insert')
        or has_table_privilege('authenticated', 'public.period_reports', 'update')
        or has_table_privilege('authenticated', 'public.period_reports', 'delete')
        or has_any_column_privilege('authenticated', 'public.period_reports', 'insert')
        or has_any_column_privilege('authenticated', 'public.period_reports', 'update') then
        raise exception 'signed-in users can still write period_reports';
    end if;
    if has_table_privilege('anon', 'public.period_reports', 'select') then
        raise exception 'anon can still read period_reports';
    end if;
    if not has_table_privilege('authenticated', 'public.period_reports', 'select') then
        raise exception 'signed-in users can no longer read their reports';
    end if;
end $$;
