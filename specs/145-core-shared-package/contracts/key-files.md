# Contract: key files and the managed-settings gate

R18, R23, R24; FR-022, FR-035 to FR-038.

## Files in `~/.config/codeworks/`

| File | Read by | Where | Managed settings checked |
|---|---|---|---|
| `session-app.pem` | the orchestrator's SessionStart hook | agent machine | yes |
| `reviewer-app.pem` | reviewer's hook | agent machine | yes |
| `planner-app.pem` | planner's hook | admin machine | no: the one exempt read (root ADR-0008 d2, d9) |
| a validator package's token, named by its package | its module in a hook, through `deps.readKey` (R18) | agent machine | yes |
| the orchestrator App's key | the orchestrator's hooks; its name is the orchestrator's spec | agent machine | yes |

Every file: a bare file name in that folder, owned by the current user, no group or other permission bit, else
refused naming the cause.

## Managed settings in effect (Linux)

`/etc/claude-code/managed-settings.json` exists; it and `/etc/claude-code/` are owned by root and not writable by
group or other; it is the one source: neither `/etc/claude-code/managed-settings.d` nor
`~/.claude/remote-settings.json` exists (root ADR-0008 d9); it parses as JSON; and it holds each of the following, where `<K>` is `~/.config/codeworks` and
`<S>` is reviewer's state folder `~/.local/state/codeworks/reviewer`, each written so or as the absolute path:

| Setting | Required value |
|---|---|
| `sandbox.enabled` | `true` |
| `sandbox.failIfUnavailable` | `true` |
| `sandbox.allowUnsandboxedCommands` | `false` |
| `sandbox.excludedCommands` | `[]` |
| `sandbox.filesystem.denyRead` | contains `<K>` and `~/.claude/.credentials.json` |
| `sandbox.filesystem.denyWrite` | contains `<K>`, `<S>`, `~/.claude` and `~/.gitconfig` |
| `sandbox.filesystem.allowManagedReadPathsOnly` | `true` |
| `sandbox.network.allowManagedDomainsOnly` | `true` |
| `sandbox.network.strictAllowlist` | `true` |
| `sandbox.network.allowAllUnixSockets` | `false` |
| `permissions.deny` | contains `TaskStop`; `Read(<K>/**)`, `Edit(<K>/**)` and `Edit(<S>/**)`, the absolute form written `//…`; `Read(~/.claude/.credentials.json)`, `Edit(~/.claude/**)`, `Edit(~/.gitconfig)`; `Edit(**/.claude/settings.json)`, `Edit(**/.claude/settings.local.json)`, `Edit(**/.claude/workflows/**)`, `Edit(**/.claude/agents/**)`, `Edit(**/.claude/skills/**)`, `Edit(**/.claude/commands/**)`, `Edit(**/.claude/hooks/**)`, `Edit(**/.mcp.json)`, `Edit(**/.git/config)`, `Edit(**/.git/hooks/**)` |
| `allowedMcpServers` | `[]` |
| `allowManagedMcpServersOnly` | `true` |
| `allowManagedHooksOnly` | `true` |
| `enabledPlugins["<plugin>@codeworks"]` | `true` |
| `enabledPlugins` | no entry `true` but those §5 lists |

These are the values `SECURITY.md` §5 fixes, `<V>/keys` and `<V>/state` read as `<K>` and `<S>`, except the ones
standing for a per-environment path (`<V>/ghcreds`, `<V>/plugin/gaterev`, the session's gh config folder, `<C>` and
the `env` entries under it) or listing the served repo's registries (`allowedDomains`); §5's `enabledPlugins`
entries are the list the last row allows. A test parses §5's JSON block and fails when one of its entries is in neither this table
nor that list of exceptions. A refusal names every missing or different setting and every second source. On a platform other than Linux a
checked read is refused naming the platform (§5 names only the Linux path).

## App permission sets (FR-035)

GitHub's API keys, pinned to `SECURITY.md` §3 by a test that maps §3's names to them ("projects" →
`organization_projects`).

| App | Permissions |
|---|---|
| session | `metadata`, `contents`, `pull_requests`, `issues`, `checks`, `statuses`, `actions`: read; `organization_projects`: read |
| orchestrator | `contents`, `pull_requests`, `issues`, `checks`, `workflows`: write; `organization_projects`: write |
| reviewer | `issues`: write |
| planner | `contents`, `pull_requests`, `issues`: write; `organization_projects`: read |

A token request names one repository and these permissions. An answer is refused when it names another
repository, lacks or lowers a requested permission, or adds any but `metadata: read` (R24).
