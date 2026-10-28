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
| a reviewer App comment deleted at or after the newest's `createdAt`, same second included (or any, when there is none) | yes | `deleted` |
| newest lacks the tag, or fails the format or the schema | yes | `invalid` (comment URL, error) |
| open hold rows of the working snapshot | yes | one `open_hold` (id) each |
| no reviewer App comment and no deletion, PR or not | no | none: "no state" |

Causes combine; all are reported. The working snapshot is the state comment's when no `tampered`, `deleted` or
`invalid` cause stands; else the newest reviewer App comment that is unedited, tagged and valid; else an empty
snapshot. Every answer below is over it. The issue having no item on `[shared] board` the reader can see throws
`BoardNotVisible`, naming the board.

## Attestation (R16; FR-016)

`attests(checkout, reading, head, base, specFolder)` is true exactly when `held` is false, an INTERNAL or AUDIT
round with result CLEAN, or result DIRTY with verdict CONVERGED_PUSHBACK, is at the PR head or at a commit in its
history, and the newest such round has not lapsed (orchestrator ADR-0004 d1). It lapses when, since it:

| Lapse | Read as |
|---|---|
| governing documents changed | at `base` and at the round's commit, a different object, or one at only one of them, for `<specFolder>/spec.md`, any tree `docs/adr` at any depth, or `.specify/memory` |
| a merge not git's clean one | a merge commit between the round's commit and the head whose tree differs from `git merge-tree --write-tree` of its parents, or which conflicts |
| a comment release | a hold row with `released_by.reset` false and `released` after the round's `at` |

A `/codeworks reset` lapses nothing. GITHUB rounds, stage 2, never count for or against. A round commit the clone
does not hold is not in the head's history. No state never attests.

## Release (R27; FR-019, FR-019a, FR-019b)

Read in the same pass as the state (R15). A hold's time is its row's `since`, GitHub's time just before the
comment that placed it was posted. "After" a time is a `createdAt` in a later second, so a same-second pair is not
after (GitHub's times are whole seconds); "after" between two comments is `databaseId` order.

| Term | Read as |
|---|---|
| admin comment | an issue comment whose author is a `User` (an App posting as itself is a `Bot`; an admin posting through an App acting for them is the `User`), whose `role_name` on the repository, from the collaborator-permission endpoint, is admin, maintain or write (orchestrator ADR-0010 d2) |
| Ready move | the newest status-change event on the issue's timeline whose `status` is `Ready`, whose `project.url` is `[shared] board`, whoever made it (orchestrator ADR-0002 d1; reviewer ADR-0013 d2) |
| an escalation hold's question | the oldest comment by `orchestrator_app_login` whose first line is `<!-- codeworks:hold-question <id> <since> -->`, the hold's id and `since` |
| reset | the newest admin comment whose body, trimmed, is `/codeworks reset` |

An OPEN hold is **releasable** when a reset is after its `since`, released by the reset; or when a Ready move and
an admin comment are both after its `since`, that comment also after the question for an escalation hold, released
by the newest such comment. An escalation hold whose question is not posted is releasable only by a reset.

A `tampered`, `deleted` or `invalid` cause is **released** when a Ready move and an admin comment are both after
the newest of: the state comment's `lastEditedAt`, the newest reviewer App comment deletion, the invalid comment's
`createdAt`.

`startable` is true when every such cause is released and every open hold is releasable.

`questionTag(hold)` renders the question's first line; the orchestrator posts its question with it.

## Write rules (R16; FR-019, FR-020)

| Write | Posts | Refused when |
|---|---|---|
| `writeState` | the caller's snapshot, each appended round's `at` set from `now()` | a cause above stands; the snapshot drops or rewrites a round or pushback, or changes any hold row; the body is over the size limit |
| `placeHold` | the working snapshot with the row added OPEN, or moved RELEASED → OPEN, `since` set and `released`, `released_by` cleared; nothing when the row is OPEN | as `writeState`; the kind is `rescope`; an escalation without a question |
| `placeRescopeHold` | the working snapshot with `rescope-<issue>` OPEN, `since` set, `released` and `released_by` cleared, recording `spec_pr`; nothing when the row already records that spec PR, open or released | as `writeState` |
| `releaseOnClaim` | the working snapshot with every releasable hold moved OPEN → RELEASED, `released` and `released_by` set; nothing when it releases no hold and no tamper cause | a cause above stands and is not released |

`since`, `released` and `at` are GitHub's time, `YYYY-MM-DDTHH:MM:SSZ`, from the client's `now()` read just before
the post; no caller supplies them.
