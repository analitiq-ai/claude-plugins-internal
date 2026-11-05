# Contract: builder's step script

`builder/plugin/scripts/step.ts`, run by the skill as

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/step.ts" <s> --session "${CLAUDE_SESSION_ID}"
```

from the main checkout or any of its worktrees. It imports `../lib/guarded.ts` first (R1).

## Input

| Argument | Rule |
|---|---|
| `<s>` | one positional, `^[1-9][0-9]*$`, a safe integer |
| `--session` | a UUID |

Anything else: exit 2, stderr `builder: step.ts takes <s> --session <id>, not <args>`, nothing read.

Reads (research R5–R12, R16): the stop rule's facts through core's `readStoryStopFacts`; the gh folder at core's
`ghFolder`; the main checkout's origin; GitHub through the session token; git in the main checkout and the story's worktree.

## Writes

Only these, each idempotent:
- every run, by core's `readStoryStopFacts` before it reads: `git fetch` of the default branch to
  `refs/remotes/origin/<default>` (R9), and of a branch on GitHub only to `refs/remotes/origin/<branch>` (R8);
- no branch on GitHub or locally: `git worktree add -b <branch> ../<repo>.worktrees/<branch> <sha>`, `<sha>` the
  fetched default tip;
- a branch on GitHub only: `git worktree add -B <branch> ../<repo>.worktrees/<branch> refs/remotes/origin/<branch>`;
- a local branch with no worktree: `git worktree add ../<repo>.worktrees/<branch> <branch>`.

Each `worktree add` runs only when the folder at the ref it starts from gives no stop (R10).

Nothing else: no commit, no push, no GitHub write. Every stop leaves branches, worktrees and GitHub unchanged; its
only writes are the fetches of remote-tracking refs (SC-002).

## Output

stdout: one JSON line, the `Step` of data-model.md; stderr: nothing on exit 0 or 1.

```json
{"v":1,"kind":"implement","story":231,"worktree":"/home/a/repo.worktrees/231-us3-lane-check","branch":"231-us3-lane-check","requirement":{"kind":"defect","source":"specs/217-rebuild-issue-tackle/spec.md","observed":"hypothesis"},"tasks":[{"id":"T012","line":"- [ ] T012 [US3] ..."}]}
{"v":1,"kind":"stop","story":231,"state":"lane","reason":"#231's card is in Blocked: builder builds nothing there (root ADR-0006 d1)","pr":null}
{"v":1,"kind":"merge","story":231,"worktree":"…","ref":"refs/remotes/origin/main","why":["docs/adr differs between origin/main and HEAD"],"argv":["git","merge","--no-ff","--no-edit","refs/remotes/origin/main"]}
```

| Exit | Meaning |
|---|---|
| 0 | `merge`, `implement`, `internal_round`, `github_round` or `nothing_to_do` |
| 1 | `stop`, its `reason` naming the state and any open story PR |
| 2 | a read did not answer or was refused, or the arguments are refused: one stderr line `builder: <cause>`, stdout empty |

Every `reason` comes from core's stop rule (R16), the same text the orchestrator's Stop hook writes as the Blocked
reason (builder ADR-0003 d2); none names a planning command (FR-008).

## Idempotence

Two runs with no change on GitHub or in git print the same JSON (SC-003); the cut runs at most once, the second
run finding the branch it made.
