# Architecture, CI, operations and security

The detail behind [the README](../README.md).

## Architecture in detail

- **App:** Next.js 16 (App Router, server actions and route handlers) on Vercel. The UI strings are in English and Traditional Chinese, using next-intl.
- **Data:** Supabase Postgres, with row-level security on every user table. The policies are in the repo. pgvector holds the exercise embeddings.
- **Reports:** an hourly scheduler finds the users whose week has ended in their own time zone, claims a report row, and queues it. A week an earlier report already covered to its end, such as one round of a cycle from before reports were weekly, gets none. The worker Lambda builds and writes the report. A request is retried up to 3 times, then goes to a dead-letter queue, which raises an alarm.
- **Reminders:** a device that turns the reminder on registers a service worker ([`public/sw.js`](../public/sw.js)) and saves its push subscription through a database function; signed-in users can't read the table. Every hour a Lambda finds the users whose local time is 21:00, skips a rest day their cycle plans, and claims each device for the day before sending, so a repeated run sends nothing twice. It posts only to the browsers' push services, which the database also enforces, so a subscription can't point it anywhere else. A device the push service no longer knows is deleted.
- **AWS access:** Vercel deployments assume IAM roles through OIDC, with separate roles for production and preview. API keys live in SSM Parameter Store. Everything AWS-side is in [`infra/terraform`](../infra/terraform).

## CI

Every pull request runs these free checks, with no secrets ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). `main` accepts changes only through a pull request with CI green.

- Types, lint and the production build, for the app and the Lambda.
- Ronnie's tools, turn loop and grader, offline.
- **Replays of recorded conversations** ([`evals/ronnie/replays`](../evals/ronnie/replays)). The recorded model output is fed through the current code, so a fixed mistake can't come back.
- The report's rules, goal and message reading, next-session advice, grader and queue behavior, offline.
- The daily review's grouping by local day and its flags, and the weekly email, offline.
- Research citations resolve, by DOI.
- Day boundaries are right in every time zone.
- The app and the database enforce the same input limits.
- Every server error reaches the error log.
- Coach G accepts only what it can use and save.
- **Every write counts in the browser's data version, and every signed-in page reads its own writes.** The check reads the code as syntax and fails a pull request with:
  - a server action call or an API write outside `serverWrite`;
  - a second browser database client;
  - a page without the check.
- **Every model call asks the spend limits first.** Only one module makes a model client or reads the API key, and every feature the app traces counts toward the limits. The limits' own logic is tested against a fake database.

## Operations

- **AI traces.** Every AI call stores its input, output, tool calls, tokens, cost and latency. Traces are kept 90 days, with a daily usage view.
- **Flagged replies.** A Ronnie reply is flagged when:
  - the reply check fired;
  - the user's next message says it was wrong;
  - the user edits the message it answered;
  - the user cancels its card or clears the chat within two minutes;
  - the user reports it, picking what was wrong (a wrong fact, a missed question, unsuitable advice, a wrong change, length or tone) and adding a note if they want;
  - the daily review finds a problem in it.

  A flagged trace is kept 365 days. These are the conversations that become eval cases:
  - `npm run trace:to-case` drafts a replay from each flagged turn of one account, outside the repo. It moves the turn onto the fixture user: exercise IDs become fixture exercises and the user's name becomes Alex.
  - A person reviews each draft before it's committed, since the repo is public.
  - CI refuses a replay that still has its review notes, or an exercise the fixture doesn't have.
- **Daily review.** Each morning a Lambda reads every Ronnie conversation from a day that has ended in its user's time zone ([`lambda/ai-worker/src/audit`](../lambda/ai-worker/src/audit)). The reviewer is Opus, the eval judge's model. It reads the system prompt and each turn's tool results, with no rubric, and flags a reply that:
  - states something no tool result supports;
  - claims an action no tool took;
  - does the wrong thing, or misses the request;
  - gives unsafe advice.

  A day is marked read only after its review is saved. Each run is capped at 20 days and US$0.50.

  Before shipping, the reviewer read 32 eval conversations whose outcome was already graded ([record](../.claude/hillclimb/ronnie-audit/v1/change.md)):
  - it flagged 14 of the 16 with a real problem, and 1 of the 16 without one;
  - on 20 held-out conversations it flagged none;
  - it found two mistakes in the eval judge's own grades.
