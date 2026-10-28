# Data Model: Planner carries core

## Carrier (US1)

`planner/plugin/` holding:

| Field | Value | Graded by |
|---|---|---|
| `core` | symlink, target `../../core/src` | `check-carriers.ts` |
| `package.json` | `type: "module"`, `dependencies` equal to core's | `check-carriers.ts` |
| `package-lock.json` | `lockfileVersion: 3`, `packages["node_modules/<pin>"].version` equal to core's | `check-carriers.ts` |
| `.claude-plugin/plugin.json` | `version`, changed in any PR that changes `core/src` or core's pins | `check-carriers.ts` |

## Planner settings (US2)

`codeworks.toml` at the checkout's `HEAD` ([contract](contracts/codeworks-toml.md)).

- `[shared]`: core's `Shared` (unchanged); planner reads `planner_app_login` and `board`.
- `[planner]`: `app_id`, a positive integer. Unknown keys refused.

## Stored token (US2)

Folder `~/.local/state/codeworks/planner/<owner>/<name>/gh`, mode 0700.

| File | Content | Reader |
|---|---|---|
| `hosts.yml` (0600) | `github.com: {oauth_token, user: <planner_app_login>, git_protocol: https}` | gh, `gh auth git-credential` |
| `codeworks-token.json` (0600) | `{repo: "<owner>/<name>", expires_at: <ISO-8601>}` | `readGhToken` |

Rule: mint when no token, another `repo`, or `expires_at − now < 10 min`. A folder with one file and not the
other is refused, not repaired.

## Spec facts (US3)

spec.md's front matter key `codeworks` = core's `SpecFacts`: `{v: 1, kind: feature | defect | no_spec,
root_cause: {observed: anchored | hypothesis | none}}`.

| Input | kind | observed |
|---|---|---|
| no-spec spec.md (`# No spec needed`) | `no_spec` | `none` |
| report `Reports wrong behaviour: no`; root cause `Not a defect report.` | `feature` | `none` |
| report `yes`; root cause opens with the hypothesis sentence | `defect` | `hypothesis` |
| report `yes`; any other filled `Observed:` opening | `defect` | `anchored` |

Exactly one `codeworks` key; other front-matter keys are kept.

## Premise vocabulary (US3)

`core/src/contracts/premise.ts`, generated to `core/src/generated/premise.json`:

| Key | Value(s) |
|---|---|
| `picks` | `write the spec`, `no spec needed`, `not worth doing` |
| `reports_wrong_behaviour.label` / `.yes` / `.no` | `Reports wrong behaviour`, `yes`, `no` |
| `root_cause.heading` | `## Root cause` |
| `root_cause.observed` | `Observed:` |
| `root_cause.not_a_defect` | `Not a defect report.` |
| `root_cause.hypothesis` | `Observed: nothing; this trace is a hypothesis from reading the code.` |

## Lane (US4)

Core value set `Lane`: `Backlog`, `Ready`, `In progress`, `In review`, `Blocked`, `Done`. `laneOf` returns one,
or null for an issue with no card on `[shared] board`. Planner runs only in `Backlog` or `Blocked`.

## Spec PR (US4)

`pickSpecPr` over same-repository PRs headed `<p>-spec`, newest by number: `{number, state: open | closed |
merged}` or null.

| State | Landing |
|---|---|
| null | new branch from the default branch, draft PR |
| open | push to the branch, no new PR |
| closed | stop: delete `<p>-spec` (admin) |
| merged | stop: the spec is on the default branch; a rescope (#178) |

## Story issue (US4)

| Stories in tasks.md | Story issue of US`k` |
|---|---|
| 1 | `<p>` itself |
| n ≥ 2 | sub-issue `k−1` (0-based) of `<p>`; US`k` (k ≥ 2) `blockedBy` US`k−1` |

Existing sub-issues m: m ≤ n creates US`m+1`…US`n`; m > n stops naming the extra ones.

## Task-block label (US4)

A line `Story issue: #<n>` directly under each `## Phase …` heading of tasks.md. Phase with `[US<k>]` tasks →
story k's issue; phases before the first story phase → US1's; after the last → US`n`'s.
