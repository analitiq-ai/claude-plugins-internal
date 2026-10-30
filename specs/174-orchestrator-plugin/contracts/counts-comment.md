# Contract: the bound-count comment (Story 5)

Owned by core (`core/src/contracts/counts.ts`, through C6's shared tagged-snapshot channel). Writer: the
orchestrator App. Reader: the orchestrator's hooks.

- **Where**: comments on the story issue whose first line is `<!-- codeworks:orchestrator-counts -->`, then one
  `json` fence ending the body, keys sorted (as `renderState`).
- **Which counts**: the newest such comment by the orchestrator App. The card goes to Blocked naming it when
  it was edited, lacks the tag, or the timeline shows an orchestrator App comment deleted after it (reviewer
  ADR-0011 d2's rule, by the same core code).
- **Shape** (strict):

```json
{
  "v": 1,
  "since": "2026-10-30T12:00:00Z",
  "sessions": [{ "id": "<uuid>", "ended": false }],
  "turns": 3,
  "repeat": { "head": "<sha>", "findings": ["<finding key>"] }
}
```

| Field | Rule |
|---|---|
| `since` | the newer of the last Ready move and the last admin `/codeworks reset`; a snapshot with an older `since` counts nothing |
| `sessions` | every session on the story since `since`; `ended` true once its Stop hook let it end |
| `turns` | turns since `since` (`max_turns`) |
| `repeat` | the head and finding keys of the last turn that ended needing work, or null |

- **Deaths**: sessions with `ended: false` other than the current one (`k_deaths`).
- **Posted**: at the claim or resume, when a hook names a builder step, and just before Stop lets the session end
  — only when a field changed.
