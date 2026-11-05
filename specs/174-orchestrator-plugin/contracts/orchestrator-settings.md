# Contract: `[orchestrator]` in `codeworks.toml`

Strict Zod object in `orchestrator/plugin/lib/settings.ts`; an unknown key, a missing required key or a bad value refuses
as `SettingsError("codeworks.toml [orchestrator]", …)` (root ADR-0002 d2). Read per research R5.

| Key | Type | Rule | Story |
|---|---|---|---|
| `app_id` | integer | ≥ 1; the orchestrator App | 1 |
| `session_app_id` | integer | ≥ 1; the session App | 1 |
| `status_issue` | integer | ≥ 1; where failures naming no issue go (FR-008) | 1 |
| `exempt_labels` | string[] | label names, no duplicates (ADR-0005) | 3 |
| `review_timeout` | integer seconds | 1–3600; absent reads core's default 1800 (FR-021) | 4 |
| `max_turns` | integer | ≥ 1 (ADR-0001 d8) | 5 |
| `k_deaths` | integer | ≥ 1 (ADR-0001 d8) | 5 |

Logins come from `[shared]` (`session_app_login`, `orchestrator_app_login`, …), never from here, and so does
`required_checks` (check names, at least one, no duplicates; optional, set only where the repo's plan offers no
rulesets; FR-020c, ADR-0009 d2), which builder reads too.

Example (Story 1):

```toml
[orchestrator]
app_id = 1234567
session_app_id = 1234568
status_issue = 1
```
