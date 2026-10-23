Baseline for the topic pages (#79 at 906048d): RONNIE_PAGES=off, so Ronnie gets the notes alone, as production did after #78. claude-sonnet-5-5, 3 reps on 33 knowledge cases: the 29 from v31 plus 4 where a good answer puts several notes together or the notes conflict (nsaid, concurrent-week, cut-muscle, short-time). The owner approved the harness.
Results: pass 91/99, judge 92/99, sourced 74/75, right_tools 99/99. Mean 7.5 s, 2.16 API calls, about 15,500 input tokens a run.
- The 8 earliest cases: 21/24.
  - bench-plateau 1/3. The bench numbers were right, but the replies misstated the rest of the log: that the other lifts had gone up this week, or that push day had no bench accessories, though the log has three.
  - spot-reduction 2/3.
- The 4 new cases: 8/12.
  - concurrent-week 3/3 and cut-muscle 3/3: Ronnie put several notes together without a page.
  - short-time 2/3.
  - nsaid 0/3: every run stated the conflict between the two trials, then said occasional use is probably fine but not daily, which the rubric counts as dosing advice.
- The other 21: 63/63.
- belt rep2 cited a side note (raising load 2-10%) in a reply that was otherwise general advice, so it had sources and no label.
