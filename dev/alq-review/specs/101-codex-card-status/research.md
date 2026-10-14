# Research: the poller reads Codex's status card (#101)

Read for this: `plugins/alq-review/skills/alq-github-pr-review/{poll-pr-review.sh,deepsource-pr-gate.sh,SKILL.md}`,
`plugins/alq-review/scripts/{ledger,sweeper_read,specbinding}.py`, `plugins/alq-review/README.md`,
`dev/alq-review/tests/{test_poll_pr_review,test_poller_contract,test_deepsource_pr_gate,test_shipped_tree,paths,helpers}.py`,
`.github/workflows/tests.yml`, ADR-0003, ADR-0009 and the constitution, on `101-spec` at `735c172`. Nothing below
was run. Codex's bodies are in the spec folder's `samples/`, byte for byte (R8).

## R1: The Codex reader is one pure module the poller runs as a subprocess

- **Decision**: a new script `plugins/alq-review/scripts/codexstate.py`, standard library only. Its one pure
  function, `state(items, since, head) -> dict`, takes the snapshot's Codex items, the trigger time and the head
  SHA and returns Codex's state for the round. Its `main` reads one JSON object on stdin
  (`{"since", "head", "items"}`), prints the state as JSON and exits 0; it exits 2 with `codexstate: <why>` on
  stderr when the input is not that shape. The poller finds it as
  `$(dirname "${BASH_SOURCE[0]}")/../../scripts/codexstate.py`: the skill and the script ship in one plugin tree,
  so the relative path holds after an install. The poller runs it inside `if ! codex=$(...)`, prints
  `ERROR: the Codex reader failed` and exits 1 on any failure, so a reader crash can never surface as the
  poller's exit 2 (FINDINGS) through `set -e`. Shape and name are the spec's clarification: a script under
  `scripts/`, like the plugin's other modules; `codexstate` names what it returns.
- **Rationale**: constitution P3 puts the decision in a pure function of its inputs, testable without the fake
  `gh`; FR-011 says no other poller code reads a Codex item. A jq implementation would live inside the poller's
  600-line string and could not be unit-tested apart from it. `python3` is already a requirement wherever the
  plugin runs: every hook in `hooks/hooks.json` is `python3 scripts/…`.
- **Existing tools**: `deepsource-pr-gate.sh`, which reads a bot's edited-in-place summary comment in jq and
  fails loud on a format change; its approach is kept (read the row, fail on anything unexpected), its medium is
  not, because FR-011 asks for a module with unit tests. `test_shipped_tree` already checks that every `.py`
  under `plugins/alq-review` imports from a copy holding only this plugin, so the new script is covered by the
  existing guard with no change.

## R2: What the poller hands the reader, and the trigger defined once in jq

- **Decision**: a jq program `CODEX_ITEMS` reduces the raw GraphQL snapshot to the reader's input: `since` (the
  trigger time, as today: the given comment id, else the newest `@codex review` comment, else the PR's
  creation), `head` (`headRefOid`), and `items`: every PR comment by `chatgpt-codex-connector` and every PR
  review by it with a `submittedAt`, whatever their creation time, each as `{kind: "comment"|"review", url, at,
  body}`. The trigger is defined in one jq snippet, `TRIGGER_DEFS` (`bare` and `trigger($comments)`), prepended
  to both `CODEX_ITEMS` and `ANALYZE`. `snapshot()` becomes three steps on one `gh api graphql` result: extract,
  read (`python3 "$READER"`), analyse with `--argjson codex "$state"`.
- **Rationale**: the reader must see every Codex item, since the card is older than the trigger from the PR's
  second review on (Terms); the time filter for the other items is the reader's to apply. One snapshot still
  feeds everything, so the report stays one consistent picture. Defining the trigger once keeps the two programs
  from drifting (coding principles: define once).
