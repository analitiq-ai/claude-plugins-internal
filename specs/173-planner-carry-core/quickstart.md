# Quickstart: validating "Planner carries core"

Run from the repository root of a story's worktree. Contracts: [core API](contracts/core-api.md),
[scripts](contracts/scripts.md), [settings](contracts/codeworks-toml.md).

## Prerequisites

- Node ≥ 22.18, Python 3.13, `git`, `gh`, Spec Kit CLI ≥ 1.0.7.
- `npm ci` in `core`, `planner/plugin` and `planner`.
- For the live checks (US4, US6): `~/.config/codeworks/planner-app.pem` (0600, owned by you), no
  `/etc/claude-code/managed-settings.json`, the planner App installed on a scratch repository.

## US1: carrier and CI

```sh
node core/scripts/check-carriers.ts --base origin/main   # "1 carriers checked against origin/main, 0 failures"
(cd planner && npm test)                                  # tsc clean; node --test passes
(cd planner/tests && python -m unittest -v)               # unchanged Python suite passes
```

Missing dependency, on an installed-shaped copy (the link dereferenced, as an install copies it):

```sh
tmp=$(mktemp -d); cp -rL planner/plugin "$tmp/planner"; (cd "$tmp/planner" && npm ci)
rm -rf "$tmp/planner/node_modules/zod"
node "$tmp/planner/scripts/preflight.ts" 1; echo "exit $?"
# stderr: core dependency zod is not installed in <tmp>/planner ; exit 2
```

CI: a PR that breaks one planner `*.test.ts` fails the `unittest (planner/tests)` job.

## US2: token

Automated: `planner/tests/token.test.ts` against a local GitHub (scopes, a mint under 10 minutes left, a failure
naming a missing key, exit 2 on a missing file or section); `preflight.test.ts` and `land.test.ts` with a fake
mint; `core/tests/gh-config.test.ts` with
the real `gh`:

```sh
GH_CONFIG_DIR=<written folder> gh auth token        # prints the written token
printf 'protocol=https\nhost=github.com\n\n' | GH_CONFIG_DIR=<folder> \
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' credential fill
# username=<planner_app_login>, password=<the token>
```

## US3: spec facts

```sh
(cd planner && node --test tests/spec-facts.test.ts)   # the four rows of data-model "Spec facts", the re-grade
(cd core && node --test tests/spec-facts.test.ts)      # writeSpecFacts round-trips through readSpecFacts
```

The planner test reads each spec.md it wrote back with core's `readSpecFacts`, which must not refuse (US3 #5).

## US4: landing

Automated: `planner/tests/land.test.ts`, a local bare repository as origin and `fakeGitHub`: a three-story run
creates three sub-issues chained by `blockedBy`, labels tasks.md, pushes only the spec folder, opens one draft
PR; re-run creates nothing new; closed PR, rescope and lane cases stop with no write call recorded.

Live, once, on the scratch repository: `/planner:issue-spec #<issue>` on a Backlog issue through to
`completed`; the PR, issues and commit are authored by `codeworks-planner[bot]`. Then one `untracked` run: preflight
passes, or stops naming the card to add and passes on a re-run (spec Assumptions).

## US5: not worth doing

`planner/tests/test_drive_workflow.py` with a fake `gh` on `PATH` that records calls: a `not worth doing` pick
completes with no `gh` call and stdout `Close #<issue> as not planned: <reason>`.

## US6: no hook

Automated: `planner/tests/hooks.test.ts`: the plugin has no `hooks/`; `token.test.ts`: `gh.ts` runs gh with
planner's folder and no token variable; `test_new_issue.py`: `new_issue.py` runs its gh calls through `gh.ts`.

Live, once, on the scratch repository, in a Claude Code session started with `GH_TOKEN` exported:
`echo ${GH_TOKEN:+set}` prints `set`; `/planner:issue-spec untracked "<change>"` creates an issue whose author is
`codeworks-planner[bot]`.
