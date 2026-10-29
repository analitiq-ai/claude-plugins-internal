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
your supervision; its scripts act on GitHub as its own App, and the rest of the session keeps your gh login.
Setting up that machine and a served repo:
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

## A repository planner scopes in

Set up once, and merged to the repository's default branch before the first `/planner:issue-spec`:
planner reads `codeworks.toml` at `HEAD`, and landing stops on any committed path outside the spec
folder that the default branch lacks.

1. Install the Spec Kit CLI, `specify` 1.0.7 or later, and initialise the repository:
   `specify init --here --integration claude`.

   The `issue-spec` workflow's grill and critique steps run two third-party Spec Kit community extensions,
   part of neither Spec Kit nor planner. Spec Kit's catalog lists both as discovery-only, not vetted, so
   `specify` will not install them from it. Vet each yourself, then install it with
   `specify extension add <id> --from <archive-url>`, or `--dev <folder>` from a local copy:

   | Extension | Author | Skill it adds |
   |---|---|---|
   | `grill` | [yoshi1220/speckit-grill-me](https://github.com/yoshi1220/speckit-grill-me) | `speckit-grill-me` |
   | `critique` | [arunt14/spec-kit-critique](https://github.com/arunt14/spec-kit-critique) | `speckit-critique-run` |

   No other extension is needed. The workflow's other steps, `speckit.specify`, `speckit.plan` and
   `speckit.tasks`, come with `specify init`, and planner installs its own preset (`settled-design`) and
   workflow (`issue-spec`) at each start. This repo's `adrkit` and `assess` extensions are not planner's.

   Commit `.specify/` and the `speckit-*` skills under `.claude/skills/`.
2. Copy this repo's `codeworks.toml` to the repository's root and set `board` to the repository's board,
   `https://github.com/orgs/<org>/projects/<n>`.
3. Make the board an organization project in the org where the planner App is installed. Spell its Status
   options Backlog, Ready, In progress, In review, Blocked, Done. Planner scopes an issue only from
   Backlog or Blocked: turn on the project's workflows that add the repository's new issues in Backlog, or
   add each card by hand.
4. Install the planner App on the repository, and keep its key at `~/.config/codeworks/planner-app.pem`,
   mode 0600, owned by you.
5. Planner scopes each issue in a worktree it creates per the repository's branch rules. Name the place in
   the repository's `CLAUDE.md`, for example `.claude/worktrees/<branch>`, and add that folder to
   `.gitignore`. Never under `.git/`: Claude Code protects it, and the run cannot write there.
6. Commit and merge to the default branch.

## Layout

`<component>/plugin/` holds what an install copies. Beside it, never installed: `tests/` and the component's
decision records in `docs/adr/`. Records about the repo as a whole are in `docs/adr/`. The repo is one Spec
Kit project (`.specify/`, with the constitution, and the `speckit-*` commands); feature specs are in
`specs/<n>-<slug>/`. Start Claude Code at the root for spec work. CI runs every `<component>/tests/`
(`.github/workflows/tests.yml`).
