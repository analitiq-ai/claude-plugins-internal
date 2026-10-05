# Contract: alq-review shim check

Internal to alq-review; no shape from the contracts map is involved.

## Launch

```
Workflow(name='alq-review:shim-check', args={worktree: '<absolute checkout path>'})
Workflow(name='alq-review:shim-check', args={worktree: '<path>', contests: [{site: '<16-hex id>', reason: '<why>'}]})
```

Refused before any agent runs when: `worktree` is not an absolute path to a branch checkout with a GitHub origin;
tracked files differ from what is staged; nothing is staged; the claim check has not labelled every hunk of the
staged tree; the tree already has a `complete` check and no contest is given; the chain is `held`; a contest names
a site not in the chain's current list, a site already ruled, or has an empty reason. The gate, not the caller,
sets the mode (R4).

## Workflow result

`COMPLETE`: `{status, check_ref, mode, agents, next_step}`; the verdict is the gate's, shown at `git commit`.
`INCOMPLETE`: `{status, check_ref, did_not_report: [...], next_step}`.

## Sweep output (shim-sweeper; three of them in deep mode)

```json
{"check_ref": "shim-…", "same_operation": [{"file": "a.py", "line": 12, "function": "load", "does": "…"}],
 "callers": [{"file": "b.py", "line": 40, "function": "main", "does": "…"}]}
```

Validated by `shimcheck.validate_sweep` (R5) before it is recorded.

## Site ruling output (shim-site-judge)

```json
{"check_ref": "shim-…", "site": "<id>", "ruling": "shares|not_shared|deferred", "issue": 123,
 "evidence": ["path:line"], "reason": "…"}
```

`issue` is required for `deferred` and must be an open issue in the same repo; `evidence` paths must exist in the
staged tree.

## Jev requests (R6)

At launch: state `COMMIT DIFF\n<code and mixed hunks>`, question `kind` (`fix` | `not_fix`). For a `fix`, after
the sweep, state: `COMMIT DIFF\n<code and mixed hunks>\n\nSAME OPERATION\n- file:line function — does\n…\n\nCALLERS/CONSUMERS\n…`.
Questions `level` and `coverage`, instructions and criteria verbatim from the design (spec FR-005).

## Commit refusals (text the author sees)

- not checked: names the launch call.
- failed: "the check failed, not the fix: <reason>", names the relaunch.
- patch: level, coverage, every SAME OPERATION site with id and `touched` or `not touched` (whether a staged hunk
  overlaps the site's lines in `HEAD`), the chain count; at count 3 the deep-sweep step; how to contest a site.
- held: the question for the user.
- every refusal ends with `override shim-<id>` (chain id, or tree prefix when no chain matches).

## User override

A user prompt `override shim-<id>` switches this check off for that bug on that branch until a commit lands (R11).
The sweeper reads `<main checkout>/.claude/worktrees/shim-<12 hex of sha256(HEAD, staged tree)>/`, deleted when the check ends or a later
check at the same checkout replaces it (R3).

## Log entries (`gate.log`)

`shim-check` (verdict, answers, sites, cost), `shim-commit` (allow/deny/would_deny), `shim-contest`,
`shim-miss` (site id, chain, the check that missed it), `shim-override`.
