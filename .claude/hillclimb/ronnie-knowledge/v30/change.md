The knowledge base (#78 at 7be6b89): search_knowledge, sources written by code, the Haiku check and the general-advice label; claude-sonnet-5-5, 3 reps on the 29 knowledge cases.
Results: pass 70/87 (v29 21/87), judge 77/87 (63/87), sourced 56/63 (0/63), right_tools 87/87. Mean 6.9 s, 2.1 API calls; 7 runs had a reply sent back by the check and rewritten.
- The 21 new cases: judge 62/63 (v29 42/63). Every cites_any case cited a right note, except steps rep1.
- The 8 earlier cases went down, 21/24 to 15/24, and they are the fairer comparison: their rubrics predate the notes.
  - volume-zh 3/3 to 0/3. The replies followed the notes: more sets, more growth, with diminishing returns (Pelland 2026), and with weekly sets equal, the number of days matters little (Schoenfeld 2019). The rubric asked for "two or more sessions a week" and failed "more is better", so it disagreed with the notes. All three also left out that sets should be close to failure, a real miss.
  - back-pain-en 2/3 to 0/3 (v27 2/3, v28 1/3): the warning signs and "see a professional" stayed, but technique and how soreness differs from a warning sign went.
  - spot-reduction-zh 3/3 to 2/3: rep0 kept crunches as a "help" for losing belly fat.
  - The common thread: given notes, Ronnie answered from them and dropped the coaching a good answer still needs.
- The general-advice label showed in none of the 6 no-note runs (belt, shoes). Every reply said "this is my own coaching advice, not research", the check returned general false each time, and code had nothing else to go on. The traces didn't record the check's verdict or the sources, so this was worked out from the grader and the replies.
- steps-zh rep0 said the user's push days meet "2+ strength days a week", a fact about the user no tool gave.

Fixes for v31: a reply that searched the notes and cites none is labelled by code, whatever the check says; principle 1 says the notes add to a coach's answer (how hard the sets are, the technique to check, which signs mean stop); the volume rubric accepts either way of spreading the sets, as the notes found; and the traces record the sources, the label and the check's verdicts.
