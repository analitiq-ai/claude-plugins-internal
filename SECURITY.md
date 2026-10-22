# Security

How codeworks stops an autonomous Claude Code session from merging unreviewed code, and what a
contributor must not break. Records: root ADR-0007 and ADR-0008, orchestrator ADR-0001 and ADR-0009,
reviewer ADR-0011, ADR-0012 and ADR-0021.

## 1. The boundary that must hold

Only code that passed review merges. Four things hold that:

1. Each served repo's ruleset requires CI, `internal-review` and each external reviewer module's
   `<module>-review` (for example `codex-review`) from the orchestrator App. No App is on its bypass
   list (orchestrator ADR-0009).
2. The orchestrator App's key is readable only by hooks, never by the model.
3. The orchestrator attests `internal-review` only from a round record posted by the reviewer App.
4. reviewer posts that record only from verdicts the gate rule (§6) accepts.

Every other refusal (commit gates, lane rules, reviewer's refusals of the model's GitHub writes) is a
guardrail: the boundary catches a bypass of one. A change that weakens any of the four points is a
security change.

## 2. Where things run

- **Agent environment.** One dedicated machine, VM or container, holding no human GitHub credential, with
  Claude Code's managed settings (§5) installed. One session there runs the orchestrator, builder and
  reviewer plugins, one story at a time, one session per board. Something outside codeworks starts it
  (`claude -p`, or a human); the orchestrator's hooks drive it from there. The orchestrator and reviewer
  App keys exist only here. builder runs nowhere else.
- **Planner** runs where its human works, outside the agent environment and its managed settings, under
  human supervision. Its agent acts on GitHub as the session App, through the token reviewer's hook mints
  from the session key there (root ADR-0007 d2), never with a person's credentials. It never runs in a
  container.

Accepted risks:

- planner's agent works without managed settings: that it acts on GitHub only with the agent
  credentials on its machine, never a person's, rests on human supervision.
- A flaw in Claude Code's sandbox is a codeworks hole.
- All hooks run as one OS user. Each App key is read only by its own plugin's hooks by convention; what
  enforces it is that plugin code is pinned and the model cannot write it.
- The session App's `contents` write also authorises GitHub's merge endpoint; only the ruleset stops the
  model merging.
- The gate rule relies on hook fields Claude Code does not promise to keep. If one changes, no verdict
  counts and every story stalls: it fails closed.

## 3. Identities

Three GitHub Apps per served repo, none on a ruleset bypass list.

| App | Acts for | Repository permissions | Organization permissions | Key read by |
|---|---|---|---|---|
| `codeworks-session` | the model's commands, through a one-hour, one-repo installation token | contents, pull requests, issues: write; metadata, checks, statuses, actions: read; no administration, workflows, secrets or environments | projects: read | the orchestrator's SessionStart hook in the agent environment; reviewer's hook where planner runs |
| `codeworks-orchestrator` | the orchestrator's hooks: claim, lanes, `internal-review`, external review requests, each module's `<module>-review`, the ready flip, merge, Blocked moves | contents, pull requests, issues, statuses: write; checks: read | projects: write | the orchestrator's hooks, agent environment only |
| `codeworks-reviewer` | reviewer's hooks: round records, holds, rescope holds | issues: write | none | reviewer's hooks, agent environment only |

A hook mints the session token into a gh config folder the model can read but not write, outside
`~/.claude` and the session's temp folder, and refreshes it before the hour runs out. No trust check
counts the session App as a human, writer, trusted or exempt actor. The App keys, the validator modules'
tokens (for example a DeepSource token) and the classifier key live in `~/.config/codeworks/`.

## 4. Boundaries per component

Stops, strongest first: **GitHub** (App permissions, ruleset), **managed settings**, **hook guardrail**.

**Orchestrator.** Hooks only, as the orchestrator App. It runs no LLM and parses no prose except through
core.
- GitHub: no administration or workflow access; the ruleset decides whether a merge goes through, and
  the merge names the head it evaluated.
- It attests `internal-review` only from the reviewer App's newest record.
- A hook that crashes or times out attests, flips and merges nothing.

