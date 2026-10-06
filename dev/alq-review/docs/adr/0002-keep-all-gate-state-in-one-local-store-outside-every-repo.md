---
schemaVersion: 0.1.0
id: "0002"
title: "Keep all gate state in one local store outside every repo"
status: draft
date: 2026-10-06
deciders: []
tags: [state, ledger]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{ledger,hookio,pre_merge_gate,snapshot}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: async
externalRefs:
  - type: issue
    id: "30"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
    label: "The batch of decisions already made, written as records"
---

# ADR-0002: Keep all gate state in one local store outside every repo

Draft for the ratifier. Paths are relative to the repo root. The code was read at main @ 50c4330.

## Context

Two parts of the plugin have to meet on the same records, and neither knows what the other knows. The
docstring of `plugins/alq-review/scripts/ledger.py:3-5` gives the reason for the place and for the key:

> State lives outside every repo so that the poller, which knows a PR but no checkout, and the hooks, which
> know a checkout but no PR, meet in one place: one SQLite file whose ledgers are keyed by PR. Which PR a
> checkout means is GitHub's answer, cached per commit.

What the code does today:

- `state_root` (`plugins/alq-review/scripts/ledger.py:88`) returns `ALQ_REVIEW_STATE_DIR` when it is set.
  Otherwise it returns `alq-review` under `XDG_STATE_HOME`, or under `~/.local/state` when that is unset.
- `_connect` (`plugins/alq-review/scripts/ledger.py:105`) opens `ledger.db` in that folder.
- The `ledgers` table has the primary key `(repo, pr)` (`plugins/alq-review/scripts/ledger.py:24-28`).
- When a ledger names a checkout's branch, `pr_of` (`plugins/alq-review/scripts/gate.py:74`) asks
  `ledger.open_pr` for its PR (`plugins/alq-review/scripts/ledger.py:186`). The docstring of `open_pr` says a
  PR that GitHub names "is kept for that commit".
- The claim and shim tables have no PR in their keys (`plugins/alq-review/scripts/ledger.py:37-80`).
  Spec 005 gives the reason: "PR ledgers cannot hold these records because a commit has no PR"
  (`dev/alq-review/specs/005-claim-check-gate/research.md:128`).
- The poller hands its outcome to the gate as a file named by repo and PR, in `inbox/` under the same root
  (`plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh:262-267`). `ingest_inbox`
  (`plugins/alq-review/scripts/ledger.py:435`, "Store every poller drop in the ledger of its PR") reads each
  file there and then deletes it.

The rule is written in that docstring and in the README's State section
(`plugins/alq-review/README.md:129-145`). That section lists `ledger.db`, `inbox/`, `gate.log` and
`errors.log`. Three more things the plugin writes are not on its list, and two of them have no recorded reason:

- **Session files.** `session_file` (`plugins/alq-review/scripts/hookio.py:86`) names a JSON file per session
  in `sessions/` under the state root. It is inside the root but outside the database. The README's State
  section does not list `sessions/`. No reason recorded.
- **Merge override grants.** `_overrides` (`plugins/alq-review/scripts/pre_merge_gate.py:199`) builds its
  folder as `analitiq-merge-gate` under `XDG_STATE_HOME` or `~/.local/state`
  (`plugins/alq-review/scripts/pre_merge_gate.py:202`). That line does not read `ALQ_REVIEW_STATE_DIR`. No
  reason recorded.
- **The sweeper's copy of `HEAD`.** `folder` (`plugins/alq-review/scripts/snapshot.py:30`) names it
  `shim-<12 hex>` in `.claude/worktrees/` of the main checkout. This one has a recorded reason. Spec 006 R3
  rejected the state folder: "it is outside the project, so every read depends on the allow"
  (`dev/alq-review/specs/006-shim-check-gate/research.md:59-60`).

## Decision

1. **One place.** What a gate records goes in the state root that `ledger.state_root` returns. A gate writes
   no record into a checkout.
2. **One database.** A record that has to outlive a session goes in `ledger.db`, through
   `ledger._transaction`.
3. **Two kinds of key.** A record about a PR is keyed by `(repo, pr)`, with the PR as GitHub reports it. A
   record about a commit or a staged tree is keyed by repo and an id that needs no PR, because it may have
   none.
4. **Exceptions are named in a record.** Two are named here:
   - The sweeper's copy of `HEAD` stays beside the worktrees (spec 006 R3). It is a read copy, not a record.
   - Per-session files stay as JSON in `sessions/` under the state root.
5. **The merge override grants come under the rule.** They are to move under the state root, so that
   `ALQ_REVIEW_STATE_DIR` covers them. This is a proposal of this draft, for the ratifier to confirm.

Not in this record: the internal-review attestation, which is a PR comment on GitHub by design (see
ADR-0003), and which key a hold or a chain uses (see ADR-0001).

## Options considered

### Option A: One local folder outside every repo, one SQLite file (chosen, mostly in place)

| Dimension | Assessment |
|---|---|
| Poller and hooks meet | Yes, by `(repo, pr)` |
| Writers at the same time | The README: "every write inside a `BEGIN IMMEDIATE` transaction so concurrent writers take turns" (`plugins/alq-review/README.md:133-134`) |
| Seen by tests, lint or a commit of the repo | Not by default: the default folder is under the home directory |
| Shared between machines | No |

### Option B: Do nothing: the rule stays in a docstring and the README

Rejected: the two unrecorded stores above stay unexplained, and the next gate has no rule to follow.

### Other options, rejected

| Option | Why rejected |
|---|---|
| C. State inside the checkout | The poller "knows a PR but no checkout" (`plugins/alq-review/scripts/ledger.py:3`). |
| D. One JSON file per PR | Writers would be "losing each other's update the way a bare JSON file or a stale flock would" (`plugins/alq-review/README.md:134-135`). |
| E. A second store for the commit checks | "a second store would need its own locking" (`dev/alq-review/specs/005-claim-check-gate/research.md:127-128`). |
| F. Review ledgers on GitHub, as comments or check runs | No reason recorded. It was not found as a considered option in the sources read. |

## Trade-offs

- The state is per machine. A hold, a ledger or a switch set on one machine is not known on another.
- The state is not in any PR, so a reviewer cannot read it there.
- The folder's place depends on two environment variables.
- Session files are a second format beside the database, with their own lock
  (`plugins/alq-review/scripts/hookio.py:96-97`).

## Consequences

- Easier: a new gate adds a table to one schema and reuses one transaction. The per-repo switch of issue #26
  has a place to live.
- Harder: anything that must hold for the cron bot and for the user's machine at once cannot rest on this
  store alone.
- **How we would know this was wrong:** two machines that work on one PR disagree on whether it is locked or
  held, and that costs a wrong refusal or a wrong pass. Or a third store appears with no record.
- Revisit if: gate state has to be shared between machines.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Move the merge override grants under `ledger.state_root`, with a red test first.
3. [ ] List `sessions/` and the override grants in the README's State section.
