# Research: a cause fix with no site left is complete

## R1: With no SAME OPERATION site left, the verdict does not read `coverage`

- **Decision**: `verdict(kind, level, coverage, *, sites_left)` returns `complete` for a fix iff
  `level == cause` and, when a site is left, `coverage in (all, none_other)`. `_judge` passes
  `sites_left=bool(same_operation)` after dropping the sites ruled out of the bug. Jev is still asked both
  questions, and its `coverage` answer is stored and logged as given.
- **Rationale**: `coverage` is defined over listed sites (`jev.FIX`: `edited_only` = "at least one listed
  site has the same defect and is not fixed"), so over an empty list it carries no information. On PR #58
  every listed site was ruled `not_shared`, Jev answered `edited_only` over the empty list, and the commit
  was refused with nothing to fix or contest (gate.log 2026-10-04T08:32:40Z). `level` is unaffected: ruling
  sites out says nothing about where the fix acts, so `symptom` stays a `patch`. Rejected: rewriting
  `coverage` to `none_other` (the ledger and log would misreport Jev's answer), and skipping the `coverage`
  question for an empty list (a second request shape, while 006 SC-001 rests on replaying the one shape).
- **Existing tools**: `shimcheck.ruled_out`, which gives the sites ruled out, and `_judge`'s filter that drops
  them: fit, reused unchanged. The replay `tests/replay_shim.py`: kept on the 006 rule, since its sweeps are recorded
  as prose and never parsed into a `same_operation` list.

## R2: A refusal with no site left offers no contest

- **Decision**: `_patch_report` prints the site list and the "contest a site" step only when a site is
  left; otherwise the next step is to move the fix to the cause. The override line is unchanged.
- **Rationale**: `contest_errors` refuses any site not in the check's list, so a contest step over an
  empty list cannot succeed; a refusal that names an impossible step leaves only the override.
- **Existing tools**: `with_override`, which appends the override to a patch refusal: fit, unchanged.
