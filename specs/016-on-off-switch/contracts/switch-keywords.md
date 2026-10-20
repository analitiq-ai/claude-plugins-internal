# Contract: the switch keyword and what off stops

## What the user types

The keyword starts a prompt the user typed (leading whitespace ignored), as `unlock` does.

```
alq-review off
alq-review on
```

The keyword is the prompt's first line, in lower case as written here. Another word after it on that line
changes nothing and is answered with the two forms (FR-010). Later lines are the rest of the prompt.

## What the user and the agent are told

Each answer is shown to the user (`systemMessage`) and given to the agent (`additionalContext`).

| Typed | Answer |
|---|---|
| `alq-review off` | `alq-review is off for this session. It stays off until the user types alq-review on. Its workflows do not run; carry on without them.` |
| `alq-review on` | `alq-review is on again. Its rules apply from where its records stand.` |
| no change | `alq-review was already off.` / `... already on.` |
| a further word | `"<line>" is not a switch, so nothing changed. Type alq-review off or alq-review on.` |

## What off stops

| Hook event | While off |
|---|---|
| UserPromptSubmit: `unlock`, `override`, `override-merge`, the switch keyword | runs |
| SubagentStart / SubagentStop bookkeeping | runs |
| Sweeper and contest-judge confinement (Read, Glob, Grep, WebFetch) | runs |
| Edit, Write, NotebookEdit rules | stopped |
| Bash rules: commit (claim and shim), push, re-request, ready, attestation comment, `ledger.py unlock`, branch watch before and after | stopped |
| `pre_merge_gate.py`: attestation for ready and merge, `--admin`, `gh api` merge | stopped |
| Agent and Skill dispatch rules | stopped |
| Launch of `review-round`, `assess-round`, `claim-check`, `shim-check` | answered: off |
| StructuredOutput of the plugin's agents (validation and recording) | stopped |
| Inbox ingestion | stopped |

"Answered: off" is a refusal of the launch that reads
`alq-review is off for this session, so <workflow> does not run. Carry on without it. Only the user turns it on, with alq-review on; do not ask them to.`
It is given in `log` mode too: a workflow whose arguments the gate did not supply cannot run.

## Session start

When a session resumes while off, the user is told `alq-review is off in this session.` before the first
prompt (FR-009). After a compaction the agent is given the same line.
