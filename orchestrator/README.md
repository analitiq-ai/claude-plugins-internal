# orchestrator

The deterministic script that drives a story issue from Ready to merge. Its decisions are in `docs/adr/`.

## Setting up a served repo

1. Install the org's existing GitHub App, the orchestrator's (ADR-0001).
2. Create and install the `codeworks-session` GitHub App with exactly the permissions root ADR-0007
   lists, on no ruleset bypass list.
3. Run the orchestrator as its own OS user, its App key readable by that user alone (ADR-0009).
4. Delete the `PR_GATE_APP_KEY` Actions secret; the orchestrator writes `codex-review` (ADR-0008).
5. Add the ruleset and the repo settings ADR-0009 requires.
6. Install Codex with Automatic review off (ADR-0008), and CodeRabbit.
7. Spell the board's lanes Backlog, Ready, In progress, In review, Blocked, Done.
