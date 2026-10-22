# orchestrator

The plugin whose hooks drive a story issue from Ready to merge inside the agent session. Its decisions
are in `docs/adr/`.

## Setting up a served repo

1. Create and install three GitHub Apps, each with exactly the permissions its record lists and on no
   ruleset bypass list: `codeworks-orchestrator` (ADR-0001), `codeworks-session` (root ADR-0007) and
   `codeworks-reviewer` (reviewer ADR-0011).
2. Provision the agent environment (root ADR-0008): no human GitHub credential on it, the managed
   settings in `SECURITY.md` installed, and the three App keys, the validator modules' tokens (for
   example a DeepSource token) and the classifier key in `~/.config/codeworks/`. Where
   planner runs, keep the session App's key for reviewer's hook (root ADR-0007).
3. Install the orchestrator, builder and reviewer plugins in the agent environment.
4. Delete the `PR_GATE_APP_KEY` Actions secret; the orchestrator writes each module's
   `<module>-review`, for example `codex-review` (ADR-0008).
5. Add the ruleset and the repo settings ADR-0009 requires.
6. Install each external reviewer, for example Codex or CodeRabbit, its automatic review off wherever
   its module triggers it (ADR-0008).
7. Spell the board's lanes Backlog, Ready, In progress, In review, Blocked, Done.
8. Start one session in the agent environment (`claude -p`, or by hand); the orchestrator's hooks take
   it from there.
