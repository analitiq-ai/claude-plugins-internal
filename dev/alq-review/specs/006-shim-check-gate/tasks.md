---

description: "Task list for the shim check before commit"
---

# Tasks: Shim check before commit

**Input**: Design documents from `/specs/006-shim-check-gate/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/shim-check.md, quickstart.md

**Tests**: Required. Constitution IV: every mechanism starts from a test that is written, run, and fails for the
reason it names before the implementation task after it begins. Gate tests drive `scripts/gate.py` with hook
payloads, recorded agent outputs and a stub Jev endpoint (`JEV_ENDPOINT`); no unit or gate test calls a model.
Only T047 (the SC-001 replay) calls Jev live.

**Organization**: by user story from spec.md, in priority order. The override (FR-017) is built in US1, not US3:
under `enforce` every refusal must name it from the first story on (FR-007), and US3 only adds the hold that asks
for it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 from spec.md

## Path Conventions

All paths are relative to `.claude/plugins/alq-review/` unless they start with `specs/` or `~`. Tests run from that
directory with `ALQ_REVIEW_STATE_DIR=$(mktemp -d) python3 -m unittest discover -s tests`. Shim gate tests live in a
new `tests/test_shim_gate.py` whose `ShimGate` subclasses `Gate` from `tests/test_gate.py`, as
`tests/test_claim_gate.py` does (the plan's "shim cases in `test_gate.py`" is placed there instead, matching the
claim check's layout). Workflow tests run `workflows/shim-check.js` through `tests/workflow_harness.mjs`.

Callers, stated before any edit (coding principles): `gate.on_bash` is called by `gate.handle` for every
PreToolUse `Bash`; `claimcheck.commit_decision` only by `claimgate.on_commit`; `gate.on_workflow`,
`on_structured_output` and `after_structured_output` by `gate.handle` for every `Workflow` and `StructuredOutput`
call; `gate.on_prompt` for every user prompt; `ledger.SCHEMA` by every ledger call through `ledger._connect`;
`hookio._setting` by every mode read. Any task that edits one of these re-runs the full suite before it is done.

---

## Phase 1: Setup (spikes, fixtures, settings)

**Purpose**: settle the facts the plan leaves unrun, collect the replay fixtures, add the setting.

- [X] T001 Spike, record the answer in `specs/006-shim-check-gate/research.md` R3: in a scratch repo with the
  plugin enabled, run a throwaway workflow whose one agent (tools Read, Glob, Grep) reads a file under
  `<main checkout>/.claude/worktrees/spike/`, in a headless session started (a) in the main checkout and (b) inside
  a worktree. Log the PreToolUse payload the gate receives for that agent's Read, Glob and Grep: is `agent_type`
  present, and does returning `permissionDecision: allow` stop a permission prompt in (b)? Also time one
  `scripts/gate.py` PreToolUse round-trip for a Read, since T004 routes every Read, Glob and Grep through the gate.
  If `agent_type` is absent or the allow does not take effect, stop and report: R3 needs a different read path.
  Delete the throwaway workflow and folder.
- [X] T002 [P] Spike, record the answer in R6: time 5 Jev requests with the replay's `level`+`coverage`
  questions over the largest fixture diff (`~/.local/share/alq-churn/churn/trees/commit-*.diff`, by size) and 5
  `kind` requests over the same diff. The replay used a 180 s timeout, R6 says 30 s. Set the request timeout to
  at least 3× the slowest measured call, record it, and set the `hooks/hooks.json` timeouts in T004 above it.
- [X] T003 [P] Build `tests/fixtures/shim-replay/`: copy the 14 commits' `commit-*.diff` and `sweep-*.md` from
  `~/.local/share/alq-churn/churn/trees/` (leave out `pre-*` trees and `2d9a0479a45e/`), and write
  `manifest.json` mapping each commit to the expected verdict from the design's evidence table: `complete` for
  6aa17485, 29ade9e4, 053e0ec9 and 49320e88 (known sweep miss); `patch` for the 8 patches and bf12120a; no entry
  for 8a219ca0, which is not in the table. Add at least 15 non-fix commits from claude-code-plugins since
  2026-08-01 (features and refactors whose message and diff correct no defect, each with a code diff under 60 kB)
  as `nonfix-<sha8>.diff`, expected `not_fix`. Record how each non-fix commit was chosen in `manifest.json`.
- [X] T004 Add `"shim_checks": "enforce"` to `config.json`. In `hooks/hooks.json`, add a separate PreToolUse entry
  for `Read|Glob|Grep` running `scripts/sweeper_read.py` (R3 spike: the full gate costs 76 ms per read), and give
  the existing PreToolUse and PostToolUse entries a 60 s timeout (T002).

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: shared preconditions, the pure rules module, the ledger tables, the Jev client, the snapshot and
the settings every story reads.

**⚠️ CRITICAL**: no user story work starts until this phase is complete.

- [X] T005 Write the failing test in `tests/test_claimcheck.py`: `claimcheck.commit_preconditions` exists and
  returns the refusal for an empty commit, a concluding merge/cherry-pick/revert, a staging flag and a
  `git commit` that is not alone, and `None` otherwise; `commit_decision`'s existing tests still pass. Run it;
  it fails on the missing function.
- [X] T006 Move those four checks out of `claimcheck.commit_decision` into `claimcheck.commit_preconditions` in
  `scripts/claimcheck.py`, and call it from `commit_decision` (R1). Full suite green.
- [X] T007 [P] Write failing tests in `tests/test_shimcheck.py` for the pure rules in `scripts/shimcheck.py`
  (R5, R7, R9, data-model):
  - `site_id(file, function)` is "first 16 hex of sha256(`file` \0 `function`)";
  - `validate_sweep(output, head_files)` rejects "a `file` not in `HEAD`", "a `line` past its end", "an empty
    `function` or `does`", and "the same `(file, function)` twice in one list", returning every reason;
  - `verdict(kind, level, coverage)` is `complete` iff kind is `not_fix`, or level is `cause` and coverage is
    `all` or `none_other`; otherwise `patch`;
  - `overlaps(ranges, hunks)` uses `claimcheck._touches` (old-side ranges);
  - `touched(sites, hunks)` marks each site `touched` or `not touched`;
  - `override_id(chain, tree)` is the chain id, or `tree[:12]` when no chain matches.
  Run; they fail on the missing module.
- [X] T008 Implement those functions in `scripts/shimcheck.py`. `test_shimcheck.py` green.
- [X] T009 [P] Write failing tests in `tests/test_ledger.py` for `shim_checks` (key repo, tree), `shim_chains`
  (key repo, chain id) and `shim_rulings` (key repo, chain id, site id), with the fields and allowed values of
  data-model.md:
  - `mode` is one of "`none` (all prose) · `not_fix` · `sweep` · `deep` · `rejudge`";
  - `status` is "`sweeping` → `judging` → `complete`, or `failed` (with `reason`)";
  - chain `state` is "`open` → `deep_due` (count 3) → `deep_done` → `held` (count 4); `overridden` from any state
    by the user's `override shim-<id>`; `ended` on a `complete` or when `HEAD` moves";
  - `ruling` is "`shares` · `not_shared` · `deferred`", with `issue` "required for `deferred`".
  Writers go through `ledger._transaction`. Run; fail.
- [X] T010 Add the three tables to `ledger.SCHEMA` and a `Shims` accessor beside `Claims` in `scripts/ledger.py`
  (R14). Full suite green.
- [X] T011 [P] Write failing tests in `tests/test_jev.py` against a local stub HTTP server set by `JEV_ENDPOINT`:
  - `ask_kind(diff)` sends state `COMMIT DIFF\n<diff>` and the `kind` question and returns `fix` / `not_fix`
    with `usage.cost`;
  - `ask_fix(diff, same_operation, callers)` sends the `level` and `coverage` questions with the instructions
    and criteria copied verbatim from `~/.local/share/alq-churn/churn/jev_fix.py` (not `verdict`);
  - HTTP 400 for size raises a distinct too-large error;
  - other HTTP errors, a timeout and a missing key file (`JEV_KEY_FILE`) each raise with the reason.
  Run; fail.
- [X] T012 Implement `scripts/jev.py` (stdlib only, endpoint `https://openrouter.ai/api/v1/systemone`, model
  `typesafe/jev-1.13`, key `~/.config/openrouter/key` overridable by `JEV_KEY_FILE`, timeout from T002) (R6).
  - The `kind` question: instructions "Does this change correct a defect in existing behaviour?", criteria
    `fix`: "the change corrects a defect in existing behaviour", `not_fix`: "it adds, restructures or removes
    behaviour without correcting a defect".
  - The `level`/`coverage` state keeps the replay's prefix "A fix commit from a Python repository." with the
    language taken from the diff's files.
  - The `kind` state carries no "fix commit" prefix.
  `test_jev.py` green.