- **Existing tools**: `ANALYZE`'s `$trigger`/`$since` lines 163–166, moved into the shared snippet unchanged.
  Having the reader find the trigger itself: looked at, rejected; the trigger is unchanged by the spec and the
  reader's input is "the Codex items, the trigger time and the head" (FR-011).

## R3: The acknowledgement list is four prefixes, matched after stripping leading whitespace

- **Decision**: `codexstate.py` holds one tuple of Codex's known forms, each a name and the text an item begins
  with, as the Terms record them on 2026-10-13:
  - `card`: first line is exactly `<!-- codex-pull-request-review-summary -->`;
  - `verdict`: begins `Codex Review: Didn't find any major issues.`;
  - `security`: begins `### 🛡️ Codex Security Review`;
  - `review`: a PR review whose body begins `### 💡 Codex Review`.
  A card is matched whatever its creation time. Every other item counts only if `at > since`. An item since the
  trigger that matches no form is unknown, and every such item is reported (R5). Nothing else
  is matched: the `**Reviewed commit:**` line, the flourish and the review's state are description, not test.
  The old review opener `Here are some automated review suggestions`, which the tests still use, is not on the
  list and leaves the tests (R8); no compatibility branch is kept for it. Leading whitespace is stripped
  before matching because the sampled review body starts with a newline (`samples/review-with-findings.md`).
- **Rationale**: FR-010: one list; anything off it settles the round while nothing answers and is a WARNING
  beside a row that does. Matching "by how it begins" is the spec's own rule and the least a form can change
  without the poller noticing.
- **Existing tools**: `ANALYZE`'s author filter (line 168), which classified by author and time alone; it is the
  defect and is replaced. `deepsource-pr-gate.sh`'s "anything else fails loud" vocabulary comment, followed.

## R4: Reading the card: the Code Review row's Status, datetime and Commit cells

- **Decision**: the reader takes the card's Markdown table rows (lines starting with `|`), splits each on `|`
  and strips the cells, and takes the row whose first cell contains `**Code Review**`. From its Status cell it
  reads `\*\*(Running|Completed)\*\*` and `datetime="([^"]+)"`; from its Commit cell the first `[0-9a-f]{7,40}`
  token. The `datetime` is parsed with `datetime.strptime` against `%Y-%m-%dT%H:%M:%S.%fZ`, then
  `%Y-%m-%dT%H:%M:%SZ` (the sampled value is `2026-10-13T13:54:16.973698Z`), and re-printed as
  `%Y-%m-%dT%H:%M:%SZ` in UTC, so jq's string comparison with the gate run's `startedAt` stays valid. Any of
  these makes the card unreadable, each with its own reason, the seven FR-007 lists: no Code Review row, more
  than one, a status that is neither Running nor Completed, no `datetime`, a `datetime` in neither format, no
  commit token, or more than one comment carrying the marker. Every other row is skipped unread (FR-008).
  `fromisoformat` is not used: it accepts a trailing `Z` only from Python 3.11, and the poller runs on whatever
  `python3` the machine has.
- **Rationale**: FR-007 and the Terms. Splitting cells before matching keeps a status word in another row or
  in the trigger cell from being read as the Code Review row's. Taking the first hex token tolerates the SHA
  being wrapped in a link or backticks, which the Terms do not pin.
- **Existing tools**: `deepsource-pr-gate.sh`'s row-count check ("rows read ≠ rows present → format changed"),
  the model for naming each reading failure.

## R5: Codex's state for the round, and the precedence among its parts

- **Decision**: `state()` returns one of six states, decided in this order:
  1. `unreadable`: a card the reader cannot read (R4), or more than one card. Carries `errors`, each
     `Codex status card <url> cannot be read: <why>; its format changed: report it on the plugin's repo and
     read the PR by hand`.
  2. From the Code Review row, when there is a card and its status time is after `since`: `reviewing` when the
     status is Running (any commit); `answered` when Completed and the commit is a prefix of `head`;
     `superseded` when Completed and it is not.
  3. `declined`: no such row, and an item since the trigger that is on no form (R3).
  4. `not_started`: no such row and no unknown item.
  What each state carries is the output table of [contracts/codex-reader.md](contracts/codex-reader.md).
