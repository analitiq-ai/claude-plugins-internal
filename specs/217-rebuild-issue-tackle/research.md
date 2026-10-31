# Research: builder rebuilds issue-tackle to its records

Each decision below settles one mechanism `plan.md` lists. Core additions are named B1–B7 and listed in
`plan.md` (Delivery order).

## R1: builder's plugin is a core carrier shaped as planner's and the orchestrator's

- **Decision**: `builder/plugin/` gains a `core` symlink to `../../core/src`, a `package.json` (`"type":
  "module"`, exactly core's runtime pins, no devDependencies), a v3 `package-lock.json`, `lib/guarded.ts`
  (statically imports only `../core/guard.ts`), and a bumped `version` in `.claude-plugin/plugin.json`
  (`0.2.1` → `0.3.0`). The step script imports `../lib/guarded.ts` first and loads everything else with
  `await import(...)`. The files are copied from the orchestrator's carrier once #174 lands it (spec
  Clarifications Q4); until then nothing of builder's carrier is written. When the orchestrator's carrier links
  `validators/`, builder's links it the same way (R12).
- **Rationale**: FR-018–FR-019, root ADR-0001 d2, ADR-0009 d3–d4. `check-carriers.ts` finds any `*/plugin/core`
  entry, so the carrier check lists builder the moment the link exists (SC-001). The manifest declares no plugin
  dependency (builder ADR-0002 d1).
