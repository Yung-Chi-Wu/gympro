-- How a report request is tracked from the queue to the worker:
--   queued_at    when this request was queued (by the scheduler or a retry). The SQS message
--                carries the same value, and the worker only runs, and only saves, while the
--                row still has it: a redelivered message can't overwrite a finished report,
--                and an old message can't run beside a newer retry. A report still pending
--                long after it was queued is shown as failed, with a retry.
--   period_end   the period's last day as the scheduler computed it, so a retry asks for the
--                same period even if the cycle has changed since.
--   retries      how many times it was queued again. The app retries a failed report by
--                itself only once; after that it shows a button.
-- Rows from before this get queued_at = now (so a pending one stuck before it shows a retry
-- 30 minutes after this runs), no period_end (a retry then computes it, as before) and 0 retries.
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and
-- it is safe to run twice. "Success. No rows returned" means it worked; a wrong state ends
-- in an exception that says what is wrong.

do $$
begin
    alter table public.period_reports add column if not exists queued_at timestamptz not null default now();
    alter table public.period_reports add column if not exists period_end date;
    alter table public.period_reports add column if not exists retries smallint not null default 0;

    if (
        select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'period_reports'
          and (column_name, data_type, is_nullable) in (
              ('queued_at', 'timestamp with time zone', 'NO'),
              ('period_end', 'date', 'YES'),
              ('retries', 'smallint', 'NO')
          )
    ) <> 3 then
        raise exception 'period_reports: queued_at, period_end or retries is missing or has the wrong type';
    end if;
end $$;
