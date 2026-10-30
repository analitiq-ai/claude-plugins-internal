# Contract: reviewer's hooks

All entries `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.ts`, `onFailure: block`. Every entry first runs the claim
step (R9), then its own work. Every refusal is from [refusals.md](refusals.md).

| event / matcher | file | work |
|---|---|---|
| PreToolUse `Edit\|Write\|NotebookEdit\|Bash\|Agent\|Skill\|Workflow\|StructuredOutput\|WebFetch` | `pre-tool-use.ts` | refuse writes to the state folder; story-branch `spec.md` edit; round launch gate (reads state: cap, holds); claim/shim workflow launch rewrite (ADR-0021 d1); output validation; record HEAD before Bash |
| PreToolUse `Read\|Glob\|Grep` | `pre-tool-use.ts` | sweeper read confinement |
| PostToolUse `Bash` | `post-tool-use.ts` | after-commit check (R10): fetch, fence, structural steps |
| PostToolUse `StructuredOutput` | `post-tool-use.ts` | record round reports/assessments → `writeState` / `placeHold`; claim/shim results → gates + pass record |
| SubagentStart / SubagentStop | `subagent.ts` | in-flight reviewer tracking |
| UserPromptSubmit | `user-prompt-submit.ts` | `reviewer on` / `reviewer off` only; writes `off` via core `setReviewerOff` |
| SessionStart `resume\|compact` | `session-start.ts` | off-switch notice |

Removed: `unlock …`, `override shim-…`, `pre_merge_gate.py` Bash/prompt hooks, ledger inbox ingest.

Inputs read per run: hook JSON (`session_id`, `cwd`, tool input); `codeworks.toml`; session record (#174);
state/gates through core (≤1 read each); session folder.
