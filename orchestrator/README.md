# orchestrator

The plugin whose hooks drive a story issue from Ready to merge inside the agent session. Its decisions
are in `docs/adr/`.

## Setting up a served repo

1. Create and install four GitHub Apps, each with exactly the permissions its record lists and on no
   ruleset bypass list but the one step 6 names: `codeworks-session`, read-only (root ADR-0007),
   `codeworks-orchestrator` (ADR-0001), `codeworks-reviewer` (reviewer ADR-0011) and `codeworks-planner`
   (root ADR-0007).
2. Provision the agent machine (root ADR-0008), separate from the machine where you and planner work:
   no admin GitHub credential on it; Claude Code signed in with a claude.ai account; the managed
   settings in `SECURITY.md` installed as the one managed source; the agent identity set once as the
   global git `user.name` and `user.email`; and the session, orchestrator and reviewer App keys, the
   validator modules' tokens and the classifier key in `~/.config/codeworks/`.
3. Install the plugins on the agent machine as the root `README.md` shows. Where planner runs, keep the
   planner App's key for planner's scripts (root ADR-0007).
4. Delete the `PR_GATE_APP_KEY` Actions secret; the orchestrator writes each module's
   `<module>-review` check run, for example `codex-review` (ADR-0008).
5. Add the ruleset and the repo settings ADR-0009 requires.
6. Create the branch where reviewer records each story's rounds and holds (#288), from your machine, as an
   orphan with one empty commit: `git switch --orphan ledger`, `git commit --allow-empty -m ledger`,
   `git push origin ledger`. Then add three rulesets on `refs/heads/ledger`, one per guarantee, since a
   bypass exempts its actors from every rule in its ruleset:
   - block force pushes and restrict deletions; bypass list empty;
   - restrict updates; bypass list: the `codeworks-reviewer` App and the repository admin role, the only
     two who can commit there, the admin only to delete a file the record must not count;
   - require signed commits; bypass list empty. GitHub signs what the App commits through its API and
     refuses a commit made with a custom author.
7. Install each external reviewer listed in `validators`, as its package in `validators/<name>/` says
   (root ADR-0003), its automatic review off wherever its module triggers it (ADR-0008).
8. Name the board in `board` under `[shared]` in `codeworks.toml`, spell its lanes Backlog, Ready,
   In progress, In review, Blocked, Done (ADR-0002), and add to it a status issue, where the orchestrator
   posts a failure that belongs to no story.
9. To work a story, move its card to Ready, run `mkdir -p ../<repo>.worktrees` in the served repo's main
   checkout on the agent machine, start a session there with
   `claude --setting-sources "" --permission-mode bypassPermissions --add-dir ../<repo>.worktrees`, so no
   served repo's settings load and builder can write its worktrees (`SECURITY.md` §5), and name the issue:
   `/codeworks <issue>`. The orchestrator's hooks take it from
   there. The same prompt resumes a story In progress or In review.
