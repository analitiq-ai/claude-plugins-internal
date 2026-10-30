# Contract: refusals added by this spec

Each names the next legal step (FR-010, P1). Under `log` mode, `would_deny` is logged instead (R12), except
could-not-run outcomes for writes, which still record nothing.

| when | names |
|---|---|
| commit with no session record, reviewer on | `/codeworks <issue>`, or `reviewer off` |
| commit on a branch not starting `<s>-us` | session issue `#<s>`, allowed prefix `<s>-us` |
| session record unreadable | could not run; the record's path; re-run after the orchestrator rewrites it |
| state or gates tampered | held; release = Ready move + admin comment on `#<s>` |
| state write over comment limit | could not run; the snapshot size and limit |
| GitHub unanswered | could not run; retry the step |
| `releaseOnClaim` failed | could not run; the next hook run retries the release |
| range touches a protected path | the path; an admin's PR under an exempt label |
| commit while `escalation-` or `rescope-` hold open, or `claim-`/`shim-` open and the range touches its file/lines | the hold id; its release (Ready move + admin comment, or `/codeworks reset`) |
| claim/shim check pending for the range | the workflow to launch and its range |
| branch's GitHub head not an ancestor of the local head | pushed history rewritten; the pushed head to restore |
| session write lock not acquired in time | could not run; retry the step |
