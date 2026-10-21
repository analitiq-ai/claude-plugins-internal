# codeworks

Analitiq's Claude Code plugins and the orchestrator that drives them. One top-level folder per component;
the plugins are listed in `.claude-plugin/marketplace.json`.

| Component | |
|---|---|
| [`reviewer`](reviewer/plugin/README.md) | review rounds, commit checks and merge gates as code |
| [`planner`](planner/plugin/skills/issue-spec/SKILL.md) | scoping a change into a spec folder before it is built |
| [`builder`](builder/plugin/skills/issue-tackle/SKILL.md) | building an issue from its spec folder, then launching review on it |
| [`auditor`](auditor/plugin/README.md) | audit agents that hunt anti-patterns in a PR or a codebase |
| `orchestrator` | the deterministic script that drives an issue from Ready to merge (records only, so far) |

`builder` launches `reviewer`'s review round and says so when it is not installed; `reviewer`'s rounds
dispatch `auditor`'s agents.

## Install

```
claude plugin marketplace add analitiq-ai/claude-plugins-internal
claude plugin install reviewer@codeworks
claude plugin install planner@codeworks
claude plugin install builder@codeworks
claude plugin install auditor@codeworks
```

The repo is private: the clone uses your git credentials for github.com.

## Layout

`<component>/plugin/` holds what an install copies. Beside it, never installed: `tests/` and the component's
decision records in `docs/adr/`. Records about the repo as a whole are in `docs/adr/`. The repo is one Spec
Kit project (`.specify/`, with the constitution, and the `speckit-*` commands); feature specs are in
`specs/<n>-<slug>/`. Start Claude Code at the root for spec work. CI runs every `<component>/tests/`
(`.github/workflows/tests.yml`).
