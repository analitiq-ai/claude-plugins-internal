# Contract: `scripts/speclocation.py`

The module's code is the authority for the comment's form; this file records the command surface the skills and
the workflow rely on. Exit codes: 0 done, 1 refused (message on stderr names the next step), 2 bad usage or a
check that could not run.

| Command | Does | stdout |
|---|---|---|
| `show <issue> [--repo <owner/repo>]` | reads the issue's location comment | `spec: <folder>` and `branch: <branch>`, or `spec: none` and `reason: <text>` |
| `post <checkout>` | upserts the location comment for the checkout's branch and its `.specify/feature.json` folder | the comment's URL |
| `none <checkout> <reason>` | upserts `spec: none` + reason; creates no folder; exit 2 on an empty reason | the comment's URL |

`show` without `--repo` takes the repo from the current directory's `gh` default, as the skills' `gh api` calls did.

Refusals (each names the next step; the text is built in `speclocation.py`):

- no location comment: run `/alq-review:design-doc #<issue>`;
- malformed, repeated or out-of-repo comment: states the form; an old whole-spec comment names `design-doc`;
- folder not in the checkout: names the folder and the `branch:` that holds it;
- `spec.md` missing or empty: as above.

Callers: `gate.py` (review and assess launch) and `briefs.brief` call `resolve` in-process; the
`alq-issue-tackle` and `alq-root-cause-check` skills run `show`; the `design-doc` skill runs `post` after its run
completes and it has committed the spec folder and pushed the branch; its `none` entry runs `none`.
