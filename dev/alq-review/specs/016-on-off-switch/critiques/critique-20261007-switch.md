# Critique Report: On/off switch for alq-review and its two commit checks

**Date**: 2026-10-07
**Feature**: [spec.md](../spec.md)
**Plan**: [plan.md](../plan.md)
**Verdict**: ⚠️ PROCEED WITH UPDATES

Written by the same session that wrote the spec and plan, so it is not an independent read. Findings marked
"checked" were checked against the code; the rest are reasoning.

---

## Executive Summary

The switch itself is small and well placed: one per-session file, one pure rule, asked at the two hook entry
points. Three things need settling before tasks. First, "everything off" as planned also lifts the refusal of
`gh pr merge --admin` and of merging through `gh api`, which guard the server's rules (CI, threads, approval),
not alq-review's; that was never put to the user. Second, the keyword is only as safe as "the user typed it",
and Claude Code has routes by which an agent's own text can arrive as a prompt (a scheduled wake-up, a cron
prompt, a message from another session); whether those fire `UserPromptSubmit` is unmeasured, and one keyword
now disarms everything. Third, the shared-reading refactor has a gap: the claim check completes inside the
reader's handler today, and the plan moves that handler without saying what completes the check. Beyond those,
the largest piece of work (shared reading) serves the one combination with the least saving, so its place in
the order is worth a decision.

---

## Product Lens Findings 🎯

### Problem Validation
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P1 | 🤔 | The spec gives no instance of the need: which sessions stalled, on which check, how often. The three stories are plausible guesses (docs commits, Jev down, urgent fix). Without them the plan cannot tell which switch matters most. | Name the two or three real cases that prompted this in the spec's Story 1 and 2 "why". They decide P3. |

### User Value Assessment
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P2 | 💡 | With the claim check off and the shim check on, every commit still needs a read pass and two `shim-check` launches (read, then sweep), prose-only commits included. Today's cost with both on is also two launches. The saving is the judges only. Story 1's own example (a run of documentation commits) is not served by this combination; the user would turn both off. | Say this in Story 1 so the claim switch is not expected to make commits free. Feeds X1. |

### Alternative Approaches
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P3 | 💡 | The plan ships the refactor first, so no switch exists until the riskiest piece has merged. The plugin switch and the shim switch need no refactor (the shim check has no dependents). | Reorder: slice 1 = switch mechanics with `alq-review` and `shim-check`; slice 2 = shared reading; slice 3 = the `claim-check` switch. Two of three switches land in the first PR. |

### Edge Cases & UX
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P4 | 💡 | The org's rule files tell every agent to run `alq-review:review-round` after committing. With the plugin off that launch is answered "switched off, only the user turns it on", which reads as a blocker; the agent will likely stop and ask the user to turn it on, the opposite of what off is for. | End the launch answer with the next step: `Carry on without it; do not ask the user to turn it on.` Add it to the contract's answer text. |
| P5 | 💡 | After compaction the agent no longer has the note that a switch is off. Nothing refuses, so it is harmless, but FR-013 covers only resume. | Register the reminder for `compact` as well as `resume`, agent copy only. Same hook, one more matcher value. |

### Success Measurement
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P6 | 💡 | SC-003 says the existing tests pass "with that switch off". The plan runs them with no switch file, which shows nothing about a switch being off. | Reword SC-003 to what is tested: one gate test per cell of the contract's table, and the existing suite unchanged with no switch file. |

---

## Engineering Lens Findings 🔬

### Architecture Soundness
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E1 | 🎯 | Checked: `claimgate.after_output` calls `_settle` after each reader answer, and `_settle` is what completes a check with no judged claims and runs `_completed` (counts refusals into holds, writes the `claim-check complete` log line). The plan moves the reader's handler to `readgate` and has the claim check "absorb on load". Nothing then completes such a check, and a load on the commit path would start writing holds from a PreToolUse read. | Amend R1: after `readgate` stores a read, `gate.after_structured_output` (the dispatcher) calls `claimgate.on_read(tree)`, which absorbs and settles the open check for that tree. `readgate` still knows neither check; completion keeps exactly one trigger. |
| E2 | 💡 | R3 reads the switch through `hookio.session_state`, which takes a lock and writes the file back on every use. The switch is asked on every hook event, so every session would get a `.switches.json` and a write per tool call, with parallel subagents queueing on the lock. | Read with a plain read; only the prompt handler uses `session_state`. No file is created until a keyword is typed. |
| E3 | 💡 | R1 drops `claim_reads`. Dropping needs a `DROP TABLE IF EXISTS` that then lives in the schema forever, for a table that only ever existed on machines with the old version. | Create `hunk_reads` and leave `claim_reads` where it is, unread. Say so in R1. No statement about the old table in code. |

