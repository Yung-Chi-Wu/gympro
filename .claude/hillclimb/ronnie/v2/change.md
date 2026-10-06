Ronnie 2c (commit 92273f7), model claude-haiku-4-5 (same as baseline)

Principle fixes: code-computed date table in the prompt; get_training_summary for all totals; tolerant exercise search in code; IDs in every exercise listing and checked removals; permanent routine changes only proposed (propose_routine_change); full history with tool results kept across turns (old bulky results compacted); tools-off final call when the tool budget runs out; prompt rewritten as nine principles.

The harness models the new architecture: history carries tool calls between turns, and proposals are recorded instead of writes.
