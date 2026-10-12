# A cause fix with no site left is complete (#59)

The problem, its trace and the acceptance criteria are the `analitiq-spec` comment on
analitiq-ai/engineering#59. This folder records the one change it makes to the shim check's verdict
rule, which the shim check shipped as
`complete iff level == cause and coverage in (all, none_other)` without considering an empty list.

## Requirements

- **FR-001**: With no SAME OPERATION site left, after the sites ruled `not_shared` or `deferred` are
  dropped or because the sweep listed none, the verdict of a fix is `complete` iff `level == cause`,
  whatever Jev answered for `coverage`. With one or more sites the shipped rule is unchanged.
- **FR-002**: `level == symptom` with no site left stays a `patch`.
- **FR-003**: The stored and logged `coverage` is Jev's answer, unchanged.
- **FR-004**: A patch refusal with no site left prints no site list and no "contest a site" step; its next
  step is to move the fix to the cause, and it still names the user's override.
