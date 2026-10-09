Code 79ea578 on claude-sonnet-5-5, 5 reps: v19's swap fix plus get_training_summary naming this week (so far, day N of 7) and last week, marking clipped weeks partial, and giving sets, sessions and best set per exercise instead of best sets only.
Holdout 100% (25/25). Median latency 3.7 s.

CORRECTION (2026-10-08): the eval bundle (evals/ronnie/dist/ronnie.cjs) was not rebuilt after 79ea578, so v20 ran v19's code (f8fd09a): the training-summary change was never tested here. v20 is a second run of v19's code. Read it as test-retest noise: knowledge-bench-plateau-zh scored 1/5 in v19 and 4/5 in v20 on identical code, and swap-pick-en 5/5 then 4/5.