- **Rationale**: the critique session's precedence decision (spec Key Entities, FR-010): the row is Codex's own
  account of the review, so an unknown item beside it is a warning, not a verdict; it decides the round only
  when nothing answers. Unreadable comes first because an unreadable card ends the run (exit 1) and no state
  should be reported from a card the poller could not read. A row whose status time is not after the trigger
  is a finished earlier round, so Codex has not started (US1 scenario 5, US2 scenario 2, the second-trigger
  edge case).
- **Existing tools**: `specbinding.text_step`, the plugin's precedent for a small pure state function with
  named outcomes; followed in shape.

## R6: What the poller does with each state

- **Decision**: `ANALYZE` carries `codex: $codex` into the state and drops `$codex_comments`, `$codex_reviews`,
  `$codex_said_at`, `$codex_answered_at` and `responded`. It gains `waived`: a `codex-review` run on the head
  from the App, state SUCCESS, whose title starts `WAIVED:` (FR-013). The consumers change as follows.
  - `WAITING_ON`: `not_started` → `Codex has not answered since <since>` unless `waived`; `reviewing` → `Codex is
    reviewing <commit> since <status_at>`, waived or not; the other states add no wait. The three other waits
    are unchanged.
  - `errors`: gains `$codex.errors`, so `unreadable` exits 1 at the top of the loop, as a CodeRabbit body the
    poller cannot parse does.
  - `clean`: requires `$codex.state == "answered"`, or `waived` with `not_started` or `declined`, in addition to
    today's merge-state rule; `superseded` can never print CLEAN or hand `clean` to the gate, and `declined`
    cannot without the waiver.
  - `REPORT` and the exit per state: the table "The poller, per state" in
    [contracts/codex-reader.md](contracts/codex-reader.md) (FR-004, FR-010, FR-014).
  - `settle()` keeps its order: findings first (exit 2, `hand_over findings`), then `clean` (exit 0), else
    BLOCKED (exit 4). Exit 4 can now come with GitHub reporting CLEAN, so `ANALYZE` lists each cause in
    `blocked_by` and the BLOCKED line prints them joined by `; `.
  - The first-poll "Watching … since" line and the `--ignore-check` announcement are unchanged.
- **Rationale**: FR-001 to FR-004, FR-007, FR-010, FR-013, FR-014. Reusing `settle`'s order keeps one meaning
  for exit 2; the SKILL's exit-4 row widens from "GitHub does not report CLEAN" to the causes `blocked_by` names. The waiver is read from the gate run the
  poller already prints, so no new field is fetched.
- **Existing tools**: `WAITING_ON`, `REPORT`, `settle`, `errors` as they stand; each gains a branch, none a new
  path. `hand_to_gate` is untouched: `test_poller_contract.py` evals it by `sed` range and the drop's shape is
  the ledger's input (`ledger.ingest_poll`).

## R7: The answer time, the gate lag, the 👍 note and the gate comments read the reader's output

- **Decision**: `gate_lags` uses `$codex.status_at` when `$codex.state == "answered"` as Codex's answer time,
  in place of the max over comments, reviews and body 👍s; the sweep dispatch follows it unchanged.
  `thumbs_on_trigger_only` becomes: a Codex 👍 on the trigger comment, none on the description, and
  `$codex.spoke` false. `gate_comments` is built from `$codex.comments`, with `gist` computed by `ANALYZE`'s
  existing `strip_markup | first_line | clip` and `approves` from the gate run as today; the card is never in
  it (FR-006), and an unknown comment is, so the drop's `gate_comments` carries it when the round exits 2.
  Reactions are fetched and read in jq as today: they are not items (Terms).
