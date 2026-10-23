# Contract: `codeworks.toml` `[shared]`

Read at a ref through a `Tree` (R11, R14). Each component's own section is handed to it parsed and unvalidated;
the component validates it (root ADR-0002 d2). No environment variable sets or overrides a key (d3).

| Key | Type | Required | Rule |
|---|---|---|---|
| `validators` | list of module names `codex` · `coderabbit` · `deepsource` | yes | no duplicates; may be empty |
| `trusted_reviewers` | list of logins | no | absent → the threads module refuses to run; an entry naming an enabled module's vendor (`chatgpt-codex-connector[bot]`, `coderabbitai[bot]`, `deepsource-io[bot]`) is refused (R21) |
| `deepsource_source` | `api` · `github` | exactly when `validators` holds `deepsource` | refused otherwise |
| `session_app_id` | integer | yes | |
| `session_app_login` | string | yes | as REST writes it, `<slug>[bot]` |
| `reviewer_app_id` | integer | yes | |
| `reviewer_app_login` | string | yes | as REST writes it, `<slug>[bot]` |

Any other key in `[shared]` is refused naming it; a missing required key is refused naming it. The orchestrator
App's ID and key file are the orchestrator's spec (FR-036). Module timeouts are `[orchestrator]` keys (FR-023).

## Example

```toml
[shared]
validators = ["codex", "deepsource"]
deepsource_source = "github"
trusted_reviewers = ["alice"]
session_app_id = 1
session_app_login = "codeworks-session[bot]"
reviewer_app_id = 2
reviewer_app_login = "codeworks-reviewer[bot]"

[reviewer]
# validated by reviewer
```
