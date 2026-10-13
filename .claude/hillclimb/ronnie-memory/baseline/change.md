The Ronnie without memory (main after #29, code 5c47133) on claude-sonnet-5-5, 3 reps on the 14 memory cases, before any memory code: the cases are meant to fail here for the reason each one tests.
Results: 15/42 after the regrade.
- Everything that needs a saved note failed (memory_right 0/3): the knee and shoulder injuries, the burpee dislike, the equipment, resolving and forgetting an injury, the 45-minute limit.
- memory-injury-saved-zh: the next day, 3 of 3 runs recommended an exercise that loads the knee (avoids_noted 0/3). memory-seeded-used-zh: with the injury in a memory the prompt doesn't show yet, 0/3.
- The "don't save" cases pass 3/3 (tiredness, soreness, a today-only removal, the goal) and memory-try-once-keeps-dislike passes 3/3, trivially: nothing is ever saved. They are there to catch over-saving once memory exists.
- False claims, 5 of 42 runs: "Noted." (memory-injury-saved-en), 記下了 / 記住了 / 已記下 (memory-dislike-zh, memory-dislike-flip-zh 3/3) in turns that saved nothing.
The first grader missed three of them: its pattern needed 我 before 記住. Reading the traces found it; the pattern was fixed (with those replies as check-grader controls), and regrade.mjs rescored this run for free (results.before-regrade.jsonl is the original). Only no_false_memory_claim changed, on those three rows.
