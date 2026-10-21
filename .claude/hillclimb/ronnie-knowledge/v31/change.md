The fixes after v30 (#78 at c00ec4a): code labels a turn that searched the notes and cites none; principle 1 says the notes add evidence to a coach's answer and take nothing from it; the volume rubric accepts either way of spreading the sets, as the notes found (the owner approved the harness); traces record the sources, the label and the check's verdicts. claude-sonnet-5-5, 3 reps on the 29 knowledge cases.
Results: pass 79/87 (v30 70/87, v29 21/87), judge 82/87 (77, 63), sourced 60/63 (56, 0), right_tools 87/87. Mean 7.0 s, 2.2 API calls.
- The 8 earlier cases: 20/24 (v30 15/24, v29 21/24). back-pain 3/3, spot-reduction 3/3, and volume 3/3 under the revised rubric, which still asks for sets close to failure. The misses aren't about the notes:
  - bench-plateau 1/3 (v29 2/3) miscounted the sessions at 82.5 kg, and rep2 made up a weekday pattern;
  - cardio-zh rep0 said to keep cardio away from push day, where the notes point at leg day;
  - creatine rep1 played the effect down, as in v29 and v30.
- The 21 new cases: judge 62/63. steps rep0 said the user's "pull days" count, a fact no tool gave.
- The label showed in 6/6 no-note runs (v30 0/6).
- All 3 sourced misses were one bug. The replies cited the right notes with full-width square brackets (U+FF3B and U+FF3D around the key), which code didn't read. They were shown with the raw keys, with no sources, and labelled general advice. v30 had the same in 3 runs (creatine rep2, steps rep1, volume rep0), so it happened in 7 of 174 runs.
- In cardio-order rep1, a rewrite after the check named K1 and K2 inside a sentence ("K1 found 3.96 kg more"), so the user would have seen the keys.

Fixed after v31:
- code reads keys in full-width square brackets, tortoise-shell brackets, and ASCII or full-width parentheses as citations;
- a key given this turn, written in a sentence, becomes its paper and is listed;
- the rewrite feedback says keys go in square brackets after the sentence.

The new code, replayed offline on v31's recorded replies with the notes each was given: sources right 63/63, and no key is left in any reply. v30's steps rep1 is fixed the same way.
