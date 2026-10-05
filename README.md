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

Each plugin keeps its feature specs in its own `specs/<nnn>-<feature>/` (Spec Kit), e.g. `plugins/alq-review/specs/`. CI runs every `tests/` folder under `plugins/`
(`.github/workflows/tests.yml`).
