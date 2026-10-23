# Contract: key files and the managed-settings gate

R23, R24; FR-026a, FR-035 to FR-038.

## Files in `~/.config/codeworks/`

| File | Read by | Managed settings checked |
|---|---|---|
| `session-app.pem` | the orchestrator's hook (agent environment); reviewer's hook where planner runs | yes for the orchestrator; no for reviewer (root ADR-0008 d2, d9) |
| `reviewer-app.pem` | reviewer's hook | yes |
| `deepsource-token` | the DeepSource module, `api` source, in a hook | yes |
| the orchestrator App's key | the orchestrator's hooks; its name is the orchestrator's spec | yes |

Every file: owned by the current user, no group or other permission bit, else refused naming the mode.

## Managed settings in effect (Linux)

`/etc/claude-code/managed-settings.json` exists; it and `/etc/claude-code/` are owned by root and not writable by
group or other; it parses as JSON; and it holds each of the following, where `<K>` is `~/.config/codeworks` and
`<S>` is reviewer's state folder `~/.local/state/codeworks/reviewer`, each written so or as the absolute path:

| Setting | Required value |
|---|---|
| `sandbox.enabled` | `true` |
| `sandbox.failIfUnavailable` | `true` |
| `sandbox.allowUnsandboxedCommands` | `false` |
| `sandbox.excludedCommands` | `[]` |
| `sandbox.filesystem.denyRead` | contains `<K>` and `~/.claude/.credentials.json` |
| `sandbox.filesystem.denyWrite` | contains `<K>`, `<S>` and `~/.claude` |
| `sandbox.filesystem.allowManagedReadPathsOnly` | `true` |
| `sandbox.network.allowManagedDomainsOnly` | `true` |
| `sandbox.network.strictAllowlist` | `true` |
| `sandbox.network.allowAllUnixSockets` | `false` |
| `permissions.deny` | contains `Read(<K>/**)`, `Edit(<K>/**)` and `Edit(<S>/**)`, the absolute form written `//…`; `Read(~/.claude/.credentials.json)`, `Edit(~/.claude/**)`; `Edit(**/.claude/settings.json)`, `Edit(**/.claude/settings.local.json)`, `Edit(**/.claude/workflows/**)`, `Edit(**/.claude/agents/**)`, `Edit(**/.claude/skills/**)`, `Edit(**/.claude/commands/**)`, `Edit(**/.claude/hooks/**)`, `Edit(**/.mcp.json)`, `Edit(**/.git/config)`, `Edit(**/.git/hooks/**)` |
| `allowedMcpServers` | `[]` |
| `allowManagedMcpServersOnly` | `true` |
| `allowManagedHooksOnly` | `true` |
| `enabledPlugins["<plugin>@codeworks"]` | `true` |

These are the values `SECURITY.md` §5 fixes, `<V>/keys` and `<V>/state` read as `<K>` and `<S>`, except the ones
standing for a per-environment path (`<V>/ghcreds`, the plugin and gh config folders, `<C>`) or listing the
served repo's registries (`allowedDomains`). A test parses §5's JSON block and fails when one of its entries is in
neither this table nor that list of exceptions. A refusal names every missing or different setting. On a platform
other than Linux a checked read is refused naming the platform (§5 names only the Linux path).

## App permission sets (FR-035)

GitHub's API keys, pinned to `SECURITY.md` §3 by a test that maps §3's names to them ("projects" →
`organization_projects`).

| App | Permissions |
|---|---|
| session | `contents`, `pull_requests`, `issues`: write; `metadata`, `checks`, `statuses`, `actions`: read; `organization_projects`: read |
| orchestrator | `contents`, `pull_requests`, `issues`, `statuses`: write; `checks`: read; `organization_projects`: write |
| reviewer | `issues`: write |

A token request names one repository and these permissions. An answer is refused when it names another
repository, lacks or lowers a requested permission, or adds any but `metadata: read` (R24).
