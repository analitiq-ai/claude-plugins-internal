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

The orchestrator, builder and reviewer run together in one session on a dedicated agent machine that
holds no admin GitHub credential, under Claude Code's managed settings
([root ADR-0008](docs/adr/0008-run-the-agent-session-on-one-agent-machine-under-managed-settings-with-keys-only.md)).
You start each session there naming one issue, `/codeworks <issue>`. planner runs where you work, under
your supervision, and acts on GitHub as its own App, never with your credentials. Setting up that machine
and a served repo:
[`orchestrator/README.md`](orchestrator/README.md). The exact managed settings and their tests:
`SECURITY.md`.

On the agent machine, from a shell, with a read-only deploy key of this repo loaded for SSH and kept
with the credentials the model is denied (`SECURITY.md` §5):

```
claude plugin marketplace add git@github.com:analitiq-ai/claude-plugins-internal.git
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install orchestrator@codeworks
claude plugin install builder@codeworks
claude plugin install reviewer@codeworks
claude plugin install auditor@codeworks
claude plugin install pr-review-toolkit@claude-plugins-official
```

`orchestrator` installs once its plugin ships.

Where you work:

```
claude plugin marketplace add analitiq-ai/claude-plugins-internal
claude plugin install planner@codeworks
claude plugin install reviewer@codeworks
```

The repo is private: on your machine the clone uses your git credentials for github.com; the agent
machine, which holds none, uses the deploy key.

## Layout

`<component>/plugin/` holds what an install copies. Beside it, never installed: `tests/` and the component's
decision records in `docs/adr/`. Records about the repo as a whole are in `docs/adr/`. The repo is one Spec
Kit project (`.specify/`, with the constitution, and the `speckit-*` commands); feature specs are in
`specs/<n>-<slug>/`. Start Claude Code at the root for spec work. CI runs every `<component>/tests/`
(`.github/workflows/tests.yml`).
