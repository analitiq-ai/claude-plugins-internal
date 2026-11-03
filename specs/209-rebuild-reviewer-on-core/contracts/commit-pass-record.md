# Contract: commit-check pass record (core, PR C)

Owner: `core/src/contracts/commit-pass.ts` (Zod) + `core/src/commit-pass.ts`. Writer: reviewer's hook (P6).
Reader: the orchestrator's push hook (#174 Story 2), reviewer's hook. A pass is the pre-push gate only — not a
review verdict.

## Location

`~/.local/state/codeworks/reviewer/sessions/<session id>/commit-passes.json`, folder 0700, file 0600, written by
temp file + rename. The folder is a model deny path (`core/src/keys.ts` `HOME_FOLDERS`).

## Shape

```json
{
  "v": 1,
  "repository": "owner/name",
  "off": false,
  "branches": {
    "42-us1-login": {
      "issue": 42,
      "head": { "sha": "<40 hex>", "range_from": "<40 hex>", "at": "2026-10-30T12:00:00Z" },
      "passes": [{ "sha": "<40 hex>", "range_from": "<40 hex>", "at": "2026-10-30T12:00:00Z" }]
    }
  }
}
```

- `off`: reviewer is switched off for the session (FR-019); the orchestrator pushes the agent identity's
  commits without consulting `branches`. Set and cleared only by reviewer's `reviewer on|off` prompt hook.
- Keyed by branch: a second story branch or a second claim in one session adds a key.
- Per branch, `passes` ordered oldest → newest; a `sha` appears once; `range_from` of an entry is the base its
  check first graded it from.
- `head`: the branch's newest pass, i.e. the head most recently checked and passed, set on every pass even when
  its sha is already in `passes` (a branch restored to an earlier passed commit after a rewrite). It is the
  orchestrator's push target and the check's base; never inferred from the order of `passes`.

## Functions

- `readCommitPasses(session): CommitPasses | null` — `null` when no file; throws on invalid content (P4: could not run).
- `recordCommitPasses(session, {repository, issue, branch, from, shas, at}): void` — appends every sha of the
  graded range under `branch` not already there, and sets the branch's `head` to the range's head; refuses a repository differing from the file's, or an issue differing from the
  branch entry's.
- `setReviewerOff(session, repository, off: boolean): void` — writes `off`; the file is created with `repository` when
  absent; a `repository` differing from the file's is refused.

## Protected paths

Not in this PR: the check calls core's existing `protectedPaths(changedFiles, {tickOnly, adrFolders}): string[]`
(`core/src/protected-paths.ts`, orchestrator ADR-0004 d4), the one matcher for both plugins, passing
`{tickOnly, adrFolders}`: `tickOnly` the story's `tasks.md` when core's `isTickOnly` finds its base and head versions TICK_ONLY, else null; `adrFolders` the `inside` folders of core's `adrFolders`, each relative to the repo root (#177 R12).
