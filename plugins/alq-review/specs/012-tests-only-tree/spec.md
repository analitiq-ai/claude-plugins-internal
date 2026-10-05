# A tree that changes only test files is not a fix to sweep (#60)

The problem, its trace and the acceptance criteria are the `analitiq-spec` comment on
analitiq-ai/engineering#60. This folder records the design decisions the change makes to the shim check,
which the alq-review README describes (§8: a commit whose code is all in test files skips the check).
