# Research: Claim check before commit

Every decision below is a mechanism the plan builds or changes. Facts about the existing plugin were read
from `.claude/plugins/alq-review/` in this worktree. Facts about Claude Code hooks come from the official
hooks guide (https://code.claude.com/docs/en/hooks-guide.md), read by a research agent and not re-read by
the author; where the docs are silent that is said. Facts about outside tools were read from the pages named.
Git behaviour stated as "probed" was run in a scratch repo on git 2.47.3.

## R1: The commit is intercepted by the existing alq-review gate

- **Decision**: Extend `scripts/gate.py`'s `on_bash`. `shell.classify` already returns `Action("commit", cwd)` for
  every `git commit`; a new rule `claimcheck.commit_decision` is evaluated for that action beside the existing
  PR-lock rule. It refuses through `refuse()` under its own setting `claim_checks` (`log` | `enforce`, env
  `ALQ_REVIEW_CLAIM_CHECKS`), read by the existing `_setting` exactly as `spec_checks` is, and ships as
  `enforce`. A gate crash on a PreToolUse tool refuses the call under enforce (`_refuses`), unchanged.
- **Rationale**: The spec decided the gate lives in alq-review (Clarifications, scope). One entrypoint means one
  place that parses `git commit`, one refusal format that names the next step, and FR-015 (a failed check
  refuses) is already how the gate treats its own crash. Its own setting lets the user switch the claim check to
  `log` without switching off the review gate (critique E7, user decision). The commit-time decision is a ledger
  read, so it is fast (T002: `git write-tree`, `git diff --cached -U0 -M`, `git diff --quiet`, `git check-attr`
  and one batched `git patch-id --stable` took 0.06 s together for a 50-file staged change in analitiq-infra, so
  the hook keeps the default timeout); the guide says a command hook that reaches its timeout is cancelled and, on most events,
  renders no decision, which is why the slow work must not run inside the hook.
- **Existing tools**: (1) alq-review `gate.py` + `shell.classify` + `_setting`: fits, already hooks `git commit`
  and already has a per-feature setting. (2) A git `pre-commit` hook or the `pre-commit` framework: does not fit;
  it runs outside the session, cannot launch a Claude Workflow, and `--no-verify` skips it. (3) Claude Code
  `prompt` / `agent` hook handlers (hooks guide): an agent hook can block a PreToolUse call but is documented with
  a 60 s default timeout and 50 tool turns, one verdict per hook; it cannot fan out one judge per claim, validate
  each verdict, or keep a per-claim record. (4) `or1can/claims` (https://github.com/or1can/claims, README read):
  a PreToolUse hook on `git commit` whose gate checks are executable claims, citations, links and file refs; its
  judgment-agent check is listed as advisory, and the README documents no verdict values or output schema. It
  cannot block on a judged claim, so it does not meet FR-008; its citation checks are the K7 category this
  feature leaves out of scope.

## R2: A commit is checked as the exact staged tree, and the commit command stands alone

- **Decision**: The staged state is identified by `git write-tree`. A check is stored and looked up under that
  tree id, and a commit is allowed only when its tree has a complete check. `git commit` may be preceded in its
  Bash command only by `cd`; anything else in the same command, and any staging flag (`-a`, `--all`, `-i`,
  `--include`, `-o`, `--only`, pathspecs), is refused with "stage with `git add` in an earlier command, then run
  `git commit` alone". A commit with an empty staged diff, or one that concludes a merge, cherry-pick or revert
  (`MERGE_HEAD`, `CHERRY_PICK_HEAD` or `REVERT_HEAD` exists), needs no check.
- **Rationale**: A check bound to a tree id cannot be reused for different content (FR-010). The hook runs once
  before the whole Bash command, so anything earlier in that command could change the index after
  `git write-tree` was read. "Only `cd`" is the rule the refusal states and is closed, where "anything that could
  change the index" is an open list (critique E10). Probed: the tree id is unchanged by an untracked file and
  changes when a file is staged.
- **Existing tools**: `git write-tree` / `git diff -U0 -M <base> <tree>`: fit. `shell.classify` already splits a command into
  segments and `shell._git` finds the verb and `-C`; both are extended. No tool maps a commit command to the tree
  it will record.

## R3: Hunks, including removals, come from the plugin's diff parser

- **Decision**: `worktree.added_lines` is split into a parser over diff text plus its two callers' diff
  commands, and `worktree.tree_hunks(root, base, tree)` is added over `git diff -U0 <base> <tree>`. Every hunk is kept,
  including one that only removes lines: removing words can change what a claim says ("only admins" →
  "admins"). Each hunk carries its removed and added lines; the reader reads the staged file around the hunk for
  the full sentence. A file `git check-attr` reports as `linguist-generated` is skipped; git itself emits no
  hunks for a binary file. Each hunk's fingerprint is `git patch-id --stable` of that hunk's diff.
- **Rationale**: Define once: `_HUNK` and the `-U0` walk exist in `worktree.py` for committed ranges; a second
  parser would diverge on the first odd header. `facts.round_facts` is its only caller today. Removal-only hunks
  are checked by user decision (critique P1). `patch-id` is git's own content fingerprint for a diff: probed, it
  is unchanged by added spaces and indentation and changes when a word changes (critique E4/E9).
- **Existing tools**: `worktree.added_lines`, `worktree._HUNK`: fit after the split. `git patch-id --stable`:
  fits as the hunk fingerprint. `unidiff` (PyPI): not used; a hunk header is one
  regex.

## R4: One workflow does the reading and judging, and the gate supplies everything it needs

- **Decision**: A new `workflows/claim-check.js`, launched as
  `Workflow(name='alq-review:claim-check', args={worktree})`. Like `review-round.js` it only orders work: the
  gate injects prompts, schemas and the staged hunks through `updatedInput` at launch. Stages: reader agents
  (Sonnet, medium effort) label each hunk CODE / PROSE / MIXED and extract claims with a category, in batches of
  16, only for hunks whose patch-id has no cached read (R7); then one judge agent per K1 claim in parallel. The
  study's batch size and model settings are kept.
- **Rationale**: The four steps of the study already ran as this shape. The gate-injected-args pattern is how
  `review-round.js` keeps prompts and the hook that checks the answers from drifting (`briefs.py`). The docs do
  not say whether a command hook may rewrite `Workflow` input; the plugin already relies on it for
  `review-round` (`gate.on_workflow` returns `updatedInput`).
- **Existing tools**: The `Workflow` tool, `agent()`, `parallel()`, `pipeline()` (workflow-authoring reference):
  fit. `alq-review:review-round` as the template: fits. A Claude Code `agent` hook: see R1, does not fit.

## R5: Agents are read-only and read the worktree, which must match the staged tree

- **Decision**: `agents/claim-judge.md` with `tools: Read, Glob, Grep` (no Edit, Write or Bash),
  `agents/claim-contest-judge.md` with the same plus `WebFetch` (R9), and `agents/claim-reader.md` with
  `tools: Read`. They read the worktree itself. The gate refuses to launch a check while any tracked file has
  unstaged changes (`git diff --quiet` fails), naming the files, so what the agents read is what will be
  committed. Untracked files may be read but never cited (R6). The judge brief is the study's prompt, unchanged
  except for the checkout line, held in `briefs.py`.
- **Rationale**: FR-016 and SC-006 are met by the tool list, which is checkable by a test, not by an
  instruction. A copy of the staged tree is not needed once the worktree is required to equal it (user decision,
  critique E6): no export to time out inside the hook, none to go missing or be deleted by another session's
  cleanup (critique E3), and no read outside the project.
- **Existing tools**: `agents/assessor.md` (same frontmatter pattern, with Bash, which these agents omit): fits
  as the template. `git diff --quiet`: fits. `git archive` to an export: rejected, see rationale.

## R6: The hook validates every output before it is recorded, against the staged tree

- **Decision**: The gate's existing `StructuredOutput` hooks (`on_structured_output`,
  `after_structured_output`) learn the claim-check outputs, found by their `check_ref`. `claimcheck.validate_*`
  reject: a hunk label missing or duplicated; a claim whose `quote` is not verbatim in the staged file (`git show
  :<path>`) at its `line`, or whose `line` is outside its hunk's paragraph; a `CORRECT` with an unconfirmed
  assertion or no evidence; a `WRONG` with no failing case or no `path:line` evidence for the assertion it
  breaks; an `UNSURE` with no gap; a `path:line` whose path is not in the staged tree (`git cat-file -e
  :<path>`) or whose line is past its end. A contest verdict may also cite an `https://` URL. Rejected output
  goes back to the agent with the reasons, as `validate_assessment` does. A check whose verdicts are all `UNSURE`
  with nothing cited is complete, and its claims are notes (user decision 2026-10-02, replacing critique E3).
- **Rationale**: FR-006/007/009 are rules about what a verdict must say; the schema carries the shape and the
  validator carries what the fields must say together, which is `assessment.py`'s documented split. Checking
  citations against the index is what keeps an untracked or unstaged file from being evidence, and it is what
  makes a claim about code outside the repo come back `UNSURE` (FR-014).
- **Existing tools**: `assessment.validate_report` / `validate_assessment` and the hook path that calls them:
  fit as the pattern; the claim-check validators are siblings in a new module so `assessment.py` stays about
  review rounds. `git show :<path>`, `git cat-file -e`: fit. JSON Schema alone: not enough, it cannot express
  "every assertion confirmed".

## R7: Checks, reads and cached verdicts live in the existing ledger database

- **Decision**: `ledger.SCHEMA` gains `claim_checks`, `claim_reads`, `claim_verdicts` and `claim_lineages` (see
  `data-model.md`), all opened through `ledger._transaction`. A reader's output is cached under the hunk's
  patch-id, so a hunk whose words are unchanged is not read again and its claims keep their ids. Only `CORRECT`
  is cached across trees: under the claim id, reused while every file it cites has the same blob id
  (`git rev-parse :<path>`) in the staged tree, and never for a claim that says "every", "only", "all",
  "exactly", "always" or "never". `WRONG` and `UNSURE` are kept only inside the check for their tree, so any
  change to the staged tree re-judges them.
- **Rationale**: One SQLite file with `BEGIN IMMEDIATE` already solves concurrent writers for the PR ledgers; a
  second store would need its own locking. PR ledgers cannot hold these records because a commit has no PR. A
  reader's quote can differ between runs; caching its output per hunk fingerprint keeps claim ids, and so FR-010
  and SC-005, stable. A `WRONG` can be fixed by a change to a file it never cited, so reusing it would refuse a
  claim that is now true and spend one of its 3 refusals (critique E4).
- **Existing tools**: SQLite via `ledger._transaction`, `ledger._connect`: fit. Git blob ids and patch-ids as
  the fingerprints: fit. A JSON file per check: rejected, ADR-0002 records why the plugin left that design.

## R8: The bound counts WRONG rulings per claim lineage, and the user releases with `unlock`

- **Decision**: A lineage is one row per (repo, branch, lineage id) with one current claim. Its fields, its
  three states (`checked`, `released`, `stopped`), what every event does to a row and how a staged tree is
  matched to rows are in data-model Lineage, and nowhere else. The decisions that section carries out: the
  count is per claim and never summed across claims; each completed check that rules the claim `WRONG` adds one,
  and so does a rejected contest (critique P2); the bound is 3; while a row is stopped, the launch is refused as
  well as the commit; a release records the claim's id and the count, and does not lower the count; a `WRONG`
  ruling of the released words adds nothing; no count and no lineage is keyed on `HEAD` or a commit.
  `on_prompt` already parses `unlock <ref>`. Only a prompt typed by the user releases (FR-011).
- **Rationale**: ADR-0001. The earlier key, a hold per (repo, `HEAD`, file, hunk), failed in three observed ways
  (issue #17): a commit of other work moved `HEAD` and the same words started again at 1 with no `unlock`
  (#15); one check added two refusals to one hold (#16); and three different claims of a new file, each wrong
  once, reached 3 because a new file is one hunk (critique E1). A check is not allowed on a stopped lineage
  because a passing ruling would then end a hold without the user, a second way out that constitution P2
  forbids (user decision, 2026-10-06). A stopped row is matched by its file and not by its words, because a
  rewording or a deletion that reached a check could end the hold in the same way. Keying on the claim's words alone would give
  every rewording a new count, which is why the id is carried and succession is decided by a diff (R12).
- **Existing tools**: `gate.on_prompt` / `UNLOCK`, `policy.unlock_ref`: fit as the user-only release path. The
  claim id (`sha256(file + normalised words)[:16]`): fits as what `unlock` takes; not enough as the row id,
  since the same words can be ruled `WRONG` again after their row ended. The PR ledger's `unlocked_at` fields: not reused, they belong to a PR and a commit has none.

## R9: A contest is evidence checked by the gate and judged by a fresh agent, whose fetches the gate limits

- **Decision**: `Workflow(name='alq-review:claim-check', args={worktree, contests: [{claim, evidence}]})`, where
  `claim` is a claim id from the refusal. At launch the gate accepts a contest only if `evidence` holds a
  `path:line` in the staged tree or an `https://` URL; otherwise it is refused before any agent runs, naming what
  is missing. An accepted contest re-judges that claim alone with a new `claim-contest-judge`, given the claim,
  the first verdict and the evidence. The PreToolUse matcher in `hooks.json` gains `WebFetch`: for that agent
  type the gate allows a fetch only when the URL's host (`urllib.parse`) is a host of a URL cited in the
  contest, so the judge can follow pages within those sites and nowhere else.
- **Rationale**: FR-012 and the user's answer that a contest rests on facts and research: a contest that is only
  an assertion leaves the verdict standing, which the gate can test for free; whether the evidence persuades is
  the fresh judge's job. The judge reads a private repo and fetched pages are untrusted, so an injected page
  could make it send repo text to another host; the host limit is a control in code, not an instruction
  (critique E5), and still lets it follow the cited site's pages (user decision). Its verdict passes the same
  validator (R6).
- **Existing tools**: The launch-time argument checks in `gate.on_workflow` and the `agent_type` field the gate
  already reads from hook payloads: fit. `urllib.parse`: fits. The `WebFetch` tool: fit for the contest judge
  only.

## R10: Cost, the large-commit warning, a failed check and the log are results of the same workflow

- **Decision**: The workflow result carries `judged` (claims judged) and `agents` (readers and judges run) as the
  cost of the check. `config.json` gains `claim_warn_over: 20`; a commit with more K1 claims gets a `warning`
  in the result. A reader or judge that returns nothing makes the result `INCOMPLETE` and leaves the check `reading` or `judging`, so
  the commit stays refused with "the check failed, retry". Every check (claims judged, zero-claim checks,
  verdicts, cost), refusal, contest outcome and release is written to `gate.log` through `gate.record`
  (FR-018); the user reads it and decides, and no threshold is built in. Tokens are not reported: the workflow
  reference documents `budget.spent()` as the output tokens of the whole turn, main loop and every workflow
  together, so it cannot say what one check cost (T001, settled from the reference, not run).
- **Rationale**: FR-013/FR-015/FR-018. `review-round.js` already returns `INCOMPLETE` when an agent does not
  report; a partial check is not a check. The threshold is a setting because the user chose 20 as a judgment
  call. Reading the log is the user's (critique P3, X1).
- **Existing tools**: `config.py` / `config.json` for settings; `gate.record` and `gate.log`;
  `review-round.js`'s `INCOMPLETE` for the failure shape: fit.

## R11: A commit hook that rewrites files after the check is not checked again

- **Decision**: Nothing runs after the commit. The repo's own commit hooks (the frontend's `lint-staged`) are
  cosmetic checks and validations, so what they change is not checked again and the push is not gated (user
  decision 2026-10-02). This replaces the earlier word-diff-before-push design (critique E9).
- **Rationale**: Re-checking cosmetic changes costs a check and adds a push gate for no claim the hooks write.
- **Existing tools**: None fit. Looked at: nothing new is built for this decision; commit hooks that rewrite
  files stay as they are.

## R12: A lineage is carried from one version of a file to the next by one pure module

- **Decision**: One module takes the open lineages of a file with their last versions, the diff of the file's
  two blobs, and the claims the reader found in the staged blob, and returns the new lineages. The diff is
  `git diff -U0 <old blob> <new blob>`; commits play no part. A line outside every hunk is shifted past the
  hunks above it. A sentence inside a replaced range has its character span mapped into the new blob by
  `diff-match-patch`, and the claims found in that span continue the lineage: a split forks it into one row
  per part, and which row continues a claim that several rows arrive at is in data-model Lineage (Who wins a
  claim; the Split and Merged rows of its Transitions table). A claim whose words are unchanged at another
  place in the file is found by its claim id. The old version of the file is read from the ledger, as data-model Lineage
  says (Old trees). Two pieces
  are hand-rolled: shifting a line past earlier hunks, and locating a sentence's character span.
  `diff-match-patch` is a required dependency: the hooks import it and fail with a message naming the install
  command when it is missing. It is not vendored. The shim check carries its chain ranges with the same module
  (spec 006 R9).
- **Rationale**: ADR-0001 fixes the rule; a pure function of stored state and git's answers is constitution P3.
  Moved words are found by id and not through the diff because `git diff -U0` showed a sentence moved within a
  file as unchanged context on a fixture (issue #17). Text moved and reworded in one step is not followed:
  every tool that claims to follow it pairs sentences by a similarity threshold, which ADR-0001 rejects.
- **Existing tools**: `git diff` of two blobs: fits for the changed ranges. `diff-match-patch` (Apache-2.0, pure
  Python): fits for the character mapping. Rejected, with reasons in ADR-0001 and the survey of 2026-10-06 in
  issue #17: `prosediff` (similarity threshold, missed half of a split), review-comment porting in Gerrit,
  GitLab, Phabricator and Sourcegraph (hunk shifting only), ids assigned at authoring time.

## Limits

- Commits that do not go through `git commit` as the Bash tool runs it are not intercepted: `git merge`,
  `cherry-pick`, `rebase --continue`, `am`, `commit-tree`, `bash -c '...'` and git aliases.
- `shell.classify` and `worktree.locate` only see repos with a GitHub `origin`, so the check covers the repos
  alq-review already covers, which is what "every repo the plugin is installed in" meant for its other rules.
- A claim moved and reworded in one step is not followed and starts a new count. So does the half of a split
  that lands in a pure insertion, and a claim whose file is moved to a new path (R12, data-model Lineage).
