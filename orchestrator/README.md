# orchestrator

The deterministic script that drives a story issue from Ready to merge. Its decisions are in `docs/adr/`.

## Setting up a served repo

1. Create and install three GitHub Apps, each with exactly the permissions its record lists and on no
   ruleset bypass list: `codeworks-orchestrator` (ADR-0001), its key only on the orchestrator's host;
   `codeworks-session` (root ADR-0007) and `codeworks-reviewer` (reviewer ADR-0011), their keys on every
   machine that runs a session.
2. Install the managed settings root ADR-0008 lists on every machine that runs a session.
3. Delete the `PR_GATE_APP_KEY` Actions secret; the orchestrator writes `codex-review` (ADR-0008).
4. Add the ruleset and the repo settings ADR-0009 requires.
5. Install Codex with Automatic review off (ADR-0008), and CodeRabbit.
6. Spell the board's lanes Backlog, Ready, In progress, In review, Blocked, Done.