### Failure Mode Analysis
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E4 | 💡 | While the plugin is off an agent can commit onto a branch whose round is collecting or awaiting assessment. When the plugin is on again the round's findings are judged against code that has moved. Later delta rounds pick the commits up, and `mark_ready` still needs a settled round at the head, so nothing unreviewed can be attested; but the assessor rules on stale findings. | Add an edge case to the spec and a test: after `alq-review on`, a round whose `head_sha` is no longer the branch tip is named in the answer to the keyword (`round N was taken at <sha>; the branch has moved`). No new rule. |

### Security & Privacy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E5 | 🎯 | `pre_merge_gate.py` refuses `gh pr merge --admin` and `gh api .../pulls/N/merge`. Those refusals protect the server's requirements (CI, DeepSource, Codex verdict, threads, approval), and have their own per-PR user keyword, `override-merge #N`. R6 skips all of `pre_merge_gate.py`'s gating while the plugin is off, so one session-wide keyword lets an agent admin-merge any PR. The user's "everything off" answer was given to a question about the attestation and locks; admin merge was not in it. | Keep the `--admin` and `gh api` merge refusals on while the plugin is off; `override-merge #N` remains their only release. Plugin-off still lifts the attestation requirement for `ready` and a plain `merge`. Amend FR-007, R6 and the contract table. If the user does want admin merge lifted too, that is their call (Q1). |
| E6 | 🎯 | The whole design rests on `UserPromptSubmit` meaning "the user typed this". Claude Code can deliver text an agent chose as a prompt: `ScheduleWakeup`'s `prompt`, a cron prompt, a message from another session. If any of these fire `UserPromptSubmit`, an agent can switch the plugin off by scheduling a wake-up that starts with `alq-review off`. The same hole would exist for `unlock` today, but there it frees one branch; here it frees everything. Not measured. | Make it the first task, beside the session-id measurement: fire each route with a keyword and see whether the hook runs and what the payload carries. If one does and the payload cannot tell it from typing, stop and re-plan; do not ship the plugin switch on an unverified boundary. Record the result in R5. |
| E7 | 💡 | `hookio.session_file` builds a path from `payload['session_id']` unchecked; `pre_merge_gate` validates it against `[\w-]+` first. `switches_off` would add another caller of the unchecked path. | Validate the id in `session_file`, once, for every caller; a session whose id does not match holds no state. |

### Performance & Scalability
No findings beyond E2.

### Testing Strategy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E8 | 💡 | The contract's table has about 30 cells and is the real specification of the switch. The plan mentions "one gate test per cell" only in the quickstart. | Put it in the plan's Testing line and have `/speckit-tasks` generate the tests from the table, row by row, before any handler changes. |

### Operational Readiness
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E9 | 💡 | With the plugin off nothing is written to `gate.log` except the switch line, so there is no record of what was done while off (an attestation posted, a merge). The spec chose "only the switch change is recorded" to keep off free. | Keep it, but say in the Switches section of the README that the off line and the on line bracket an unrecorded span, so a reader of `gate.log` knows the gap is deliberate. |

### Dependencies & Integration
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E10 | 💡 | R9 depends on `session_id` surviving a resume, and R3 on subagent payloads carrying the parent's id. Neither is documented. The second is relied on by the gate already (rounds are tied to the launching session's id and reviewers' outputs are matched by it), so it holds in practice; the first is unknown. | Already the plan's first task for resume. Add an assertion test for the subagent case using a recorded payload, so a change in Claude Code shows up as a failing test. |

---

## Cross-Lens Insights 🔗

| ID | Finding | Product Impact | Engineering Impact | Suggestion |
|----|---------|---------------|-------------------|------------|
| X1 | Shared reading is the largest and riskiest part of the plan (two shipped checks, their store and an agent rename) and exists only so the claim check can be off while the shim check is on, the combination that saves least (P2). | Most of the value is the plugin switch and the shim switch. | Most of the risk, and E1, is the refactor. | Take P3's order. Then decide with real cases (P1) whether slice 3 is wanted now; the refactor stands on its own as a clean-up of the shim check's dependence on the claim check's record either way. |

---

## Findings Summary