**Reviewer.** Hooks as the reviewer App, which can write only issues, so a record cannot touch code,
statuses or merges (GitHub). It runs the gate rule (§6).
- Hook guardrail: it refuses from the model's tool calls every write the orchestrator or a human owns
  (reviewer ADR-0012).
- It refuses builder and review work where the managed settings are not in effect, naming what is missing.

**Builder.** The model, as the session App: it writes code in `.claude/worktrees/`, commits, pushes and
opens draft PRs.
- GitHub: it cannot write a status, change a ruleset or workflow, or merge past the ruleset.
- Managed settings (§5): no key or credential read, no write to plugin code, reviewer's state or Claude
  Code config, listed hosts only for sandboxed commands (WebFetch stays allowed), no unlisted MCP server,
  no Docker.
- Hook guardrails: commit gates, the lane fence and reviewer's write refusals.

**Planner.** Under human supervision, without managed settings, as the session App: its agent acts on
GitHub with the agent credentials on its machine, never a person's. It opens spec PRs and writes no
reviewer state: reviewer's hook in the agent environment places a rescope hold when it sees the
rescope's PR open.

**Auditor.** Agents dispatched inside reviewer's rounds. They hold no key and write nothing to GitHub;
their answers count only through the gate rule.

## 5. Managed settings

The block below is the target setup. It differs from the tested one (§7) in the ways listed in §8.
`<V>` stands for the test folder and `<C>` for the session's package cache folder. In the agent environment: `<V>/keys`
is `~/.config/codeworks/`; `<V>/ghcreds` stands for every other credential (gh, git, SSH, cloud); `/tmp/verify-b-ghsess` is the session's gh config folder;
`<V>/plugin/gaterev` is the installed plugin code and data; `<V>/state` is reviewer's state folder
(`~/.local/state/codeworks/reviewer`); `allowedDomains` lists GitHub plus the registries the served repo
needs. On Linux the file is `/etc/claude-code/managed-settings.json`.

```json
{"sandbox":{"enabled":true,"failIfUnavailable":true,"allowUnsandboxedCommands":false,"excludedCommands":[],
 "filesystem":{"denyRead":["<V>/keys","<V>/ghcreds","~/.claude/.credentials.json"],
  "denyWrite":["<V>/keys","<V>/ghcreds","<V>/plugin/gaterev","<V>/state","/tmp/verify-b-ghsess","~/.claude"],
  "allowManagedReadPathsOnly":true},
 "network":{"allowedDomains":["github.com","api.github.com","*.githubusercontent.com","pypi.org","files.pythonhosted.org"],
  "allowManagedDomainsOnly":true,"strictAllowlist":true,"allowAllUnixSockets":false}},
"permissions":{"deny":["Read(/<V>/keys/**)","Edit(/<V>/keys/**)","Read(/<V>/ghcreds/**)","Edit(/<V>/ghcreds/**)",
 "Read(~/.claude/.credentials.json)","Edit(/<V>/plugin/gaterev/**)","Edit(/<V>/state/**)","Edit(//tmp/verify-b-ghsess/**)",
 "Edit(~/.claude/**)","Edit(**/.claude/settings.json)","Edit(**/.claude/settings.local.json)","Edit(**/.claude/workflows/**)",
 "Edit(**/.claude/agents/**)","Edit(**/.claude/skills/**)","Edit(**/.claude/commands/**)","Edit(**/.claude/hooks/**)",
 "Edit(**/.mcp.json)","Edit(**/.git/config)","Edit(**/.git/hooks/**)"]},
"allowedMcpServers":[],"allowManagedMcpServersOnly":true,
"allowManagedHooksOnly":true,"enabledPlugins":{"orchestrator@codeworks":true,"builder@codeworks":true,
 "reviewer@codeworks":true,"auditor@codeworks":true},
"env":{"PIP_CACHE_DIR":"<C>/pip","npm_config_cache":"<C>/npm"}}
```

`/<V>` yields `//tmp/...`, the absolute-path form permission rules need.

- `sandbox.enabled`: every Bash command runs in the OS sandbox.
- `sandbox.failIfUnavailable`: no session starts when the sandbox cannot run.
- `sandbox.allowUnsandboxedCommands: false`: the model cannot ask to run a command outside the sandbox.
- `sandbox.excludedCommands: []`: no command skips the sandbox.
- `sandbox.filesystem.denyRead`: sandboxed commands cannot read the keys, other credentials or Claude
  Code's own login.
