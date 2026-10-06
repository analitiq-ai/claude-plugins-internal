# Research: Shim check before commit

Facts about the plugin were read from `.claude/plugins/alq-review/` at 0.7.0 (`gate.py`, `claimgate.py`,
`claimcheck.py`, `ledger.py`, `hookio.py`, `workflows/claim-check.js`, `hooks/hooks.json`, `agents/`). The sweep
prompt, Jev questions and replay inputs are the design page's, cross-checked against the replay scripts that
produced its evidence table. Jev's request shape and limits are from the `jev` skill (`SKILL.md`, `jev.py`).

## R1: The commit is intercepted by the existing gate, after the claim check

- **Decision**: `gate.on_bash` already calls `claimgate.on_commit` for every `Action("commit")`. A new
  `shimgate.on_commit` is called right after it, so a commit passes only when both allow. It refuses through a
  new `hookio.refuse_shim` under its own setting `shim_checks` (`log` | `enforce`, env `ALQ_REVIEW_SHIM_CHECKS`),
  read by the existing `_setting`, shipped as `enforce`. The preconditions both checks share (empty commit,
  concluding merge/cherry-pick/revert, staging flags, `git commit` not alone) move out of
  `claimcheck.commit_decision` into one `claimcheck.commit_preconditions`, called by both decisions.
- **Rationale**: Spec FR-001/FR-013/FR-014. One commit hook, one refusal format. The shared preconditions must
  be one function: under `claim_checks=log` the claim decision only records, so the shim decision cannot rely on
  it having refused a staging flag. The commit-time decision only reads the ledger, so the hook stays fast.
- **Existing tools**: `gate.on_bash`, `shell.classify`, `hookio._setting` / `_refuse_under`: fit, as for spec
  005 R1. A git `pre-commit` hook: does not fit, it cannot launch a workflow and `--no-verify` skips it.

## R2: Hunk labels come from the claim check's read of the same staged tree

- **Decision**: The shim check reads `labels` from the claim check record of the same tree (`claim_checks`,
  keyed by `git write-tree`). The shim launch refuses until that record has a label for every hunk, naming
  `alq-review:claim-check`. Only `CODE` and `MIXED` hunks go to the sweep and to Jev; a tree whose hunks are all
  `PROSE` gets a `complete` shim record with no sweep (`mode: none`).
- **Rationale**: FR-002 and define-once: the reader, its prompt, its validator and its per-patch-id cache
  already exist. Running a second reader would let two labels for one hunk disagree. Ordering is natural: the
  claim check refuses the commit first.
- **Existing tools**: `claim_checks.labels`, `claim_reads` cache: fit. Jev as labeller (the skill notes 6 of 8 on
  a spot check, never scored): rejected, the Sonnet reader is the decided source.

## R3: The sweep reads a snapshot of `HEAD`, beside the worktrees, with Read, Glob and Grep only

- **Decision**: At launch the gate exports `HEAD` with `git archive HEAD | tar -x` into
  `<main checkout>/.claude/worktrees/shim-<12 hex of sha256(HEAD, staged tree)>/`, where the main checkout is the
  parent of `git rev-parse --git-common-dir`. Each check owns its folder, so a check that ends never deletes one
  another check is still sweeping (two worktrees can share a `HEAD`). A new agent `agents/shim-sweeper.md` (Sonnet, effort medium) has `tools: Read,
  Glob, Grep` and no Bash; its prompt names the snapshot path and is the design's sweep task verbatim. The gate's
  PreToolUse handler returns `permissionDecision: allow` for a `shim-sweeper` Read, Glob or Grep whose resolved
  path is inside that snapshot. The snapshot is deleted when its check reaches `complete` or `failed`, and a
  relaunch exports it again. A launch that starts or restarts a check at a checkout ends, as `failed`, every sweeping or judging
  check of another tree or `HEAD` there, and deletes its snapshot. Before deleting, the gate checks that the resolved path is a `shim-*` folder directly
  under `.claude/worktrees/`.
