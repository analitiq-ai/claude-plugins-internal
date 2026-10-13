# Implementation Plan: The poller reads Codex's status card to know when its review of the head has ended

**Branch**: `101-spec` (#101) | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/101-codex-card-status/spec.md`

## Summary

The poller stops counting any Codex comment, review or 👍 since the trigger as Codex's answer. A new pure module,
`plugins/alq-review/scripts/codexstate.py`, is handed every Codex comment and PR review from the snapshot, the
trigger time and the head, and returns Codex's state for the round: `not_started`, `reviewing`, `answered`,
`superseded`, `declined` or `unreadable`. It reads the status card's Code Review row (status, status time,
commit) and matches every other item against one list of Codex's known forms. The poller's jq analysis consumes
that state: it waits on `not_started` and `reviewing`, takes the row's status time as the answer time for the gate
lag, refuses CLEAN on `superseded` and `declined` and prints the re-request or the unknown item, releases
`not_started` and `declined` when the org gate has waived Codex for the head (FR-013), prints an unknown item
beside a row that answers as a WARNING (FR-010) and one `Codex: …` line per report (FR-014), and exits 1 on
`unreadable`. Decisions are in [research.md](research.md), shapes in [data-model.md](data-model.md), the reader's
input, output and the poller's lines per state in [contracts/codex-reader.md](contracts/codex-reader.md).

## Technical Context

**Language/Version**: Bash + jq for the poller, as today; Python 3 (CI runs 3.13), standard library only, for the
reader, as the rest of `scripts/`

**Primary Dependencies**: `gh`, `jq`, `python3`. Nothing new: every hook already runs `python3 scripts/…`

**Storage**: none. The inbox drop keeps its shape; `gate_comments` no longer carries the card (R7)

**Testing**: `python -m unittest -v` in `dev/alq-review/tests/`: `test_codexstate.py` (new, no fake `gh`) and
`test_poll_pr_review.py` (the fake `gh` harness), each test red before its code (constitution IV, FR-012)

**Target Platform**: wherever the plugin's skill runs the poller: a machine with `gh` authenticated, `jq` and
`python3`

**Project Type**: Claude Code plugin: one shell skill script and one Python module

**Performance Goals**: one extra `jq` pass and one `python3` start per poll, on the snapshot already fetched; no
extra GitHub call

**Constraints**: the reader imports only the standard library (`test_shipped_tree`); `hand_to_gate` keeps its
signature and brace shape, since `test_poller_contract.py` extracts it by `sed` range; the poller's exit codes
and their meanings are unchanged; no backwards compatibility for Codex's earlier review opener (R3)

**Scale/Scope**: one new script (~120 lines), one new test file, edits to `poll-pr-review.sh` (`snapshot()`,
`ANALYZE`, `WAITING_ON`, `REPORT`, header), `test_poll_pr_review.py` (fixtures and scenarios), `SKILL.md`,
`README.md`; ten fixture files copied from the spec folder's `samples/`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | The reader's JSON is an interface between two files of one plugin, defined once in `codexstate.py` and read by one jq program; it is no contracts-map shape. The acknowledgement list is the one source for what Codex posts (FR-010); nothing else re-declares it. Pass. |
| II. Ownership & trust boundaries | All in this repo. The card is outside input and is validated where it enters, in the reader (R4); a card it cannot read is an error, never a guess. No secret, no infrastructure detail. Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | The cause is fixed: classification by author and time is replaced by reading the item (R3, R5). An unreadable card exits 1; an unknown item settles the round; the earlier review opener is dropped from the tests, not kept as a branch. Pass. |
| IV. Test-first | Every state and reading failure has a reader unit test, every scenario a poller test, each run red first (R9). The reader is a pure function; the poller's jq is exercised through the fake `gh`. Pass. |
| V. Smallest complete change | One module, one list, the existing waits and report extended. The class of defect, "a Codex item counted by author and time alone", is closed for comments and reviews together (R3); reactions are not items and the gate reads them, so they stay as the spec says (FR-005). `$codex_said_at`, `$codex_answered_at` and `responded` are removed, not left beside the reader's output. Pass. |
| VI. Governing rule ships apart | No rule file, lint or schema check changes. `SKILL.md` and the README describe the poller and change with it (R10). Pass. |
| P1. Code decides | The reader and the poller decide; every settled-not-clean line names the next step (`comment @codex review`; read the unknown item). Pass. |
| P2. Only an approved entity releases a hold | No hold, lock or count is added or changed: the poller waits and settles, it holds nothing in the ledger. Not applicable. |
| P3. Rules are pure | `codexstate.state(items, since, head)` is pure; `main` is stdin/stdout; the poller's shell does the fetching and printing. Pass. |
| P4. A check that could not run is its own outcome | An unreadable card is an error naming the comment (exit 1); an unknown item is `declined`, never an answer; a reader crash is `ERROR`, never FINDINGS (R1). Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/101-codex-card-status/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/codex-reader.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
plugins/alq-review/
├── scripts/codexstate.py                             # new: FORMS, read_card, state, main
├── skills/alq-github-pr-review/poll-pr-review.sh     # header; TRIGGER_DEFS, CODEX_ITEMS; snapshot() runs the reader;
│                                                     # ANALYZE, WAITING_ON, REPORT consume $codex
├── skills/alq-github-pr-review/SKILL.md              # the card rule; no "only answer is a 👍"
└── README.md                                         # Layout: scripts/codexstate.py
dev/alq-review/tests/
├── test_codexstate.py                                # new: every state, every unreadable reason, the CLI
├── test_poll_pr_review.py                            # card fixtures; the spec's scenarios and edge cases
└── fixtures/codex-card/{completed-one-row,completed-two-rows}.md   # trimmed copies of the sampled cards
```

**Structure Decision**: the repo's `plugins/<name>/` + `dev/<name>/tests/` layout, as every other module. Callers
of what changes, read in the code: `poll-pr-review.sh` is run by the agent through `SKILL.md` *Waiting for the
response* and the `pr-review-loop` rule that routes to it; its drop is read by `ledger.ingest_inbox` from
`gate.py:698` and pinned by `test_poller_contract.py`; its behaviour is tested by `test_poll_pr_review.py`.
`ANALYZE`'s `$codex_comments`, `$codex_reviews`, `$codex_said_at` and `$codex_answered_at` are read only by
`responded`, `thumbs_on_trigger_only`, `gate_lags` and `gate_comments` in the same program; `responded` only by
`WAITING_ON`. The new script has one caller, `snapshot()`, and one guard, `test_shipped_tree`.

## Complexity Tracking

None.

## Open points

None. The critique session (2026-10-13) settled the four the plan had raised: the waiver releases `not_started`
and `declined` (FR-013); a `declined` round settles through `settle`'s order, exit 2 with open findings, else 4
(FR-010); Codex's bodies are in the spec folder's `samples/` (R8); the seven reading failures are FR-007's.

## Mechanisms

- The Codex reader as one pure module, run by the poller as a subprocess: R1
- The reader's input extracted in jq, with the trigger defined once for both programs: R2
- The acknowledgement list of four prefixes, the card matched any time, the rest since the trigger: R3
- Reading the Code Review row's status, status time and commit, each failure named: R4
- The six states and their precedence: R5
- The poller's waits, `clean`, report lines and exit codes per state: R6
- The answer time, the gate lag, the 👍 note and `gate_comments` from the reader's output: R7
- Card fixtures as trimmed copies of the sampled cards, fetched first: R8
- Reader unit tests without `gh`, poller scenario tests through the fake `gh`, red first: R9
- The poller header, `SKILL.md` and the README stating the card rule: R10