- [X] T013 [P] Write failing tests in `tests/test_shim_snapshot.py`, against a scratch repo with one worktree:
  - `snapshot.export(checkout, tree)` writes `HEAD`'s files to `<main checkout>/.claude/worktrees/shim-<12 hex>/`,
    found through `git rev-parse --git-common-dir`, from both the main checkout and the worktree;
  - the worktree's `git status --porcelain` and `ls -a` show nothing new;
  - `snapshot.remove(path)` deletes only "a `shim-*` folder directly under `.claude/worktrees/`" after
    `realpath`, and refuses any other path, including a symlink pointing out.
  Run; fail.
- [X] T014 Implement `scripts/snapshot.py` with `git archive HEAD | tar -x` (R3). Green.
- [X] T015 [P] Write failing tests in `tests/test_shim_gate.py` for `hookio.shim_checks_mode()` (config, env
  `ALQ_REVIEW_SHIM_CHECKS`, default `enforce`) and `hookio.refuse_shim(text)` (deny under `enforce`, `would_deny`
  record under `log`). Run; fail.
- [X] T016 Implement both in `scripts/hookio.py` through the existing `_setting` and `_refuse_under`. Green.
- [X] T017 [P] Write the sweeper and judge prompts and schemas in `scripts/briefs.py`:
  - the standard sweep brief is the design page's sweep task verbatim, plus the snapshot path;
  - the callers-first brief (R10) starts from the callers and consumers of the changed code and searches outward
    for code doing the same operation;
  - the site-judge brief (R7);
  - the two-list sweep schema `{check_ref, same_operation[], callers[]}` with entries
    `{file, line, function, does}`;
  - the ruling schema of contracts §Site ruling.
  Add a failing test in `tests/test_shimcheck.py` that the schemas match the contract's shapes, run it, then make
  it pass.
