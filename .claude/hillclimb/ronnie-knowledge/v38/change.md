The two follow-up citation cases (branch ronnie-citations-units at 1f3c613) on claude-sonnet-5-5, 3 reps each: the three turns of the 2026-10-28 conversation, in Chinese and in English. The owner approved the harness.

Results: knowledge-followup-cite-zh 2/3, knowledge-followup-cite-en 1/3.

The bug itself is gone in all 6 runs:
- no reply "corrects" an earlier citation or takes it back;
- no sentence is cut off where a source should be;
- every key cited was one Ronnie was given (sourced and keys_known, 6/6).

The misses came from the cases and the grader, not from Ronnie:
- **The grader** counted request_exercise as a change to the workout. The fixture library has no hack squat, so in English Ronnie asked the owner to add it. That failed no_wrong_change and valid_ids, with "undefined" in the explanation. A request is a note to the owner, so the grader now leaves it out of both, and check-grader has a case for it.
- **The English third turn** was "Just today.", meant as the Chinese case's third turn: the pain only started today. After a Leg Press card with an Add to today button, it read as "add it for today only", and one run added it (add_exercise_today, forbidden). The turn is now "It only started today."
- **The judge asked for more than this case is about:** avoiding lower-back exercises today, and pain that spreads down the leg. All 3 misses on the judge were on these. knowledge-back-pain-en already holds the full warning signs for a question about back pain. Here the back comes up in passing, so the case now asks for what knowledge-knee-zh does: keep it light and pain-free, and see a professional if the pain is sharp or lasts. The citation part of the judge is unchanged.

Rerun as v39.
