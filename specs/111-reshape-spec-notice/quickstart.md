# Quickstart: validating the RESHAPE_SPEC notice

## Prerequisites

- The worktree on branch `111-spec`; `python3`, `node` 22+ (for `tests/workflow_harness.mjs`), `jq`.
- No network is needed: `tests/test_gate.py` puts a stub `gh` on `PATH` that appends each call to `$GH_LOG`.

## Run

```bash
cd reviewer/tests && python3 -m unittest
```

## Scenarios the tests must cover (each written red first)

| # | Scenario | Expected | Spec |
|---|---|---|---|
| 1 | Direct assess-round launch on a PR bound to `specs/123-login` | injected args carry `spec_folder: "specs/123-login"` | FR-001 |
| 2a | review-round launch, same PR | the harness's recorded `calls` show `spec_folder: "specs/123-login"` forwarded to `alq-review:assess-round` (the harness returns canned answers for nested workflows; it does not run them) | FR-001 |
| 2b | assess-round run directly with `spec_folder: "specs/123-login"` in args and a `RESHAPE_SPEC` assessment | the result's `spec_folder` is `specs/123-login`, and `assessment` holds both `spec_gap` findings | FR-001/002, SC-001 |
| 3 | `RESHAPE_SPEC` assessment recorded (PostToolUse) | `$GH_LOG` holds exactly `issue comment 123 --repo acme/demo …` then `issue edit 123 --repo acme/demo --add-label reshape_spec --add-assignee <escalate_to>` | FR-004/006/007/009 |
| 4 | Same PostToolUse payload delivered again | the second delivery makes no gh call | SC-003 |
| 5 | Later round on the same PR ruled `RESHAPE_SPEC` again | a second comment and edit for that round | US2-4 |
| 6 | Verdict `PATCH` / `ESCALATE`; spec-held launch | no gh call | US1-3, Edge |
| 7 | PR bound to `spec: null` | no gh call; unlock reply is today's close-and-restart text | FR-012 |
| 8 | Folder `specs/020-decision-review` | no gh call; lock refusal names the folder as giving no issue | Edge, FR-005 |
| 9 | Stub gh fails `issue edit` with `could not add label: 'reshape_spec' not found` | the comment is still made; lock refusal and `unlock #7` reply both quote the error; a later event makes no gh call | US3-1/2/3, FR-006 |
| 10 | Both calls succeed | lock refusal and unlock reply carry no notice sentence | US3-4 |
| 11 | Any notice failure | `policy.mutation` still refuses; only `unlock` releases | FR-011 |
| 12 | `unlock #7` after a ruling | the unlock reply's summary equals `reshape.summary(...)`, which is the comment's text | FR-003, SC-005 |
| 13 | `escalate_to` missing or blank in config | `hookio.escalate_to()` raises; the edit's stored outcome is the config error; the comment is still made | FR-007 |
| 14 | `ALQ_REVIEW_MODE=log` | notice still posted | Edge |
| 15 | Comment body for a ruling | contains no checkout root, round ref or session id | FR-013 |
| 16 | `reshape.issue_of`: `specs/123-x` → 123, `dev/a/specs/111-x` → 111, `specs/020-x`, `specs/x`, `specs/0-x` → None | | FR-005 |
| 17 | Notice claimed, outcome left `null` (hook killed before `record_notice`) | lock refusal and `unlock #7` reply both say GitHub's answer was not recorded for issue #123 and to check it by hand | P4, plan Performance Goals |

## Before shipping (by hand)

```bash
gh label create reshape_spec --repo analitiq-ai/claude-plugins-internal --description "A review ruled the spec must be reshaped"
```
