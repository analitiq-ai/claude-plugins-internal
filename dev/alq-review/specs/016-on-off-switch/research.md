# Research: on/off switch for alq-review

Read for this: `plugins/alq-review/scripts/{gate,hookio,claimgate,shimgate,policy,pre_merge_gate,sweeper_read}.py`,
`workflows/*.js`, `hooks/hooks.json`, the README.

## R1: The switch is the session's own state file

- **Decision**: `sessions/<session_id>.off.json` holding `{"at": <stamp>, "by": <the user's first line>}`. The
  file's presence is the off state; the prompt handler creates and deletes it. `hookio.session_file` validates
  the id against `[\w-]+` before building any path, for every caller.
- **Rationale**: the user chose session scope. Hook payloads of a session's subagents and workflow agents carry
  its `session_id` (the gate already ties rounds and reviewer outputs to it), so they are covered with nothing
  extra. Presence as the state means no file is ever written for a session that types no keyword, and the read
  is one `stat` and one small read per hook event.
- **Existing tools**: `hookio.session_file`: the per-session path; used. `hookio.session_state`: takes a lock
  and writes the file back on every use, which would create a file per session and a write per tool call; not
  used for the read. `config.json` and `ALQ_REVIEW_MODE`: plugin-wide or process-wide, not per session.
  `ledger.db`: keyed by repo and PR. `pre_merge_gate.SESSION_ID`: the same id check for that script's own state
  folder; it stays where it is, since that folder is not this feature's.

## R2: One function says whether the plugin is off, asked at the two hook entry points

- **Decision**: `hookio.switch_state(payload)` returns `on`, `off` or `unreadable`. `gate.handle` asks it once
  per event, before it dispatches; `pre_merge_gate.main` asks it before gating. Only `off` stops anything. No
  handler, rule or workflow asks it.
- **Rationale**: asking at the entry, not inside `hookio.refuse`, is what makes off mean "no rule judges": no
  git, GitHub or Jev call is made. Two callers of one function keep the two hook scripts agreeing.
- **Existing tools**: `hookio.refuse`: decides after a rule has judged, so it cannot stop the judging; not
  used. `pre_merge_gate.py` already imports alq-review's `github.py` from the same checkout, so importing
  `hookio` there follows its own pattern.

## R3: The keyword is `alq-review off` / `alq-review on`, anchored at the start of a user's prompt

- **Decision**: `alq-review\s+(on|off)\b` matched at the prompt's start; a further word on that line changes
  nothing and is answered with the two valid forms. The first task fires a keyword through each route by which
  Claude Code delivers text an agent chose (a `ScheduleWakeup` prompt, a cron prompt, a message from another
  session) and records here whether `UserPromptSubmit` runs and what its payload carries.
- **Rationale**: starting with the plugin's name keeps an ordinary prompt from being read as a switch and
  leaves room for a name after it later. The measurement is not a gate on this feature: an agent that would
  schedule a false prompt can already write the state file with a shell command (R8), and `unlock` has the same
  exposure. It is done so the exposure is known, not guessed.
- **Existing tools**: `gate.UNLOCK`, `shimgate.OVERRIDE`, `pre_merge_gate.OVERRIDE`: patterns anchored by
  `match()` on the stripped prompt; the same anchoring is used. A command the user runs with `!`: looked at
  after the critique and not used, because an agent can run the same command through its shell tool and the
  gate could only refuse it by recognising its words.
- **Measured**: not measured. Each of the three routes needs a long-lived interactive session with a throwaway
  hook registered, which the agents that built this feature could not hold. The exposure stays unknown, as
  written above; it does not gate the feature.

## R4: What keeps running while off

- **Decision**: with the plugin off, `gate.handle` still runs the prompt handler, the subagent bookkeeping
  and the contest judge's fetch confinement; `sweeper_read.py` is untouched; `pre_merge_gate.py` still records
  an `override-merge` grant. Every other PreToolUse and PostToolUse handler, and all of `pre_merge_gate.py`'s
  gating, is skipped. A launch of one of the plugin's four workflows is denied with the answer in the contract.
