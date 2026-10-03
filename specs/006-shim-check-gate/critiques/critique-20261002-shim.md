# Critique Report: Shim check before commit

**Date**: 2026-10-02
**Feature**: [spec.md](../spec.md)
**Plan**: [plan.md](../plan.md)
**Verdict**: ⚠️ PROCEED WITH UPDATES

---

## Executive Summary

The problem (C1), the decisions, and the reuse of the claim check's interception, labels, ledger and unlock path
are sound. The plan's facts about the plugin match the code. Three things would break the gate in use, and one
needs your decision:

- **The check judges commits it was never measured on.** The replay covered 14 fix commits only. Spec Q1 now
  sweeps every commit, but the `level` question assumes there is a defect to fix.
- **About 6–8% of recent plugins commits are too big to judge.** Those would be blocked outright.
- **The sweeper's git allowlist checks the command name but not its options.** `git grep -O` can run a program
  and `git show --output` can write a file.
- **A check interrupted mid-run has no way back.** If a hook dies while a check is running, that tree stays
  stuck and its commit is refused for good.

---

## Product Lens Findings 🎯

### Problem Validation
No findings. C1 is evidenced (14-commit replay, plugins #352) and scoped against C2–C4.

### User Value Assessment
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P1 | 🤔 | Every commit with code now pays for a 2–4 min sweep, including the many small feature commits made while building something. Nothing in the spec says how much time that adds per PR, or what would make you switch the check to `log`. | Add an SC: after the first 2 weeks, read the would-deny and failure counts and the total sweep time per PR from `gate.log`. You decide from those whether the every-commit scope stays. |

### Alternative Approaches
No findings. Existing tools were compared per mechanism (research R1–R14).

### Edge Cases & UX
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P2 | 💡 | A refusal lists every SAME OPERATION site, and Jev's `coverage` answer doesn't say which of them still have the bug. The author has to work out which listed sites are the unfixed ones. | Mark in the refusal which listed sites the staged diff touches and which it doesn't. These are git facts, not a judgement. Contract §Commit refusals. |

### Success Measurement
Covered by X1 and P1.

---

## Engineering Lens Findings 🔬

### Architecture Soundness
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E1 | 💡 | Using `alq-anti-pattern:duplication` in the deep sweep bends a generic agent. Its own prompt is "reports nothing it cannot name an existing alternative for", it expects an audit scope packet, and it brings its own output format. Here it would get the sweep's schema and a different job. That is the special case the "no bending generic abstractions" rule warns against, and it also adds a dependency on a second plugin. | Make the third deep agent an alq-review sweeper with a different framing (for example, start from callers and consumers of the changed mechanism). Drop the cross-plugin dependency. This needs a spec change to FR-016, which names the agent. |

### Failure Mode Analysis
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E2 | 🎯 | Only a `failed` check can be relaunched (data-model). The Jev call runs in a PostToolUse hook, and PostToolUse can't block. If that hook is killed by its timeout, or the workflow dies during the sweep, the check stays `judging` or `sweeping` forever. Its commit is refused with "check running" and no launch is accepted, so the tree is stuck. | Let a launch for any tree that isn't `complete` start again. A `judging` tree whose lists are already recorded re-runs Jev only (`rejudge`), and a `sweeping` tree re-sweeps. State this in R13 and the data-model transitions. |
| E3 | 🎯 | In a headless (bot) session, the sweeper's Bash calls need permission. Nothing in the plan grants it, so they would be denied, the sweep fails, and every code commit is refused under `enforce`. | In R3, the gate returns `permissionDecision: "allow"` for an allowlisted sweeper command. `on_workflow` already uses the same allow as the headless permission. |

### Security & Privacy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E4 | 🎯 | R3 allowlists git verbs and the revision, but not options. `git grep -O<cmd>` (`--open-files-in-pager`) runs a program. `git show --output=<file>` writes a file. `--ext-diff` and `--textconv` run configured drivers. So "read-only by a control in code" is not true as written. | Parse the command with `shlex`. Refuse shell metacharacters. Allow only listed options per verb (grep: `-n -i -w -E -F -P -l -e --`; show: none beyond `<sha>:<path>`; ls-tree: `-r --name-only`), and refuse everything else. Add a test for each refused option. |

### Performance & Scalability
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E5 | 🎯 | Measured: of 638 non-merge plugins commits since 2026-08-01, 50 have a code diff over 60 kB and 41 over 100 kB (`*.py *.js *.ts *.sh *.json`, before generated files are excluded). Jev's limit is about 33k tokens for the state plus one question. So roughly 6–8% of commits would be refused as unjudgeable, and splitting them is the only way out. | See X1: if the check judges only fix commits, most of these large commits (features, generated or vendored files) never reach Jev. For a large fix commit, keep the refusal. |

### Testing Strategy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E6 | 💡 | The replay fixtures are all fix commits, so no test shows that a feature or refactor commit passes. | Add non-fix commits to `tests/fixtures/shim-replay/` with an expected verdict. This is part of the X1 replay. |

### Operational Readiness
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E7 | 💡 | Rollout order isn't stated. If the plugin version that turns the check on is installed before the OpenRouter key (and the anti-pattern plugin, unless E1 drops it) is present on the bot, every code commit is refused. | Add a pre-release check to quickstart: on the bot, the key file is readable and one Jev call succeeds before the version is bumped. |

### Dependencies & Integration
Covered by E1 and E7.

---

## Cross-Lens Insights 🔗

| ID | Finding | Product Impact | Engineering Impact | Suggestion |
|----|---------|---------------|-------------------|------------|
| X1 | The `level` question asks whether a fix acts on "the defect's cause". The replay ran on fix commits only. With every commit swept (Q1), Jev must answer `cause` or `symptom` for features and refactors that have no defect, and every `symptom` it picks refuses the commit for no reason. The cost of being wrong was never measured. | False refusals on ordinary work, under `enforce` from day one. | 2–4 min sweeps and the size limit (E5) hit commits that have no bug to check. | Ask Jev a third question first: `kind`, one of `fix` or `not_fix` ("does this change correct a defect in existing behaviour?"). Only `fix` commits are swept and judged. Other commits pass without a sweep, with the label logged. Before shipping as `enforce`, replay it on the 14 fix commits plus about 15 non-fix commits from the same repo. Spec: FR-005, US1-4, edge cases; plan R4/R6. |

---

## Findings Summary

| Metric | Count |
|--------|-------|
| 🎯 Must-Address | 4 (E2, E3, E4, X1) |
| 💡 Recommendations | 5 (P2, E1, E5 folds into X1, E6, E7) |
| 🤔 Questions | 1 (P1) |
| Product findings | 2 |
| Engineering findings | 7 |
| Cross-lens findings | 1 |

---

## Consolidated Findings Table

| ID | Lens | Severity | Category | Finding | Suggestion |
|----|------|----------|----------|---------|------------|
| X1 | Cross-lens | 🎯 | Scope × Risk | `level` assumes a defect; non-fix commits were never replayed | Jev `kind` question first; only fixes swept; replay non-fix commits |
| E4 | Engineering | 🎯 | Security | Allowlist checks verbs, not options (`-O`, `--output`, ext-diff) | Allowlist options per verb; refuse metacharacters; tests |
| E2 | Engineering | 🎯 | Failure Modes | A check interrupted while sweeping or judging can never be relaunched | Relaunch any non-complete tree; a `judging` tree re-runs Jev only |
| E3 | Engineering | 🎯 | Failure Modes | Sweeper Bash needs permission in headless runs | Gate returns `allow` for allowlisted sweeper commands |
| E5 | Engineering | 💡 | Scalability | ~6–8% of commits exceed Jev's limit | Mostly removed by X1 |
| E1 | Engineering | 💡 | Architecture | Duplication agent bent into a sweeper; cross-plugin dependency | Third alq-review sweeper with a callers-first framing |
| P2 | Product | 💡 | UX | Refusal doesn't separate touched from untouched sites | Mark touched/untouched per site from git |
| E6 | Engineering | 💡 | Testing | No non-fix fixtures | Add them with the X1 replay |
| E7 | Engineering | 💡 | Operations | Rollout order on the bot | Pre-release key and Jev check |
| P1 | Product | 🤔 | Success | No point at which the every-commit cost is reviewed | 2-week read of `gate.log` |

---

## Recommended Actions

### 🎯 Must-Address (Before Proceeding)
1. **X1**: spec FR-005/FR-006 and edge cases gain the `kind` gate. Plan R6 asks it first; R4 skips the sweep for
   `not_fix`; quickstart §6 replays non-fix commits.
2. **E4**: plan R3 gets per-verb option allowlists and metacharacter refusal; contract and tests follow.
3. **E2**: plan R13 and the data-model transitions let any non-complete tree be relaunched (`judging` → Jev only).
4. **E3**: plan R3 has the gate return `allow` for allowlisted sweeper commands.

### 💡 Recommendations (Strongly Suggested)
1. **E1**: spec FR-016 and plan R10 replace the duplication agent with a third alq-review sweeper.
2. **P2**: the contract's refusal marks which listed sites the diff touches.
3. **E6/E7**: non-fix fixtures; a pre-release bot check in quickstart.

### 🤔 Questions (Need Stakeholder Input)
1. **P1**: should a 2-week review of `gate.log` decide whether the every-commit scope stays?

---

**Severity Legend**:
- 🎯 **Must-Address**: Blocks proceeding to implementation
- 💡 **Recommendation**: Strongly suggested improvement
- 🤔 **Question**: Needs stakeholder input to resolve

---

*Generated by `/speckit.critique` — Dual-lens strategic and technical review for spec-driven development.*
