# claude-plugins-internal

Analitiq's internal Claude Code plugin marketplace. One folder per plugin under `plugins/`, listed in
`.claude-plugin/marketplace.json`.

| Plugin | |
|---|---|
| [`alq-review`](plugins/alq-review/README.md) | review rounds, commit checks and merge gates as code |
| [`alq-plan`](plugins/alq-plan/skills/issue-spec/SKILL.md) | scoping a change into a spec folder before it is built |
| [`alq-build`](plugins/alq-build/skills/issue-tackle/SKILL.md) | building an issue from its spec folder, then launching review on it |

None requires another; `alq-build` launches `alq-review`'s review round and says so when it is not installed.

## Install

```
claude plugin marketplace add analitiq-ai/claude-plugins-internal
claude plugin install alq-review@alq-internal
claude plugin install alq-plan@alq-internal
claude plugin install alq-build@alq-internal
```

The repo is private: the clone uses your git credentials for github.com.

`plugins/<name>/` holds what an install copies. `dev/<name>/` holds what the plugin is built with and is never installed: its
Spec Kit project (`.specify/`, with the plugin's constitution), the `speckit-*` commands, its feature specs in
`specs/<nnn>-<feature>/` and its tests in `tests/`. Its decision records go in `docs/adr/` there. Start Claude Code in `dev/<name>/` for
spec work. CI runs every `tests/` folder under `dev/` that is not inside a `fixtures/` folder (`.github/workflows/tests.yml`).