- **Rationale**: FR-001 (everything that reads the answer time reads the status time), FR-005 (the 👍 note
  stays, because the gate reads reactions on the description only), FR-006. The gist stays in jq because it is
  formatting the poller already applies to Codex thread bodies; moving it would be a second copy of
  `strip_markup`/`first_line`/`clip`. The reader decides, the poller prints.
- **Existing tools**: `gate_lags`, `thumbs_on_trigger_only`, `gate_comments` and the gist helpers, edited in
  place.

## R8: Fixtures are the spec folder's samples, copied byte for byte

- **Decision**: the first implementation task copies the ten files of `specs/101-codex-card-status/samples/`
  to `dev/alq-review/tests/fixtures/codex/` unchanged: the five card states sampled on probe PR #103
  (`card-one-row-running.md`, `card-one-row-completed.md` and the three two-row states), its verdict and
  security comments, PR #93's review with findings and not-connected decline, and claude-code-plugins#499's
  error decline. A `card(sample, commit=…, at=…)` test helper substitutes only the Commit cell's SHA and the
  Status cell's `datetime` where a scenario needs the head or a time relative to the fake trigger; the rest of
  every body is the sampled text. In `test_poll_pr_review.py`, the verdict comment fixture becomes the sampled
  verdict and the review fixture the sampled `### 💡 Codex Review` body; every test whose round Codex answers
  gets the Completed card for the head in its snapshot; `test_the_waiver_is_printed` keeps exit 0 (FR-013) and
  gains a sibling with the card's row Running, which waits.
- **Rationale**: FR-012 and SC-003: the Terms were typed from observation, so every form constant and every
  parse is graded against a body Codex wrote, not against the Terms.
- **Existing tools**: `tests/fixtures/deepsource-*.html`, the precedent for a bot's real comment as a fixture
  file; `test_poll_pr_review.py`'s inline trimmed bodies and `snapshot()` builder, extended with a card.

## R9: Tests: the reader's states without `gh`, the poller's exits through the fake `gh`

- **Decision**: `dev/alq-review/tests/test_codexstate.py` imports the module as `test_specbinding.py` does
  (`helpers` puts `scripts/` on `sys.path`) and covers: one test per form that its constant matches its sample
  byte for byte (card marker, verdict, security, review) and that the two sampled declines match none; every
  state of R5, the precedence between an unknown item and each row state; every reading failure of R4; the CLI's
  stdin/stdout round trip and its exit 2 on malformed input. `test_poll_pr_review.py` covers the spec's
  scenarios and edge cases through the fake `gh`: US1 1–6, US2 1–2, US3 1–2, US4 1, US5 1–6 and the eight edge
  cases, the second-trigger case and the card-less review included, plus the `Codex: …` report line. Each test
  is written and run red before its code (FR-012); the reader's tests fail on `ModuleNotFoundError`, the
  poller's on today's exit code or missing line. CI needs no change: `tests.yml` already runs every
  `dev/**/tests` folder.
- **Rationale**: constitution IV; SC-003 names both suites.
- **Existing tools**: the `Poller` harness, its fake `gh` and `snapshot()` builder, reused; `helpers.py`'s
  `sys.path` line, reused.

## R10: The prose that states the rule changes with the code

- **Decision**: the poller's header (lines 11–21) states the card rule: Codex has answered when the card's Code
  Review row says Completed for the head since the trigger, at the row's status time; a Running row is waited
  on; a row for another commit is reported with the re-request; any Codex item off the acknowledgement list
  settles the round. `SKILL.md`'s *Waiting for the response* paragraph says the same in one sentence and points
  the reader to `codexstate.py` for the list; its 👍 paragraph keeps the gate's rule and drops "Codex's only
  answer is a 👍". The README's Layout table gains a `scripts/codexstate.py` row. No rule file under
  `.claude/rules` changes.
- **Rationale**: FR-009. The README and SKILL describe the plugin and change with it (plan 019, R17); no
  governing rule file is touched, so constitution VI needs no split.
- **Existing tools**: the three files, edited in place.
