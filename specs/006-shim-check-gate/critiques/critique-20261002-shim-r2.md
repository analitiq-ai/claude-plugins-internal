# Critique Report: Shim check before commit (round 2)

**Date**: 2026-10-02
**Feature**: [spec.md](../spec.md)
**Plan**: [plan.md](../plan.md)
**Previous**: [critique-20261002-shim.md](critique-20261002-shim.md), all of whose findings are applied
**Verdict**: ⚠️ PROCEED WITH UPDATES

---

## Executive Summary

The round-1 changes hold together. The `kind` question, the three alq-review sweepers, restartable checks, the
override, the touched/not-touched marks and the bot release step are consistent across the spec, research,
data model, contract and quickstart. One new design choice causes a real problem: the `HEAD` snapshot sits inside
the checkout, where the repo's own tools pick it up. Everything else is small.

---

## Product Lens Findings 🎯

### Problem Validation
No findings.

### User Value Assessment
No findings.

### Alternative Approaches
No findings.

### Edge Cases & UX
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P1 | 💡 | The override lasts "until a commit lands", which in R11 means until `HEAD` moves. If the author commits something unrelated on the branch first, `HEAD` moves and the overridden bug is checked again. That is not what option B promised ("until that bug's commit lands"). | Accept this and say so in R11's rationale (a commit carries the whole index, so the bug's staged hunks normally land with it). The alternative would be to carry the chain across `HEAD` moves, which breaks R9's same-coordinates premise. Recommend accepting and documenting it. |

### Success Measurement
No findings.

---

## Engineering Lens Findings 🔬

### Architecture Soundness
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E1 | 🎯 | The snapshot at `<checkout>/.claude/shim-snapshots/<sha>/` is excluded from git and ripgrep, but not from the repo's own tools, and R3 keeps it until the next launch, which in practice means indefinitely. Checked in the frontend repo: `Dockerfile` line 23 `COPY . .` with no `.claude` entry in `.dockerignore`; `vitest.config.ts` sets no `include`, so vitest's default glob runs every `*.test.ts` under `.claude/` (its default excludes don't cover `.claude`); `eslint.config.js` lints `**/*.{ts,tsx}` and ignores only `dist`, `node_modules`, fonts. So after one check, `yarn test` runs the old tree's tests too, lint reports the copy, and the image gains a 26 MB stale tree. That Claude Code's own Glob and Grep tools skip the folder is assumed from the ripgrep CLI test, not tested through the tools. | Move the snapshot outside every repo, to `<plugin state root>/snapshots/<repo>/<sha>/`. The gate's PreToolUse handler already sees subagent calls with `agent_type`; it returns `permissionDecision: allow` for a `shim-sweeper` Read, Glob or Grep whose path is inside that folder. That is a single path-prefix check, not a list of commands or options, so it keeps E3/E4's fix. Remove a snapshot when its check reaches `complete` or `failed` (re-export costs 0.1–0.2 s), and verify that path with `realpath` before deleting. |

### Failure Mode Analysis
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E2 | 💡 | `kind` is asked at launch, but the data model has no state for a failed or timed-out `kind` call, and R13's restart rules start at `sweeping`. | Add to the data model that a `kind` failure leaves the check `failed` with no answers, so a relaunch asks `kind` again. |

### Security & Privacy
No new findings. The sweeper has no write or exec tool, and the override can only be typed in a user prompt.

### Performance & Scalability
No new findings. The size limit is a stated Limit.

### Testing Strategy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E3 | 💡 | `git archive` leaves out paths marked `export-ignore` and submodule contents. The snapshot then lacks those files, so a site inside them is never listed, and nothing says so. | Name this in R3 and Limits. The root `.gitattributes` of plugins, infra and frontend has no `export-ignore` today. |

### Operational Readiness
No findings.

### Dependencies & Integration
No findings.

---

## Cross-Lens Insights 🔗

None this round.

---

## Minor (no severity)

- spec.md User Story 3 acceptance scenarios are numbered 1, 2, 3, 4, 6, 5.
- plan.md Constraints says "the commit hook only reads the ledger". Matching an overridden chain also needs the
  staged hunks from git, so it should read "only reads the ledger and git".

---

## Findings Summary

| Metric | Count |
|--------|-------|
| 🎯 Must-Address | 1 (E1) |
| 💡 Recommendations | 3 (P1, E2, E3) |
| 🤔 Questions | 0 |

---

## Consolidated Findings Table

| ID | Lens | Severity | Category | Finding | Suggestion |
|----|------|----------|----------|---------|------------|
| E1 | Engineering | 🎯 | Architecture | Snapshot in checkout is picked up by Docker `COPY . .`, vitest and eslint, and persists | Snapshot under plugin state; gate allows sweeper reads by path prefix; delete on check end |
| P1 | Product | 💡 | Edge cases | An unrelated commit moving `HEAD` ends an override | Accept and document in R11 |
| E2 | Engineering | 💡 | Failure modes | No state for a failed `kind` call | `failed` with no answers; relaunch re-asks |
| E3 | Engineering | 💡 | Testing | `git archive` drops export-ignore paths and submodules | Name it in R3 and Limits |

---

## Recommended Actions

### 🎯 Must-Address (Before Proceeding)
1. **E1**: rewrite R3 for a snapshot under the plugin state root, with a path-prefix allow for the sweeper and
   deletion when the check ends. Update plan Storage, the contract's snapshot line and quickstart §2.

### 💡 Recommendations
1. **P1**: one sentence in R11's rationale.
2. **E2**: one line in the data-model transitions.
3. **E3**: one line each in R3 and Limits.
4. Minor: renumber the US3 scenarios; fix the plan's Constraints wording.

---

**Severity Legend**:
- 🎯 **Must-Address**: Blocks proceeding to implementation
- 💡 **Recommendation**: Strongly suggested improvement
- 🤔 **Question**: Needs stakeholder input to resolve

---

*Generated by `/speckit.critique` — Dual-lens strategic and technical review for spec-driven development.*
