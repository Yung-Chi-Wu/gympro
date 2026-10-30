# How the AI parts are built

The detail behind [the README](../README.md): Ronnie, an agent; Coach G and the weekly report, workflows.

## Ronnie, an agent

[`lib/ronnie`](../lib/ronnie): Claude Sonnet 5.5 in a tool-use loop.

| Tools | |
|---|---|
| Read | `get_today_workout`, `get_workout_history`, `get_training_summary`, `get_routine_exercises`, `search_exercises`, `search_knowledge` |
| Change today | `add_exercise_today`, `remove_exercise_today`, `recommend_exercise` (a swap card) |
| Change routines | `propose_routine_change`, `plan_routines` (a plan card, built by Coach G's planner) |
| Memory | `remember`, `forget` |
| Requests | `request_exercise`: asks the owner to add an exercise the library doesn't have |

- **Who decides a change.** A change to today's workout that the user names, Ronnie makes at once. A change Ronnie picks, and any change to a routine, is shown as a card, and code applies it after the tap. Removing an exercise from a routine asks twice. The model never makes a permanent change itself; that is enforced by code, not by the prompt.
- **Research notes.** [`lib/ronnie/knowledge-notes.json`](../lib/ronnie/knowledge-notes.json) holds one note per paper, 151 in all. Each was written from the paper's abstract and checked against it, and each DOI was resolved through LibKey. Search ranks the notes by Cohere vectors in pgvector.
  - **Topic pages:** [`lib/ronnie/knowledge-pages.json`](../lib/ronnie/knowledge-pages.json) holds 26 pages, one per subject, for example cardio with lifting, protein, or fat loss. Each page says where the notes agree, where they are unsure or conflict, and what that means for training. Every line cites the notes it comes from. They were written once from the notes, each line checked against its notes by a second reader, and CI checks that every number in a line is in a note it cites. Given to Ronnie with the notes, they made its answers no better (see below), so Ronnie gets the notes alone; the weekly report is to use the pages.
  - **Citations:** Ronnie marks a sentence with a note's key. Code turns the keys into the papers listed under the reply, so a source shown is always one Ronnie was given. A key it wasn't given is dropped. The chat shows the list as one line ("See 3 sources") that opens it, with no number after each tip.
  - **Check:** before the reply is shown, Claude Haiku reads it against the notes. A finding presented as research that no note supports, or that goes past its note, is sent back once for a rewrite.
  - **No note:** general advice that no note covers stays in the reply, with a line under it saying it has no research source. Code adds that line to any reply that searched the notes and cites none.
  - **Medicines:** Ronnie may say what research found about a medicine and how it works, but never whether, when, how much or how often to take one; it sends the user to a doctor or pharmacist. The advice is a prompt rule, measured by four eval questions. The referral is checked by code: a reply about a medicine that names no doctor or pharmacist gets a line under it saying so. Supplements such as creatine are not medicines here.
- **Memory.** The kinds the code acts on have fixed slots:
  - one injury per joint, active or resolved;
  - a like or dislike per exercise;
  - equipment;
  - schedule.

  A new fact replaces the old one in code. Everything else goes into up to 30 free-text notes. The "saved" line under a reply is written by code from what was actually stored.
- **Reply check.** Before a reply is shown, code reads it clause by clause. It looks for a claim that an exercise was done while today's log has no sets of it.
  - If it finds one, the model rewrites the reply once, without tools.
  - If the claim survives, a correction in the code's words is added.

  This took the case that kept failing from 5/8 to 8/8 passing ([#62](https://github.com/Yung-Chi-Wu/gympro/pull/62)).
- **Exercise search.** Keyword ranking, with plurals, word order and near-miss Chinese names, runs alongside pgvector search over Cohere Embed v4 vectors. If the keywords match a name, both rankings are fused with reciprocal rank fusion, so a typed name stays on top. Otherwise the vector ranking is used. Filters cover the main muscle and low load on a painful joint.

## Coach G, a workflow

- [`lib/coach-g-planner.ts`](../lib/coach-g-planner.ts) builds the week in code:
  - the split, from the days a week;
  - each day's exercises, from a fixed list per slot, leaving out those with high load on an injured joint;
  - sets and reps, from the goal, the level and the session's length.

  The same answers always give the same plan.
- Claude Haiku 4.5 only reads the user's free text, such as injuries and exercises asked for by name.
- The result is validated and saved in one database transaction.

## Weekly report, a workflow

[`lambda/ai-worker/src/report`](../lambda/ai-worker/src/report) runs these steps. A week under 10 working sets stops after step 2: it is saved with its facts alone, and the goal shows as read before while its text is the same, so the week makes no model call.

1. **Goal and messages:** Claude Haiku 4.5 reads the goal the user wrote in their own words into targets: a lift's load or reps, a body weight, a body fat, or the body parts a physique goal names. Code keeps only what checks out, such as an exercise from the library and a number in range, and converts it to kg. Each text is read once, and the report shows what was read.
   - Haiku also reads what the user said during the period, in day notes and in their own messages to Ronnie, into a few signals: pain and where, soreness, tiredness, illness, time away. Code keeps a signal only when its words are in the text it came from.
   - The report lists these signals, with Ronnie's memory notes, so the user sees what it went on.
2. **Facts:** the numbers are computed in code. That covers sets per muscle, with half sets for secondary muscles, estimated 1RM trends, missed sessions, body weight, cardio minutes, and how far each goal target is. Cardio minutes are rated by heart rate where one was logged: moderate at 64–76% and vigorous at 77–95% of a maximum estimated as 208 − 0.7 × age (ACSM; Tanaka 2001). The report also tracks heart rate at the same machine setting over time, and never says to do more or less cardio.
3. **Rules:** a rule table fires on those facts, for example deload, regression, stall, low volume, missed sessions, weight trend, and cardio before legs. For low volume, code also picks the exercises to add the sets with: at most 2 more sets a week, none without a goal, and for a strength goal only for the muscles of a stalled goal lift.
   - **Deload:** it fires when several main lifts drop together, or when the user said they were tired and their lifts dropped.
   - **Missed sessions:** under 3 in 4 planned sessions done two periods running, with no reason given, the advice is a smaller plan the user can keep, and nothing is added.
   - **Too few days:** under 2 training days a week, the report suggests 2 (WHO 2020), unless the user said they were ill or away.
4. **Next session:** code works out each main lift's next session from the user's own sets. It keeps the heaviest weight and adds reps up to two more, then the smallest step for the equipment in the user's unit (double progression).
   - **The goal's lifts:** each lift the goal names gets that plan first, then the other ways research supports. A strength goal gets heavier sets, and a lift trained once a week a second day. A first pull-up goes through the pulldown or the assisted pull-up the user already does.
   - **What the user said:** a lift that hurt this period is held at its weight, with a lighter alternative. An injury in Ronnie's notes rules out the heavier options, and an exercise the user doesn't want is never suggested.
   - **A lighter week:** a deload replaces the plan. Each main lift gets a line about 10% lighter, with half the sets.
   - **Text:** code writes all of it, in both languages.
5. **Words:** Claude Sonnet 4.6 phrases only the rules that fired. Low-volume advice is the exception: code writes it, a line per muscle with its options, and the model adds one sentence only when the user's note bears on them.
   - Code checks the text before it's saved: Traditional, not Simplified, characters; punctuation; no Markdown; the user's weight unit; headline length; and that each action names every finding of its rule.
   - A failure is retried with the specific error.
   - After two failures, a code template is used.
6. **Research:** each rule's research line comes from a table of 27 papers in [`lib/report/evidence.ts`](../lib/report/evidence.ts), not from the model.
