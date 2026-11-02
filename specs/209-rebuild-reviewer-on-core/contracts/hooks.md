# Contract: reviewer's hooks

All entries `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.ts`, `onFailure: block`. Every entry first runs the claim
step (R9), then its own work. Every refusal is from [refusals.md](refusals.md).

| event / matcher | file | work |
|---|---|---|
| PreToolUse `Edit\|Write\|NotebookEdit\|Bash\|Agent\|Skill\|Workflow\|StructuredOutput\|WebFetch` | `pre-tool-use.ts` | refuse writes to `codeworks.toml` and the state folder (ADR-0012 d1); story-branch `spec.md` edit; round launch gate (holds, lane, switch; ADR-0013 d4, ADR-0015 d3, ADR-0006 d4); `review-round`/`claim-check`/`shim-check` launch rewrite (ADR-0021 d1); output validation |
| PreToolUse `Read\|Glob\|Grep` | `pre-tool-use.ts` | sweeper read confinement |
| PostToolUse `Bash` | `post-tool-use.ts` | fetch the clone's HEAD into the bare copy, compare (ADR-0020 d2); after-commit check (R10): fence, structural steps |
| PostToolUse `Workflow` | `post-tool-use.ts` | record a recorded launch's run ID; invalid when seen before or `scriptPath` differs (ADR-0021 d2) |
| PostToolUse `StructuredOutput` | `post-tool-use.ts` | record round reports/assessments → `writeState` / `placeHold`; claim/shim results → `recordGates` + pass record |
| SubagentStart / SubagentStop | `subagent.ts` | in-flight reviewer tracking |
| UserPromptSubmit | `user-prompt-submit.ts` | `reviewer on` / `reviewer off` only; writes `off` via core `setReviewerOff` |
| SessionStart `resume\|compact` | `session-start.ts` | off-switch notice |

Removed: `unlock …`, `override shim-…`, `pre_merge_gate.py` Bash/prompt hooks, ledger inbox ingest.

Inputs read per run: hook JSON (`session_id`, `cwd`, tool input); `codeworks.toml`; session record (#174);
state (gates section included) through core (≤1 read); session folder.
