# orchestrator

The plugin whose hooks drive a story issue from Ready to merge inside the agent session. Its decisions
are in `docs/adr/`.

## Setting up a served repo

1. Create and install four GitHub Apps, each with exactly the permissions its record lists and on no
   ruleset bypass list: `codeworks-session`, read-only (root ADR-0007), `codeworks-orchestrator`
   (ADR-0001), `codeworks-reviewer` (reviewer ADR-0011) and `codeworks-planner` (root ADR-0007).
2. Provision the agent machine (root ADR-0008), separate from the machine where you and planner work:
   no admin GitHub credential on it; Claude Code signed in with a claude.ai account; the managed
   settings in `SECURITY.md` installed as the one managed source; the agent identity set once as the
   global git `user.name` and `user.email`; and the session, orchestrator and reviewer App keys, the
   validator modules' tokens and the classifier key in `~/.config/codeworks/`.
3. Install the plugins on the agent machine as the root `README.md` shows. Where planner runs, keep the
   planner App's key for planner's hook (root ADR-0007).
4. Delete the `PR_GATE_APP_KEY` Actions secret; the orchestrator writes each module's
   `<module>-review` check run, for example `codex-review` (ADR-0008).
5. Add the ruleset and the repo settings ADR-0009 requires.
6. Install each external reviewer listed in `validators`, as its package in `validators/<name>/` says
   (root ADR-0003), its automatic review off wherever its module triggers it (ADR-0008).
7. Name the board in `board` under `[shared]` in `codeworks.toml`, spell its lanes Backlog, Ready,
   In progress, In review, Blocked, Done (ADR-0002), and add to it a status issue, where the orchestrator
   posts a failure that belongs to no story.
8. To work a story, move its card to Ready, start a session on the agent machine with
   `claude --setting-sources "" --permission-mode bypassPermissions`, so no served repo's settings load
   (`SECURITY.md` §5), and name the issue: `/codeworks <issue>`. The orchestrator's hooks take it from
   there. The same prompt resumes a story In progress or In review.
