# codeworks

Analitiq's Claude Code plugins. One top-level folder per component; the plugins are listed in
`.claude-plugin/marketplace.json`.

| Component | |
|---|---|
| [`reviewer`](reviewer/plugin/README.md) | review rounds, commit checks and merge gates as code |
| [`planner`](planner/plugin/skills/issue-spec/SKILL.md) | scoping a change into a spec folder before it is built |
| [`builder`](builder/plugin/skills/issue-tackle/SKILL.md) | building an issue from its spec folder, then launching review on it |
| [`auditor`](auditor/plugin/README.md) | audit agents that hunt anti-patterns in a PR or a codebase |
| [`orchestrator`](orchestrator/README.md) | hooks that drive an issue from Ready to merge inside the agent session (records only, so far) |

`builder` launches `reviewer`'s review round and says so when it is not installed; `reviewer`'s rounds
dispatch `auditor`'s agents.

## Install

The orchestrator, builder and reviewer run together in one session in a dedicated agent environment that
holds no human GitHub credential, under Claude Code's managed settings
([root ADR-0008](docs/adr/0008-run-the-agent-session-in-one-environment-under-managed-settings-with-keys-only-h.md));
planner runs where you work, under your supervision, and acts on GitHub with the agent credentials there,
never yours. Setting up that environment and a served repo:
[`orchestrator/README.md`](orchestrator/README.md). The exact managed settings and their tests:
`SECURITY.md`.

In the agent environment:

```
claude plugin marketplace add analitiq-ai/claude-plugins-internal
claude plugin install orchestrator@codeworks
claude plugin install builder@codeworks
claude plugin install reviewer@codeworks
claude plugin install auditor@codeworks
```

`orchestrator` installs once its plugin ships.

Where you work:

```
claude plugin marketplace add analitiq-ai/claude-plugins-internal
claude plugin install planner@codeworks
claude plugin install reviewer@codeworks
```

The repo is private: on your machine the clone uses your git credentials for github.com. How the agent
environment, which holds none, fetches it is open; it is moot once the repo is public.

## Layout

`<component>/plugin/` holds what an install copies. Beside it, never installed: `tests/` and the component's
decision records in `docs/adr/`. Records about the repo as a whole are in `docs/adr/`. The repo is one Spec
Kit project (`.specify/`, with the constitution, and the `speckit-*` commands); feature specs are in
`specs/<n>-<slug>/`. Start Claude Code at the root for spec work. CI runs every `<component>/tests/`
(`.github/workflows/tests.yml`).
