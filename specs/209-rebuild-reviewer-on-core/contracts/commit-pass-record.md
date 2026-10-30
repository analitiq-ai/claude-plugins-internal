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
      "passes": [{ "sha": "<40 hex>", "range_from": "<40 hex>", "at": "2026-10-30T12:00:00Z" }]
    }
  }
}
```

- `off`: reviewer is switched off for the session (FR-019); the orchestrator pushes the agent identity's
  commits without consulting `branches`. Set and cleared only by reviewer's `reviewer on|off` prompt hook.
- Keyed by branch: a second story branch or a second claim in one session adds a key.
- Per branch, `passes` ordered oldest → newest; a `sha` appears once; `range_from` of an entry is the base its
  check graded from. Newest pass of a branch = its last entry.

## Functions

- `readCommitPasses(session): CommitPasses | null` — `null` when no file; throws on invalid content (P4: could not run).
- `recordCommitPasses(session, {repository, issue, branch, from, shas, at}): void` — appends every sha of the
  graded range under `branch`; refuses a repository differing from the file's, or an issue differing from the
  branch entry's.
- `setReviewerOff(session, off: boolean): void` — writes `off`; the file is created when absent.

## Protected paths (same PR)

`touchesProtected(paths: string[]): boolean` — orchestrator ADR-0004 d4's list (`.github/`, `codeworks.toml`,
`.claude/`, …), one matcher for both plugins.
