# Contract: planner's hook

`planner/plugin/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/token.ts", "onFailure": "block" }] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/token.ts", "onFailure": "block" }] }
    ]
  }
}
```

`token.ts`, in order (US1 ships steps 1 and 6 only; US2 adds 2–5):

1. Import only `../lib/guarded.ts` statically. A missing package: stderr
   `core dependency <name> is not installed in <root>`, exit 2.
2. Read `hook_event_name` and `cwd` from stdin JSON (validated).
3. `codeworks.toml` at `cwd`'s `HEAD`: `[shared]` by core, `[planner]` by planner. Refused: stderr
   `<where>: <why>`, exit 2.
4. Repository from origin (R8). No origin or not GitHub: stderr names the remote, exit 2.
5. `<folder>` is `ghFolder(repo)` (R6). When `needsMint`: `mintToken("planner", app_id, "planner-app.pem",
   "planner", repo)`, then `writeGhToken`.
   `KeyReadRefused` / `MintError` / `GitHubRefused` / `GitHubUnanswered`: stderr with core's message, exit 2.
6. On `SessionStart` only: append to `$CLAUDE_ENV_FILE` (unset: stderr names it, exit 2):
   `export GH_CONFIG_DIR='<folder>'` and `unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN`.
   Exit 0, stdout empty.

The token's value is never written to stdout, stderr or an error message.
