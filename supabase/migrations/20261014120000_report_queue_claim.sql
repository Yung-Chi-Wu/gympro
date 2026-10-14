-- A report is queued again only through the database, which decides what the queued request is.
--
-- Until now the app's retry read the row's period_end, user_note and retries and put them in the
-- SQS message, and the worker used whatever the message said. Users can write their own report
-- rows (the policies only require status 'pending'), so a user could set any period length, any
-- note and an old queued_at, then press retry as often as they liked: each run is paid model
-- calls, sized by those values.
--
-- This migration, applied before the app and worker that use it:
--   limits    a training cycle lasts 1 to 28 days (lib/periods.ts MAX_CYCLE_DAYS), which is
--             also the longest period one report covers; a report's note is at most 1000
--             characters, the period note's own limit.
--   claim_report_retry(period_start, auto)
--             queues the signed-in user's report again, under a row lock: only a failed one, or
--             one still pending 30 minutes after it was queued (lib/report/queue.ts), the
--             automatic retry only while it was never retried, and at most 5 retries in all.
--             It answers { claimed, queued_at } or { claimed: false, reason }.
--   mark_report_queue_failed(period_start, queued_at)
--             marks that request failed when the app couldn't send it to the queue. The app
--             did this with the user's own client, which the policies refuse.
-- The worker then reads the period's end and the note from the row, not from the message.
-- 20261014130000 makes report rows read-only for users once that code is live.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it
-- is safe to run twice. It changes no rows: a row already outside a new limit stops it with an
-- exception that says how many. "Success. No rows returned" means it worked.

do $$
declare
    v_bad bigint;
begin
    select count(*) into v_bad from public.training_cycles where cycle_length not between 1 and 28;
    if v_bad > 0 then
        raise exception 'training_cycles: % cycle(s) are shorter than 1 or longer than 28 days; nothing was changed', v_bad;
    end if;
    select count(*) into v_bad from public.period_reports where char_length(user_note) > 1000;
    if v_bad > 0 then
        raise exception 'period_reports: % report(s) have a note over 1000 characters; nothing was changed', v_bad;
    end if;
    select count(*) into v_bad from public.period_reports where period_end - period_start not between 0 and 27;
    if v_bad > 0 then
        raise exception 'period_reports: % report(s) cover more than 28 days or end before they start; nothing was changed', v_bad;
    end if;

    alter table public.training_cycles drop constraint if exists training_cycles_length_range;
    alter table public.training_cycles add constraint training_cycles_length_range
        check (cycle_length between 1 and 28);
    alter table public.period_reports drop constraint if exists period_reports_user_note_length;
    alter table public.period_reports add constraint period_reports_user_note_length
        check (user_note is null or char_length(user_note) <= 1000);
    alter table public.period_reports drop constraint if exists period_reports_period_length;
    alter table public.period_reports add constraint period_reports_period_length
        check (period_end is null or period_end - period_start between 0 and 27);

    create or replace function public.claim_report_retry(p_period_start date, p_auto boolean default false)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        v_row public.period_reports;
        -- Milliseconds, so the value the app and the worker compare survives a round trip through JavaScript
        v_now timestamptz := date_trunc('milliseconds', now());
        v_end date;
    begin
        select * into v_row from public.period_reports
        where user_id = auth.uid() and period_start = p_period_start
        for update;
        if not found
            or not (v_row.status = 'failed' or (v_row.status = 'pending' and v_row.queued_at < v_now - interval '30 minutes')) then
            return jsonb_build_object('claimed', false, 'reason', 'not_failed');
        end if;
        if p_auto and v_row.retries > 0 then
            return jsonb_build_object('claimed', false, 'reason', 'auto_used');
        end if;
        if v_row.retries >= 5 then
            return jsonb_build_object('claimed', false, 'reason', 'limit');
        end if;

        -- A row queued before rows kept their period's end gets the one a retry computed then
        v_end := coalesce(v_row.period_end, v_row.period_start + coalesce(
            (select c.cycle_length from public.training_cycles c where c.user_id = v_row.user_id), 7) - 1);
        update public.period_reports
        set status = 'pending', error_message = null, queued_at = v_now, retries = v_row.retries + 1, period_end = v_end
        where user_id = v_row.user_id and period_start = v_row.period_start;
        return jsonb_build_object('claimed', true, 'queued_at', v_now);
    end
    $fn$;

    create or replace function public.mark_report_queue_failed(p_period_start date, p_queued_at timestamptz)
    returns void
    language sql
    security definer
    set search_path = ''
    as $fn$
        update public.period_reports
        set status = 'failed', error_message = 'Failed to queue report request.'
        where user_id = auth.uid() and period_start = p_period_start and status = 'pending' and queued_at = p_queued_at;
    $fn$;

    revoke all on function public.claim_report_retry(date, boolean) from public, anon;
    revoke all on function public.mark_report_queue_failed(date, timestamptz) from public, anon;
    grant execute on function public.claim_report_retry(date, boolean) to authenticated;
    grant execute on function public.mark_report_queue_failed(date, timestamptz) to authenticated;

    if (select count(*) from pg_constraint where conname in
            ('training_cycles_length_range', 'period_reports_user_note_length', 'period_reports_period_length')) <> 3 then
        raise exception 'a cycle or report limit is missing';
    end if;
    if (select count(*) from pg_proc
            where oid in ('public.claim_report_retry(date, boolean)'::regprocedure, 'public.mark_report_queue_failed(date, timestamptz)'::regprocedure)
              and prosecdef and proconfig @> array['search_path=""']) <> 2 then
        raise exception 'the report retry functions must be security definer with an empty search_path';
    end if;
    if has_function_privilege('anon', 'public.claim_report_retry(date, boolean)', 'execute')
        or has_function_privilege('anon', 'public.mark_report_queue_failed(date, timestamptz)', 'execute') then
        raise exception 'anon can still call the report retry functions';
    end if;
    if not has_function_privilege('authenticated', 'public.claim_report_retry(date, boolean)', 'execute')
        or not has_function_privilege('authenticated', 'public.mark_report_queue_failed(date, timestamptz)', 'execute') then
        raise exception 'signed-in users cannot call the report retry functions';
    end if;
end $$;
