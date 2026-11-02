plan-asks-first-zh, 6 reps on claude-sonnet-5-5, with the prompt's new unit sentence (principle 2) taken out and everything else as at 84fa429. The tree was uncommitted only for that sentence, which was put back after the run.

Results: 0/6. Every reply asked days a week and session length in one sentence. With the sentence (v37) it was 2/4, so the unit sentence is not what makes Ronnie ask two at once.

The case went 14/14 through v32 (2026-10-16), and the prompt has grown on main since then (the knowledge base, the medicine rule, request_exercise, memory v2). This is a regression already on main, left for its own change: principle 5 says "one question at a time", and a sentence that joins two questions with a comma still reads to the model as one.