- **Rationale**: FR-003 says the tree before the change; on the staged tree the fixed site no longer shows the
  old behaviour. Read, Glob and Grep cannot write or run anything, so read-only holds by the tool set, with no
  hand-kept list of allowed commands or options (critique 1 E4). The path-prefix allow keeps a headless run from
  stopping at a permission prompt wherever the session started (critique 1 E3). Beside the worktrees, the
  snapshot is outside every agent worktree, so tests, lint and Docker builds run in a worktree never see it
  (critique 2 E1: `COPY . .`, vitest's default include and eslint's `**/*.ts` all pick up a folder inside the
  checkout). From the main checkout it is as visible as the worktrees already are; that is fixed once per repo by
  listing `.claude/` in its ignore files, not by this feature. Measured export time: 0.10–0.19 s for plugins,
  frontend and infra (17–26 MB), so deleting and re-exporting costs nothing noticeable. Not under `.git/`: Claude
  Code denies writes there.
- **Existing tools**: `git archive`: fits; it leaves out `export-ignore` paths and submodule contents, so sites
  there are not swept (Limits). A Bash sweeper limited to `git grep/show/ls-tree <sha>`: rejected (critique 1
  E4, E3). `git worktree add`: rejected, it registers a worktree that `git worktree list` and cleanup then see.
  A folder inside the checkout being committed: rejected (critique 2 E1). The plugin state folder: rejected, it
  is outside the project, so every read depends on the allow.
