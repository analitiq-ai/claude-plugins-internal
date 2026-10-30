# Contract: the orchestrator's hooks

`orchestrator/plugin/hooks/hooks.json`. Every command is `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.ts`, and every
entry file imports `../lib/guarded.ts` before anything else. A missing core package: exit 2,
`core dependency <name> is not installed in <folder>` on stderr, nothing else done (FR-002).

| Event | Matcher | File | Timeout | onFailure | Story |
|---|---|---|---|---|---|
| SessionStart | — | `session-start.ts` | 60 | block | 1 |
| UserPromptSubmit | — | `prompt.ts` | 120 | block | 1 |
| PreToolUse | `Bash` | `pre-tool-use.ts` | 60 | block | 1 |
| Stop | — | `stop.ts` | 3900 | (none: fails open) | 2–5 |

## Input (stdin JSON; fields read, each validated)

| Field | Events | Rule |
|---|---|---|
| `session_id` | all | UUID; names the record file |
| `cwd` | all | absolute path; the checkout |
| `hook_event_name` | all | equals the event the file serves |
| `prompt` | UserPromptSubmit | matched against `^/codeworks ([1-9][0-9]*)$` (R20) |
| `tool_name` | PreToolUse | `Bash` |
| `background_tasks` | Stop | array of `{type, status}`; a running `workflow` entry means no push and no step; absent → Blocked naming it (FR-016b) |

## Output

- **Refusal** (every hook but Stop): exit 2, one stderr line `orchestrator: <reason>`; the reason names the next
  legal step where one exists.
- **Context** (UserPromptSubmit on start or resume): exit 0, stdout
  `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"[orchestrator] <s> <claimed|resumed>: run builder:issue-tackle <s>"}}`.
- **Next step** (Stop, Story 2): exit 2 with the step on stderr, refusing the stop; exit 0 lets it end.
- **Crash**: Stop exits 1 (fails open, ADR-0001 d5); the others exit non-zero and `onFailure: block` holds.

## Per-hook behaviour (Story 1)

- **SessionStart**: `ensureSessionToken`. On failure: `postKeyed(status_issue, "session-start-<cause>")` and exit
  0 (it cannot block).
- **PreToolUse (Bash)**: `ensureSessionToken`; refuse on failure naming core's cause.
- **UserPromptSubmit**: `ensureSessionToken`; then, for a `/codeworks <s>` prompt: with a record naming another
  issue, refuse naming it; with a record naming `<s>`, emit the resume context without re-deciding (US1 #8 is
  idempotent); otherwise read the facts, `decideStart`, write as data-model.md orders, emit context or refuse. A
  prompt that does not match the grammar but starts `/codeworks` is refused naming the grammar; any other
  prompt passes after the mint.
