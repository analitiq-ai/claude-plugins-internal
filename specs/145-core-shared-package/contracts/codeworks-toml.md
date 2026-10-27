# Contract: `codeworks.toml` `[shared]`

Read at a ref through a `Tree` (R11, R14). Each component's own section is handed to it parsed and unvalidated;
the component validates it (root ADR-0002 d2). No environment variable sets or overrides a key (d3).

| Key | Type | Required | Rule |
|---|---|---|---|
| `validators` | list of module names | yes | each a `ModuleName` (data-model.md), the folder of its package in `validators/`; no duplicates; may be empty |
| `trusted_reviewers` | list of logins | no | absent → the threads module refuses to run; a login an enabled package lists as its provider's is that module's alone (R21) |
| `board` | string | yes | the board project's URL, `https://github.com/orgs/<login>/projects/<n>` or `https://github.com/users/<login>/projects/<n>` (orchestrator ADR-0002 d1) |
| `session_app_login` | string | yes | as REST writes it, `<slug>[bot]` |
| `orchestrator_app_login` | string | yes | as above |
| `reviewer_app_login` | string | yes | as above |
| `planner_app_login` | string | yes | as above |

Any other key in `[shared]` is refused naming it; a missing required key is refused naming it. The four logins
and `board` are `[shared]` because core's reads exclude every codeworks App from every trust (root ADR-0007 d5)
and count a Ready move only on the board, for both the orchestrator and reviewer. No module has a setting of its
own (root ADR-0003 d8).

Keys core does not validate, named here so no one looks for them in `[shared]`: each App's ID is a key of the
component whose hook mints its token, the session and orchestrator Apps' in `[orchestrator]`, the reviewer App's in
`[reviewer]`, the planner App's in `[planner]` (root ADR-0002 d1, d2); `review_timeout`, `max_turns` and `k_deaths` are
`[orchestrator]` keys (orchestrator ADR-0001 d8); `k_topic` and `max_rounds` are `[reviewer]` keys. Their names are
those components' specs'.

## Example

```toml
[shared]
validators = ["fixture"]
trusted_reviewers = ["alice"]
board = "https://github.com/orgs/example-org/projects/1"
session_app_login = "codeworks-session[bot]"
orchestrator_app_login = "codeworks-orchestrator[bot]"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "codeworks-planner[bot]"

[reviewer]
# validated by reviewer
```