- **Feedback.** Users send feedback from Settings: a problem, an idea, or an exercise they want added, in their own words. It is kept in `app_feedback` with the app version, language and browser, never their training log, and a user can send 10 a day. When a user names an exercise the library doesn't have, Ronnie asks for it there too (`request_exercise`, at most 3 a day): code checks the library first, the same name isn't sent twice in 30 days, and the line under the reply saying it was sent is written by code.
- **Weekly email.** Each Monday the owner gets one email with the week's feedback and the Ronnie replies that were flagged, by the review or by the user, with the reasons a user gave for reporting one. It is sent only when there is something in it. It never quotes a conversation, and every line a user wrote starts with "> ", so none of it can pass for the email's own text.
- **Errors.** Server and browser errors go to an `app_errors` table.
- **Alarms.** 15 CloudWatch alarms send email when:
  - AI calls fail, or half of an hour's calls fail (a dead key);
  - a day's AI spend runs high;
  - the scheduler goes silent;
  - a report is stuck, or reaches the dead-letter queue;
  - a Lambda nears its timeout, or the daily review, weekly email or reminder fails;
  - the app logs an error;
  - the database passes 400 MB of the free plan's 500 MB.
- **Data integrity.** Today's workout and its plan are created in one transaction, under a per-user lock. Limits on sets, targets and amounts are enforced in both the app and the database.

## Performance

**How it's measured:**
- A script taps through the tabs on production, on a phone-sized screen. It times each tap until the new page's content is on screen, and takes the median of 6 taps.
- **Each tap is broken down.** The proxy sends a `Server-Timing` header with its own time, its token check and its region. Each signed-in page lists its server steps in a hidden element: every database request with its start and length, and when the page was ready ([`lib/server-timing.ts`](../lib/server-timing.ts)).

**What was found, and what changed:**

