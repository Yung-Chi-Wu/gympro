Model: claude-sonnet-4-6 (same as baseline), with three code/prompt changes:

1. Progress status is computed in code by the agreed rule and given to Claude; Claude only writes the notes.
2. Prompt principle: only well-established physiological claims (no hormone-myth reasoning).
3. Zod validation of the tool input, with one retry when malformed.

Expected: status_correct to 100% by construction, sound_advice up (all 9 baseline failures were the hormone myth), everything else unchanged.