- `sandbox.filesystem.denyWrite`: sandboxed commands cannot write the keys, credentials, plugin code,
  reviewer's state, the session's gh config or `~/.claude`.
- `sandbox.filesystem.allowManagedReadPathsOnly`: user, project and repo settings cannot reopen a denied
  path.
- `sandbox.network.allowedDomains`: sandboxed commands reach only GitHub and the listed registries. It
  does not cover WebFetch or WebSearch.
- `sandbox.network.allowManagedDomainsOnly`: lower settings cannot add a host.
- `sandbox.network.strictAllowlist`: unlisted hosts stay blocked to sandboxed commands, also under
  `bypassPermissions`; tests can set it with `--settings`.
- `sandbox.network.allowAllUnixSockets: false`: on Linux, seccomp blocks unix sockets, so a command cannot
  reach a local daemon such as Docker.
- WebFetch and WebSearch stay allowed: they run outside the sandbox and reach any host, so agents can
  check claims about third-party tools and best practice (§8).
- `permissions.deny` `Read(...)`: Claude's Read and Grep tools, which ignore the sandbox, cannot read the
  keys or credentials.
- `permissions.deny` `Edit(...)`: Claude's Edit and Write tools, which ignore the sandbox, cannot write
  those paths, plugin code, reviewer's state, `~/.claude` or the repo's Claude Code config.
  `.claude/worktrees/` stays writable for builder. Edit rules cover Write; `Write(...)` path rules are
  accepted but never checked, so the block has none.
- `allowedMcpServers: []` with `allowManagedMcpServersOnly`: no MCP server loads unless the managed file
  lists it.
- `allowManagedHooksOnly` with the codeworks plugins in `enabledPlugins`: only their hooks run. Hooks a
  served repo commits in its settings, skills or agents would otherwise run outside the sandbox with the
  user's full access, even in a folder never trusted, because a `-p` session treats every folder as
  trusted.
- `env`: package caches sit in the session's temp folder, which the sandbox lets commands write.

The session starts with `--setting-sources user` (`claude -p --setting-sources user`, or the same flag by
hand), so no repo settings file loads: a repo's `env` would otherwise reach every process Claude Code
starts, the codeworks hooks included. Managed settings always load.

Two rules live in hooks, not in the file: hooks run git with `core.fsmonitor` and `core.hooksPath` off,
and every hook that reads a key refuses unless the managed settings are present and in effect.

## 6. The review gate rule

It covers every reviewer workflow: `review-round`, `claim-check`, `shim-check`.

1. reviewer's PreToolUse hook rewrites any Workflow launch naming a reviewer workflow to that name and the
   gate's args, dropping `script`, `scriptPath` and `resumeFromRunId`, and records the launch.
2. Its PostToolUse hook records the run ID only for a recorded launch. The run is invalid if its run ID was
   seen before, or the executed script copy (`tool_response.scriptPath`) differs from the plugin's file.
3. A verdict counts only from a live `StructuredOutput` event of an agent bound to that run by its
   `agent_transcript_path`; never from task notifications, task output files, the journal or transcripts.
4. A round is CLEAN only when every expected agent answered; otherwise DIRTY or INCOMPLETE.
5. Any other workflow runs untouched, and its results never count.

reviewer records the round as the reviewer App; the orchestrator attests `internal-review` only from that
record. A run the gate did not record never counts.

## 7. What was tested

Run on Linux. The end-to-end gate tests ran on Claude Code 2.1.308 in `claude -p` sessions with the sandbox
on, `--permission-mode bypassPermissions`, the gate plugin loaded and the settings passed with `--settings`
(the managed file needs root). Two dummy reviewer agents; a dummy key stood in for the App key.
The other rows ran on 2.1.300 to 2.1.306.

