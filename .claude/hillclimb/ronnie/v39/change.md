The trimmed fix (branch ronnie-citations-units at 38d043f) on claude-sonnet-5-5. The unit rule is no longer its own sentence: principle 2 now reads "numbers come only from tool results, as they give them: a weight stays in the user's unit". The lb cases use the fixture user's own goal, written in kg, like the owner's account, and the judge tells quoting the goal apart from converting the log. The word check (mentions_none) and the per-case goal are gone. The owner approved the harness.

The lb cases ran 3 reps each, then the full set once.

Results:
- **lb cases: 5/6.** In all 6, every weight from the log was in lb. The kg goal was given in the user's unit too: "100 公斤（約 220lb）", "Your 100kg goal is about 220lb". The miss said the push day had been the same for 3 weeks, where it was about 9 days. That is the history miscount seen in v36, not a unit.
- **Full set: 38/39.** plan-asks-first-zh passed this time.
- **The miss was add-after-recommend-en, and Ronnie was right.** The recommended Incline Dumbbell Press was already in today's workout. recommend_exercise said so, and the reply told the user there was nothing to add. The grader only takes "already planned" from a get_today_workout result in the same turn, so it failed change_done. This is a grader gap. Ronnie made no mistake, and the grader is left as it is in this change.

Spend for this change, ronnie v35-v39 and ronnie-knowledge v38-v39, from the recorded tokens: about US$5.73.