| Found | Change |
|---|---|
| Each tab switch asked the auth server who the user was three times, one after another: the proxy, the layout and the page. | The session token is verified on the server against the project's public key, once per request ([#91](https://github.com/Yung-Chi-Wu/gympro/pull/91)). |
| Today read the database in 10 rounds, each waiting for the one before. | Reads are grouped by what they wait for, and related rows come in one query. Today now takes 2 rounds: the day's reads start as soon as the profile and cycle are in, and last time's sets come with today's workout ([#94](https://github.com/Yung-Chi-Wu/gympro/pull/94)). Before shipping, the old and new loaders gave the same result in 1,720 runs: 344 cases (60 days, up to 3 routine choices each, 2 languages), each called 5 ways. |
| React keeps a loading skeleton on screen for at least 300 ms, so even a fast page took about 360 ms. | No skeletons. The tapped tab is marked at once (about 55 ms), and the page appears when it's ready. |
| Every database query costs 30–50 ms from the app's region, even for one row. The two regions are about 10 ms apart, so most of that is the database service itself. | The app was not moved next to the database: that would save about 10 ms per round and add a hop for the user. The fix was fewer rounds. |
| The calendar on Routines waited for the profile and cycle before reading its month: a second round, and the tab went from 0.21 s to 0.43 s. | The month is read in the first round, over a range that holds it for any time zone and cycle, then cut to the calendar's. The wider read goes as two queries at once, which come back sooner than one ([#107](https://github.com/Yung-Chi-Wu/gympro/pull/107)). |
| Today still sent about 14 requests in two rounds. Each costs Supabase's API layer 40–100 ms even for one row, and the slowest in a round decides it. | One database function, `today_page`, reads the page's rows in one request, and the app builds the page from them with the same code ([#134](https://github.com/Yung-Chi-Wu/gympro/pull/134)). The app works the day out again and reads the old way if the function's day differs, as where the database's time zone data is older. Before shipping, the two gave the same page 468 times out of 468, and the function's day matched the app's at 311,440 instants across 422 zones, apart from zones whose rules changed after the database's time zone data. On production, Today's server time went from 264 ms to 149–175 ms. |
| Routines sent 10 requests at once beside the profile. Its calendar also read 27 days before the month's first week and dropped them, left over from when the calendar showed the cycle's rounds. | One function, `routines_page`, reads the page's rows in one request, over the month's weeks only ([#136](https://github.com/Yung-Chi-Wu/gympro/pull/136)). It does no time zone work, so the app reads the old way only when the call fails. Before shipping, the function and the old reads each gave the same page as before 4,992 times out of 4,992: every 6 hours from August to December, in 4 time zones and both languages. On production the same day, Routines' server time went from 174–200 ms to 128–133 ms. |

**Result** (tap to content on production, median of 6; runs vary by about ±50 ms):

| Tab | Before | After |
|---|---|---|
| Today | 0.62–0.64 s | 0.25–0.29 s |
| Routines | 0.39–0.45 s | 0.21 s |
| History | 0.46–0.60 s | 0.33 s |
| Settings | 0.36–0.42 s | 0.16 s |

Today's is from two runs after #134 (2026-10-30), when it had drifted to 0.39 s before the change; the others are from 2026-10-27. By 2026-10-30 Routines had drifted to 0.30–0.33 s, and it was 0.24–0.25 s after #136.

Opening the app on Today went from 0.8–1.1 s to about 0.5 s.

**Read your writes.** Most writes go straight from the browser to Postgres, under row-level security. A page cached in the browser would then show data from before the user's own change. So every write is counted before anything is cached ([#95](https://github.com/Yung-Chi-Wu/gympro/pull/95)), after the *read your writes* guarantee in Terry et al., *Session Guarantees for Weakly Consistent Replicated Data* (1994):
- **One data version per browser.** It goes up after each write ([`lib/data-version.ts`](../lib/data-version.ts)).
- **Writes are counted where they leave the browser,** not by each caller. The database client counts its own writes, and calls that write on the server are wrapped in `serverWrite`. A CI check fails any write that isn't counted.
- **First use: back and forward.** Back and forward used to show the earlier page exactly as first drawn. Now a page shown again from memory is read again if the user wrote anything since.
- **Pages are not cached across tabs yet.** Next.js documents cache invalidation only through Server Actions, and its current invalidation clears everything and is marked as temporary. The data version is ready for when it is documented.

## Security

- Row-level security on every user table, with the policies in [`supabase/migrations`](../supabase/migrations). Conversation and memory tables are written only by the server.
- No long-lived AWS credentials. Production and preview deployments get separate IAM roles through OIDC.
- Queues are encrypted, size-capped and TLS-only.
- Security headers are set, and sign-in redirects are validated. A Content Security Policy is enforced: scripts, styles and connections only from the app itself and Supabase (inline scripts too, which Next.js needs), the Vercel toolbar on preview deployments only, and no framing. It ran report-only for a week first. Anything it blocks in a signed-in page is sent to `app_errors`, so it raises an alarm.
- **AI spend limits**, against what OWASP's LLM10 calls "denial of wallet". Before every model call the app takes a slot from the database ([`lib/ai/spend-limits.ts`](../lib/ai/spend-limits.ts)):
  - one AI request at a time per user;
  - a user's requests may cost US$0.50 over any 24 hours;
  - accounts younger than 7 days share US$1, so accounts made to spend can't use up what everyone shares;
  - all users' together may cost US$5, so however many accounts someone makes, the scheduled reports keep room under the Anthropic spend cap.

  The cost is summed from the traces, and a slot is let go only after its trace is saved, so a user can pass their limit by one request at most. That one request is bounded too: a turn sends at most 60,000 characters of the day's history, and a trace the database refuses for its text is saved again with only its cost. Past a limit, Ronnie says when it's back, and Coach G carries on without the model. If the limits themselves fail, the request goes through and an alarm fires. Checked against the last 30 days of real use: none of the 47 requests would have been refused.
- **Rows per account.** Each table a user writes to takes at most about ten years of heavy use per account (60,000 sets, 5,000 workouts), checked by a trigger after each insert, and a day's Ronnie conversation at most 1 MB. The database is on Supabase's free plan, which turns read-only at 500 MB.
- Dependabot is on, and GitHub Actions are pinned to commit SHAs. CodeQL scans the code and the workflows on every pull request and once a week, with GitHub's extended security queries.