- [X] T018 [P] Create `agents/shim-sweeper.md` (Sonnet, effort medium, `tools: Read, Glob, Grep`) and
  `agents/shim-site-judge.md` (Sonnet, effort high, `tools: Read, Glob, Grep`, frontmatter from
  `claim-contest-judge.md`). First extend `tests/test_agents.py` so each has exactly those tools and no Bash; run
  it, see it fail on the missing files, then create them.

**Checkpoint**: pure rules, ledger, Jev client, snapshot, settings, prompts and agents exist and are tested alone.

---

## Phase 3: User Story 1 — a fix that leaves sibling sites is refused at commit (Priority: P1) 🎯 MVP

**Goal**: a commit with code is refused until checked. A non-fix passes. A fix that misses a sibling is refused,
listing the sites with touched marks. Every refusal names an override.

**Independent test**: quickstart §2: a stub repo with the same unchecked input in two functions; fixing one and
committing is refused, naming the other function's file and line.

- [X] T019 [US1] Write failing gate tests in `tests/test_shim_gate.py` for the commit decision order in
  data-model §Commit decision, with recorded ledger state:
  - preconditions refuse first;
  - an unlabelled hunk refuses, naming the claim check;
  - all prose is allowed;
  - an `overridden` chain match is allowed;
  - no check refuses, naming `Workflow(name='alq-review:shim-check', args={worktree})`;
  - a `sweeping`/`judging`/`failed` check refuses with "the check failed, not the fix: <reason>" or "running",
    naming the relaunch;
  - a `patch` refuses with level, coverage and every site with id and `touched`/`not touched`;
  - a `complete` check is allowed;
  - under `log`, a `patch` is allowed with `would_deny`;
  - every refusal ends with `override shim-<id>`.
  Run; fail.
