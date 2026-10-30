# Quickstart: validating the orchestrator plugin

Shapes are in [contracts/](contracts/); decisions in [research.md](research.md).

## Prerequisites

- Node ≥ 22.18; `npm ci` in `core/`, `orchestrator/plugin/` and `orchestrator/`.
- The core PRs M and C1–C4 merged (plan: Delivery order).

## 1. Carrier check (US1 #1–#2, SC-001)

```bash
node core/scripts/check-carriers.ts --base origin/main
```

Expected: `2 carriers checked against origin/main, 0 failures` (planner and orchestrator). A branch changing
`core/src` without bumping `orchestrator/plugin/.claude-plugin/plugin.json` fails naming that file.

```bash
jq -e '.plugins[] | select(.name=="orchestrator" and .source=="./orchestrator/plugin")' .claude-plugin/marketplace.json
```

## 2. Test suite (FR-005)

```bash
(cd orchestrator && npm test)
```

Covers: guard exit 2 naming the package (US1 #3), no import outside `core/` (FR-003), mint and refresh against
the fake GitHub (US1 #4–#6), every `decideStart` row (US1 #7–#13), record write-once and ordering after the lane
write (US1 #14 / FR-015).

## 3. A hook by hand (fake input)

```bash
printf '{"hook_event_name":"UserPromptSubmit","session_id":"%s","cwd":"%s","prompt":"/codeworks 212"}' \
  "$(uuidgen)" "$PWD" | node orchestrator/plugin/hooks/prompt.ts; echo "exit $?"
```

Off the agent machine this exits 2 naming the managed-settings check from core's key reader: no key is read
without managed settings in effect.

## 4. On the agent machine (US1 end to end)

1. Install the plugin outside a session; confirm `orchestrator/plugin/node_modules` holds core's packages.
2. Start: `claude --setting-sources "" --permission-mode bypassPermissions -p "/codeworks <s>"` for a Ready story
   with a merged spec PR, no blocker, no hold.
3. Check:
   - `~/.local/state/codeworks/orchestrator/gh/codeworks-token.json` names the repository, expiry ≤ 1 h ahead;
   - `GH_CONFIG_DIR=… gh api /installation/repositories` lists the one repository;
   - the card is In progress, moved by `codeworks-orchestrator[bot]`;
   - `sessions/<session id>.json` holds `"taken": "claim"` and `<s>`.
4. Send `/codeworks <other>`: refused naming `<s>`.

R20's first task runs step 2 with a hook that logs its input, to fix the prompt fixture before any claim code.
