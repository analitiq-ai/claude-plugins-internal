# Quickstart: validating the agent-picked premise

Run from `dev/alq-plan/` unless noted.

## 1. ADRs first (PR 1)

`git diff --name-only origin/main...HEAD` lists only `docs/adr/0006-*.md` and `docs/adr/0008-*.md`.
`grep -n "user picks\|the user picked\|session that picked" docs/adr/0006-* docs/adr/0008-*` prints nothing.
Merged before PR 2 opens (US3).

## 2. Red tests before code (PR 2)

Each must fail on main for the stated reason, then pass:

| Test (`tests/`) | Fails on main because |
|---|---|
| `test_premise_report.py`: the form has no `Recommendation:` | the form prints it |
| `test_premise_report.py`: defect + `no spec needed` with both answers citing `a.py:12` from `code:` passes | refused as a defect |
| `test_premise_report.py`: same, an answer without `<path>:<line>`, or with a `user:` source, is one problem naming the question | the old refusal fires instead, naming the recommendation |
| `test_premise_report.py`: `Pick:` mismatch message says "resumed", not "user" | message says "the user picked" |
| `test_spec_source.py`: step 2 states the three outcomes in rule order, says the agent never asks the user to pick, and the session line precedes `premise_verdict=<pick>"` | step 2 asks the user to pick |
| `test_spec_source.py`: the closing rule names grill and critique, not a premise pick | it names a premise pick |
| `test_drive_workflow.py` `Premise`: a defect report located as R4 says, resumed with `no spec needed`, completes with the no-spec spec.md in the run's folder and no GitHub call | `premise-report` step fails |

Unedited, and must still pass with the `report()` helper changed (R3, R7): `test_no_spec.py`, `test_spec_folder.py`,
`test_rootcause.py`, and `test_drive_workflow.py` `NoSpecRescope`.

```sh
python3 -m unittest discover -s tests -v
```

Expected: all pass.

## 3. End to end (manual, in Claude Code)

1. `/alq-plan:issue-spec #<issue that fixes a typo>` → the run completes with no question to the user; the session
   names `no spec needed`, its reason, and `spec: null`; `specs/<issue>-<name>/spec.md` starts `# No spec needed`
   and nothing is posted on the issue.
2. `/alq-plan:issue-spec #<issue with decisions>` → one line naming `write the spec`, then grill starts; no pick
   was asked for.
3. `/alq-plan:issue-spec #<issue about removed code>` on a test repo → the issue is closed as not planned, its
   comment is the report's `Reason:`, and the session says so.
4. `/alq-plan:issue-spec rescope specs/<issue>-<name> #<issue>` on the folder from 1, with an open decision →
   the run pauses at premise and the agent picks again; no pick was asked for.

In each, `premise-report.md` has `Pick:` and no `Recommendation:`.