- **Spike (T001, 2026-10-02, Claude Code 2.1.287)**: a headless `claude -p` run, `--permission-mode default`,
  project settings only. A subagent with tools Read, Glob and Grep read a file outside the project. Without a hook
  the read was refused as outside the working directory; with a PreToolUse hook returning
  `permissionDecision: allow` it succeeded. The payload carried `agent_type` (the agent's name) and `agent_id`;
  workflow agents already carry a namespaced `agent_type` (`gate.py` routes their StructuredOutput by it). One
  `gate.py` round trip costs 76 ms against 30 ms for a bare `python3`, so the allow is a separate lean hook
  (`scripts/sweeper_read.py`, json and os only) on its own `Read|Glob|Grep` entry, not the full gate on every
  read. Glob and Grep default to the session's working directory when given no `path`, which is the staged tree,
  not the snapshot; so for `alq-review:shim-sweeper` the hook denies any Read, Glob or Grep whose resolved path is
  not inside a `shim-<12 hex>` folder directly under `.claude/worktrees/`, including a call with no path.

## R4: One workflow, ordered by the gate, in three modes

- **Decision**: `workflows/shim-check.js`, launched as `Workflow(name='alq-review:shim-check', args={worktree})`
  (contests add `contests`, R8). Like `claim-check.js` it only orders work; the gate injects prompts, schemas,
  the code/mixed diff, the `HEAD` sha and the mode through `updatedInput`. Modes, chosen by the gate from the
  ledger, never by the caller: `not_fix` (Jev's `kind` said the change fixes no defect, R6; no agent), `sweep`
  (one sweeper), `deep` (R10: three sweepers in parallel), `rejudge` (no agent; contests and a chain with a deep
  list only need Jev, R8/R10). A sweeper that returns nothing makes the result `INCOMPLETE`.
- **Rationale**: FR-013 reuses the gate-injected-args shape so the prompt and the validator cannot drift
  (`briefs.py`). Mode chosen by the gate keeps the agent from asking for the cheap path.
- **Existing tools**: `claim-check.js` and `review-round.js` as templates; `agent()`, `parallel()`: fit.

## R5: Sweep output is schema-pinned and checked against `HEAD` before it is recorded

- **Decision**: The sweeper answers through a JSON schema of two lists, each entry `{file, line, function,
  does}`. `shimcheck.validate_sweep` rejects: a `file` not in `HEAD` (`git cat-file -e <sha>:<path>`), a `line`
  past its end, an empty `function` or `does`, the same `(file, function)` twice in one list. A site's id is the
  first 16 hex of sha256 of `file \0 function`. Rejected output goes back to the agent with the reasons, as the
  claim check does.
- **Rationale**: FR-003. A site that does not exist cannot be fixed or contested; the id must survive line
  drift inside one chain (R9) and be short enough to type in a contest.
- **Existing tools**: `gate.on_structured_output` / `after_structured_output` routing by an owning module
  (`claimgate.owns`): fit, `shimgate.owns` is a sibling. `git cat-file -e`: fits.

## R6: Jev decides `kind` at launch, then `level` and `coverage` from the hook that records the last sweep

- **Decision**: A new `scripts/jev.py` in the plugin: one stdlib POST to the OpenRouter `systemone` endpoint,
  model `typesafe/jev-1.13`, key from `~/.config/openrouter/key` (override `JEV_KEY_FILE`), 30 s timeout. At
  launch, the gate asks `kind` over the code/mixed diff alone (`fix`: the change corrects a defect in existing
  behaviour; `not_fix`: it adds, restructures or removes behaviour without correcting a defect). `not_fix` records a
  `complete` check with no sweep and logs the label (spec FR-005). When the last expected sweep output of a check is recorded (`after_structured_output`), the hook builds the state
  (`COMMIT DIFF` of code/mixed hunks, then `SAME OPERATION` and `CALLERS/CONSUMERS` as the replay did, minus sites
  ruled `not_shared` or open-`deferred`) and asks `level` and `coverage` in one request, with the exact
  instructions and criteria of the replay's `jev_fix.py`. The replay's third question (`verdict`) is not sent.
  `hooks.json` gives the PostToolUse entry an explicit timeout above the request timeout.
- **Spike (T002, 2026-10-02)**: 5 `kind` and 5 `level`+`coverage` calls over the largest replay diff (8a219ca0,
  70 kB) took 0.39–0.63 s each, at about $0.0008–0.0009 per call, with the same answers every time. The request
  timeout stays at 30 s, nearly 50 times the slowest call, so a slow network is not mistaken for a failure. The
  gate's PreToolUse and PostToolUse entries (`gate.py`) get a 60 s timeout. A launch may ask Jev up to four times
  (three `kind` asks, then `level`+`coverage` against a deep sweep's list), so the hook allows itself 40 s of Jev:
  each call's socket timeout is at most what is left of it, and no call is made once it is spent. A Jev that stops
  answering then fails the check, which is recorded before the hook ends.
- **Early replay (2026-10-02, before T047, on `tests/fixtures/shim-replay/`; the gate's state, so no commit
  message)**:
  - The 13 evidence commits: 12 match the table. 053e0ec9 comes out `patch` (cause, edited_only), not
    `complete`; the table's `complete` was obtained with the message in the state. 6aa17485 is labelled
    `not_fix` and is still `complete`.
  - The 18 non-fix commits: 8 are labelled `fix` (180ffb43, 18bb6a7a, 1c5b4cdf, 8dae9233, 92351857, a101fef7,
    bf174c7b, e84067b2). SC-001 allows at most 1. Read by hand, 3 of the 8 do correct a defect despite a `feat`
    subject (18bb6a7a, 92351857, e84067b2). The other 5 are plain features or refactors.
  - So `kind` as worded does not separate fixes from other changes. Stopped pending the user's decision; the
    question was not tuned.
- **Replay (T047, 2026-10-02, `tests/replay_shim.py`, live Jev)**: SC-001 scores only the evidence fixes (the
  user's call: catching real fixes is what counts; non-fix commits are not scored).
  - Asked once, `kind` labelled 619ff3b6, a real patch, `not_fix` in 1 of 5 asks, which lets it through unswept.
    `ask_kind` now asks up to 3 times and takes any `fix`.
  - With that, 5 replays in a row gave every evidence fix its expected verdict, about $0.007 each.
- **Live run (T049, 2026-10-02)**: quickstart §2 in a headless session inside a worktree of a local scratch repo.
  Refused as `patch` (cause, edited_only) listing `load_team`, then committed once both were fixed. Each sweeper
  made one Grep under the snapshot and nothing else, with no denial or prompt; the snapshot was gone after each
  verdict. 65 s for the whole session, two claim checks and two shim checks included (SC-003: 4 min).
- **Rationale**: FR-005/FR-006. `level` presupposes a defect, and the replay covered fix commits only (critique
  X1); asking `kind` first keeps features and refactors out of a judgement that does not apply to them, and skips
  their sweep. One Jev call is about a second, so it fits in the launch hook. The fix questions are copied
  verbatim because SC-001 rests on them; `kind` is new and is replayed on non-fix commits (SC-001). Calling from the
  recording hook means the verdict exists before the author tries to commit, and the commit hook stays a ledger
  read. The plugin cannot call the user-level skill script: the bot runs the plugin without the user's
  `~/.claude/skills`.
- **Existing tools**: `jev` skill `jev.py`: fits as the reference for the request, not as a dependency (user
  level, `sys.exit` on error). OpenRouter SDKs: not used, the call is one POST.

## R7: The verdict is composed in code, and a contested site is ruled by a fresh judge

- **Decision**: `shimcheck.verdict(level, coverage)`: `complete` iff `level == cause` and
  `coverage in (all, none_other)`. A contested site is ruled by a new `agents/shim-site-judge.md` (Sonnet, effort
  high, `tools: Read, Glob, Grep`), given the diff, the site, the author's reason and the other listed sites. It
  answers `shares`, `not_shared` or `deferred` with `file:line` evidence; `deferred` must name an issue number.
  The review-round `assessor` is not reused.
- **Rationale**: FR-006/FR-009. The assessor starts from `briefs.py --ref <round_ref>` and rules a round of a PR
  ledger; bending it to rule one site with no round and no PR is the special case that breaks it (the spec's
  "assessor" is defined as an independent judge of the same standing). The judge is read-only by tool list.
- **Existing tools**: `claim-contest-judge.md` as the frontmatter template: fits. `assessor.md`: rejected, above.

## R8: A contest is checked by the gate, ruled once, and re-judged without a new sweep

- **Decision**: `args.contests = [{site: '<id>', reason: '<text>'}]`. The gate accepts a contest only for a site
  in the chain's current list that has no ruling, with a non-empty reason; otherwise it refuses before any agent
  runs. Rulings are stored per chain and site (`shim_rulings`), so a site is never ruled twice for one bug
  (SC-005). A `deferred` ruling is accepted only if `gh issue view <n> --json state` says `OPEN` in the same repo;
  each later launch re-reads the issue state and drops the deferral if it closed. After the rulings, the check of
  the same tree is re-judged in `rejudge` mode (Jev only, filtered list) and its verdict replaced; a re-judge of
  the same tree never adds a refusal.
- **Rationale**: FR-009. Accepting only listed, unruled sites is a check in code; whether the reason persuades is
  the judge's job. Re-judging without a sweep keeps a contest to one judge and one Jev call.
- **Existing tools**: `github._gh`: fits for the issue state. Claim-check contest handling in `claimgate.on_launch`:
  fits as the pattern.

## R9: A bug chain is a set of line ranges on one branch, carried from one checked tree to the next

- **Decision**: A chain is keyed by `(repo, branch, chain id)`; the id is minted from the first member's tree
  and never recomputed. It stores its ranges per file, with the tree they are in the coordinates of: the
  new-side ranges of every member check's code/mixed hunks, plus the listed sites' lines. A site's line comes
  from the sweep of `HEAD`, so it is carried from the `HEAD` blob to the staged blob before it is stored. One
  rule covers every overlap test: before the test, every range of every chain that has not ended is carried to
  the staged tree, at launch and at commit alike, whatever the chain's state. The carry is done by the lineage
  module (spec 005 R12) over `git diff -U0 <old blob> <new blob>` of each file: a range outside every hunk is
  shifted, a range that overlaps a replaced range grows to cover the replacing lines, a range whose lines are
  all deleted is dropped. The commit hook computes the carry and stores nothing; a launch stores the carried
  ranges with the staged tree. A completed `patch` check joins a chain when a new-side range of its hunks
  overlaps a carried range; otherwise it opens a new chain. Each completed `patch` check of a new tree adds one
  to its chain, kept as the tree, so a repeated check adds none. A `complete` check that overlaps ends the
  chain. A commit, an amend or a rebase does not. A refusal prints, per listed site, the staged-tree line
  ranges of the hunks in that site's file.
- **Rationale**: FR-015 and ADR-0001. The earlier key, `(repo, branch, HEAD sha)`, lost the chain whenever a
  commit of other work landed, and `test_head_moving_leaves_the_chain_behind` asserted that loss (issue #17).
  That key also gave every range one coordinate system for free; carrying every range to the staged tree
  before any test restores it without an unchanged `HEAD`. Line ranges need only the hunk mapping, not the
  character mapping.
- **Existing tools**: the lineage module of spec 005 R12: fits, reused, not copied. `claimcheck._touches`
  (range overlap) and `worktree.tree_hunks`: fit, reused.

## R10: At a chain's third refusal the next check runs the deep sweep, and later checks reuse its list

- **Decision**: When a chain's count reaches 3, the refusal says so and names the check. The next launch for that
  chain runs `deep` mode: three `shim-sweeper` agents in parallel, two with the standard brief and one whose brief
  starts from the callers and consumers of the changed code and searches outward for other code doing the same
  operation, each given the diff and the same two-list schema; the merged SAME OPERATION list (by site id) becomes the chain's target. That check's Jev
  verdict replaces the third one without adding a refusal, so its `patch` lists every deep site. Every later
  check of the chain runs in `rejudge` mode against the target.
- **Rationale**: FR-016. Two sweepers on the same prompt are independent samples; the callers-first brief
  approaches the operation from another side, so it does not share the standard brief's blind spot (the replay's
  miss was a duplicate filed under callers). Reusing the target makes later retries cost one Jev call.
- **Existing tools**: `alq-anti-pattern:duplication` agent: rejected (critique E1, user decision). Its prompt
  reports only code with a named existing alternative and expects an audit scope packet; driving it with the
  sweep's schema bends a generic agent, and adds a second-plugin dependency.

## R11: Every refusal names an override; a user's override switches the check off for that bug until a commit lands

- **Decision**: A chain is held when its count is 4 or more and above the count at its last override. While it
  is held, the commit and a launch of the check are both refused with the question for the user. Every refusal
  of this check (not checked, running, failed, `patch`, held) ends with `override shim-<id>`: the chain id when
  the staged tree matches a chain (R9), else the tree's 12-hex prefix. `gate.on_prompt` learns that word; for a
  tree id it opens a chain seeded with that tree's hunk ranges. The override records two things on the chain:
  the branch's `HEAD` and the chain's count. While the branch's `HEAD` still equals the recorded one, every
  staged tree that matches the chain (R9 overlap) commits without a check. Once a commit lands the override is
  over and the count is unchanged: the next staged tree of that bug is checked again, a `complete` verdict ends
  the chain, and a `patch` raises the count above the recorded one, so the chain is held again at once. The
  recorded `HEAD` decides how long a release lasts, not which bug a change belongs to. The override is logged
  (`shim-override`). It touches only this check; the claim check keeps its own release. Only a prompt typed by
  the user overrides (FR-017).
- **Rationale**: FR-007/FR-017 and the user's choice (critique E2, option B): one override per check, lasting for
  the bug's piece of work however often it is re-staged, ending on its own when the commit lands. Any commit on
  the branch ends the override, an unrelated one included. The count is kept after it because only the approved
  entity may release a hold and nothing may start it again (constitution P2); for the same reason no check runs
  on a held chain, since a `complete` verdict would end the hold without the user (user decision, 2026-10-06).
  Once the override is over, the bug's next staged tree is checked before the user is asked again (user
  decision, 2026-10-06).
- **Existing tools**: `gate.on_prompt`, `claimgate.UNLOCK_CLAIM`: fit as the pattern.

## R12: Sweep misses are found by comparing lists inside a chain

- **Decision**: When a chain records a new list (a later check or the deep sweep), every site id in it that is
  absent from an earlier check's list in the same chain is logged once to `gate.log` as `shim-miss`, against
  that earlier check. Only earlier checks that swept the same `HEAD` as the new list are compared, so every
  listed site was in the tree each of them swept.
- **Rationale**: FR-018 and SC-004. Same `HEAD` makes "present at the earlier check" true by construction; a
  chain can now span several, so the comparison is limited to it. Sweep
  variance also produces entries; the user reads the log, nothing acts on it.
- **Existing tools**: `hookio.record` / `gate.log`: fit.

## R13: Cost, a failed check and the log

- **Decision**: Each check records `agents`, wall time (launch to verdict) and Jev's `usage.cost`, written to
  `gate.log` with the verdict, the answers and the site count. A sweeper that does not report, a Jev HTTP error
  or a missing key file leaves the check `failed` with the reason; the commit stays refused with "the check
  failed, not the fix; relaunch". A Jev 400 for size says the code diff is too large for the classifier and names
  the split. Any check that is not `complete` can be relaunched: one stopped in `sweeping` (workflow died) sweeps
  again; one stopped in `judging` (the PostToolUse hook was killed before Jev answered) re-runs Jev on the lists
  already recorded, with no sweep. A relaunch of a stopped check never adds a refusal to its chain.
- **Rationale**: FR-010/FR-012. A PostToolUse hook cannot block, so a hook killed mid-call leaves no `failed`
  mark; without relaunch from any non-complete state the tree would be refused for good (critique E2). Tokens are
  not reported (spec 005 R10: no per-workflow token count).
- **Existing tools**: `hookio.record`, the `INCOMPLETE` result shape: fit.

## R14: Checks, chains and rulings live in the existing ledger database

- **Decision**: `ledger.SCHEMA` gains `shim_checks` (key: repo, tree), `shim_chains` (key: repo, chain id) and
  `shim_rulings` (key: repo, chain id, site id), opened through `ledger._transaction`, with accessors on a
  `Shims` class beside `Claims`. Nothing is written to a PR ledger.
- **Rationale**: FR-008/FR-009 and the every-branch answer: a commit may have no PR. One SQLite file with
  `BEGIN IMMEDIATE` already serialises writers.
- **Existing tools**: `ledger._transaction`, the `Claims` accessor pattern: fit.

## Limits

- A code diff over Jev's ~33k-token limit cannot be classified; the commit must be split (R13). Measured: 41–50
  of 638 recent plugins commits (6–8%).
- The check needs the OpenRouter key wherever alq-review runs, the bot image included. Before a version that
  turns the check on is installed on the bot, one Jev call must succeed there (quickstart §9).
- Commits that do not go through `git commit` as the Bash tool runs it are not intercepted (spec 005 limits).
- A chain range whose lines are moved elsewhere in the file is dropped, so an edit at the new place does not
  continue the bug (R9). Chains stored under the earlier key are not migrated.
- Paths marked `export-ignore` and submodule contents are not in the snapshot, so sites there are never listed
  (R3). No root `.gitattributes` of plugins, infra or frontend uses `export-ignore` today.
- A commit made in the main checkout rather than a worktree has the snapshot inside its own tree until the check
  ends or a later check there replaces it (R3).
