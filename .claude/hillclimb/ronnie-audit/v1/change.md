# Daily review reviewer, v1

The daily review's reviewer (`lambda/ai-worker/src/audit/auditor.ts`, Opus 5.5, effort medium) was run on Ronnie eval conversations whose outcome the eval judge had already decided. The reviewer gets no rubric, as in production. Script: `lambda/ai-worker/evals/audit/check-live.mjs`. The conversations are the local eval traces from ronnie v29-v33 (fixture user only).

## Runs

1. **All 32 calls returned 400.** zod's toJSONSchema gives an integer a minimum and a maximum, and structured output refuses both. Nothing was billed. The schema is now written out, and check-audit.mjs fails on any refused keyword.
2. **First answers** (`run2-paired.txt`): 16 the judge failed, each paired with a passed rep of the same case. Caught 14/16 judge fails and flagged 4/16 judge passes. US$0.64.
3. **After two prompt changes** (`run3-paired.txt`): caught 13/16 judge fails and flagged 2/16 judge passes. US$0.64.
   - Ronnie's own words are shown apart from the lines the app adds.
   - A card presented as done before it is saved counts as false_action.
4. **Held out** (`run3-holdout.txt`): 20 passed conversations, one per case, from cases with no failure, which the prompt was not written against. Flagged 0/20. US$0.31.

## The judge was wrong twice

- **v32 elbow-high-recommend-zh rep 1** was failed for a 📝 "remembered" line. That line was the app's note receipt, which the app adds when remember is called. The reviewer was told which lines are the app's and found nothing.
- **v32 swap-question-only-zh rep 4** was passed, but its reply says the incline press already trained the front delts, while the tool result shows no sets of it. The reviewer flagged it in all three runs.

## With those two corrected (run 3)

- **Real problems:** the reviewer flagged 14 of 16.
  - Both misses are v29 plan-full-info-zh replies that open with a check mark before the plan card is saved.
  - Production now adds the app's own line under a plan card saying it replaces the routines only on Save.
- **No problem:** the reviewer flagged 1 of 16.
  - The flag says Ronnie didn't save the user's training days and equipment with remember. Ronnie's principle 8 asks for that, though the eval rubric doesn't check it.
- **Held out:** 0 of 20 flagged.

## Limits

- Runs 2 and 3 use the same 32 conversations that the prompt changes were made against. Only the held-out run is independent.
- Each conversation was read once (k=1), so the run-to-run noise is not measured.
- Every conversation is a single eval case with the fixture user, not a production day.

Total cost: US$1.61.
