# Data Model: The orchestrator plugin carries core

Field-level shapes live in [contracts/](contracts/); this file names each entity, its one writer, and how it
changes.

## OrchestratorSettings

`[orchestrator]` of `codeworks.toml`, beside core's `Shared`. Writer: none at runtime (no session writes the
file, root ADR-0002 d1). Read per R5. Shape: [contracts/orchestrator-settings.md](contracts/orchestrator-settings.md).

## SessionToken (stored)

Core's `StoredToken` in the gh config folder. Writer: the orchestrator's SessionStart, UserPromptSubmit and
PreToolUse hooks. Readers: the model's `gh` and git, reviewer, builder.
Rule: replaced whole when `needsMint(stored, repo, now)`; never repaired (`GhFolderRefused`).
Shape: [contracts/gh-config-folder.md](contracts/gh-config-folder.md).

## SessionRecord

The session's issue. Writer: the orchestrator's UserPromptSubmit hook, once per session, after the lane write.
Readers: reviewer (releases on `claim`; its fence, reviewer ADR-0015 d1), builder, the orchestrator's later
hooks. Shape: [contracts/session-record.md](contracts/session-record.md).

States: absent → written (`claim` | `resume`). No transition out of written: a prompt naming another issue is
refused naming the recorded one.

## StartFacts → StartDecision

Read in one UserPromptSubmit run: `lane`, `blockers: {issue, done}[]`, `specIssue`, `specPr: SpecPr | null`,
`subIssues: number[]`, `done`, `state: StateReading`. `decideStart(issue, facts)` returns one of:

| Facts | Decision | Writes, in order |
|---|---|---|
| Ready, blockers done, spec PR merged and none open, no sub-issues, not done, `startable` | `start` | lane Ready → In progress; record `claim` |
| In progress or In review, state not held | `resume` | record `resume` |
| Ready, not `startable` | `refuse` (open holds) | lane → Blocked, no comment |
| Ready, spec PR open or none merged | `refuse` (spec PR) | keyed reason; lane → Blocked |
| Ready, sub-issues | `refuse` (parent) | keyed reason naming them; lane → Blocked |
| Backlog, Blocked, Done, no card, a blocker not done, or done | `refuse` | nothing |
| In progress or In review, state held | `refuse` (open holds) | lane → Blocked, no comment |

The card's lane is the commit point (ADR-0002 d5): a reason is posted before the move.

## KeyedComment

An orchestrator App comment whose first line is `<!-- codeworks:orchestrator-reason <key> -->`. Writer: the
orchestrator App. Posted only when none with that key exists (HANDLED, ADR-0003 d3). Keys: `spec-pr-open-<p>`,
`spec-pr-unmerged-<p>`, `parent-<s>`, `session-start-<cause>`, and the Blocked and bound keys of Stories 2–5.

## AgentIdentity (Story 2)

`{name, email}` from `~/.gitconfig` (R14). Missing or empty → the push is refused naming the key.

## PushPlan (Story 2; Story 4 adds the stage-2 inputs)

`decidePush({commits, passes, off, identity, stage, fixCommits, defaultBranchMerges})` → `push {branch, head}` or
`refuse {commit, cause}`. `passes` is the pushed branch's entry of the commit-check pass record; with `off`, a commit
needs no pass but its change must touch no `.github/` folder. One failing commit refuses all.

## CountsSnapshot (Story 5)

The orchestrator App's tagged comment on the story issue; newest wins; edited, untagged or followed by a
deletion → Blocked naming it. Shape: [contracts/counts-comment.md](contracts/counts-comment.md).

Transitions: a new snapshot at the claim or resume (session added), when a hook names a builder step (turn
count, REPEAT head and findings), and just before Stop lets the session end (session marked ended). Counts
restart from the newer of the last Ready move and the last admin `/codeworks reset`.
