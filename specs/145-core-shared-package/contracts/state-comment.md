# Contract: the state comment

A comment on a story issue, posted by the reviewer App (reviewer ADR-0011 d1; FR-015, FR-018). Its body is
exactly:

````text
<!-- codeworks:reviewer-state -->
```json
<Snapshot as JSON, sorted keys, two-space indent>
```
````

- The state comment is the newest comment whose author is a `Bot` whose login plus `[bot]` equals `[shared]
  reviewer_app_login`, whatever its body (FR-015). The reviewer App posts nothing else.
- The tag is that comment's first line, byte for byte. A tag anywhere else, in a quoted reply for one, or no tag,
  is `invalid`; an older comment never stands in for it.
- Between the fences: one JSON object valid against `core/schemas/snapshot.schema.json`. Anything else in the
  body, or a body that does not end with the closing fence and an optional newline, is `invalid`.
- The snapshot is whole: each comment carries every round, hold row and pushback (FR-018).
- Size: GitHub refuses a comment over 65,536 characters. A write whose body exceeds it is refused naming the
  size; trimming history would drop rows, which R16 forbids.

## Read outcomes (R15; FR-016)

| Case | `held` | `causes` |
|---|---|---|
| newest reviewer App comment unedited, valid, no open hold, no later deletion | no | none |
| newest has `lastEditedAt` | yes | `tampered` |
| a reviewer App comment deleted after the newest by `createdAt` (or any, when there is none) | yes | `deleted` |
| newest lacks the tag, or fails the format or the schema | yes | `invalid` (comment URL, error) |
| open hold rows | yes | one `open_hold` (id) each |
| no reviewer App comment and no deletion, PR or not | no | none: "no state" |

Causes combine; all are reported.

## Attestation (R16)

`attests(reader, repo, reading, head)` is true exactly when `held` is false and an INTERNAL or AUDIT round with
result CLEAN, or result DIRTY with verdict CONVERGED_PUSHBACK, is at the PR head or at a commit in its history
(GitHub's compare reads `ahead` or `identical`). This is stage 1; GITHUB rounds after it, stage 2, never undo
it, and a rewritten history that drops the commit restarts it (orchestrator ADR-0004 d1). No state never
attests.

## Write rules (R16; FR-019)

| Write | Refused when |
|---|---|
| `writeState` | `tampered`, `deleted` or `invalid` stands; the new snapshot drops or rewrites a round, hold row or pushback; the body is over the size limit |
| `placeRescopeHold` | as `writeState` |
| `releaseState` | none of `tampered`, `deleted`, `invalid` stands |

`releaseState` posts again the newest reviewer App comment that is unedited, tagged and valid, or
`{"holds": [], "pushbacks": [], "rounds": [], "v": 1}` when there is none.