- [X] T020 [US1] Implement `shimcheck.commit_decision` and `shimgate.on_commit` in `scripts/shimgate.py`, and call
  `shimgate.on_commit` from `gate.on_bash` right after `claimgate.on_commit` (R1). The commit hook reads only the
  ledger and git. Green; full suite green.
- [X] T021 [US1] Write failing gate tests for the launch (`gate.on_workflow` → `shimgate.on_launch`) per
  contracts §Launch:
  - refused for a non-absolute `worktree`, no GitHub origin, unstaged tracked changes, nothing staged, missing
    hunk labels, or a tree that is already `complete` with no contest;
  - with a stub Jev answering `not_fix`: a `complete` check with `kind: not_fix`, `mode: not_fix`, no snapshot,
    no agent;
  - with `fix`: a `sweeping` check, the snapshot exported, and `updatedInput` carrying mode `sweep`, the
    code/mixed diff, the `HEAD` sha, the snapshot path, the brief and the schema;
  - a failed `kind` call leaves `failed` with no answers (data-model).
  Run; fail.
- [X] T022 [US1] Implement `shimgate.on_launch` and the routing in `scripts/gate.py` (R2, R4, R6). Green.
- [X] T023 [US1] Write failing harness tests for `workflows/shim-check.js`, extending `tests/workflow_harness.mjs`
  for the shim agent types:
  - mode `not_fix` runs no agent;
  - `sweep` runs one `shim-sweeper` with the injected brief and schema;
  - `rejudge` runs no agent;
  - a sweeper returning nothing gives `INCOMPLETE` with `did_not_report`;
  - the result shape is contracts §Workflow result.
  Run; fail.
- [X] T024 [US1] Implement `workflows/shim-check.js`, with `claim-check.js` as the template (R4). Green.
- [X] T025 [US1] Write failing tests in `tests/test_sweeper_read.py`, driving `scripts/sweeper_read.py` with
  payloads:
  - a Read, Glob or Grep from `agent_type` `alq-review:shim-sweeper` whose resolved path is inside a
    `shim-<12 hex>` folder directly under `.claude/worktrees/` gets `permissionDecision: allow`;
  - the same agent outside it, with no `path`, or through a symlink that resolves out, gets `deny` with a reason
    naming the snapshot;
  - any other agent, or the main session, gets no output.
  Run; fail.
- [X] T026 [US1] Implement `scripts/sweeper_read.py` (json and os only) (R3). Green.
- [X] T027 [US1] Write failing gate tests for recording a sweep (`on_structured_output` /
  `after_structured_output` routed by `shimgate.owns`):
  - invalid output goes back to the agent with T007's reasons;
  - valid output is recorded;
  - after the last expected output, a stub Jev `level`/`coverage` call runs and the verdict is stored with
    status `complete`;
  - the snapshot is removed on `complete` and on `failed`;
  - a Jev error leaves `failed` with the reason, and a 400 for size gives the split message.
  Run; fail.
- [X] T028 [US1] Implement the recording hook in `shimgate` (R5, R6, R13). Green.
- [X] T029 [US1] Write failing gate tests for restarting a stopped check (R13, quickstart §5):
  - a relaunch of a `sweeping` check sweeps again;
  - a relaunch of `judging` with lists recorded calls only Jev;
  - a relaunch of `failed` before lists sweeps;
  - no restart changes a chain's count.
  Run; fail.
- [X] T030 [US1] Implement the restart rules in `shimgate.on_launch`. Green.
- [X] T031 [US1] Write failing gate tests for the override (R11, contracts §User override):
  - a user prompt `override shim-<chain id>` sets the chain `overridden`;
  - `override shim-<tree12>` opens a chain seeded with that tree's hunk ranges, then overrides it;
  - a re-staged tree overlapping it commits with no check;
  - an unrelated tree is still refused;
  - after `HEAD` moves, the bug is checked again;
  - one `shim-override` log entry is written;
  - an agent command writing the ledger is refused by `shell.classify`, unchanged.
  Run; fail.
