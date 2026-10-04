# Data model: Gate verdicts are check runs (#9)

This change adds no stored data. The one entity is the object the prose describes, and `pr-gate.js` owns it
(`analitiq-ai/.github`).

## Gate check run

| Field | Source | Prose term |
|---|---|---|
| name | `codex-review` or `internal-review` (`poll-pr-review.sh:50`) | verbatim |
| app | `checkSuite.app.slug == "analitiq-pr-gate"` (`:52`, `:176`) | "the `analitiq-pr-gate` App" |
| head | posted on the PR head commit | "on the head" |
| state | GitHub `status` + `conclusion` | see transitions |
| title | `output.title`, where the gate puts its reason (`:177`) | "title" |

## State transitions (gate result → check run → poller report)

| Gate result (`pr-gate.js@9bd2b2997c03` `:446-448`) | Check run | Poller prints (`:178`) | Skill wording |
|---|---|---|---|
| `pending` | `in_progress` | `PENDING` | none: the printed title |
| `success` | completed / `success` | `SUCCESS` | none: the printed title |
| `error` | completed / `failure` | `FAILURE` | none: the printed title |

Runs belong to a head commit. Each time the gate runs, it posts a new run on the head only when the
state or title differs from the newest one there (`pr-gate.js@9bd2b2997c03` `:469-487`).
