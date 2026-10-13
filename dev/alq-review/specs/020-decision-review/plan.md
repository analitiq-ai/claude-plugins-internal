# Implementation Plan: The internal review round checks the diff against the decisions that govern it

**Branch**: `88-us1-decision-review` (#88) | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/020-decision-review/spec.md`

## Summary

At an internal round's launch the gate lists the files of the round's own diff range and asks adrkit, once per
corpus (`adr lint` and `adr check`, each tracked `docs/adr` and the org corpus at `ALQ_ORG_ADR_DIR`), which governing
records cover them. A new boundary module `adrkit.py` runs the CLI under the hook's deadline and refuses any answer it
cannot read; a new pure module `decisions.py` sorts adrkit's findings into refuse, notice and ignore by the spec's
table. When records govern the change, `alq-review:decision-reviewer` joins the round's expected reviewers with those
records as its brief, and its findings reach `assess-round` like any other. The round's result carries a `decisions`
block: corpora checked, records governing, notices, and whether the org corpus was unset. An internal round of more than
`max_review_files` files (50) is refused before any `adr` call; the check has its own `decision_checks` setting, and
each assessed round's rulings on the decision reviewer's findings go to `gate.log`. The user's notice choice lands
first as ADR-0019 in its own PR, with the constitution's line on per-check settings. Decisions are in [research.md](research.md), shapes in
[data-model.md](data-model.md), the adrkit fields read, the refusal table, the injected arguments and the scenario
coverage in [contracts/interfaces.md](contracts/interfaces.md).

## Technical Context

**Language/Version**: Python 3 (CI runs 3.13), standard library only, as the rest of `scripts/`; the agent is Markdown;
the workflow is JavaScript

**Primary Dependencies**: git, as today; adrkit's CLI `adr` (`@adrkit/cli` 0.20.0, node ≥ 22) on `PATH` of the
machine that launches rounds, new, required only when a corpus is to be checked (R11)

**Storage**: none new. The round's `expected` list in the PR's ledger doc names the decision reviewer when it joins;
the check's result is reported in the workflow's return and kept nowhere (R9)

**Testing**: `python -m unittest -v` in `dev/alq-review/tests/`; pure rules without node, the boundary against the
real `adr` (skipped locally without it, installed in CI), launches through the hook driver (R14)

**Target Platform**: any machine running Claude Code with alq-review installed; `ALQ_ORG_ADR_DIR` is per machine

**Project Type**: Claude Code plugin (hook, workflow, agent)

**Performance Goals**: two `adr` calls per corpus at each internal launch, all started at once, within one 55 s
deadline shared with the 30 s review-base fetch and the `gh` calls (R4, R7). How long a call takes was not measured;
the deadline bounds it, and a deadline refusal names what each step spent

**Constraints**: no path list anywhere (R2); one validator per document (adrkit's), the gate re-declares only the
status and rule names it must sort by, pinned by a drift test (R6); every refusal names a fix that can succeed for the
corpus it names (R10); no fallback when `adr` or its answer is missing (R5, R11)

**Scale/Scope**: this repo has three corpora (17 + 6 + 2 records) with overlapping ids; a round reviews at most
`max_review_files` (50) files (R16), well under adrkit's fixed marker-scan cap of 3000; adrkit's 64 markers per file
is a refusal, not a limit the plugin works around

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | The shapes are adrkit's `lint --json` and `check --json`; the gate is an adapter that reads five fields and refuses the rest (R5). No second validator: adrkit alone judges a record. The five non-governing statuses and seven rule names are a copy of adrkit's vocabulary, justified in Complexity Tracking and pinned by a drift test (R6). Pass with that entry. |
| II. Ownership & trust boundaries | All in this repo. `ALQ_ORG_ADR_DIR` and adrkit's output are validated where they enter (`adrkit.py`). The org's records are read, never written. Nothing public. Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | A missing `adr`, a bad org path, an unreadable answer, a capped scan or a deadline each refuse with the step named; nothing degrades to "no decisions". The install step pins one version; no tolerance for another shape. Pass. |
| IV. Test-first | Each scenario of the spec is a test written to fail first (contracts, Scenario coverage). `decisions.judge` is pure; `adrkit.py` is tested with a stand-in script and with the real CLI. Pass. |
| V. Smallest complete change | No cache, no planning-time check, no audit check, no ledger field. `changed_files` is generalised, not duplicated. The whole mechanism ships in one PR because a check that cannot refuse would pass silently (spec, one story). Pass. |
| VI. Governing rule ships apart | ADR-0019 and the constitution's Platform Constraints line naming `decision_checks` are their own PR, merged first (R13). The README changes with the code it describes, as in spec 019. Pass. |
| P1. Code decides | The check, the reviewer's seat in `expected`, every refusal and the notices are decided in the gate; the agent is told nothing it could skip. Each refusal ends with its next step (R10). Pass. |
| P2. Only an approved entity releases a hold | No hold, lock or count is added. A refused launch holds nothing: the next launch checks again. The user releases the check by setting `decision_checks` to `log` (R15, ADR-0011). Pass. |
| P3. Rules are pure | `decisions.judge` and `decisions.governance` are functions of the reports; `adrkit.py` and the gate do the I/O; `review-round.js` only echoes `decisions` (R6, R9). Pass. |
| P4. A check that could not run is its own outcome | A call that fails, hangs, or answers in another shape, a capped scan, an unreadable changed file: refused in both plugin modes as a failed check (named in `not_checked` when the user sets `decision_checks` to `log`, R15), never a pass or a finding against the author (R5, R7, R10). A matcher adrkit cannot evaluate here is a named notice, not silence (R6). Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/020-decision-review/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/interfaces.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

ADR first, its own PR (branch `88-adr-notice`):

```text
dev/alq-review/docs/adr/0019-run-the-round-with-a-notice-for-a-matcher-adrkit-cannot-evaluate-here.md
dev/alq-review/.specify/memory/constitution.md   # Platform Constraints: decision_checks beside claim and shim
```

Then the code (branch `88-us1-decision-review`):

```text
plugins/alq-review/
├── scripts/
│   ├── adrkit.py              # new: finds adr, checks ALQ_ORG_ADR_DIR, runs lint + check per corpus under the deadline,
│   │                          #      reads the fields of R5, reads statuses and lstat, locates record files; Unavailable
│   ├── decisions.py           # new: Corpus, Finding, CorpusReport, Judgement, Governance; corpora(), judge(), governance()
│   ├── gate.py                # main takes the deadline; handle/on_workflow carry it; step timings; the file limit;
│   │                          #      _governance(); the refusals; on_agent covers the decision reviewer; the
│   │                          #      decision-review gate.log line on assessment; HOOK_SECONDS, ANSWER_MARGIN
│   ├── hookio.py              # decision_checks_mode(); max_review_files()
│   ├── briefs.py              # DECISION_REVIEWER; REVIEWERS includes it; review_range(); _scope(); _decision_prompt();
│   │                          #      waves(); review_args takes governance and injects args.decisions
│   └── worktree.py            # files_in(root, rev_range) replaces changed_files; tracked(root, pathspec)
├── workflows/review-round.js  # returns decisions: args.decisions on every path
├── agents/decision-reviewer.md
├── .claude-plugin/plugin.json # 0.14.0
├── config.json                # "decision_checks": "enforce", "max_review_files": 50
├── hooks/hooks.json           # unchanged; its 60 s timeout is pinned by a test
└── README.md                  # item 8, Layout rows, Dependencies
dev/alq-review/tests/
├── test_decisions.py          # new: pure cases, real-CLI contract cases, rule and status drift test
├── test_adrkit.py             # new: stand-in adr: shapes, exit codes, deadline, symlink vs regular file
├── test_gate.py               # DecisionReview, HookDeadline
├── test_agents.py             # DecisionReviewer tools
├── test_worktree_facts.py     # files_in, tracked; review_args signature
└── paths.py                   # HARNESS
.github/workflows/tests.yml    # setup-node 22; npm install -g @adrkit/cli@0.20.0
```

**Structure Decision**: the plugin's existing split: one boundary module per outside service (`github.py`,
`worktree.py`, now `adrkit.py`), pure rules beside them (`policy.py`, `specbinding.py`, now `decisions.py`), the gate
as the only handler, the workflow as orchestration. Callers of what changes, read in the code: `worktree.changed_files`
is called by `briefs._audit_prompt` and tests `test_worktree_facts` (lines 403, 456); `briefs.review_args` by
`gate.on_workflow` and `test_worktree_facts.RoundFacts`; `briefs.REVIEWERS` by `gate.track_subagent`;
`briefs.INTERNAL_REVIEWERS` by `gate.on_agent`, `gate.on_workflow`, `test_gate`, `test_switch`; `gate.handle` by
`gate.main` and the hook driver in `test_gate` (through `main`); `review-round.js`'s returns by the launching agent
and `test_gate` through `workflow_harness.mjs`; `hooks.json`'s timeout by Claude Code.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `decisions.py` re-declares adrkit's five non-governing statuses and the seven rule names it sorts by (constitution I: no re-declared type-name list) | A `check --json` finding names a record by path and id but not its status, and adrkit's JSON gives no status for a record it could not load; the spec's rule turns on both the status and the rule name | Asking adrkit per record (`explain`) gives no status either and costs a call per finding against a 55 s deadline; parsing adrkit's YAML schema in full is a second validator. The copy is pinned to the installed package by a drift test (R6, R14) |

## Open points

Settled by reading, not by the user: the deadline margin is 5 s (R7); `adr` is required only when a corpus is to be
checked (R11); an org path that coincides with a repo corpus is checked once as the org corpus, as the spec's edge case
says, which reverses PR #92's choice (R3). The corpus is read from the checkout, which equals HEAD for tracked files
because a dirty tracked tree is refused before the check; an untracked file inside a corpus is read as adrkit reads it.

## Mechanisms

- The check at an internal round's launch, between `launch_round` and `open_round`; audits and assessments skip it: R1
- The files from the reviewers' own diff range, deleted and non-regular files included: R2
- Every tracked `docs/adr` and the org corpus, each checked once and labelled: R3
- `adr lint` and `adr check` per corpus, all started at once, with the checkout as working directory: R4
- The `adrkit.py` boundary: the fields read, the install step, `Unavailable`: R5
- The pure classification in `decisions.py`: governing status, broken, failed, notice, ignored: R6
- One absolute deadline per hook run, 55 s after the payload, pinned to `hooks.json`: R7
- The decision reviewer agent, its brief, its seat in `expected`: R8
- The `decisions` block in the injected args and the round's result: R9
- The two refusals, their mode and their fix texts: R10
- `adr` required only when a call would be made: R11
- README item 8, Layout, Dependencies, version 0.14.0, CI's node and adrkit install: R12
- ADR-0019 for the notice choice, its own PR first: R13
- The test suites and the scenario coverage: R14
- `decision_checks`, the check's own setting: R15
- `max_review_files`, refused before any `adr` call: R16
- The decision reviewer's rulings in `gate.log`: R17