- [X] T032 [US1] Teach `gate.on_prompt` the word `override shim-<id>` through `shimgate`, on the
  `claimgate.UNLOCK_CLAIM` pattern. Green; full suite green.
- [X] T033 [US1] Add gate tests for spec US1 scenarios 5 and 6: an all-prose tree is not swept (SC-002), and a
  `MIXED` hunk goes to the sweep. Run them and confirm they pass against the code already written; if one fails,
  fix the cause in `shimgate`.

**Checkpoint**: US1 works end to end against recorded outputs. This is the MVP.

---

## Phase 4: User Story 2 — a contested site is ruled once (Priority: P2)

**Goal**: the author contests a listed site; a fresh judge rules it once per bug; the same tree is re-judged with
no new sweep.

**Independent test**: quickstart §3.

- [X] T034 [US2] Write failing gate tests for contest acceptance (R8):
  - `args.contests` is refused before any agent runs for a site not in the chain's current list, a site
    already ruled, or an empty reason;
  - an accepted contest runs one `shim-site-judge` per site.
  Run; fail.
- [X] T035 [US2] Implement contest acceptance in `shimgate.on_launch` and the judge step in
  `workflows/shim-check.js`, with a harness test first. Green.
- [X] T036 [US2] Write failing gate tests for recording a ruling:
  - `deferred` without `issue`, or with an issue `gh issue view <n> --json state` does not report `OPEN` (stub
    `github._gh`), is rejected back to the judge;
  - `evidence` paths must exist in the staged tree;
  - a stored `not_shared` or open `deferred` drops the site from the next Jev state;
  - the same tree is re-judged in `rejudge` mode and its verdict replaced, with no refusal added;
  - a later launch drops a deferral whose issue closed.
  Run; fail.
- [X] T037 [US2] Implement ruling validation, storage in `shim_rulings` and the rejudge in `shimgate`. Green;
  SC-005 covered by a test where the same site is contested twice in one chain.

**Checkpoint**: US1 and US2 work independently.

---

## Phase 5: User Story 3 — a bug that keeps turning up new sites gets a deep sweep (Priority: P2)

**Goal**: refusals of one bug are counted on one branch at one `HEAD`. At 3 the deep sweep sets the target. At 4
the chain holds and asks the user. Misses are logged.

**Independent test**: quickstart §4.

- [X] T038 [US3] Write failing gate tests for chain membership and counting (R9, FR-015), with recorded sweeps on
  one `HEAD`:
  - a `patch` touching a listed site or an earlier hunk joins the chain; one touching neither opens a new chain;
  - each new tree's `patch` adds 1;
  - an overlapping `complete` ends the chain, and so does `HEAD` moving;
  - one commit touching two chains counts for both;
  - another branch never matches.
  Run; fail.
- [X] T039 [US3] Implement chain matching and counting in `shimgate` with `shimcheck.overlaps`. Green.
- [X] T040 [US3] Write failing tests for the deep sweep (R10):
  - at count 3 the refusal names the deep step;
  - the next launch runs mode `deep` with three `shim-sweeper` agents (two standard, one callers-first);
  - the merged SAME OPERATION list (by site id) becomes the chain's `target`;
  - that check's verdict replaces the third without counting;
  - later checks of the chain run `rejudge` against the target.
  Cover the harness and the gate. Run; fail.
- [X] T041 [US3] Implement deep mode in `workflows/shim-check.js` and `shimgate`. Green.
- [X] T042 [US3] Write failing gate tests for the hold: at count 4 the chain is `held` and the refusal asks the
  user and names `override shim-<chain id>`; after the override, re-staged trees of the bug commit. Run; fail.
