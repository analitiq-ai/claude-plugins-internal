# Contract: the session's gh config folder

Readers: the model's `gh` and git (through `GH_CONFIG_DIR`), reviewer and builder. Writer: the orchestrator's
hooks alone, through core's `writeGhToken`.

- **Path**: `~/.local/state/codeworks/orchestrator/gh/` (one per agent machine). Mode 0700; files 0600; each file
  replaced whole by rename.
- **Files**: core's gh-config format, unchanged (`core/src/gh-config.ts`):
  - `hosts.yml`: `github.com: {oauth_token, user: <[shared] session_app_login>, git_protocol: https}`; gh may add
    a `users` map.
  - `codeworks-token.json`: `{"repo": "<owner>/<name>", "expires_at": "<ISO datetime>"}`, strict.
- **Token**: `codeworks-session`, one repository (the checkout's origin), exactly `APP_PERMISSIONS.session`,
  ≤ 1 hour.
- **Refresh**: minted when `needsMint` holds: no token, another repository, or under 10 minutes left.
- **Environment**: the managed settings set `GH_CONFIG_DIR` to this path and none of `GH_TOKEN_VARIABLES`; the
  folder and its parent are write-denied to the model (Edit deny and sandbox `denyWrite`).
- **Refusal**: one file without the other, or a file that does not parse, is `GhFolderRefused` and never
  repaired; the hook refuses naming it.
