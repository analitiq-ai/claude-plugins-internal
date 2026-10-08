# Implementation Plan: Merge override grants in the state folder

**Branch**: `bugfix/36-merge-grants-state-folder` (#36) | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/017-merge-grants-state-folder/spec.md`

## Summary

A session's merge override grants move from a folder of their own into the state folder, as the session record
`sessions/<session id>.merge.json`, kept through the one session-state helper. That puts them under the write
guard and under the setting that moves the state folder, with no new rule. The merge gate's own copy of the
helper and of the session-id rule are deleted.

Five things change in what is typed and answered. The first four are by the user's answers to the
[first](critiques/critique-20261007-merge-grants.md) and
[second](critiques/critique-20261007-merge-grants-2.md) critique; the fifth is from review of the PR and an
audit of the branch (2026-10-08):

- An override names its PR, `override-merge owner/repo#N`, and a grant lets through that PR only.
  `override-merge #N` grants nothing and is answered with what to type.
- A grant is asked for last, only by a merge the gate is about to refuse. A merge that meets its requirements
  neither spends a grant nor opens the record.
- A recorded override is shown to the user in one line.
- An override that cannot be recorded, and grants that cannot be used by a merge that needs one, are answered
  with the reason and, where the gate knows one, the step. A refusal that offers an override gives the line in
  full, or says why none applies.
- Every command the user types to the plugin is read one way, by one reader: a prompt's first words, parted
  by a space, a tab or a line break, each read whole, and a PR's name read whole wherever it is typed. The
  override's keyword is always answered.

Four scripts change, with their tests and the README: `pre_merge_gate.py`, and `gate.py`, `claimgate.py` and
`shimgate.py` where they read what the user types. `hookio.py` and `hooks.json` are not edited.

The change was run on a scratch copy of the plugin three times: as first planned, after the first critique,
and after the second. Every "Measured" line in [research.md](research.md) says which. The first run found a
class of cases where FR-011's words cannot be given (R5, issue #49); FR-011 and the spec's Edge Cases are
worded to match. The third run was the author's alone; no reviewer has run it. Since the PR opened the tests
are in the repo, and what they showed is in R7.

Decisions are in [research.md](research.md), the record and the PR name in [data-model.md](data-model.md), the
answers, the table of which commands ask for a grant and the test list in
[contracts/merge-override.md](contracts/merge-override.md).

## Technical Context

**Language/Version**: Python 3, standard library only, as the rest of `scripts/`

**Primary Dependencies**: none new. The Claude Code hook protocol: `UserPromptSubmit` and `PreToolUse` on
`Bash`, as `pre_merge_gate.py` is registered today

**Storage**: `sessions/<session id>.merge.json` and its `.lock` under the plugin's state root; a failure is one
line in `errors.log`. `ledger.db` and `gate.log` are not touched

**Testing**: `python3 -m unittest discover -s tests` in `dev/alq-review/`. The tests run
`scripts/pre_merge_gate.py` and `scripts/gate.py` as programs with hook payloads and a stub `gh`. The
contract's last table is the test list, in three kinds.

- A **new** row is written first and seen to fail on main. The typed form changes, so most new rows fail on
  main only because main does not take it. For those the table names a wrong version of the new code, and the
  row is seen to fail on that too.
- A **guard** row pins behaviour that does not change, so it passes on main. It is first seen to fail on the
  wrong version the table names.
- A **kept** row is an existing test of the override. It changes in what it types, in its stand-in PR's
  address and in where it keeps state. One that shows a refusal also shows the same override letting its own
  merge through.

Where a red run on a wrong version is shown: the commit that adds the test names the wrong version in one
line and carries the failing output. The wrong versions themselves are not committed.

What was run, on which script, and what it showed is in R7, and nowhere else in this folder

**Target Platform**: any machine running Claude Code with the plugin enabled

**Project Type**: Claude Code plugin (hooks, workflows, agents)

**Performance Goals**: a typed override takes one lock, one small read and one small write, as today. A merge
that needs an override takes the same; a merge that needs none takes none, where today every merge writes the
record. An unattested merge without `--admin` asks GitHub about a version-only release before the grant is
read, which a granted one did not do before (R5; the hook's time limit is issue #52). A prompt that is not an
override loads nothing it does not load today

**Constraints**: no migration and no reading of the old folder (issue #36). The old typed form is not
accepted. The write guard is used as it is (FR-003). PR #31 adds a merge-gate row and a note to the README's
State section: whichever of the two PRs lands second removes them, and a test fails if it does not (R7). The
PR's body tells users what the README cannot, since the old folder's name leaves the plugin: an unspent
override is lost on upgrade, the override is now typed with the repo, and the old folder can be deleted by
hand

**Scale/Scope**: one record per session that types an override or runs a merge that needs one.
`pre_merge_gate.py`, `gate.py`, `claimgate.py`, `shimgate.py`, their four test files, `test_switch.py` and the
README change

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | No shape from the contracts map is added. The grant record's form is defined once, in `pre_merge_gate.py`, its only reader and writer (R2). The PR's name has one reader, for what is typed, for what GitHub answers and for what the record holds, and is GitHub's own form (R8). A typed command's words have one reader, for every command of the plugin (R9). Pass. |
| II. Ownership & trust boundaries | All in alq-review, this repo. The session id is checked where the path is built, by the one rule left (R3). The record is checked each time it is read, and what a foreign record holds is not passed on to the user or the agent (R2). The repo a grant is compared with comes from GitHub's answer, not from the command (R8). Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | The cause is fixed: the grants move, and nothing is guarded twice. No migration, no reading of the old folder (R1). The old typed form grants nothing; it is matched only to tell the user what to type (R8). Failures are answered and logged, not swallowed (R4, R5). One guard lets any failure pass: the one round the step that writes a failure to `errors.log`, and what passes there is the failure to log, with the first failure already in the answer (R4). The cases where the layer cannot give FR-011's words are named with the real fix, issue #49 (R5). Pass. |
| IV. Test-first | A new row starts as a test that fails on main. A guard row cannot fail on main; it starts by failing on the wrong version the contract names, and so does a new row that main fails only for not taking the new form. The commit carries that red run (Technical Context, R7). Pass. |
| V. Smallest complete change | Four scripts where they read what the user types, their tests, the README. The script's copy of the helper and of the session-id rule go, and so do six patterns that each read a typed command their own way (R9). Two smaller copies stay, for one reason: this script must answer when the plugin's other scripts cannot load, so it keeps its own `deny` and builds its own answer to a prompt (R4). The reader of typed commands is kept in this script for the same reason, and `gate.py` loads it from here (R9). No migration, no `gate.log` line for an override (issue #51), no new module, no way to withdraw a grant. Pass. |
| VI. Governing rule ships apart | No rule file, lint or schema check changes, and the write guard is used as it is (R6). `gate.py` changes only in how it reads what the user types (R9); what it refuses, and when, does not. Decision record 0002 is updated in PR #31, not here. The README describes the plugin and changes with it. The test that reads the plugin's files is a test of this change, written red first, as `Marker` is (R7). Pass. |
| P1. Code decides | The grant is read by the hook. A refusal says what the merge lacks. Where it offers an override it gives the line in full, and the line works as given; where no override applies it says why (R8). A damaged record's answer names it and the repair (R2). An id that is not a plain name is told no override can be kept in that session and what can be done (R3). One kind of answer names no step: an override that could not be recorded because of the folder or the plugin's own scripts carries the system's error and the path, since the gate knows no step there (contract). Pass, with that stated. |
| P2. Only an approved entity releases a hold | The hold is the merge gate's. The approver is the user; the action is `override-merge owner/repo#N` at the start of a prompt, and it releases that PR only. This plan removes two other ways out: an agent's file edit to the grant, with the plugin on and enforcing, and a grant being spent on another repo's PR of the same number. Three it does not add remain; see Complexity Tracking. Justified deviation. |
| P3. Rules are pure | The record's check, the reader of a PR's name and the reader of a prompt's words are pure functions, and the two changes to the grants are pure functions of the names held. Locking, reading and writing stay in the helper. `unmet` is not pure: it holds today's checks in today's order, and one of them asks GitHub about a release, as `gated` does today (R5). Pass. |
| P4. A check that could not run is its own outcome | Grants that cannot be used are their own outcome: said beside the refusal, logged, the record left as found, and never a grant. A merge that needs no grant does not run the check (R5). A PR that cannot be named is told so, not treated as holding no grant (R8). Pass. |
| P5. Settled design | Every mechanism below cites a decision with its existing tools. Nothing is left to measure for this feature; what nobody ran is listed in R4 and R7, and the hook's time limit is issue #52. Pass. |

Re-check after Phase 1, after the first critique, and after the second: P1, P2, P3 and III were reworded to say
what is true; no row changed its answer. After review round 3 and the audit: I, V, VI and P3, the same.

## Project Structure

### Documentation (this feature)

```text
specs/017-merge-grants-state-folder/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/merge-override.md
├── checklists/requirements.md
├── critiques/critique-20261007-merge-grants.md
├── critiques/critique-20261007-merge-grants-2.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
plugins/alq-review/
├── scripts/pre_merge_gate.py     # grants through hookio.session_state, by PR name, asked for last; the answers; the reader of typed words and of a PR's name
├── scripts/gate.py               # unlock, the rescope and the switch read with that reader
├── scripts/claimgate.py          # `unlock claim-<id>` takes the typed word
├── scripts/shimgate.py           # `override shim-<id>` takes the typed word
└── README.md                     # State lists the record; the Layout row gives the override as typed; how a typed command is read

dev/alq-review/tests/
├── test_pre_merge_gate.py        # state under ALQ_REVIEW_STATE_DIR; the contract's rows N1 to N45, G1 to G7, K1 to K3
├── test_gate.py                  # N46 to N50, G8, G10, G11
├── test_switch.py                # N51 to N53, G9
├── test_claim_gate.py            # N54
└── test_shim_gate.py             # N55, N56
```

**Structure Decision**: the plugin's existing layout, one PR.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| P2: after this feature a grant can still be made without the user in three ways. An agent's file edit in `log` mode or in a session that is off (issue #38). A shell command that writes the state folder (016 R8, issue #50; run on the first scratch copy, R6). And, not measured, a keyword in text an agent chose that arrives as a prompt: a scheduled wake-up, a cron prompt, a message from another session (016 R3) | The first two are how the write guard treats every record in the state folder. The third is how every keyword of the plugin is read, `unlock` and the switch included | Closing them here changes what `log` and off mean for every record, or needs state an agent cannot write, or a way to tell the user's prompt from one an agent sent; each is a feature of its own. Leaving the grants where they are keeps a fourth way out, which is what this feature ends |
| P2: a grant the user typed and no merge needed stays until a merge of its own PR needs it, and cannot be withdrawn | The user chose "asked for only when needed" on 2026-10-07 and kept it after the second critique stated this cost. Naming the PR bounds it to the PR the user allowed | Ending a grant at the next prompt, or on any merge of that PR as main does: the first is a new rule with its own surprises, the second spends an override on a merge that did not need it |

## Mechanisms

- A session's grants are a session record of their own kind, kept through the one session-state helper, and the old folder is gone: R1
- The record's form, checked by the merge gate each time it is read, with a damaged record's error naming the record and the repair and repeating nothing it holds: R2
- One rule for a session id, the helper's, with an id that is not a plain name counting as grants that cannot be reached and told what can be done: R3
- A typed override is answered to the user and the agent in one line, recorded or not, and a failure is logged inside a guard that cannot itself stop the answer: R4
- A grant is asked for last, only by a merge the gate is about to refuse; grants that cannot be used are said beside that refusal, and no other command opens the record: R5
- The write guard covers the record by where it is, unchanged: R6
- The merge gate's tests keep state under `ALQ_REVIEW_STATE_DIR`, beside a second folder that must not come to exist; one test reads the plugin for the old folder's name, a second copy of the helper in this script and the README's two lines: R7
- An override and a grant name the PR as `owner/repo#N`, read by one reader of whole texts from what is typed, from GitHub's answer and from the record; a refusal gives that line in full or says why none applies: R8
- Every command the user types is a prompt's first words, read whole by one reader that `gate.py` loads from the merge gate's script: R9