- [X] T043 [US3] Implement the hold in `shimcheck.commit_decision` and `shimgate`. Green.
- [X] T044 [US3] Write failing gate tests for miss logging (R12, FR-018, SC-004): a later list or the deep list
  naming a site absent from an earlier check's list in the same chain writes one `shim-miss` (site id, chain, the
  earlier check), once. Run; fail.
- [X] T045 [US3] Implement miss logging in `shimgate` through `hookio.record`. Green.

**Checkpoint**: US1–US3 work independently.

---

## Phase 6: User Story 4 — the check is paid for once per staged tree (Priority: P3)

**Goal**: a retry of an unchanged tree reuses its verdict, and the cost is logged.

**Independent test**: quickstart §6.

- [X] T046 [US4] Write gate tests, failing where the behaviour is missing:
  - a commit retry of a checked tree needs no launch, and a relaunch of a `complete` tree with no contest is
    refused;
  - a one-line change is refused, naming the launch;
  - every finished check writes `shim-check` to `gate.log` with verdict, answers, site count and cost `agents`,
    `seconds` and `jev_usd` (FR-012).
  Implement the missing parts in `shimgate`. Green.

---

## Phase 7: Polish & release

- [X] T047 Write `tests/replay_shim.py`: for each fixture in `tests/fixtures/shim-replay/manifest.json`, call
  `jev.ask_kind`, and for `fix` call `jev.ask_fix` with the recorded sweep, compose `shimcheck.verdict`, and
  compare with the expected verdict. Run it live (quickstart §7) and record per-commit results in
  `specs/006-shim-check-gate/research.md` R6. Drop the non-fix fixtures: SC-001 scores evidence fixes only.
  SC-001: every evidence-table commit matches. If SC-001 fails, stop and report; do not tune the questions
  in this task.
- [X] T048 [P] Update `README.md` (shim check, contests, `override shim-<id>`, the snapshot location, the
  per-repo `.claude/` ignore entries), and bump `.claude-plugin/plugin.json` to `0.8.0`.
- [X] T049 [P] Run quickstart §2 live in a scratch GitHub-origin repo, in a headless session started inside a
  worktree. Confirm the sweeper transcript shows only Read, Glob and Grep under the snapshot, no permission
  prompt, and no snapshot after the verdict. Record the wall time against SC-003 (≤ 4 min).
- [X] T050 Run the full suite and quickstart §1–§8, then the internal review loop per `.claude/rules/pr-review-loop.md`.
- [ ] T051 Before the version is installed on the bot (quickstart §9): on the bot, the key file is readable and
  one `jev.ask_kind` call returns an answer. If not, do not release.

---

## Phase 8: Amendment of 2026-10-06 — a bug is followed across commits (ADR-0001, issue #17)

**Goal**: FR-015, FR-017 and FR-018 as amended. Supersedes every task line that names a removed mechanism: the
touched mark (T007, the Phase 3 goal, T019), the stored chain `state` and its `HEAD` end (T009, T019, T031,
T042), the count at one `HEAD` (the Phase 5 goal, T038), the "one commit touching two chains counts for both"
case of T038, and the "after `HEAD` moves, the bug is checked again"
case of T031. Needs spec 005 Phase 7 (T052) first. Stored chains are not migrated.

**Independent test**: quickstart §4.

- [ ] T060 Change `test_head_moving_leaves_the_chain_behind`, which asserts count 1 after a commit of an
  unrelated file between two patches of one bug, so that it asserts count 2. Run it; it fails on the current
  code.
- [ ] T061 [P] Write tests, not written yet, in `tests/test_shimcheck.py` for carried ranges (R9): a range below an edit is
  shifted; a range overlapping a replaced range grows to the replacing lines; a fully deleted range is dropped;
  a site line swept in `HEAD` is carried to the staged tree before it is stored; a chain in each of the four
  states whose range moved is still matched, at commit and at launch. Run them; each fails.
- [ ] T062 Implement the carry in `shimcheck` on the lineage module, applied before the overlap test, and key
  chains by `(repo, branch, chain id)` in `scripts/ledger.py` and `shimgate`. T060 and T061 pass.
