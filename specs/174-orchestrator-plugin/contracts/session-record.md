# Contract: the session's issue record

Owned by core (`core/src/contracts/session-record.ts`, C1). Writer: the orchestrator's UserPromptSubmit hook.
Readers: reviewer, builder, the orchestrator's later hooks, through core's `readSessionRecord`.

- **Path**: `~/.local/state/codeworks/orchestrator/sessions/<session id>.json`; `<session id>` a UUID.
- **Write**: once per session, after the lane write (claim) or after the decision (resume): text to a temp file
  in the folder (mode 0600, `wx`), then `link` to the final name; an existing file fails the link, and the temp
  file is removed either way.
- **Shape** (strict):

```json
{
  "v": 1,
  "repo": "owner/name",
  "issue": 212,
  "taken": "claim",
  "at": "2026-10-30T12:00:00Z"
}
```

| Field | Rule |
|---|---|
| `v` | literal 1 |
| `repo` | `owner/name` as `ownerAndName` accepts |
| `issue` | positive integer |
| `taken` | `claim` \| `resume`, a core value set (root ADR-0010) |
| `at` | core `Time`, from GitHub's clock (`client.now()`) |

- **Read**: absent → `null`; present and invalid → refused naming the file, never read as absent.
- **Release rule** (reviewer, #209): `taken: claim` → `releaseOnClaim` at reviewer's first hook run that reads
  it, before a commit or round passes; `resume` or absent → never.
