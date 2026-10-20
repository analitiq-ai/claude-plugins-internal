# Critique Report: Merge override grants in the state folder

**Date**: 2026-10-07
**Feature**: [spec.md](../spec.md)
**Plan**: [plan.md](../plan.md)
**Verdict**: ⚠️ PROCEED WITH UPDATES

Written by the session that wrote the spec and the plan. One independent reviewer read both cold, without
being told what the author thought was wrong; its findings are merged here. "run" means run by the author on
main `2ec150f` or on the scratch copy of the planned change. "reviewer" means run by the reviewer and not run
again. "read" means reasoning from the code.

**Outcome (2026-10-07)**: the user chose, for X1, a grant asked for only by a merge that needs one, and for X2,
one line shown to the user; and asked for every edit below to be applied. The spec, plan, research, data model,
contract and quickstart are rewritten to match, after the revised design was run on a second scratch copy.
Issues opened: #48 (a record written in place, E2), #49 (the switch raising, E3), #50 (the shell route, E4),
#51 (a `gate.log` line, E8). One suggestion was not taken as worded: E1's single prefix. The two answers to a
prompt carry `[alq-review]`, as the switch's do; the note beside a refusal carries none, as no refusal of this
script does (research R4).

---

## Executive Summary

The move itself is sound: one record kind, the one helper, no new guard. Every "Measured" line the reviewer ran
again held. Four things need settling before tasks.

First, the reason given for refusing an attested merge when the grants cannot be read is false. A grant only
ever turns a refusal into a pass, so reading unreadable grants as "none" can never pass a wrong merge. The
refusal buys no safety and costs every merge in the session. The author recommended it at clarification; that
recommendation rested on the false reason. Second, an unreadable record stays unreadable, the answer names
neither the file nor a repair, and the plugin can produce one itself. Third, the spec and the contract disagree
on whether the user is told of a recorded override, and after this change a recorded override and a mistyped one
both show the user nothing. Fourth, the plan's claim that every test starts red is false for about half the
contract's rows.

None of this needs a rethink. All of it is edits to the documents, two of them after a choice by the user.

---

## Product Lens Findings 🎯

### Problem Validation
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P1 | 💡 | US1 is titled "An agent cannot write itself a merge override". After the feature it still can, with one shell command, the tool it merges with. Run on the scratch copy with the plugin on and enforcing: the gate does not refuse the command, and `gh pr merge 12 --admin` then passes with no override typed. The spec's Assumptions say so; the story and its "why" do not. | Retitle to "An agent's file edit cannot write a merge override". Say what is gained: the grants get every guard the state folder has or is given later (#38). |

### User Value Assessment

No finding. US3 is not extra: the helper raises where the old code returned nothing, so the move needs those
answers.

### Alternative Approaches

See X1.

### Edge Cases & UX

See X2 and E2.

### Success Measurement

No finding.

---

## Engineering Lens Findings 🔬

### Architecture Soundness
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E1 | 💡 | Plan row V says both second copies in the script go. Two remain: the script's own `deny` beside `hookio.deny`, and a hand-built copy of the two-field answer `gate._tell` builds. They also disagree: the override answer starts `[alq-review]`, the merge refusal does not (run). Both copies have a sound reason the plan does not give: the script must answer when `hookio` cannot load (run: the script run apart from `hookio.py` still answers). R4 gives a weaker reason. | State that reason in row V and in R4. Choose one prefix for the two new answers. |

### Failure Mode Analysis
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E2 | 🎯 | An unreadable record stays unreadable: a typed override is "not recorded" and the record is left as found (run). The answers do not name the file; for text that is not JSON the error carries no path at all (run). The plugin can make one itself: the helper empties the file and then writes it, on every merge, so a failed write-back empties a record that held a grant (run, a file-size limit standing in for a full disk). For a session id that is not a plain name the user has no action: `alq-review off` fails too (run), so "Only the user can put that right" is false there. Plan row P1 says the next step is named; the user's is not. | Both answers name the record and the repair: delete it and type the override again. For such an id, say a new session is the only way. The data model says how a record is repaired. X1 limits what a damaged record blocks. Writing through a temporary file and a rename fixes the cause; it is in `hookio.py` and serves every session record, so an issue of its own. |
| E3 | 💡 | R5's "not met in one case" is a class: whenever the session's switch cannot be read and `errors.log` cannot be written. `sessions` unsearchable under a read-only state folder gets the general answer too (run). That makes the contract's row "`sessions` cannot be made or written: could not be read" false in part. A deeply nested record raises `RecursionError`, which the planned catch lets through to the general answer (reviewer). | Word FR-011, the edge case and the contract's row by the condition, not by one example. R5 names the real fix and no issue; open one. |

