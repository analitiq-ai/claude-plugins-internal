# Contract: reviewer's hooks

All entries `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.ts`, `onFailure: block`. Every entry that gates a commit, a
round launch or a state write (PostToolUse `Bash`, `Workflow`, `StructuredOutput`; PreToolUse launches) first runs
the claim step (R12), then its own work; `Read|Glob|Grep`, UserPromptSubmit, Subagent* and SessionStart entries
skip it. Every refusal is from [refusals.md](refusals.md). No entry posts to an issue or PR
(FR-023); every state write goes through core's writes ([ledger-record.md](ledger-record.md#writes)).

| event / matcher | file | work |
|---|---|---|
| PreToolUse `Edit\|Write\|NotebookEdit\|Bash\|Agent\|Skill\|Workflow\|StructuredOutput\|WebFetch` | `pre-tool-use.ts` | refuse writes to `codeworks.toml` and the state folder (ADR-0012 d1); story-branch `spec.md` edit; round launch gate (holds and tampers, lane, switch; ADR-0013 d1, d4, ADR-0015 d3, ADR-0006 d4); `review-round`/`claim-check`/`shim-check` launch rewrite (ADR-0021 d1); output validation |
| PreToolUse `Read\|Glob\|Grep` | `pre-tool-use.ts` | sweeper read confinement |
| PostToolUse `Bash` | `post-tool-use.ts` | fetch the clone's HEAD into the bare copy, compare (ADR-0020 d2); after-commit check (R13): fence, structural steps |
| PostToolUse `Workflow` | `post-tool-use.ts` | record a recorded launch's run ID; invalid when seen before or `scriptPath` differs (ADR-0021 d2) |
| PostToolUse `StructuredOutput` | `post-tool-use.ts` | record round reports/assessments → one `writeState` (round named by its run, the holds it places as `placements`), a spec PR seen open → `placeRescopeHold`; claim/shim results → `recordGates` + pass record |
| SubagentStart / SubagentStop | `subagent.ts` | in-flight reviewer tracking |
| UserPromptSubmit | `user-prompt-submit.ts` | `reviewer on` / `reviewer off` only; writes `off` via core `setReviewerOff` |
| SessionStart `resume\|compact` | `session-start.ts` | off-switch notice |

Removed: `unlock …`, `override shim-…`, `pre_merge_gate.py` Bash/prompt hooks, ledger inbox ingest.

Inputs read per run: hook JSON (`session_id`, `cwd`, tool input); `codeworks.toml`; session record (#174); state
through `readState` once, then the reading each write returns; on `StateStale` the directory's path history
from the new head, then a fresh read only when it moved (≤3 attempts, R3); session folder.
