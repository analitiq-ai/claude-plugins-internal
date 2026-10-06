# claude-plugins-internal

Analitiq's internal Claude Code plugin marketplace. One folder per plugin under `plugins/`, listed in
`.claude-plugin/marketplace.json`.

| Plugin | |
|---|---|
| [`alq-review`](plugins/alq-review/README.md) | review rounds, commit checks and merge gates as code |

## Install

```
claude plugin marketplace add analitiq-ai/claude-plugins-internal
claude plugin install alq-review@alq-internal
```

The repo is private: the clone uses your git credentials for github.com.

`plugins/<name>/` holds what an install copies. `dev/<name>/` holds what the plugin is built with and is never installed: its
Spec Kit project (`.specify/`, with the plugin's constitution), the `speckit-*` commands and its feature specs in
`specs/<nnn>-<feature>/`. Its decision records go in `docs/adr/` there. Start Claude Code in `dev/<name>/` for spec work. CI runs every
`tests/` folder under `plugins/` and `dev/` that is not inside a `fixtures/` folder (`.github/workflows/tests.yml`).
