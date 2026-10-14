---

description: "Task list for #101: the poller reads Codex's status card to know when its review of the head has ended"
---

# Tasks: The poller reads Codex's status card to know when its review of the head has ended

**Input**: Design documents from `dev/alq-review/specs/101-codex-card-status/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R10), data-model.md, contracts/codex-reader.md, quickstart.md

**Tests**: Required. FR-012 and constitution IV: every test is written and run red before its code, and the
expected red reason is stated on each run-red task. A test that is green at write time grades a rule an earlier
phase landed; the task says so and names the red grade for that rule.

**Organization**: Phase 2 builds the reader (every story reads its output) and wires the poller to it. Each
story phase then holds its poller tests and the slice of the poller's jq that serves it. Phase order follows
priority: US1 (P1), US2, US3, US5 (P2), US4 (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5, as numbered in spec.md)
- Paths are relative to the repository root

## Path Conventions

- Plugin code: `plugins/alq-review/scripts/`, `plugins/alq-review/skills/alq-github-pr-review/`
- Tests: `dev/alq-review/tests/` (run from `dev/alq-review/` with `python -m unittest -v`)
- Fixtures: `dev/alq-review/tests/fixtures/codex/` (R8; supersedes the `fixtures/codex-card/` path in plan.md's
  tree and quickstart.md, aligned in T002)
- Spec folder: `dev/alq-review/specs/101-codex-card-status/`

---

## Phase 1: Setup (fixtures and design-doc alignment)

**Purpose**: The sampled Codex bodies become test fixtures before any test is written (R8, quickstart step 0).

- [ ] T001 Copy the ten files of `dev/alq-review/specs/101-codex-card-status/samples/` to `dev/alq-review/tests/fixtures/codex/` unchanged, same names (`card-one-row-running.md`, `card-one-row-completed.md`, `card-two-rows-code-running-security-completed.md`, `card-two-rows-code-completed-security-running.md`, `card-two-rows-code-completed-security-completed.md`, `verdict-comment.md`, `security-comment.md`, `review-with-findings.md`, `decline-not-connected.md`, `decline-error.md`); verify each pair with `cmp` (byte for byte, R8)
- [ ] T002 [P] Align the fixture path in the design docs to R8: in `dev/alq-review/specs/101-codex-card-status/plan.md` replace the `fixtures/codex-card/{completed-one-row,completed-two-rows}.md` tree line with `fixtures/codex/*.md  # the ten samples, copied byte for byte (R8)`; in `dev/alq-review/specs/101-codex-card-status/quickstart.md` step 0 expect `ls tests/fixtures/codex/` to list the ten sample names and step 4 read `tests/fixtures/codex/card-one-row-completed.md`

---

## Phase 2: Foundational (the Codex reader, and the poller wired to it)

**Purpose**: `codexstate.py` returns Codex's state for the round (R1, R3, R4, R5); the poller hands it every Codex
item and carries its output into `ANALYZE` (R2) and prints what it read (FR-014). No story's poller behaviour
can be tested before this exists.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Reader tests, red first (R9)

- [ ] T003 Create `dev/alq-review/tests/test_codexstate.py` importing as `test_specbinding.py` does (`import helpers  # noqa: F401` then `import codexstate`), with `SAMPLES = Path(__file__).parent / "fixtures" / "codex"` and a `sample(name)` reader. Tests for the forms (R3, data-model "Acknowledgement form"): `codexstate.match` names `card` for `card-one-row-completed.md` (first line is exactly `<!-- codex-pull-request-review-summary -->`), `verdict` for `verdict-comment.md` (begins `Codex Review: Didn't find any major issues.`), `security` for `security-comment.md` (begins `### 🛡️ Codex Security Review`), `review` for a `kind: review` item whose body is `review-with-findings.md` (begins `### 💡 Codex Review` after leading whitespace is stripped: the sample starts with a newline); `None` for `decline-not-connected.md`, `decline-error.md` and `test_poll_pr_review.py`'s `USAGE_LIMIT` text. Tests for card reading (R4, data-model "Code Review row"): on each of the five card samples `read_card` yields the Code Review row's `status` (`Running` or `Completed`), `status_at` re-printed `%Y-%m-%dT%H:%M:%SZ` from the row's `datetime="…"` (parsed as `%Y-%m-%dT%H:%M:%S.%fZ` or `%Y-%m-%dT%H:%M:%SZ`) and `commit` (first `[0-9a-f]{7,40}` token of the Commit cell), ignoring the Security Review row; `card-two-rows-code-completed-security-running.md` yields `Completed`, `2026-10-13T13:54:16Z`, `a3d2db7`
- [ ] T004 Add to `dev/alq-review/tests/test_codexstate.py` the seven reading failures (FR-007), each built by editing a copy of `card-one-row-completed.md` in the test and passed as a comment item with `url="u1"`: Code Review row deleted → `no Code Review row`; row duplicated → `2 Code Review rows`; `**Completed**` replaced by `**Failed**` → `status is neither Running nor Completed`; the `datetime="…"` attribute removed → `no datetime in the Status cell`; `datetime="yesterday"` → `datetime yesterday is not in the card's format`; Commit cell blanked → `no commit in the Commit cell`; two card items → `2 comments carry the marker`. Each asserts `state == "unreadable"`, `commit` and `status_at` `None`, `unknown == []`, and `errors == ["Codex status card u1 cannot be read: <why>; its format changed: report it on the plugin's repo and read the PR by hand"]`; the two-cards case names the first card's URL. Then the state table (R5, data-model "State transitions"), with `SINCE="2026-10-13T12:00:00Z"`, `HEAD = "a3d2db7" + 33 hex`: no items → `not_started` with `commit`/`status_at` `None`; Completed row with `status_at < SINCE` → `not_started` carrying the row's `commit` and `status_at`; Running row after `SINCE`, commit a prefix of `HEAD` → `reviewing`; Running row for another commit → `reviewing`; Completed row after `SINCE`, commit a prefix of `HEAD` → `answered` with `status_at` the row's; Completed row for another commit → `superseded`; no row after `SINCE` plus an unknown comment since the trigger → `declined`; an unknown comment before `SINCE` → `not_started`; an unknown item beside each of Running, Completed-for-head, Completed-for-other → the row's state; unreadable card beside an unknown item → `unreadable`; in every case `unknown` and `comments` as the output table of `contracts/codex-reader.md` says; `spoke` true when any non-card item is since the trigger (a review counts), false when only the card is; a card created before `SINCE` whose row is after `SINCE` → `answered` (the card's `at` is never compared)
- [ ] T005 Add to `dev/alq-review/tests/test_codexstate.py` the CLI round trip (contract "Exit codes"): `subprocess.run([sys.executable, str(PLUGIN / "scripts" / "codexstate.py")], input=json.dumps({"since", "head", "items"}))` prints exactly `codexstate.state(items, since, head)` as JSON and exits 0, `unreadable` included; stdin that is not JSON, a top-level list, an object without `items`, and an item with `kind: "reaction"` each exit 2 with stderr starting `codexstate: ` and empty stdout
- [ ] T006 Run red from `dev/alq-review/`: `python -m unittest -v test_codexstate`. Expected: every test errors with `ModuleNotFoundError: No module named 'codexstate'`

### Reader implementation (R1, R3, R4, R5)

- [ ] T007 Create `plugins/alq-review/scripts/codexstate.py`, standard library only (`test_shipped_tree`): `FORMS` as one tuple of `(name, kind, prefix)` for `card` (`<!-- codex-pull-request-review-summary -->` as the whole first line), `verdict` (`Codex Review: Didn't find any major issues.`), `security` (`### 🛡️ Codex Security Review`), `review` (`### 💡 Codex Review`, kind `review`); `match(item)` strips leading whitespace and returns the form's name or `None`; `read_card(url, body)` takes the lines starting with `|`, splits each on `|` and strips the cells, takes the rows whose first cell contains `**Code Review**` (none or more than one is an error), reads `\*\*(Running|Completed)\*\*` and `datetime="([^"]+)"` from the Status cell and the first `[0-9a-f]{7,40}` token from the Commit cell, parses the datetime with `datetime.strptime` against `%Y-%m-%dT%H:%M:%S.%fZ` then `%Y-%m-%dT%H:%M:%SZ` (never `fromisoformat`, R4) and re-prints it `%Y-%m-%dT%H:%M:%SZ`, returning `(row, errors)` with each error worded as in T004; `state(items, since, head)` decides in R5's order (1 unreadable: any card error or more than one card; 2 from the row when `status_at > since`: Running → `reviewing`, Completed and `head.startswith(commit)` → `answered`, else `superseded`; 3 `declined` when an item since `since` matches no form; 4 `not_started`) and always returns `{state, commit, status_at, spoke, comments, unknown, errors}` per the contract's table; `main()` reads one JSON object from stdin, validates `since` and `head` are strings and `items` a list of objects with `kind` in `{"comment","review"}` and string `url`, `at`, `body`, exits 2 with `codexstate: <why>` on stderr otherwise, else prints `json.dumps(state(...))` and exits 0
- [ ] T008 Run green from `dev/alq-review/`: `python -m unittest -v test_codexstate test_shipped_tree`. Expected: all pass

### Poller harness and wiring (R2, R8, FR-014)

- [ ] T009 [P] In `dev/alq-review/tests/test_poll_pr_review.py` add the card helpers: `SAMPLES = Path(__file__).parent / "fixtures" / "codex"`, `sample(name)`, and `card(name, cid=90, commit=HEAD[:7], at=None, created=None)` returning `comment(cid, CODEX, body, created or at(1))` where `body` is the sample with, on the line starting `| 📝 **Code Review**` only, its 7-hex Commit cell token replaced by `commit` and both the `datetime="…"` attribute and the `<relative-time>` text replaced by `at` (R8: only the SHA and the time are substituted; the Security Review row is untouched). Replace every `"Codex Review: Didn't find any major issues."` literal with `VERDICT = sample("verdict-comment.md")` and every `"Here are some automated review suggestions"` with `REVIEW_WITH_FINDINGS = sample("review-with-findings.md")`. Run `python -m unittest -v test_poll_pr_review`: still green (bodies only changed)
- [ ] T010 Add to `dev/alq-review/tests/test_poll_pr_review.py`, red first: (a) FR-014: a settled report carries, on the line after the `== acme/demo#7 @ …` header, `Codex: answered abc1234 at <status_at>` when the snapshot holds `card("card-one-row-completed.md", at=at(12))`, and a TIMEOUT report with no card carries `Codex: not started`; (b) R1's guard: a `python3` shim written to `self.tmp / "bin" / "python3"` that execs the real interpreter unless its last argument ends with `codexstate.py`, in which case it exits 1; the poller then prints `ERROR: the Codex reader failed` on stderr, exits 1 and writes no drop
- [ ] T011 Run red from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review -k codex_line -k reader_fail` (use the test names given in T010). Expected: (a) `AssertionError` on the missing `Codex: ` line; (b) exit 0 or 3, not 1
- [ ] T012 In `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh`: add `READER="$(dirname "${BASH_SOURCE[0]}")/../../scripts/codexstate.py"`; move `ANALYZE`'s `bare`, `$comments`, `$trigger` and `$since` definitions (today lines 162–166 and the `bare` def) verbatim into a `TRIGGER_DEFS` jq snippet prepended to both programs (R2, define once); add a `CODEX_ITEMS` jq program producing `{since: $since, head: $pr.headRefOid, items: [every $comments[] by $codex, any time, as {kind: "comment", url, at: .createdAt, body}] + [every $pr.reviews.nodes[] by $codex with .submittedAt != null as {kind: "review", url, at: .submittedAt, body}]}`; rewrite `snapshot()` as three steps on one `gh api graphql` result held in a variable: `input=$(jq … "$TRIGGER_DEFS$CODEX_ITEMS" <<<"$raw")`, then `if ! codex=$(python3 "$READER" <<<"$input"); then echo "ERROR: the Codex reader failed" >&2; return 1; fi` (so `set -e` ends the run with exit 1 at `state=$(snapshot)` and a reader crash can never become exit 2), then `jq --argjson codex "$codex" … "$TRIGGER_DEFS$ANALYZE"`; add `codex: $codex` to `ANALYZE`'s output object; add to `REPORT`, immediately after the header line, `Codex: <state> <commit> at <status_at>` with `since` in place of `at` for `reviewing` and `Codex: not started` / `Codex: declined` when `commit` is null (contract, FR-014). Touch nothing in `hand_to_gate` (`test_poller_contract.py` extracts it by `sed` range). Run `python -m unittest -v test_poll_pr_review test_poller_contract`: T010's tests and the whole file pass

**Checkpoint**: the reader is graded on Codex's own bodies and the poller prints what it read; every story's
poller tests can now be written against `codex.*`

---

## Phase 3: User Story 1 - The poller waits while Codex reviews the head (Priority: P1) 🎯 MVP

**Goal**: a Running Code Review row holds the poller and names the commit and time; Completed for the head since
the trigger is the answer; the card is never a "Codex comment since the trigger" (FR-001–FR-003, FR-005, FR-006,
FR-013's release of `not_started`).

**Independent Test**: `python -m unittest -v test_poll_pr_review -k reviewing -k running_row -k not_started -k card`
against snapshots whose card is `card()` in each state; read exit code, report and drop.

### Tests for User Story 1 (red first)

- [ ] T013 [US1] In `dev/alq-review/tests/test_poll_pr_review.py` give every existing test whose round Codex answers the Completed card for the head: add `card("card-one-row-completed.md", at=at(12))` to the `comments` of each test that uses `CODEX_CLEAN`, `BODY_THUMBS` or `VERDICT` at `at(12)` (the clean, findings, gate-lag, thumbs-up, outside-diff, ignored-check and unstable tests); `test_a_codex_answer_before_the_trigger_does_not_end_the_wait` gets `card(..., at=at(-60), created=at(-60))`; `test_a_gate_status_that_never_catches_up_is_reported_after_the_sweep` gets `card(..., at=at(-40), created=at(-40))` beside its trigger at `at(-50)`; `test_the_waiver_is_printed` gets no card and keeps exit 0 (FR-013); `test_codex_comments_reach_the_drop_as_gate_comments` gets no card. This is fixture alignment, not a red test: run `python -m unittest -v test_poll_pr_review`, still green (today a card after the trigger counts as an answer)
- [ ] T014 [US1] Add to `dev/alq-review/tests/test_poll_pr_review.py`, each snapshot with `check("pytest")`, `ATTESTED` and no `codex-review` run unless stated: (1) `card("card-one-row-running.md", at=at(1))`, `merge="CLEAN"` → exit 3 after `minutes="0"`, stdout has `Codex is reviewing abc1234 since <at(1)>`, no drop; (2) that snapshot then `card("card-one-row-completed.md", at=at(5))` with `body_thumbs=BODY_THUMBS`, `merge="CLEAN"` → exit 0, `drop()["status"] == "clean"`; (3) then the Completed card plus `review(9, CODEX, REVIEW_WITH_FINDINGS, at(5))` and a `thread(1, CODEX, CODEX_THREAD_BODY)` → exit 2; (4) the Running card only, `minutes="0"` → exit 3 and the TIMEOUT list names `Codex is reviewing abc1234 since <at(1)>`; (5a) no card and (5b) `card("card-one-row-completed.md", at=at(-5), created=at(-5))` → waits on `Codex has not answered since <TRIGGER_AT>` and exits 3; (6) the Completed card as the only Codex comment, `WAITING` pending gate started `at(13)` (after the row, so no lag) and `check("pytest", conclusion="FAILURE")` → exit 2, stdout lacks `Codex comments since the trigger`, `drop()["gate_comments"] == []`. Edge cases: `card("card-two-rows-code-completed-security-running.md", at=at(5))` → exit 0 with `merge="CLEAN"` and `CODEX_CLEAN` (only the Code Review row is read); the Completed card with `created=at(-20)` and `at=at(5)` → answered, exit 0 (the card's creation time is never compared); the Running card plus `comment(101, CODEX, VERDICT, at(4))` → still waits on `Codex is reviewing`; the card-less legacy Codex: `review(9, CODEX, REVIEW_WITH_FINDINGS, at(12))` and `comment(101, CODEX, VERDICT, at(12))` with no card → exit 3 and the report lists the verdict under `Codex comments since the trigger`; a 👍 on the trigger comment only, no card, no description 👍 → the `Codex answered with only a 👍` note is printed and the poller waits (FR-005, `spoke` false)
- [ ] T015 [US1] Run red from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review`. Expected: (1), (4), the verdict-before-flip and the 👍-only tests fail `AssertionError: 0 != 3` (today the card is an answer and the round is CLEAN); (5b) fails `0 != 3`; (6) fails on `Codex comments since the trigger` present and `gate_comments` holding the card; the legacy test fails `0 != 3` or `2 != 3`; (2), (3), (5a) and the two-rows edge pass already and stay as pins. Record each reason
- [ ] T016 [US1] In `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh` `ANALYZE` (R6, R7): add `waived: ($codex_gate != null and $codex_gate.state == "SUCCESS" and ($codex_gate.description | startswith("WAIVED:")))` (FR-013); remove `responded`; make `clean` today's merge-state rule `and ($codex.state == "answered" or (.waived and ($codex.state | IN("not_started", "declined"))))`; build `gate_comments` from `$codex.comments[]` as `{url, at, gist: (.body | strip_markup | first_line | clip), approves: ($codex_gate.state == "SUCCESS")}` (FR-006: never the card); make `thumbs_on_trigger_only: (($thumbs_on_trigger | length) > 0 and ($thumbs_on_body | length) == 0 and ($codex.spoke | not))`; delete `$codex_comments` and `$codex_reviews` from everything but `$codex_said_at` (which `gate_lags` still reads until T024). In `WAITING_ON` replace the `.responded` line with `(if .codex.state == "not_started" and (.waived | not) then "Codex has not answered since \(.since)" elif .codex.state == "reviewing" then "Codex is reviewing \(.codex.commit) since \(.codex.status_at)" else empty end)`; the three other waits are unchanged
- [ ] T017 [US1] Run green from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review test_poller_contract`. Expected: all pass, `test_the_waiver_is_printed` included

**Checkpoint**: SC-001 holds: PR #100's 12:50–12:54Z shape never exits 0; the 12:55Z shape exits 0

---

## Phase 4: User Story 2 - A review of a superseded commit is reported, not awaited (Priority: P2)

**Goal**: a Completed row for a commit that is not the head settles at once with the re-request, never CLEAN
(FR-004); a row older than a newer trigger is not an answer.

**Independent Test**: `python -m unittest -v test_poll_pr_review -k superseded -k second_trigger`.

### Tests for User Story 2 (red first)

- [ ] T018 [US2] Add to `dev/alq-review/tests/test_poll_pr_review.py`: (1a) `card("card-one-row-completed.md", commit="a3d2db7", at=at(5))`, `merge="CLEAN"`, `CODEX_CLEAN`, no findings → exit 4, stdout has ``Codex reviewed a3d2db7, not the head abc1234567: comment `@codex review` `` and `Codex: superseded a3d2db7 at <at(5)>`, never `CLEAN:`, no drop; (1b) the same with `check("pytest", conclusion="FAILURE")` → exit 2 and the line is still printed (SC-002 shape); (2) a second trigger `comment(102, "Analitiq-Bot", "@codex review", at(20))` newer than the row at `at(12)` → waits on `Codex has not answered since <at(20)>`, then `card(..., at=at(21))` Running → `Codex is reviewing`, then Completed for `HEAD[:7]` at `at(25)` with `merge="CLEAN"`, `CODEX_CLEAN` → exit 0; the second-trigger edge case: Running row at `at(10)`, trigger at `at(15)` → `Codex has not answered since <at(15)>`; then Completed at `at(17)` for `HEAD[:7]` → exit 0, and for `"a3d2db7"` → exit 4 with the superseded line
- [ ] T019 [US2] Run red from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review -k superseded -k second_trigger`. Expected: (1a) fails on the missing `Codex reviewed a3d2db7` line (exit is already 4 under T016's `clean` rule); (1b) fails on the missing line; (2) and the second-trigger `not answered`/`answered` legs pass already (they pin T016's rule, graded red by T014's (5b)); the second-trigger `superseded` leg fails on the missing line
- [ ] T020 [US2] In `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh` `REPORT` add, after the gate check runs block, ``(if .codex.state == "superseded" then "Codex reviewed \(.codex.commit), not the head \(.head[0:10]): comment `@codex review`" else empty end)`` (R6). `settle()` keeps its order: findings → 2, else `clean` is false for `superseded` → 4, the BLOCKED line naming the causes in `blocked_by`
- [ ] T021 [US2] Run green from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review`. Expected: all pass

**Checkpoint**: SC-002 holds: probe PR #103's trigger-2 shape exits 4 at once naming `a3d2db7` and the head

---

## Phase 5: User Story 3 - Codex's answer time is the row's status time (Priority: P2)

**Goal**: the hold for `codex-review` to catch up, and the one sweep dispatch, are timed from the row's status
time, not from the card's creation, a 👍 or a review (FR-001).

**Independent Test**: `python -m unittest -v test_poll_pr_review -k status_time -k catch_up`.

### Tests for User Story 3 (red first)

- [ ] T022 [US3] Add to `dev/alq-review/tests/test_poll_pr_review.py`: (1) `card("card-one-row-completed.md", at=at(5), created=at(1))`, no 👍, no verdict, `gate("codex-review", "PENDING", "Waiting for a Codex review of abc1234567", at(3))` → waits on `codex-review has not caught up with Codex's answer` and `self.dispatches()` has exactly one entry; (2) then `merge="CLEAN"`, `CODEX_CLEAN` → exit 0; the edge case: the same card with `review(9, CODEX, REVIEW_WITH_FINDINGS, at(2))` and `body_thumbs=[(f"{CODEX}[bot]", at(2))]` and the pending gate at `at(3)` → still waits and dispatches once (the answer time is `at(5)`, not `at(2)`)
- [ ] T023 [US3] Run red from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review -k status_time -k catch_up`. Expected: (1) and the edge case fail with exit 4 (`BLOCKED`) and no dispatch: `gate_lags` still reads `$codex_said_at`, the card's creation `at(1)` or the review's `at(2)`, both before the gate's `at(3)`
- [ ] T024 [US3] In `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh` `ANALYZE` (R7): define `(if $codex.state == "answered" then $codex.status_at else null end) as $codex_answered_at` and keep `gate_lags` reading it; delete `$codex_comments`, `$codex_reviews`, `$codex_said_at` and the `$thumbs_on_body`-based max (reactions stay fetched for `thumbs_on_trigger_only` and `$thumbs_on_body`); leave `dispatch_sweep` and the loop's dispatch unchanged. Confirm with `grep -c 'codex_comments\|codex_reviews\|codex_said_at' poll-pr-review.sh` printing 0
- [ ] T025 [US3] Run green from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review`. Expected: all pass, the existing thumbs-up and never-catches-up tests included

**Checkpoint**: every reader of Codex's answer time reads `codex.status_at`

---

## Phase 6: User Story 5 - Codex says something the poller does not know (Priority: P2)

**Goal**: an item off the acknowledgement list settles the round while no row answers, is a WARNING beside a
row, and is released by the gate's `WAIVED:` run (FR-010, FR-013).

**Independent Test**: `python -m unittest -v test_poll_pr_review -k unknown -k declined -k waived`.

### Tests for User Story 5 (red first)

- [ ] T026 [US5] Add to `dev/alq-review/tests/test_poll_pr_review.py`, with `UNKNOWN = comment(101, CODEX, sample("decline-not-connected.md"), at(2))` and a sibling using `sample("decline-error.md")`: (1a) `UNKNOWN`, no card, `merge="CLEAN"`, `CODEX_CLEAN` → exit 4, stdout has `Codex's reply is not one the poller knows (<UNKNOWN url>, <at(2)>): Codex declined or changed what it posts; read it.` and lists the comment under `Codex comments since the trigger`, never `CLEAN:`; (1b) the same with `check("pytest", conclusion="FAILURE")` → exit 2 and `drop()["gate_comments"][0]["url"] == UNKNOWN["url"]`; (2) `UNKNOWN` plus `card("card-one-row-running.md", at=at(1))`, `minutes="0"` → exit 3, waits on `Codex is reviewing`, report has `WARNING: Codex's reply is not one the poller knows (<url>, <at(2)>); read it.`; (3) `UNKNOWN` plus the Completed card for the head, `merge="CLEAN"`, `CODEX_CLEAN` → exit 0 with the WARNING line; (4) `comment(101, CODEX, USAGE_LIMIT, at(2))`, no card, `gate("codex-review", "SUCCESS", "WAIVED: Codex is out of credits; abc1234567 was not reviewed", at(3))`, `merge="CLEAN"` → exit 0, the WAIVED title under `Gate check runs:`, no `Codex's reply is not one the poller knows` line; (5) scenario 4 plus the Running card → exit 3 waiting on `Codex is reviewing`; (6) scenario 4 with `CODEX_CLEAN` (SUCCESS, not `WAIVED:`) in place of the waiver → never exit 0: per FR-010 and the contract's `declined` row it settles exit 4 with the `not one the poller knows` line (spec US5 scenario 6's "waits on Codex has not answered" wording conflicts with FR-010; FR-010 governs, and spec.md is corrected in T036)
- [ ] T027 [US5] Run red from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review -k unknown -k declined -k waived`. Expected: (1a), (1b), (6) fail on the missing `not one the poller knows` line (exit already 4/2 under T016); (2), (3) fail on the missing `WARNING:` line; (4) and (5) pass already (they pin T016's `waived` release, with `test_the_waiver_is_printed` as the pre-existing grade)
- [ ] T028 [US5] In `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh` `REPORT` add, after the superseded line, the `declined` and WARNING lines of the table "The poller, per state" in `contracts/codex-reader.md`, one line per entry of `.codex.unknown` (R6)
- [ ] T029 [US5] Run green from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review`. Expected: all pass

**Checkpoint**: an unknown Codex item is never an answer and never silently waited on

---

## Phase 7: User Story 4 - A card the poller cannot read ends the run loudly (Priority: P3)

**Goal**: every FR-007 reading failure exits 1 with the error naming the comment's URL, as a CodeRabbit body the
poller cannot parse does today.

**Independent Test**: `python -m unittest -v test_poll_pr_review -k unreadable`.

### Tests for User Story 4 (red first)

- [ ] T030 [US4] Add to `dev/alq-review/tests/test_poll_pr_review.py` one test per reading failure through the fake `gh`, each a `comment(90, CODEX, <edited card body>, at(1))` edited as in T004 (row deleted, row duplicated, `**Failed**`, no `datetime`, `datetime="yesterday"`, blank Commit cell) and one with two card comments (ids 90 and 91): each exits 1 at the first poll, stderr has `ERROR: Codex status card https://github.com/acme/demo/pull/7#issuecomment-90 cannot be read: <why>; its format changed: report it on the plugin's repo and read the PR by hand`, stdout has no report header, and no drop is written
- [ ] T031 [US4] Run red from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review -k unreadable`. Expected: each fails with exit 4 (or 2) instead of 1: `unreadable` adds no wait and `errors` does not yet carry the reader's
- [ ] T032 [US4] In `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh` `ANALYZE` make `errors` `($overflow + $unparsed + $codex.errors + (if $trigger_id != "" …))`, so the loop's existing `errors` check prints each as `ERROR: …` and exits 1 before any report (R6)
- [ ] T033 [US4] Run green from `dev/alq-review/`: `python -m unittest -v test_poll_pr_review`. Expected: all pass

**Checkpoint**: all five stories pass through the fake `gh`; the reader is graded without it

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: the prose that states the rule changes with the code (R10, FR-009), the spec inconsistency found in
T026 is corrected, and the whole suite and quickstart are run.

- [ ] T034 [P] Rewrite the header of `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh` (lines 11–21 today): SETTLED's first bullet states the card rule (Codex has answered when its status card's Code Review row says Completed for the head with a status time after the trigger, at that status time; a Running row is waited on; a Completed row for another commit is reported with the re-request; any Codex item off the acknowledgement list in `scripts/codexstate.py` settles the round while no row answers and is a WARNING beside one); the `codex-review` lag bullet names "the row's status time" in place of "a comment, a review, or a 👍"; the `GATE_SWEEP_MINUTES` comment (lines 53–55) stays. Verify with `grep -c "a comment, a review, or a 👍" poll-pr-review.sh` printing 0
- [ ] T035 [P] In `plugins/alq-review/skills/alq-github-pr-review/SKILL.md`: the *Waiting for the response* "settled" paragraph says Codex answered when its status card's Code Review row says Completed for the head since the trigger, and points to `scripts/codexstate.py` for the list of what Codex is known to post; the 👍 paragraph keeps the gate's rule (the gate reads reactions on the description) and drops "its only answer is a 👍 on the description"; the exit-code table is unchanged. In `plugins/alq-review/README.md` Layout table add `| `scripts/codexstate.py` | Codex's state for a review round, read from its status card and its known comment forms - a pure function the poller calls |` beside the other `scripts/` rows
- [ ] T036 [P] In `dev/alq-review/specs/101-codex-card-status/spec.md` correct US5 scenario 6's Then to FR-010's outcome: "it settles at once, exit 4 (exit 2 with open findings or failing checks), printing that Codex's reply is not one the poller knows; it never exits 0: a plain SUCCESS run does not release the round", and note the correction under Clarifications with today's date
- [ ] T037 Run the whole suite as CI does, from `dev/alq-review/`: `python -m unittest -v`. Expected: every test passes, `test_shipped_tree`, `test_poller_contract` and `test_codexstate` included (SC-003, SC-004)
- [ ] T038 Run quickstart steps 4 and 6 from `dev/alq-review/`: the reader by hand on `tests/fixtures/codex/card-one-row-completed.md` gives `answered`, then `superseded` with another head, `not_started` with `since` past the row's time, `unreadable` with the `datetime` attribute removed; `grep -n "a comment, a review, or a 👍"` over the poller and `SKILL.md` prints nothing and `grep -n codexstate plugins/alq-review/README.md` finds the Layout row
- [ ] T039 Before opening the PR run the tripwire from the repo root: `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; `poll-pr-review.sh` and `test_poll_pr_review.py` are edited by five phases of one settled design (R6, R7), so commit each phase's test-plus-code together and, if either file exceeds ~3 commits, squash its commits into one before pushing rather than leaving the sediment (pr-review-loop tripwire)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; T001 and T002 in parallel
- **Foundational (Phase 2)**: T003–T008 need T001 (the samples); T009 is independent of T003–T008; T010–T012 need T009 and T007. BLOCKS every story
- **User Stories (Phases 3–7)**: each needs Phase 2. They are sequential in one file pair, in the order US1 → US2 → US3 → US5 → US4: US2's exit-4 outcome and US5's `waived` release rest on US1's `clean` rule (T016); US3 removes the bindings US1 leaves for `gate_lags`; US4 is last by priority
- **Polish (Phase 8)**: T034–T036 need nothing after Phase 2 and can run in parallel with the stories; T037–T039 need every story

### Within Each User Story

- Tests are written and run red (the "Run red" task records the reason) before the slice of jq that serves them
- The `ANALYZE` / `WAITING_ON` / `REPORT` edits per story are the slices of one design (R6, R7); none adds a path the research does not name

### Parallel Opportunities

- T001 ‖ T002
- T009 ‖ T003–T008 (different files)
- T034 ‖ T035 ‖ T036 ‖ any story phase (prose and spec only)
- Within a story the test and code tasks touch the same two files: sequential

---

## Parallel Example: Phase 2

```bash
# Reader tests and the poller harness touch different files:
Task: "T003–T005 write dev/alq-review/tests/test_codexstate.py"
Task: "T009 add card()/sample() helpers to dev/alq-review/tests/test_poll_pr_review.py and swap the inline bodies for the samples"
```

## Parallel Example: Phase 8 with the stories

```bash
Task: "T034 rewrite the poller header"
Task: "T035 SKILL.md and README Layout"
Task: "T036 correct spec.md US5 scenario 6"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: fixtures in place
2. Phase 2: the reader green on Codex's own bodies; the poller prints `Codex: …`
3. Phase 3: US1: the Running card holds, the Completed card for the head answers, the card is never a comment
4. **STOP and VALIDATE**: SC-001 through `python -m unittest -v test_poll_pr_review`; issue #101's defect is closed here

### Incremental Delivery

1. US2 adds the superseded line (SC-002)
2. US3 moves the gate lag to the status time and deletes the last of the old bindings
3. US5 adds the declined line and the WARNING
4. US4 routes the reader's errors to exit 1
5. Polish: prose, spec correction, full suite, quickstart, tripwire

### Notes

- Every poller test goes through the fake `gh`; every reader test runs without it (FR-011, R9)
- `hand_to_gate` keeps its signature and brace shape; the drop's shape is unchanged (`test_poller_contract.py`)
- No backwards compatibility for the earlier review opener: its literal leaves the tests in T009 (R3)
- Commit after each phase; the "Run red" tasks' recorded reasons go in the commit message of the code that turns them green
