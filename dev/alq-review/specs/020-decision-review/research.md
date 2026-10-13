# Research: the internal review round checks the diff against the decisions that govern it

Read on 2026-10-12 and 2026-10-13: `@adrkit/cli` 0.20.0 as installed, the closed PR #92, and `plugins/alq-review` on
`main` at `86a4b06`. Facts marked "run" were run; the rest were read.

## R1: The check runs in the gate, at an internal round's launch

- **Decision**: `gate.on_workflow` runs the check for internal launches only, after `policy.launch_round` allows the
  launch and the review base is read, before `ledger.open_round`. Audit and assess-round launches run no check.
- **Rationale**: the launch is the one moment with the diff range, the commit and the reviewer list in hand; a launch
  refused for its own reasons spends nothing on adrkit (ADR-0009).

## R2: The files are the reviewers' own diff range

- **Decision**: the files are those of the range the reviewer prompt prints (full: `<base>...HEAD`, delta:
  `<previous round>..HEAD`), deleted files, both sides of a rename, symlinks and non-regular files included.
  `worktree.changed_files` is generalised to take a range; one function writes the range for the prompts and the check.
- **Rationale**: FR-002 forbids a kept list. adrkit matches paths as text, so a deleted path still finds its record.

## R3: The corpora

- **Decision**: every tracked `docs/adr` at any depth, plus the org corpus, each checked once (data-model § Corpus).
- **Rationale**: FR-001, FR-003. `git ls-files` answers "tracked" at any depth in one call. The spec's edge case says
  an org path inside the repo is still the org corpus, which reverses PR #92's choice.

## R4: One `adr check` per corpus

- **Decision**: per corpus, `adr check --dir <corpus> --json -- <files>`. All corpora run at once, from the checkout.
  The gate reads its `ok`, `governing` and `findings`; it reads no record and calls nothing else of adrkit's.
- **Rationale**: adrkit already decides what a record is, its status, what governs a change and whether a changed
  record is broken. Earlier drafts re-derived parts of that (statuses of files adrkit could not load, record files,
  lint findings outside the change) with a reader or adrkit's library; each was a second copy of adrkit and churned in
  review.

## R5: `adrkit.py`, the boundary module

- **Decision**: a new `scripts/adrkit.py` owns every call to `adr`. It returns one outcome per corpus and
  never raises for one, so one corpus that could not run does not hide what the others answered. The plugin is built
  for one adrkit version, and the script checks `adr --version`; any other version, or an answer
  the plugin cannot read, is "could not run" with the install step (data-model § Corpus outcome).
- **Rationale**: constitution II (validate where input enters) and P4 (an answer the gate cannot read is a check that
  could not run, not a pass).

## R6: `decisions.py` holds the rules as pure functions

- **Decision**: sorting adrkit's findings, building the result and the refusal texts are pure functions in
  `decisions.py`. The four rule names it reads (`affects-unresolvable`, `affects-repo-not-applicable`,
  `marker-scan-capped`, `marker-declarations-capped`) are a copy of adrkit's, pinned by the version check (R5).
- **Rationale**: constitution P3. adrkit exports no list of its rule names. The gate runs only one adrkit version, so
  a second guard over the names would check the same thing twice.

## R7: One deadline per hook run

- **Decision**: the deadline is taken when the hook starts: the hook's 60 s timeout less a 5 s margin. Every adrkit
  call ends by it; a test pins the 60 s to `hooks/hooks.json`.
- **Rationale**: the hook is killed at 60 s, and the 30 s review-base fetch and the `gh` calls come off the same
  budget. 5 s is left to write the ledger, `gate.log` and the answer.

## R8: One decision reviewer agent

- **Decision**: a new agent `agents/decision-reviewer.md` joins the internal wave when any record governs the change.
  It is listed in `expected`, so the round is incomplete until it reports, and its findings are validated and assessed
  like any reviewer's. Its prompt is the shared scope lines plus one line per record (contracts/interfaces.md).
- **Rationale**: FR-006, FR-007. One agent however many records: the records are its brief.

## R9: The round's result carries a `decisions` block

- **Decision**: the gate injects `args.decisions` for an internal round; `review-round.js` echoes it in every result.
- **Rationale**: FR-015, SC-008: the result tells "nothing governs" from "not checked" without reading a log.

## R10: Refusals

- **Decision**: every corpus gets its outcome before the gate refuses; the refusals and their order are data-model
  § Refusals.
- **Rationale**: FR-011, FR-018, ADR-0009. When a refusal does not block, the round opens on what was read, and one
  refusal naming every problem saves a launch per corpus.

## R11: `adr` is needed only when a corpus is to be checked

- **Decision**: with no corpus, no call is made and `adr` is not needed.
- **Rationale**: a repo without decisions should not need node (ADR-0009 point 4).

## R12: README, version and CI

- **Decision**: README item 8, Layout rows, the `decision_checks` and `max_review_files` settings, and `adr` under
  Dependencies with its install step (FR-020). `plugin.json` 0.14.0. CI installs node and the pinned adrkit.
- **Rationale**: the README changes with the code it describes, as in spec 019.

## R13: The notice choice is ADR-0020, its own PR first

- **Decision**: ADR-0020 and the constitution's lines on per-check settings and reviewer agents land in their own PR
  before the code (FR-019, constitution VI).
- **Rationale**: a governing rule ships apart from the code it governs.

## R14: Tests

- **Decision**: red first. The pure rules are tested against adrkit's real answer, captured from a run on a fixture
  corpus kept outside any `docs/adr` path, and a test re-runs adrkit to pin the capture. Contract tests run the real
  adrkit; launches are tested through the hook driver. Tests that need `adr` skip without it locally and fail without
  it in CI.
- **Rationale**: constitution IV. Every earlier draft written from reading adrkit's source was wrong somewhere new;
  only a captured answer is a shape the rules may assume.

## R15: `decision_checks`, the check's own setting

- **Decision**: `decision_checks` (`log` or `enforce`, overridden by `ALQ_REVIEW_DECISION_CHECKS`, shipped `enforce`),
  as the claim and shim checks have.
- **Rationale**: ADR-0011: without it, a machine where adrkit cannot run has no internal round at all.

## R16: `max_review_files`

- **Decision**: `config.json` gains `max_review_files` (50). It is refusal 1 and applies to every internal round.
- **Rationale**: the user's choice. adrkit's own marker-scan cap (3000 files) is fixed in its code; a smaller limit
  the plugin owns is met first.

## R17: The decision reviewer's rulings in `gate.log`

- **Decision**: when a round with a decision reviewer is assessed, one `gate.log` line lists each of its findings'
  rulings.
- **Rationale**: the user's choice: the rulings tell whether the reviewer's brief is right.

## R18: The corpus is checked as the commit has it

- **Decision**: `worktree.is_dirty` runs `git status --porcelain --untracked-files=normal` instead of
  `--untracked-files=no`, and `policy.launch_round`'s refusal says "uncommitted changes or new files" with commit,
  delete or ignore as the fix (FR-024). No corpus-specific check.
- **Rationale**: adrkit reads the folder on disk, and the gate's one uncommitted-changes check skipped new files, so a
  drafted decision could govern a round it is not part of. One flag on the existing check closes that; a second
  check over decision folders would answer the same question twice. Reviewers already treat untracked files as not
  evidence (`briefs.py`), so the gate now agrees with them. Cost: any stray untracked file blocks a launch until it is
  committed, deleted or ignored.