### Security & Privacy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E4 | 💡 | Complexity Tracking lists two ways to a grant without the user. A third is written down in 016 R3 and not measured: text an agent chose arriving as a prompt (a scheduled wake-up, a cron prompt, a message from another session). The shell route has no issue, open or closed (checked). | Add the third to the row, citing 016 R3. Open an issue for the shell route, so the deviation points at something tracked. |

### Performance & Scalability

No finding. One lock, one small read and one small write per override and per merge, as today. X1 removes the
write for a merge that needs no grant.

### Testing Strategy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E5 | 🎯 | The plan (Testing, row IV) says each case of the contract starts as a test that fails on main. About half cannot: the five "as today" rows of the commands table, the merge half of the state-folder row, typed twice, merges at once, and the write guard as the contract and the quickstart word it (a `Write` to `sessions/s1.merge.json` is refused on main already; run). The reviewer wrote the contract out as 20 tests: 9 pass on main. | Mark those rows as tests of unchanged behaviour. For each, name the wrong version of the new code that turns it red (reviewer: asking for the grant first thing in `gated` turns five red). Word the write-guard test everywhere as the plan does: the file the gate wrote, found by listing the folder. |
| E6 | 💡 | No test in the list for FR-006 (spent once), FR-007 and FR-008 (one helper, one rule), FR-014 and SC-007 (one place named), or FR-004's "not created" (R7 asserts the second folder holds no file; an empty old folder passes). PR #31 adds the old folder's name to `reviewer/plugin/README.md` (checked); if it lands second, nothing fails. | A test that holds the record's lock and sees the merge hook wait: red on main, green on the scratch copy (run). A test in the `Marker` style that no file under the plugin spells the old folder and only `hookio.py` has `fcntl` and `SESSION_ID`: red on main, and it fails PR #31's CI if that lands second. Assert the second folder does not exist. |

### Operational Readiness
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E7 | 💡 | R4 leaves `errors.log` unwritten because "the usual cause is a state folder that cannot be written". It can be written in four of the five cases R4 measured (reviewer). The README says `errors.log` holds every gate failure; the new answers are shown once and kept nowhere. | Write the line when it can be written, as `gate.main` does: try, and let `OSError` pass, since the answer carries the reason. |
| E8 | 🤔 | A typed override and its spending write no `gate.log` line, while the switch, a weaker lever, records every change (016 R6). Once spent, the record reads `{"granted": []}`: nothing shows an override was used. Raised twice in this session and not answered. | An issue of its own: it is new behaviour with its own requirement. Needs the user's go-ahead. |
| E9 | 💡 | Nobody is told about the upgrade: an unspent grant is lost, and the old folder stays on every machine. SC-007 keeps its name out of the plugin, so the README cannot say it. | One line for each in the PR body. |

### Dependencies & Integration