- **Rationale**: the user's keywords must work while off, or off could not be left (FR-016). Bookkeeping of
  reviewers already running must go on, or the count is wrong for up to `INFLIGHT_TTL` after the plugin is on
  again. Confinement binds the plugin's own agents, not the session's work (FR-015). A run cut off by the
  switch is left as it is: each check already restarts a run that died (`policy.launch_round`'s dead run, the
  claim check's relaunch, 006 R13).
- **Existing tools**: the workflows' own `REFUSED: the gate hook did not supply this check` answer, which an
  un-injected launch returns today: it does not say why or what to do next, and an agent following the org's
  rule files would stop on it, so the gate answers the launch itself. The dead-run paths: reused unchanged.

## R5: Off is not a third value of the `log` / `enforce` settings

- **Decision**: `mode` and the three per-check settings keep two values. The switch is asked before any of
  them is read.
- **Rationale**: FR-013. Those settings are plugin-wide and say what a refusal does; the switch is per session
  and says whether rules run.
- **Existing tools**: `hookio._setting`: validates `log` or `enforce`; left as is.

## R6: A change is recorded in `gate.log` and told to both readers

- **Decision**: one `hookio.record(payload, "switch", <off|on|unchanged|unknown>, <first line of the prompt>)`
  per keyword. The answer goes out as `systemMessage` (the user) and `additionalContext` (the agent) in one
  hook output.
- **Rationale**: FR-007, FR-008. `gate.log` already carries time and session on every line.
- **Existing tools**: `hookio.record`: fits. The `unlock` answer's `additionalContext`: reaches only the
  agent, so `systemMessage`, which `gate._report` already uses, is added for the user. Both together are
  documented for `UserPromptSubmit` (code.claude.com/docs/en/hooks, checked 2026-10-07, CLI 2.1.292).

## R7: A resumed or compacted session says it is off

- **Decision**: a `SessionStart` hook with matcher `resume|compact` runs `gate.py`; when the session is off
  it answers with a `systemMessage` (on resume) and `additionalContext`. A task measures, on the installed
  CLI, whether a resumed session keeps its `session_id`. If it does not, the switch already ends at resume, the
  hook is built for `compact` only, and the spec's "the same session resumed is the same session" is amended;
  nothing carries a switch across ids.
- **Rationale**: FR-009. The hooks reference documents `source` as `startup`, `resume`, `clear`, `compact` or
  `fork`, a matcher on it, and both output fields for `SessionStart`. It does not say whether `session_id`
  survives a resume, so that is measured, not assumed.
- **Existing tools**: the `SessionStart` event: fits, pending the measurement. A reminder on every prompt
  while off: rejected, noise the user learns to skip. No hook of the plugin is registered for `SessionStart`
  today (`hooks/hooks.json`).
- **Measured** (2026-10-07, CLI 2.1.292, headless `claude -p`): a session resumed with `--resume <id>` or
  `--continue` carries the same `session_id` in its hook payloads as the run that opened it, and its
  `SessionStart` arrives with `source` `resume` (`startup` on the first run). With this plugin loaded, a session
  switched off and then resumed was answered `alq-review is off in this session.` So the hook is built for both
  `resume` and `compact`, and the spec stands. Not measured: an interactive `/resume`, and `compact`, which has
  no headless trigger.

## R8: A switch file that cannot be read counts as on; state written by a shell command stays unguarded

- **Decision**: `switch_state` returns `unreadable` when the file exists but is not the shape in
  `data-model.md`, and writes the failure to `errors.log`; every caller treats it as on. The prompt handler and
  the session-start handler add a `systemMessage` saying the switch could not be read and the plugin counts as
  on. `alq-review off` rewrites the file and `alq-review on` deletes it, so either keyword repairs it. Nothing is added against a Bash command that writes the file:
  `gate.on_edit` already refuses Edit and Write under the state root, and that is all the gate recognises.
- **Rationale**: FR-011; the failure direction is towards the rules applying. Principle III asks the plan to
  say where the layer cannot meet the spec: the shell route already reaches `ledger.db` and the merge
  overrides, and `ALQ_REVIEW_MODE=log` disarms the gate outright, so the switch adds no new way in. The real
  fix is state an agent cannot write, which is its own feature; FR-003 is worded to what can be held.
- **Existing tools**: `gate.main`'s crash path (`errors.log` plus a `systemMessage`): the same two outlets.
  `shell.classify`: recognises `ledger.py unlock` by its words; a rule per way of writing a file is the
  special-case pile it would become. None fit for the shell route. Looked at: `gate.on_edit`, `shell.py`,
  `pre_merge_gate._overrides`.
