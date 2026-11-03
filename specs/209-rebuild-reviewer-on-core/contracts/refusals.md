# Contract: refusals added by this spec

Each names the next legal step (FR-010, P1). Which refusals `log` mode turns into `would_deny`: reviewer ADR-0006 d1
(the commit gates and the round-launch gate only); could-not-run outcomes for writes still record nothing.

| when | names |
|---|---|
| commit with no session record, reviewer on | `/codeworks <issue>`, or `reviewer off` |
| commit on a branch not starting `<s>-us` | session issue `#<s>`, allowed prefix `<s>-us` |
| session record unreadable | could not run; the record's path; re-run after the orchestrator rewrites it |
| state tampered | held; release = Ready move + admin comment on `#<s>` |
| state write over comment limit | could not run; the snapshot size and limit |
| gates write leaving no room to release every open hold and add a round | could not run; the snapshot size, the reserve and the limit |
| write whose `gates` differs from the one it read | could not run; stale reading, retry the step |
| GitHub unanswered | could not run; retry the step |
| `releaseOnClaim` failed | could not run; the next hook run retries the release |
| change touches a path core's `protectedPaths` returns (ADR-0002 d3–d4, orchestrator ADR-0004 d4) | the paths; an admin's or planner's PR |
| change to a merged story's task block, or spec folder unequal to the default branch's after its merge (ADR-0015 d4) | the file; the default branch's version |
| commit or round launch while the session's issue is in Blocked or Backlog (ADR-0015 d3) | the lane; the admin moves the card |
| round launch while a hold that refuses rounds is open (ADR-0013 d4) | the hold id; its release |
| reviewer workflow launch while reviewer is off (ADR-0006 d4) | `reviewer on` |
| tool write to `codeworks.toml` (ADR-0012 d1) | its owner, the admin |
| commit while `escalation-` or `rescope-` hold open, or `claim-`/`shim-` open and the range touches its file/lines | the hold id; its release (Ready move + admin comment, or `/codeworks reset`) |
| claim/shim check pending for the range | the workflow to launch and its range |
| branch's GitHub head not an ancestor of the local head | pushed history rewritten; the pushed head to restore |
| session write lock not acquired in time | could not run; retry the step |
| gates anchor commit in none of the bare copy, the model's clone and GitHub, and no reset later than every `at` in the section (else the check starts the section over, gates-snapshot.md §Anchor) | error naming the branch, the anchor and `/codeworks reset`; nothing graded or recorded |
| check on a branch other than the story's gates `branch` | error naming both branches; nothing graded or recorded |