| What was tested | Result |
|---|---|
| Real review, code with a bug | DIRTY |
| Real review, clean code | CLEAN; only then the hook read the key |
| Launch naming the workflow plus a `scriptPath` to a clean copy | DIRTY: the launch was rewritten, the plugin's script ran |
| Inline script that always says clean | DIRTY: rewritten to the plugin's script |
| `resumeFromRunId` of an old clean run, after adding a bug | DIRTY: a new run with live reviewers |
| Genuine and lookalike workflow launched back to back | DIRTY: both rewritten to genuine runs |
| Same-named workflow created during the session | Creation denied (Write tool, Bash) |
| Same-named workflow already committed in the branch | It ran instead of the plugin's; the gate, checking the executed script's hash, ruled the run invalid (fails closed) |
| Same-named agent committed in the branch | The plugin's agent ran |
| Messaging a running workflow agent | Not possible |
| A plain subagent told to answer clean | Not counted: not bound to a run |
| Faked CLEAN written to the workflow's task output file | Write succeeded; the gate never reads it |
| Edits to plugin script, agent, hooks, hash pin, gate state (11 Bash, 2 Edit, 3 Write) | All denied; files unchanged |
| A hook added to the repo's settings (Write tool, Bash, python, symlink) | All denied |
| Reading the key: `cat`, python, `cp`, `ls`, Read tool | All denied |
| Deny rules under `bypassPermissions` | Held in every test above |
| Sandboxed reads of a denied file via `dd`, `tar`, `gpg`, a symlink, a hardlink or a subagent | Blocked |
| Read and Grep tools on a path only the sandbox denies | Not blocked: only a `permissions.deny` Read rule blocks them |
| Edit and Write tools on a path only the sandbox write-denies | Not blocked: only a `permissions.deny` Edit rule blocks them |
| A background process started by a sandboxed Bash call | Dies when that call ends |
| Hooks reading denied paths | Hooks run outside the sandbox and read them |
| A Stop hook's block in a `claude -p` session | The session keeps going with the named step |
| Trusting a workflow's final result or notification | Forgeable by replaying the journal (reviewer ADR-0021) |

## 8. Known limits and open items

- **Not covered by the tests in §7**, which used a stricter setup:
  - write deny on every `.claude/` folder, where §5 denies only the listed paths so builder's
    `.claude/worktrees/` stays writable;
  - Read deny on all of `~/.claude`, where §5 denies only Claude Code's login file;
  - the gate rewriting every Workflow launch, where §6 rewrites only reviewer workflows and lets other
    results never count;
  - the network and MCP allowlists, unix-socket blocking and `allowManagedReadPathsOnly`;
  - hooks running git with `core.fsmonitor` and `core.hooksPath` off;
  - `allowManagedHooksOnly` with `enabledPlugins`, and `--setting-sources user` (Claude Code docs only).
- **Managed-only keys** (`allowManagedReadPathsOnly`, `allowManagedDomainsOnly`,
  `allowManagedMcpServersOnly`) do nothing under `--settings`; only an installed managed file tests them.
- **Wildcard Edit rules on Linux** never reach the sandbox's write-deny list; Bash writes to those files
  rely on the sandbox's built-in protected paths (docs, not tested).
- **Prompt injection through the code under review:** code, comments, issues and findings are untrusted
  and reach builder's model and reviewer's agents. The settings bound what a steered model can do; they do
  not stop injected text swaying a reviewer agent's verdict. Each external reviewer's required review
  (for example Codex's) is a second reading.
- **WebFetch (accepted risk):** an injected prompt can make the model send what it reads, private source
  and the one-hour session token included, to any host through WebFetch. The merge boundary (§1) holds:
  the token cannot merge past the ruleset.
- **E2:** whether the session App can delete a reviewer comment is untested. If it can, the hold stays:
  GitHub records the deletion of another account's comment on the issue timeline, which no token can
  remove, and the state reader holds the story (reviewer ADR-0011 d2). That GitHub records it is from
  GitHub's docs; tested only that an author deleting its own comment records nothing, and reviewer
  never deletes its own.
- **Open:** how the orchestrator waits on CI and external reviewers (its spec); how core's installer
  fetches the private repo in an environment with no credential (moot once the repo is public); how the
  decision-reviewer reads a private org log with a one-repo token.
- **Claude Code upgrades:** every result in §7 holds only for the versions tested. Pin the version in the
  agent environment and re-run these tests before moving to a new one.

## 9. Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability").
Do not open a public issue.