- **Existing tools**: `planner/plugin/` (on main: link, pins, lock, `lib/guarded.ts`, scripts a workflow calls;
  fits whole, and is the shape #174 R1 copies); `core/tests/fixtures/carrier-plugin` (fits);
  `core/scripts/check-carriers.ts` (the gate, unchanged); `planner/tests/carrier.test.ts` (copied as builder's
  carrier test).

## R2: builder's tests are TypeScript on node:test; the Python ones are carried or dropped

- **Decision**: `builder/package.json` and `builder/tsconfig.json` copy planner's (`tsc -p . && node --test
  'tests/**/*.test.ts'`, `@types/node`, `typescript` as dev pins). `builder/tests/*.py` and `paths.py` are deleted
  in the PR that adds the TypeScript suite. Carried: `test_names_no_planning_command_and_reads_no_issue_comment_for_the_spec`
  and `test_no_command_the_skills_give_reads_a_value_inside_its_arguments` → `skill.test.ts`;
  `test_no_file_names_a_command_this_plugin_does_not_ship_but_the_review_round` → `skill.test.ts`, its pattern
  corrected from the retired `alq-(review|plan|build):` prefixes to `(reviewer|planner|builder|auditor|orchestrator):`
  (today's pattern matches nothing, so the test passes vacuously) and its shipped set to `{builder:issue-tackle}`.
  Dropped, as they assert retired text: every other test in `test_issue_tackle.py` and `test_spec_source.py`
  (`spec=`/`branch=`, `root-cause-check`, its verdicts, `spec.md` non-empty at the given branch).
- **Rationale**: FR-021, spec Clarifications Q5; root ADR-0009 (no Python calls core). `tests.yml` runs `npm ci`
  in `builder/plugin` when its lock exists and `npm test` in `builder/` when `builder/package.json` exists, and
  skips Python when no `test_*.py` is left: no workflow change.
- **Existing tools**: `planner/package.json`, `planner/tsconfig.json` (fit); `core/tests/support/fake-github.ts`
  (fits; planner's tests import it); `planner/tests/support/checkout.ts` (scratch git repository; fits);
  `.github/workflows/tests.yml` (fits unchanged).

## R3: One step script: facts read through core, one pure decision, the step printed as JSON

- **Decision**: `builder/plugin/scripts/step.ts <s> --session <id>` reads the facts (R5–R12) into one
  `StepFacts` value, calls the pure `decideStep(facts)` in `lib/step.ts`, and prints the `Step` it returns as one
  JSON line on stdout (contracts/step-script.md). Exit 0: work to do; 1: a stop, its reason in the JSON; 2: a read
  did not answer, or the arguments are refused (P4). Facts are read in the order the decision needs them, and a
  stop decided early reads nothing more. The one write the script makes is the cut (R8); every other change is
  the skill's.
- **Rationale**: spec "the skill does what the script names and nothing it does not"; P3's split followed (pure
  rule, I/O at the edge), so every acceptance scenario of US3–US5 is a `decideStep` unit test over facts, and the
  reads are tested once against the fake GitHub and a scratch repository.
- **Existing tools**: `planner/plugin/scripts/preflight.ts` (guard, dynamic imports, `main(args, io)` with
  injected I/O, exit 0/1/2: the shape fits); #174 R3 (`decideStart` pure over gathered facts: same split).

## R4: The skill calls the script by plugin root and session id substitution

- **Decision**: the skill's first step runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/step.ts" <s> --session
  "${CLAUDE_SESSION_ID}"`, the two values substituted into the skill text by Claude Code. `<s>` is the skill's
  one argument (`$ARGUMENTS`), which the script itself refuses unless it is one issue number (FR-001).
- **Rationale**: the script needs the session id to read the session record (FR-005), and the model has no other
  source for it that is not prose.
- **Existing tools**: auditor's skills use `${CLAUDE_PLUGIN_ROOT}` in their text (fits). Hook input carries
  `session_id`, but no hook runs at a skill's invocation (does not fit).
- **Not run**: that `${CLAUDE_SESSION_ID}` is substituted into a plugin skill's text under the agent machine's
  Claude Code. The first US3 task records a real invocation; if it is not substituted, this decision is reopened
  before any step code.

## R5: GitHub is read with the session token from the orchestrator's gh folder

- **Decision**: the script reads the session token with core's `readGhToken(folder)` from core's `ghFolder(home)`
  (`orchestrator-paths.ts`), builds `gitHub(token)`, and refuses (exit 2, naming the folder) on an absent folder or a
  token past its expiry; it never mints (only hooks read a key, root ADR-0008). The repository is the main
  checkout's origin, checked equal to the token's `repo` and the session record's. Git reads from GitHub use
  core's `fetchWithGhCredential` with the same folder.
- **Rationale**: root ADR-0007 (the model's token is read-only); P6 (builder writes nothing on GitHub); the
  orchestrator's PreToolUse hook keeps the token fresh before each Bash call (orchestrator ADR-0001 d3).
- **Existing tools**: core `gh-config.ts` `readGhToken` (fits); `github.ts` `gitHub`, `repositoryOfRemote`
  (fit); `git.ts` `fetchWithGhCredential` (fits); planner's `lib/github.ts` mints its own App's token (does not
  fit: builder holds no key).

## R6: The session's issue is read from the orchestrator's record

- **Decision**: `readSessionRecord(folder, sessionId)` at core's `sessionsFolder(home)`. Absent → stop "no session
  record" (FR-005); `issue ≠ s` → stop naming the record's issue; `repo` ≠ origin → stop naming both; refused →
  exit 2 naming the file.
- **Rationale**: builder ADR-0002 d5; root ADR-0008 d1; one writer, the orchestrator's UserPromptSubmit hook (P6).
- **Existing tools**: core `session-record.ts` (fits); `orchestrator-paths.ts` `ghFolder`, `sessionsFolder` (fit, on main
  from #242).

## R7: Lane, closed and done are read through core at every step

- **Decision**: settings come from `codeworks.toml` on the default branch through `gitHubTree` and
  `readSettings`; the lane from `laneOf(reader, repo, s, shared.board)`; closed from `GET
  /repos/{o}/{n}/issues/{s}`; done from `isDone`. Backlog or Blocked → stop naming the lane (FR-006); no card →
  stop naming the board; closed or done → stop (FR-007); `LaneRefused`, `GitHubUnanswered`, `GitHubRefused` →
  exit 2 naming the read (FR-009). Read at the start of every step, before anything is cut or merged.
- **Rationale**: builder ADR-0002 d4, root ADR-0006 d1/d3, ADR-0005 d5, root ADR-0004.
- **Existing tools**: core `board.ts` `laneOf`, `identity.ts` `isDone`, `settings.ts`, `tree.ts` `gitHubTree`
  (fit); planner's `preflight.ts` does the same lane and closed read (its shape is reused).

## R8: The story branch is found on GitHub or locally, else cut by the script

- **Decision**: `issueStory(reader, repo, s)` gives the branch on GitHub (several → stop, `DerivationError`).
  The main checkout is the parent of `git rev-parse --path-format=absolute --git-common-dir`; local branches
  `<s>-us*` and the worktree list come from `git branch --list` and `git worktree list --porcelain`. One branch,
  GitHub's or the local one (crash before push, spec Edge Cases), names the worktree `../<repo>.worktrees/<branch>`;
  a worktree there on another branch → stop naming it. With none anywhere, the script fetches the default branch
  and runs `git worktree add -b <branch> <path> <default-sha>`, the branch named by core's `storyBranchName(s, k,
  title)` (B1): `<k>` from the `[US<k>]` tag of the story's tasks (R11), else 1; `<slug>` from the issue title,
  lowercased to `[a-z0-9-]`, runs of `-` collapsed, trimmed, capped at 40 characters, `story` when empty (titles
  are untrusted: they become a ref and a path). A branch on GitHub only: fetch it and `git worktree add -B <branch>
  <path> refs/remotes/origin/<branch>`; a local branch with no worktree: `git worktree add <path> <branch>`
  (spec FR-027). A GitHub branch and a different local one, both present → stop naming both. In the worktree,
  `MERGE_HEAD` present → the merge step to finish; uncommitted changes otherwise → stop naming the files; the
  local head behind or diverged from the PR head → stop naming both (FR-028).
- **Rationale**: FR-003–FR-004, builder ADR-0002 d2, root ADR-0005 d1 (the grammar's one home is core). The cut
  is git's own deterministic answer, so the script makes it rather than handing the model a command to type.
- **Existing tools**: core `identity.ts` `issueStory`, `pickStoryBranch`, `parseBranch` (fit; B1 adds the
  builder of the name beside the parser and asserts it parses back); `git.ts` `runGit` (fits).

## R9: The merge of the default branch is decided from git and one spec PR read

- **Decision**: after fetching the default branch to `refs/remotes/origin/<default>`, the script names
  "merge" when the default branch's tip is not an ancestor of HEAD and any of: the newest merged spec PR of `<p>`
  has a merge commit not in HEAD's history (`specPr` with B4's `mergeCommit`, then `git merge-base --is-ancestor`);
  `governingDiff(ls-tree default, ls-tree HEAD, folder)` is non-empty (spec.md of the folder the default branch
  names, `**/docs/adr/`, `.specify/memory/`); or `git merge-tree --write-tree origin/<default> HEAD` exits 1
  (conflict, whether or not a PR exists). It runs before the folder check (R10). The skill then runs the printed
  `git merge --no-ff --no-edit refs/remotes/origin/<default>` in the worktree, resolves any conflict in that merge
  commit, and runs the script again (FR-017).
- **Rationale**: builder ADR-0004 d1–d2. A local merge-tree answers for the head the merge is about, including a
  head not yet pushed; GitHub's `mergeable` is of the PR's head only and may be UNKNOWN.
- **Existing tools**: core `attest.ts` `governingDiff` (the same governing set orchestrator ADR-0004 d1 uses:
  fits); `identity.ts` `specPr` (fits once B4 adds `mergeCommit { oid }`); `attest.ts` `mergeLapse` uses `git
  merge-tree --write-tree` the same way (fits); `required-checks.ts` conflict finding (GitHub's `mergeable`,
  PR head only: does not fit before a PR).

## R10: The spec folder and requirement are read at HEAD after any merge

- **Decision**: `specFolder(gitTree(worktree, "HEAD"), p)`; its `DerivationError` maps to the three stops
  (no `specs/`, none, several), each naming the open story PR if one (FR-008); `requirement(tree, folder, body)`
  gives the requirement, the story issue body for `no_spec`. `codeworks.root_cause.observed` is read from the
  spec facts for the skill (FR-015). No planning command is named in any stop.
- **Rationale**: builder ADR-0002 d3, root ADR-0005 d2/d4, ADR-0004 d2 (folder check after the merge).
- **Existing tools**: core `identity.ts` `specFolder`, `specFolderAnswer`, `requirement`; `contracts/spec-facts.ts`
  `readSpecFacts`; `tree.ts` `gitTree` (all fit).

## R11: Task ticks are read from tasks.md by core

- **Decision**: core gains `storyTasks(text, s)` (B2) in `contracts/tasks.ts`: every task line (`- [ ]` /
  `- [x]` + Spec Kit's `T<nnn>` id) in each phase block whose label is `Story issue: #<s>`, with its id, tick and
  `[US<k>]` tag. The script reads `tasks.md` at HEAD; no block labelled `#<s>` gives no tasks, and an implement
  step then builds the requirement as one task (spec Edge Cases). The skill ticks a task in a commit that flips
  only its `[ ]` (FR-023), which reviewer's TICK_ONLY rule admits (reviewer ADR-0010 d1).
- **Rationale**: builder ADR-0003 d3, planner ADR-0008 d2; reviewer #209 grades ticks by the same blocks, so the
  read has one home beside `readTaskBlockLabels`.
- **Existing tools**: core `contracts/tasks.ts` `readTaskBlockLabels`, `isPhaseHeading` (the label grammar fits;
  no task-line read exists).

## R12: The PR state is the story PR, its `internal-review` check run and its findings

- **Decision**: from `issueStory`'s PR (B3 adds `closed`): none, or newest closed unmerged → implement; merged →
  done (R7 already stopped). Open → the `internal-review` check run at the PR head by the orchestrator's App
  (`shared.orchestrator_app_login`) through core's `internalReviewAt` (B5): not `success` → internal round; a local
  HEAD ahead of the PR head (commits not yet pushed) → internal round at HEAD. Attested → `prFindings` (B6): the
  findings of `requiredChecks`, the `<module>-review` check runs the orchestrator's App writes at the head
  (orchestrator ADR-0008; #174 FR-020a) and `threadsModule`; non-empty → github round; a module's check run
  pending or absent → exit 2 naming the module; empty → nothing to do. No validator package is loaded: their deps
  read keys only hooks may read (`validation/contract.ts` `readKey`; root ADR-0008 d4). B6 takes a reader only.
- **Rationale**: builder ADR-0003 d3, orchestrator ADR-0004 d1–d3 (the check run is the attestation, pinned to
  the orchestrator's App), reviewer ADR-0016 d1 (findings only through core). The orchestrator's hooks compose the
  modules' findings with their keys and record each module's outcome as its check run; builder reads that record.
- **Existing tools**: core `identity.ts` `issueStory`/`storyPr` (fit once B3 returns `closed`, which the query
  already reads); `validation/required-checks.ts` (its private `checkRuns` read fits B5; its `internal-review`
  name is the one constant); `validation/threads.ts` `threadsModule` (fits); `validation/contract.ts` `loadValidators`,
  `findings` (do not fit: their deps read keys); `attest.ts` `attests` (recomputes from reviewer's state: does not fit, the
  check run is the record).

## R13: The skill is rewritten to run the script and act on the one step it prints

- **Decision**: `issue-tackle/SKILL.md` takes `<s>` alone and has one loop: run the script; on exit 1 or 2 end
  the turn quoting the reason; on exit 0 act on `step.kind` (contracts/skill.md): `implement` — build each listed
  task against the requirement at the Root cause, commit, then tick it in its own commit, then launch the internal
  round; `internal_round` / `github_round` — launch `reviewer:review-round` with the step JSON's `args`, never a
  `spec`, and take each step the gate names until clean; `merge` — run the printed merge, resolve,
  commit; `nothing_to_do` — end the turn. After a merge it runs the script again in the same turn; after
  implement it does not, the round ending the step (contracts/skill.md). It
  never pushes, opens or readies a PR, requests a review, writes a lane, rebases, resets a pushed commit or
  force-pushes. Today's Step 3 text (Root cause, Observed, no shims) stays, reading `observed` from the step JSON.
- **Rationale**: FR-010–FR-017, FR-023; builder ADR-0003 d1–d3, ADR-0004 d1; reviewer ADR-0014 d1.
- **Existing tools**: the current skill (Step 3 kept; Steps 1–2, 4–7 replaced).

## R14: root-cause-check retires with every file that names it

- **Decision**: delete `builder/plugin/skills/root-cause-check/`; edit `auditor/plugin/skills/pr-audit/SKILL.md:123`
  to name reviewer's root-cause reviewer (reviewer ADR-0017); edit the comment at
  `planner/plugin/scripts/rootcause.py:7` the same way; rewrite builder's manifest description. Ships in US4's
  PR, after #209 lands the root-cause reviewer. `reviewer/tests/test_shipped_tree.py`'s `alq-root-cause-check`
  names the retired `alq-` plugin's path and is left.
- **Rationale**: FR-020, builder ADR-0002 d6, SC-005.
- **Existing tools**: none needed; a repo search (`root-cause-check` outside `specs/` and `**/docs/adr/`) is
  SC-005's check, run in `skill.test.ts` over `git ls-files`.

## R16: The step's stop rule lives in core, so the Stop hook names builder's stop

- **Decision**: B7 puts the stop half of the decision order (data-model stages 1–5, 7, 9) in core as a pure
  `storyStop(facts)` with the `StopState` enum, and the read of its facts as `readStoryStopFacts(s, sessionId,
  deps)`: read-only, through core's readers and `git.ts` `runGit`, writing nothing. builder cuts or adds the
  worktree when those facts show none (R8), then reads again. builder's `decideStep` calls it first; the orchestrator's Stop hook
  reads the same facts through the same function, calls the rule and, on a stop, moves the card to Blocked with its reason instead of re-naming
  `issue-tackle <s>` until REPEAT. No file is written for the hook to read: the model may not write a hook's
  folder (root ADR-0008 d6).
- **Rationale**: builder ADR-0003 d2 (a stop's message reaches the admin through the Blocked reason); P3 (rule in
  a pure function, one home); critique P1.
- **Existing tools**: #174's `decideStart` (pure over gathered facts, same split). #174 R21 and T076 call both.

## R15: The constitution's builder line changes first, in its own PR

- **Decision**: Platform Constraints' "builder is two skills, with no scripts and no hooks" becomes "builder is
  one skill and its step script, a core carrier with no hooks", in a PATCH amendment merged before builder's
  carrier PR.
- **Rationale**: spec Assumptions; Principle VI; constitution Governance.
- **Existing tools**: `/speckit-constitution` (fits).
