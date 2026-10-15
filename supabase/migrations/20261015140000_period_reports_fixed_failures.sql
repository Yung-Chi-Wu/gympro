-- A failed report's error_message held the worker's raw error text, which could name AWS
-- resources, and each user can read their own rows. The worker now saves one of a few fixed
-- lines (lambda/ai-worker/src/supabase.ts); this rewrites the rows saved before it to the
-- general one. Rows that aren't failed (insufficient_data says how many sets were logged) are
-- left as they are.
--
-- Apply after the worker Lambda that saves fixed lines is deployed, or a failure in between
-- writes raw text again (running it again then clears that too).
--
-- Applied by hand in the SQL Editor. It is one DO block, so it applies all or nothing, and it is
-- safe to run twice. "Success. No rows returned" means it worked.

do $$
declare
    fixed constant text[] := array['Invalid report period.', 'The report could not be made.', 'Failed to queue report request.'];
begin
    update public.period_reports
    set error_message = 'The report could not be made.'
    where status = 'failed' and (error_message is null or error_message <> all (fixed));

    if exists (select 1 from public.period_reports where status = 'failed' and (error_message is null or error_message <> all (fixed))) then
        raise exception 'a failed report still holds a message that is not one of the fixed lines';
    end if;
end $$;
