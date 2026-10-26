# orchestrator

The plugin whose hooks drive a story issue from Ready to merge inside the agent session. Its decisions
are in `docs/adr/`.

## Setting up a served repo

1. Create and install four GitHub Apps, each with exactly the permissions its record lists and on no
   ruleset bypass list: `codeworks-session`, read-only (root ADR-0007), `codeworks-orchestrator`
   (ADR-0001), `codeworks-reviewer` (reviewer ADR-0011) and `codeworks-planner` (root ADR-0007).
2. Provision the agent machine (root ADR-0008), separate from the machine where you and planner work:
   no human GitHub credential on it, the managed settings in `SECURITY.md` installed, and the session,
   orchestrator and reviewer App keys, the validator modules' tokens (for example a DeepSource token)
   and the classifier key in `~/.config/codeworks/`.
3. Install the orchestrator, builder, reviewer and auditor plugins on the agent machine. Where planner
   runs, keep the planner App's key for reviewer's hook (root ADR-0007).
4. Delete the `PR_GATE_APP_KEY` Actions secret; the orchestrator writes each module's
   `<module>-review` check run, for example `codex-review` (ADR-0008).
5. Add the ruleset and the repo settings ADR-0009 requires.
6. Install each external reviewer listed in `validators`, for example Codex, CodeRabbit or DeepSource,
   its automatic review off wherever its module triggers it (ADR-0008).
7. Spell the board's lanes Backlog, Ready, In progress, In review, Blocked, Done, and add the status
   issue to the board (ADR-0002).
8. To work a story, move its card to Ready, start a session on the agent machine with
   `--setting-sources user`, so no served repo's settings load (`SECURITY.md` §5), and name the issue:
   `/codeworks <issue>`. The orchestrator's hooks take it from there.
