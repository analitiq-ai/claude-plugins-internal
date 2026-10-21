# Data model: on/off switch

## Session switch — `sessions/<session_id>.off.json` (R1)

The file exists while the plugin is off in that session. No file means on (FR-012).

| Field | Meaning |
|---|---|
| `at` | when the user turned the plugin off, as `ledger.stamp` writes it |
| `by` | the first line of the prompt that did it, at most 200 characters |

Written and deleted only by the prompt handler. A file that is not this shape is `unreadable`: it counts as on
and is reported (R8). Both fields are required, both strings; nothing else is allowed.
`session_id` must match `[\w-]+`; a session whose id does not holds no state.

## Switch change — one `gate.log` line (R6)

| Field | Value |
|---|---|
| `action` | `switch` |
| `decision` | `off` · `on` · `unchanged` (already in that state) · `unknown` (a word after the keyword) |
| `reason` | the first line of the user's prompt, at most 200 characters |
| `session`, `at` | as every `gate.log` line |

No other record changes. `ledger.db` is not touched by the switch.
