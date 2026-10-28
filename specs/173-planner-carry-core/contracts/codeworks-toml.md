# Contract: `codeworks.toml` for planner

This repository's file, added in US2 (values from the spec's Assumptions, verified 2026-10-28; the board's
owner segment `orgs/analitiq-ai` is inferred from the repository and is checked against the board's URL in US2):

```toml
[shared]
board = "https://github.com/orgs/analitiq-ai/projects/5"
validators = []
session_app_login = "codeworks-session[bot]"
orchestrator_app_login = "codeworks-orchestrator[bot]"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "codeworks-planner[bot]"

[planner]
app_id = 5510825
```

`[shared]` is core's `Shared`; `[planner]` is `z.strictObject({ app_id: z.number().int().positive() })`. A
missing file, a refused section or an unknown key blocks the hook naming `codeworks.toml` and the key.
