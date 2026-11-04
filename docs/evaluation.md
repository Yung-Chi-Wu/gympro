# Evaluation

Every suite, and every decision an eval made. [The README](../README.md) has the summary.

| Suite | Size | Graded by |
|---|---|---|
| Ronnie, development | 37 conversations | Code checks on every run: the right tools, the right writes and nothing else, valid IDs, date ranges, language, no fallback. A judge (Claude Opus 5.5) with a rubric on 28 of them. |
| Ronnie, held out | 5 | The same. Run only for acceptance. |
| Ronnie, fitness knowledge | 36 | Code checks on the sources under the reply (the right paper cited; none, plus the label, when no note covers it), plus the judge |
| Ronnie, memory | 21, some across several conversations | Code checks on the saved notes, plus the judge |
| Exercise search | 51 queries, plus 20 held out | hit@1, hit@5, MRR |
| Knowledge search | 50 questions, plus 25 held out | hit@1, hit@5, MRR |
| Weekly report | 44 scenarios | Rule checks, a grader and the judge |
| Report goal reader | 20 goal texts, run by hand | Code checks on each read |
| Report period reader | 16 sets of notes and messages, run by hand | Code checks on each read |
| [Report backtest](#report-backtest) | Every past week of every real account: 30 weeks of 4 accounts on 2026-11-04 | Code: each next-session plan against the next session, each flag against the next two weeks |

**How it runs:**
- A fixture user with fixed data stands in for the database ([`evals/ronnie/fixture.ts`](../evals/ronnie/fixture.ts)). No real user data is used, except by the [report backtest](#report-backtest), which keeps only counts.
- Each case runs k times, and high-risk cases are also reported as pass^k.
- Every run is recorded under [`.claude/hillclimb`](../.claude/hillclimb), one folder per iteration: what changed, and each case's grades and the reasons for them.
- **Grading drift is blocked.** The runner refuses to start if the grader, cases, fixture or dependencies changed since a human last approved them. It checks this with a hash.

**What the evals decided:**

| Question | Measured | Decision |
|---|---|---|
| Which model for Ronnie? | Knowledge suite: Haiku 4.5 48%, Sonnet 5.5 88% (40 runs each) | Sonnet 5.5 |
| Which model for reports? | Free-text reports: Haiku 4.5 23%, Sonnet 4.6 76% (66 runs each) | Sonnet 4.6. Then a redesign that moved the facts into code. |
| Which embeddings? | Held-out hit@5: keywords 75%, Titan V2 70%, Cohere Embed v4 90% | Cohere Embed v4, gated with keywords |
| Knowledge search: keywords, vectors or both? | Held-out hit@5: keywords 88%, both fused 96%, Cohere Embed v4 alone 100% (hit@1 76%, 80%, 88%) | Vectors alone, with keywords when Bedrock is unavailable |
| Give Ronnie topic pages with the notes? | 33 knowledge questions, 3 runs each, without and with pages: judge 92/99 both (questions that put several notes together 8/12 → 10/12, the 8 earliest 21/24 → 20/24). With pages, Ronnie cited a side note on questions no note answers in 5 of 6 runs (1 of 6 without), and a turn took 0.7 s and about 3,400 tokens more | Not given to Ronnie. The pages stay for the weekly report |
| Should Ronnie advise on medicines? | 4 medicine questions, 3 runs each: without a rule 5/12, most answers saying when or whether to take one ("now and then is fine"); with the rule 8/12; with the rule also naming steering 10/12 (the steroid rubric was loosened after the second run). The other 32 knowledge questions 93/96 with the rule, 91/96 before | Never: Ronnie gives the research and how a medicine works, and sends the user to a doctor or pharmacist ([#80](https://github.com/Yung-Chi-Wu/gympro/pull/80)) |
| Check medicine replies for advice with a model? | 48 saved medicine replies, 11 with advice by the judge's count. Haiku 4.5 caught 9, missing different ones with each prompt, and flagged 2 to 4 that gave none; Sonnet 5.5 caught 11 but flagged 18 of the other 37, such as "natural training can get you there". With the rule alone, 11/12 fresh replies gave no advice | No: each flag costs a rewrite. Code adds the doctor or pharmacist line when a reply leaves it out ([#87](https://github.com/Yung-Chi-Wu/gympro/pull/87)) |
| Which topic page goes with the notes found? | Held-out page hit: the page citing the most of the top 5 notes 88%; a page that cites the nearest note, then the most of the rest, 92% (dev 96% both) | The nearest note decides |
| Does a knowledge base make Ronnie better? | 29 knowledge questions, 3 runs each: judge 63/87 → 82/87, the right paper cited 0/63 → 60/63 (63/63 replayed after a fix for full-width brackets). The 8 questions from before the notes fell from 21/24 to 15/24 while Ronnie answered only from the notes, and came back to 20/24 once the prompt said the notes add to a coach's answer | Shipped ([#78](https://github.com/Yung-Chi-Wu/gympro/pull/78)) |
| Embed the muscles too? | Held-out hit@1 55% → 70%, MRR 0.73 → 0.81 (hit@5 95% → 90%) | Shipped |
| Ronnie called an exercise still to come "already done" | 5/8 → 8/8, with a code check instead of more prompt | The check is in code ([#62](https://github.com/Yung-Chi-Wu/gympro/pull/62)) |
| Reports misread cardio sessions | 12/15 → 15/15 after rewriting how sessions reach the model | Shipped |
| Free-text goals misread | 17/20 → 20/20 after the prompt said what isn't a number ("2x bodyweight") and that a direction such as "get stronger" is no part left unread | Shipped |
| Low-volume advice ran long (four muscles in one paragraph) | Chinese advice 90–157 characters → 10–40, 18/18. The grade passed wording that read badly in two prompt rewrites (v11, v12). | Code writes the advice; the model only fits it to a note ([#65](https://github.com/Yung-Chi-Wu/gympro/pull/65)) |
| A common gym machine was missing, so a single-arm machine row couldn't be logged (the owner's Report a mistake) | 7 exercises added. Production search (gated Cohere v4): 5 new cases ranked first; the 46 earlier cases and the held-out set unchanged | Shipped ([#72](https://github.com/Yung-Chi-Wu/gympro/pull/72)) |

When an eval fails, the fix goes into code, tool design or tool results before the prompt. Evals are also used to delete prompt rules safely.

## Report backtest

Every past week of every real account is replayed with today's report code, then checked against what the account did after. The demo account is left out, since its history is made up.

- **Each week is read as the report read it then.** The real reader ([`fetch.ts`](../lambda/ai-worker/src/report/fetch.ts)) takes only what was logged by the week's end, and each week follows up the replay's own week before.
- **No model is called, so it costs nothing.** The goal is the read kept with the profile, and nothing the user said in a week is read.
- **The owner runs it:** `AWS_PROFILE=gympro-terraform npm run backtest:report -- --all`. Across accounts it keeps only counts, added up: no account, date or exercise is printed or written.
- **CI checks the scoring** ([`check-backtest.mjs`](../lambda/ai-worker/evals/backtest/check-backtest.mjs)): made-up users with known answers, such as one who lifts every plan as written, a drop that lasts, one bad day, a small dip and a stall that breaks.

| Check | Question | Outcome |
|---|---|---|
| Next-session plans | Each weighted main lift's plan for its next session ([`planNext`](../lib/report/progression.ts), as the report and Today give it) | Was the planned weight lifted, or a heavier or lighter one? At the planned weight, did every set reach the bottom of the range, or the top? |
| Regressions | A lift the report read as regressed | Back to its level before the drop within two weeks, so the drop didn't last? |
| Any drop | The plainest rule, as a baseline: any week lower than the last trained one | The same |
| Stalls | A lift the report read as stalled | Did it beat its best within two weeks? |

**First run, 2026-11-04:** 4 accounts, 30 weeks, 10 of them with the 10 sets that advice needs.

| Check | Result |
|---|---|
| Next-session plans | 45 planned. 27 were done again: the planned weight 10 times (37%), heavier 10, lighter 7. At the planned weight, every set reached the range 8 of 10 times, and the top 0 of 10. 18 not scored: 5 in the last week, 13 lifts not done again. |
| Regressions | 4 flagged, none scored yet: 3 within the last two weeks of logs, 1 not trained again in time |
| Any drop | 6, none scored yet: 5 within the last two weeks, 1 not trained again |
| Stalls | None flagged |

**What it shows so far:**
- The reps a plan names were reachable: 8 of the 10 times its weight was lifted.
- Users lift the planned weight about a third of the time, as often heavier as lighter. The sample is too small to call the steps too big or too small.
- 20 of 30 weeks had too few sets for advice, so they had no plan at all.
- The flags can't be judged until two more weeks are logged. The backtest is run again as weeks add up.

**Limits:**
- The training cycle, Ronnie's notes and the goal are read as they are now. The database keeps no history of them.
- Tiredness or pain said in a week isn't read, so the rules that need it don't fire.

**Found while building it:** a lift trained in a week where it wasn't one of the five main lifts read as not trained. Later weeks are now read by the lift's own sets, as the report's follow-up reads them ([`liftFor`](../lambda/ai-worker/src/report/facts.ts)).