- [ ] T063 [P] Write tests, not written yet, in `tests/test_shimcheck.py`, pure, one per cell of data-model `shim_chains` that
  can occur. State: `held` is matched before `overridden`, then `deep due`, then `checked`. For a `checked` and
  for a `deep due` chain, each event of the table that can occur in that column: a `patch` on a new tree; the
  `deep` check's `patch`, which counts nothing and adds its tree to `trees`; a contest after it on that tree,
  which counts nothing; a `patch` on a tree in `trees`; `complete`; a failed check; an allowed launch; the
  override by chain id and by tree id; a commit. For a `held` and for an `overridden` chain: the override, a commit, and a completed check that writes
  nothing. A `patch` that matches no chain opens one at count 1; a tree-id override that matches none opens one
  at count 0. A bug overridden at 4 is `checked` after the commit and `held` at its next `patch`; one overridden
  at 2 is `deep due` at 3 and `held` at 4; the deep sweep is not run twice. Tree rule, for a tree that matches two
  chains, one per row of the merged-chain table: the `id` is that of the larger count, and of the smaller `id`
  at equal counts; the `count` is the larger; `target` is the union when both have one and empty when one has
  none, so a chain at 3 with a target merged with one at 1 is `deep due`; `override` is kept when both have one
  at the same `head` and neither is `held`, and dropped otherwise, so a held chain merged with an overridden one
  is `held`; the other chain gets `ended: merged` at an allowed launch and at an override; its rulings are
  keyed to the merged chain, and a site ruled differently in the two loses its ruling. Run them; each fails.
- [ ] T064 Write gate tests, not written yet, in `tests/test_shim_gate.py` for the hook paths: a user prompt `override shim-<id>`
  by chain id and by tree id; an agent cannot override; a tree that matches a held chain is refused at the launch
  and at the commit; one that matches an overridden chain and no held one is refused at the launch and allowed
  at the commit; one that matches both is refused at both. Run them; those for a changed rule fail, and the
  rest pin behaviour that must not change.
- [ ] T065 Replace the stored `state` and its transitions by the rules of data-model `shim_chains`. T063 and
  T064 pass.
- [ ] T066 Failing test, then code: a `patch` refusal prints, per listed site, the staged-tree line ranges of the
  hunks in its file, and no touched mark. Green.
- [ ] T067 Failing test, then code: a sweep miss is logged only against earlier checks that swept the same
  `HEAD` (R12). Green.
- [ ] T068 Update the plugin README (the shim check, override) and run quickstart §4.

## Dependencies & Execution Order

- **Setup (T001–T004)**: T001 and T002 can change R3/R6. If T001 fails, stop before Phase 2.
- **Foundational (T005–T018)**: after Setup. T006 must precede T020; T008, T010, T012, T014 and T016 precede
  every US1 task.
- **US1 (T019–T033)**: after Foundational. The MVP.
- **US2 (T034–T037)** and **US3 (T038–T045)**: after US1, independent of each other except that both edit
  `shimgate.py` and `shim-check.js`, so do them one after the other, not in parallel.
- **US4 (T046)**: after US1.
- **Polish**: T047 needs T012 and T003; T049–T051 need all stories.

### Within each story

The test task runs and fails before its implementation task. A task that edits a caller listed under Path
Conventions re-runs the full suite.

## Parallel Opportunities

- Setup: T002 and T003 alongside T001.
- Foundational test/implementation pairs on separate files: T007/T008, T009/T010, T011/T012, T013/T014, T015/T016,
  T017 and T018 can be split across workers once T005/T006 are done.
- Polish: T048 and T049.

Example (Foundational):

```text
Worker A: T007 → T008  (scripts/shimcheck.py)
Worker B: T011 → T012  (scripts/jev.py)
Worker C: T013 → T014  (scripts/snapshot.py)
```

## Implementation Strategy

1. Setup and Foundational; stop if T001 shows the sweeper read path does not work.
2. US1 → validate with quickstart §2 against recorded outputs. This is the MVP, but it is not released alone:
   the plugin version ships after US1–US4, T047 (SC-001) and T051.
3. US2, then US3, then US4, each validated by its quickstart section.
4. Polish, review loop, release.