| Metric | Count |
|--------|-------|
| 🎯 Must-Address | 3 |
| 💡 Recommendations | 12 |
| 🤔 Questions | 1 |
| Product findings | 6 |
| Engineering findings | 10 |
| Cross-lens findings | 1 |

---

## Consolidated Findings Table

| ID | Lens | Severity | Category | Finding | Suggestion |
|----|------|----------|----------|---------|------------|
| E5 | Engineering | 🎯 | Security | Plugin-off lifts the `--admin` and `gh api` merge refusals, which guard the server's rules | Keep those two on while off; `override-merge #N` stays their release |
| E6 | Engineering | 🎯 | Security | Agent-chosen text may reach `UserPromptSubmit` (wake-up, cron, another session); unmeasured | Measure first; stop and re-plan if a route cannot be told from typing |
| E1 | Engineering | 🎯 | Architecture | Nothing completes a claim check with no judged claims once the reader's handler moves | Dispatcher calls `claimgate.on_read(tree)` after a read is stored |
| X1 | Cross-lens | 💡 | Scope × Risk | The refactor serves the least valuable combination and blocks the rest | Reorder the slices (P3) |
| P3 | Product | 💡 | Alternatives | No switch ships until the refactor merges | Plugin and shim switches first |
| P4 | Product | 💡 | UX | A switched-off launch reads as a blocker to an agent following the org rules | Answer ends with "carry on without it" |
| P2 | Product | 💡 | User value | Claim off with shim on still reads every commit | Say so in Story 1 |
| P5 | Product | 💡 | UX | No reminder to the agent after compaction | Add `compact` to the matcher |
| P6 | Product | 💡 | Success | SC-003 names a test run the plan does not do | Reword to the contract-table tests |
| E2 | Engineering | 💡 | Architecture | Switch read takes a lock and writes on every event | Plain read; write only on a keyword |
| E3 | Engineering | 💡 | Architecture | Dropping `claim_reads` leaves a drop statement in the schema | Leave the old table unread |
| E4 | Engineering | 💡 | Failure modes | A round can be assessed against code that moved while off | Name stale rounds in the answer to `alq-review on` |
| E7 | Engineering | 💡 | Security | `session_file` builds a path from an unchecked id | Validate once in `session_file` |
| E8 | Engineering | 💡 | Testing | The contract table is the test plan but the plan does not say so | Tests generated from it, first |
| E9 | Engineering | 💡 | Operations | Nothing is logged between off and on | State the gap in the README |
| E10 | Engineering | 💡 | Dependencies | Two undocumented `session_id` behaviours | Measure one, pin the other with a test |
| P1 | Product | 🤔 | Problem | No real case behind the three stories | Name them; they decide slice 3 |

---

## Recommended Actions

### 🎯 Must-Address (Before Proceeding)
1. **E5**: `spec.md` FR-007 and Story 2 scenario 5: except `gh pr merge --admin` and merging through `gh api`. `research.md` R6 and `contracts/switch-keywords.md`: split the `pre_merge_gate.py` row into "attestation for ready/merge: stopped" and "`--admin`, `gh api` merge: runs".
2. **E6**: `research.md` R5: add the measurement as a precondition and its result. `plan.md`: first task, with the stop rule.
3. **E1**: `research.md` R1 and `data-model.md` (claim_checks): completion is triggered by `claimgate.on_read`, called by the dispatcher after a read is stored.

### 💡 Recommendations (Strongly Suggested)
1. **P3 / X1**: `plan.md` Summary and Structure: three slices in the order switch (plugin, shim), shared reading, claim switch.
2. **P4**: contract: launch answer ends with the carry-on line.
3. **E2, E3, E7**: `research.md` R3, R1; `plan.md` source list (`hookio.session_file`).
4. **P2, P5, P6, E4**: `spec.md` Story 1 note, FR-013 (compact), SC-003 wording, one edge case.
5. **E8, E9, E10**: `plan.md` Testing line; README note in slice 1 of the switch.

### 🤔 Questions (Need Stakeholder Input)
1. **Q1 (E5)**: should `alq-review off` also lift the refusal of `--admin` and `gh api` merges, or do those stay behind `override-merge #N`?
2. **P1**: which real sessions prompted this, and is "claim check off, shim check on" one of them?

---

**Severity Legend**:
- 🎯 **Must-Address**: Blocks proceeding to implementation
- 💡 **Recommendation**: Strongly suggested improvement
- 🤔 **Question**: Needs stakeholder input to resolve

---

*Generated by `/speckit.critique` — Dual-lens strategic and technical review for spec-driven development.*
