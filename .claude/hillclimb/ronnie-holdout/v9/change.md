Acceptance run on the sealed holdout set (cases-holdout.json), code a02249f, 5 reps. Same harness sha as the dev flow.
Result: pass 96%, no wrong change, asks_first 100%, judge 90%. One failure: holdout-month-legs-zh rep 4 gave the leg session a date (10/07, 週二) - get_training_summary reports weeks, not dates. This case is now seen: replace it before the next acceptance run.