No finding beyond E6 (PR #31).

---

## Cross-Lens Insights 🔗

| ID | Finding | Product Impact | Engineering Impact | Suggestion |
|----|---------|---------------|-------------------|------------|
| X1 🎯 | The spec (US3 "why", Assumptions), the plan (row P4) and the research (R3) justify refusing an attested merge by a wrong merge on the other side. There is none: a grant only turns a refusal into a pass (read). On main, with a bad id, an attested merge passes on its attestation and an unattested `--admin` one is refused (run): the right judgement both times. The grant is asked for first only because of the code's order. | One unreadable record refuses every merge of every PR in the session, attested ones too (run). A grant is spent by an attested merge that did not need it (reviewer). | Every merge writes the record back, so a merge that needs no grant can damage a record that holds one (run, E2). | Recommended: ask for a grant only when the merge would otherwise be refused. The attestation check is pure; it moves ahead of the spend for a merge without `--admin`. FR-005, FR-011 and clarification 1 change. Fallback: keep the order and correct the reason in those places to what it is, loud and not safe. Either way the reason is corrected. |
| X2 🎯 | US2 scenario 1 says "the user is told one merge of PR 12 is granted". The contract says the user is told nothing, as today (run: the answer reaches the agent only). | After this change a failed override shows the user a line, while a recorded one and a mistyped one (`override-merge 12`, `Override-merge #12`) both show nothing (run). Silence then reads as "recorded", and a typo is silent too. | A test written from the scenario fails against the contract. | Recommended: show the user one line for a recorded override too, as the switch does, and amend FR-005 to allow it. Fallback: reword the scenario and FR-005 to "the agent is told". |

---

## Findings Summary

| Metric | Count |
|--------|-------|
| 🎯 Must-Address | 4 |
| 💡 Recommendations | 7 |
| 🤔 Questions | 1 |
| Product findings | 1 |
| Engineering findings | 9 |
| Cross-lens findings | 2 |

---

## Consolidated Findings Table

| ID | Lens | Severity | Category | Finding | Suggestion |
|----|------|----------|----------|---------|------------|
| X1 | Cross-lens | 🎯 | Alternative × Failure modes | The reason for refusing an attested merge is false; the refusal buys no safety | Ask for a grant only when the merge needs one, or keep the order and correct the reason |
| X2 | Cross-lens | 🎯 | UX × Testing | Spec says the user is told of a recorded override; contract says not; a typo is silent too | Show the user one line, or reword the spec |
| E2 | Engineering | 🎯 | Failure modes | An unreadable record has no named repair and blocks the session; the plugin can produce one | Name the record and the repair in both answers; issue for the write-back |
| E5 | Engineering | 🎯 | Testing | "Every test starts red" is false for about half the contract's rows | Mark the unchanged-behaviour rows and how each is shown to grade |
| P1 | Product | 💡 | Problem validation | US1 promises more than the feature delivers | Retitle and state the real gain |
| E1 | Engineering | 💡 | Architecture | Row V says both copies go; two remain, unexplained, with two prefixes | State the reason; one prefix |
| E3 | Engineering | 💡 | Failure modes | The case FR-011's words are not given in is a class, and one contract row is false in part | Word it by the condition; open the issue |
| E4 | Engineering | 💡 | Security | A third way to a grant is left out; the shell route is untracked | Add it; open the issue |
| E6 | Engineering | 💡 | Testing | FR-004, 006, 007, 008, 014 and SC-007 have no test; PR #31 can undo FR-014 unseen | Three tests |
| E7 | Engineering | 💡 | Operations | The reason for not writing `errors.log` does not hold | Write it when it can be written |
| E9 | Engineering | 💡 | Operations | Nobody is told of the lost grant or the leftover folder | PR body |
| E8 | Engineering | 🤔 | Operations | No `gate.log` line for an override or its spending | Own issue, on the user's go-ahead |

---

## Recommended Actions

### 🎯 Must-Address (Before Proceeding)
1. **X1**: the user chooses. If the grant is asked for only when needed: `spec.md` FR-005, FR-011, FR-013,
   clarification 1, US3 "why" and scenarios 2 and 4, the first Assumption; `plan.md` Summary and row P4;
   `research.md` R3 and R5; the contract's commands table; the data model's life table. If the order stays:
   correct the reason in `spec.md` (US3 "why", the first Assumption), `plan.md` row P4 and `research.md` R3.
2. **X2**: the user chooses. If the user is shown a line: the contract's "recorded" row, `research.md` R4,
   `spec.md` FR-005. If not: `spec.md` US2 scenario 1 and FR-005 say "the agent is told".
3. **E2**: the contract's two answers name the record and the repair; `data-model.md` gains a line on repair;
   `plan.md` row P1; `spec.md` FR-011 says what the user can do, and that for a bad id it is a new session.
4. **E5**: `plan.md` Testing and row IV; the contract marks its unchanged-behaviour rows; the contract's write
   guard section and quickstart step 3 are worded as the file the gate wrote.

### 💡 Recommendations (Strongly Suggested)
1. **P1**: `spec.md` US1 title and "why".
2. **E1**: `plan.md` row V, `research.md` R4, one prefix in the contract.
3. **E3**: `spec.md` FR-011 and its edge case, the contract's row, `research.md` R5.
4. **E4**: `plan.md` Complexity Tracking.
5. **E6**: three rows in the contract's test list; `research.md` R7.
6. **E7**: `research.md` R4, the contract.
7. **E9**: a note for the PR body, kept in `plan.md` Constraints.

### 🤔 Questions (Need Stakeholder Input)
1. **E8**: an issue for a `gate.log` line on an override and its spending?
2. Issues named above, each needing a go-ahead: the shell route (E4); `switch_state` raising when `errors.log`
   cannot be written (E3); the helper writing a record back through a temporary file (E2).

---

**Severity Legend**:
- 🎯 **Must-Address**: Blocks proceeding to implementation
- 💡 **Recommendation**: Strongly suggested improvement
- 🤔 **Question**: Needs stakeholder input to resolve

---

*Generated by `/speckit.critique` — Dual-lens strategic and technical review for spec-driven development.*
