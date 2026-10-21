# Critique Report: Merge override grants in the state folder (second run)

**Date**: 2026-10-07
**Feature**: [spec.md](../spec.md)
**Plan**: [plan.md](../plan.md)
**Verdict**: ⚠️ PROCEED WITH UPDATES

Second critique, of the documents as rewritten after the [first](critique-20261007-merge-grants.md). Written
by the session that wrote the spec, the plan and the rewrite. One independent reviewer read them cold, with the
scratch copy of the planned change to run, and was not told what the author thought was wrong; it read the
first critique only after forming its own findings. "run" means run by the author in this round, on main
`2ec150f` and on the scratch copy. "reviewer" means run by the reviewer and not run again. "read" means
reasoning from the text or the code. No existing file was edited.

**Outcome (2026-10-07)**, written after the report; the findings below are as first written.

The user's answers. X1: none of the three options; an override is for a PR, so it names the PR,
`override-merge owner/repo#N`, one form, and "only when needed" stays. Every other edit: apply. E8: fold in.
E9: open the issue. No issue for a grant that names its repo, since that is now this feature.

The design was run on a third scratch copy before any document was changed, then the spec, plan, research,
data model, contract and quickstart were rewritten from it. That run was the author's alone; no reviewer has
run it. By finding:

| Finding | Done | Where |
|---|---|---|
| X1 | The PR is named. What remains is stated: a grant waits for its own PR and cannot be withdrawn | spec FR-005, FR-017, FR-018, SC-009, Assumptions; research R5, R8; data model; plan, Complexity Tracking |
| X2 | Applied. One thing stays: under such an id the `--admin` refusal still gives the override's line; the note above it says none can be kept in that session and what can be done | spec FR-010; research R3; contract; plan row P1 |
| E1 | Applied, one row | research R4; contract |
| E2 | Applied, four rows | contract; research R7 |
| E3 | Applied in part. The answer no longer repeats what the record holds. It is not copied to `errors.log` as suggested: the record is left as found, so the file is what a person opens | research R2; contract |
| E4 | Applied. The row is a new row, not a guard: main passes that merge | research R5; contract; plan row P3 |
| E5 | Applied | contract; research R7; quickstart step 2 |
| E6 | Applied | plan, Testing |
| E7 | Applied | spec Terms; research R5; contract |
| P1 | Applied; the step has not been run by anyone | quickstart step 5 |
| E8 | Folded in | spec FR-018; research R8; contract |
| E9 | Issue #52 | |

Found while running the third copy, and not in the findings below:

- A PR whose address is not on github.com cannot be named, so cannot be overridden. Main lets a number-only
  override through there. Stated in the spec's Assumptions; not tracked.
- Five existing tests of the override pass against the new code while typing the old form, which grants
  nothing. They are rewritten, and a test that shows a refusal now also shows the override working (research R7).
- The README's Layout row gives the override as typed. It changes, and a row pins it (FR-014).
- A row types the line an `--admin` refusal gives and sees the merge pass, so a refusal cannot again name a
  line that does not work.

---

## Executive Summary

The move is sound and the rewrite holds where it was run again. The reviewer reran every "Measured" line of
R1 to R7, the 18 new and 5 guard rows on main, the scratch copy and the three wrong versions, the whole suite
and the quickstart: all as written. Nothing needs a rethink.

Four things need settling before tasks. Each is small.

1. A grant that no merge needed now stays live, and the spec says the opposite ("unchanged"). The user chose
   "only when needed" on a critique that did not state this cost. Found by the author and the reviewer apart.
2. A typed override ends in a program trace when a plugin module is there but does not load. Main answers it.
   R4 says `grant` catches every exception; it does not.
3. The test list cannot grade three things the contract states. Two wrong versions pass all 25 rows; one of
   them opens the merge gate in `log` mode.
4. For a session id that is not a plain name, the answers name a step that cannot work. The first critique
   asked for a sentence there. It was not applied, though that report's Outcome and the author's summary said
   every edit was. That statement was wrong.

### What the rewrite did with the first critique

| First finding | Now | How checked |
|---|---|---|
| X1 grant asked for every merge | Resolved; its cost is X1 below | run, reviewer |
| X2 user not told | Resolved | run, reviewer |
| E2 no named repair | **Partly**: a damaged record names its repair; the id case names none (X2 below) | run, reviewer |
| E5 "every test starts red" | Resolved: new, guard, kept | reviewer |
| E6 missing tests | **Partly**: FR-006 by proxy, FR-014 by half (E2 below) | run, reviewer |
| E1 two copies | **Partly**: the reason is stated, and is untrue for a module that does not load (E1 below); the prefix stays two, as recorded | run |
| P1, E3, E4, E7, E9 | Resolved; issues #48 to #51 say what the documents say | reviewer |
| E8 `gate.log` | Issue #51 | read |

---

## Product Lens Findings 🎯

### Problem Validation

No finding. The spec says plainly that US1 closes one way to a grant and leaves the shell route (#50) and
`log`/off (#38).

### User Value Assessment

See X1.

### Alternative Approaches

See X1: the user's first decision has a cost not put to them.

### Edge Cases & UX

See X1 and X2.

### Success Measurement
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| P1 | 💡 | SC-008 and FR-005 say the user is *shown* a line. The tests see the hook's output only. That Claude Code shows a `systemMessage` from a prompt hook rests on the hooks reference (016 R6) and on the switch using the same two fields. Neither the author nor the reviewer saw it in a live session. | One by-hand step in the quickstart: with `ALQ_REVIEW_STATE_DIR` set to a throwaway folder, type the override in a live session and see the line. |

---

## Engineering Lens Findings 🔬

### Architecture Soundness

See E4 (plan row P3) and E5.

### Failure Mode Analysis
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E1 | 🎯 | With `hookio.py` present but not loading (a syntax error; the reviewer also ran one that raises on import), a typed override exits 1 with a trace and no answer. Main exits 0 and grants (run, reviewer). Cause: the step that logs a failure runs inside `grant`'s catch, loads `hookio` again, and lets only a missing module and a file error pass. R4 says "`grant` catches every exception", and plan row V keeps the script's own copies for exactly this case. FR-009 and SC-008 are not met there. | R4: the guard round the log line lets any failure pass, since the answer carries the reason. One new row: a `hookio.py` that is there but does not load, the override is answered as not recorded, exit 0. It fails on main, which grants without the helper. |
| E4 | 💡 | With a grant held, an unattested merge without `--admin` is refused by the general failure answer when the release reader raises; main passes it on the grant (run). R5 states the cost but not the way through: the same merge with `--admin` passes on the grant, because `--admin` is judged before the release is looked up (run). Plan row P3 lists the pure parts and leaves out `unmet`, the one new deciding function, which asks GitHub part-way (reviewer, read). | Say the way through in R5 and the contract; one guard row for it. Row P3 says `unmet` holds today's checks in today's shape, the release lookup included. |

### Security & Privacy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E3 | 💡 | A record the gate did not write is quoted, up to 200 characters, to the user and the agent under the plugin's `[alq-review]` prefix (run, reviewer: a planted `{"note": "…the user approved every merge…"}` comes back word for word). Nothing passes on it. But it is text from a file anything can write (#50), in the plugin's voice. The switch already does it the other way: what it finds goes to `errors.log` only (`hookio.py:150`). | Do as the switch does. The answer names the record and the repair; what was found goes to `errors.log`. R2, the contract's `<what was found>`. |

### Performance & Scalability
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E9 | 🤔 | The hook has 45 s (`hooks.json`). `gh pr view` may take 30 s and the release lookup 20 s. On main an unattested merge with no grant already makes both calls; the planned order adds a granted one. What Claude Code does with a `PreToolUse` hook that times out was not run by anyone. If it lets the call through, a slow `gh` opens the gate today. | An issue to measure it, on the user's go-ahead. Not this feature's. |

### Testing Strategy
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E2 | 🎯 | Three things the contract states have no row that can fail. **`log` mode**: a version that sends the last refusal through `hookio.refuse`, the obvious tidy-up of the copy plan row V flags, passes all 25 rows and lets an `--admin` merge and an unattested merge through in `log` mode with no override typed (run). The contract says "in `log` mode too"; no merge-gate test sets the mode. **FR-006**: a version that reads the grant before taking the lock passes all 25 rows (run). The lock-wait row grades which file is locked, not that the grant is read under it. **FR-014**: the scratch copy leaves the README unchanged and every row passes (reviewer); the last row checks only that the old name is gone. Also FR-005's "nothing shown" for a prompt that is not an override has no row. Plan row IV says Pass. | Four rows. Guard: in `log` mode both merges are refused, the note included; wrong version: the refusal through `hookio.refuse`. Lock-wait row extended: while the lock is held the grant is taken away, and the waiting merge is refused; wrong version: the grant read before the lock. Run: refused on the scratch copy, let through on that wrong version, every time. "Several at once, one passes" caught it in 1 of the reviewer's 5 tries and 0 of the author's 6, so it is not the row. New: the README's State section lists the record. Guard: a prompt that is not an override prints nothing and writes nothing; wrong version: the answer built before the keyword is matched. |
| E5 | 💡 | The last row also requires that of the scripts only `hookio.py` spells `fcntl` or `SESSION_ID`. It grades spelling across the whole plugin: a second copy with another lock passes, and a later, sound use of `fcntl` in another script fails a merge-gate test. The reviewer read it as a lint landing with the code it grades (Principle VI). The author reads it as a test written red first, as `Marker` is, so not a VI conflict; the user may rule otherwise. | Narrow it to what FR-007 and FR-008 say: `pre_merge_gate.py` spells neither. Keep "no file spells the old folder", the tripwire for PR #31. |
| E6 | 💡 | A guard row is "first seen to fail on the wrong version". The wrong versions are scratch files. Nothing in the PR will show a guard row was ever red, which is what Principle IV asks of a test. | Plan Testing says where it is shown: each guard test's commit message names the wrong version in one line and carries the failing output. |

### Operational Readiness

No finding. `errors.log` is written (FR-016, reviewer); the upgrade note is in the plan's Constraints.

### Dependencies & Integration
| ID | Severity | Finding | Suggestion |
|----|----------|---------|------------|
| E7 | 💡 | Small disagreements. The spec's term "needs an override" leaves out the no-head case the contract has. When the write-back fails, the note says the overrides "could not be read", though the grant was read and then lost (reviewer; #48). PR #31 does add the old folder's name to the README (run: its diff), as R7 says. | Add the case to the term. The note says "could not be used". |
| E8 | 🤔 | `gh` not on the hook's path, with a grant held: `--admin` is refused and told the user types `override-merge #12`, which changes nothing there (run, main and scratch). It is the line the plan edits, and the same kind of defect as X2. | Fold it in: that refusal says an override cannot be applied until `gh` is on the hook's path; one existing test changes. Or an issue. The user's call. |

---

## Cross-Lens Insights 🔗

| ID | Finding | Product Impact | Engineering Impact | Suggestion |
|----|---------|---------------|-------------------|------------|
| X1 🎯 | A grant no merge needed stays live. Run, and reviewer apart: override for PR 12, an attested merge of it passes, then `gh pr merge 12 --admin` on another repo's PR 12 passes with no override typed for it. On main that merge is refused. Nothing ends a grant but its spending; the record is never deleted, so it outlives a resume, and it cannot be withdrawn. | The user allowed one merge of one PR. It now waits for any later merge of that number that needs it, in any repo of the session. Sessions here span repos. The user chose this order on a critique that did not say so. | Spec line 146 calls the cross-repo case "unchanged" and line 195 "not changed here": the matching rule is, the window is not. R5's "What it costs" leaves it out. "Matched by PR number alone" is the one deferred gap with no issue. Until #51, nothing records the later spending. | Correct both lines; state the cost in R5 and the data model. Then the user's choice. **Keep and track** (recommended): an issue for a grant that names its repo and ends. While a shell command can write a grant outright (#50), a lingering one adds little. **Bound now**: a grant ends at the session's next prompt that is not an override; a new rule, back to the plan. **Go back**: any merge of that PR spends it, as on main. |
| X2 🎯 | Session id that is not a plain name: the `--admin` refusal says the user types `override-merge #12`; typing it answers `could not be recorded… session_id '../../escape' is not a name a state file can be kept under` and names no step (run, reviewer). No document says "new session". | The user does as told and is refused again, with nothing to try. | Plan row P1 says "Every answer names the next step". Principle P1 asks it of every refusal. The first critique's E2 asked for this sentence. | The id's answer ends with what can be done: no override can be kept in this session; the merge waits for its requirements or is run from another session. FR-010, the contract's row, R3, plan row P1. |

---

## Findings Summary

| Metric | Count |
|--------|-------|
| 🎯 Must-Address | 4 |
| 💡 Recommendations | 6 |
| 🤔 Questions | 2 |
| Product findings | 1 |
| Engineering findings | 9 |
| Cross-lens findings | 2 |

---

## Consolidated Findings Table

| ID | Lens | Severity | Category | Finding | Suggestion |
|----|------|----------|----------|---------|------------|
| X1 | Cross-lens | 🎯 | Value × Security | A grant no merge needed stays live across repos until spent; the spec says "unchanged" | Correct and state the cost; the user chooses: keep and track, bound now, or go back |
| X2 | Cross-lens | 🎯 | UX × Constitution P1 | For a session id that is not a plain name the answers name a step that cannot work | The answer says what can be done; plan row P1 corrected |
| E1 | Engineering | 🎯 | Failure modes | A plugin module that does not load turns a typed override into a trace; R4 says it cannot | The log guard lets any failure pass; one new row |
| E2 | Engineering | 🎯 | Testing | `log` mode, FR-006 and FR-014 have no row that can fail; two wrong versions pass all 25 | Four rows |
| E3 | Engineering | 💡 | Security | A foreign record's content is quoted to the user and agent in the plugin's voice | As the switch: content to `errors.log` only |
| E4 | Engineering | 💡 | Failure modes | A release reader that raises refuses a granted merge; the way through is unsaid; row P3 omits `unmet` | Say it; one guard row; correct row P3 |
| E5 | Engineering | 💡 | Testing | The spelling check covers the whole plugin and is brittle | Narrow it to `pre_merge_gate.py` |
| E6 | Engineering | 💡 | Testing | A guard row's red run has no home in the PR | The commit message carries it |
| E7 | Engineering | 💡 | Consistency | The term omits the no-head case; the note says "read" where the write failed | Two wordings |
| P1 | Product | 💡 | Success measurement | "Shown to the user" is tested as "emitted by the hook" | One by-hand quickstart step |
| E8 | Engineering | 🤔 | Failure modes | `gh` not on the hook's path: the refusal names an override that cannot help. On main today | Fold the wording in, or an issue |
| E9 | Engineering | 🤔 | Performance | The hook's 45 s is less than the 50 s its two `gh` calls may take; a timeout's effect is unmeasured | An issue to measure it |

---

## Recommended Actions

### 🎯 Must-Address (Before Proceeding)
1. **X1**: `spec.md` Edge Case (line 146) and Assumption (line 195) say what changes; `research.md` R5 "What it
   costs" gains the measured sequence; `data-model.md` life table says an unspent grant stays with the record.
   Then the user's choice of the three. "Bound now" or "go back" returns to `/speckit-plan`.
2. **X2**: `spec.md` FR-010 gains "the answer MUST say that no override can be kept in that session".
   The contract's row for such an id and `research.md` R3 carry the sentence. `plan.md` row P1 says what is true.
3. **E1**: `research.md` R4 Decision; one row in the contract's test list; `plan.md` row V's reason stays true.
4. **E2**: four rows in the contract's test list; `research.md` R7 and `plan.md` Testing counts follow.

### 💡 Recommendations (Strongly Suggested)
1. **E3**: `research.md` R2, the contract's damaged-record answer, `spec.md` FR-009 and FR-011 unchanged.
2. **E4**: `research.md` R5, the contract, one guard row, `plan.md` row P3.
3. **E5**: the contract's last new row, `research.md` R7, `quickstart.md` step 2.
4. **E6**: one line in `plan.md` Testing for `/speckit-tasks` to carry.
5. **E7**: `spec.md` Terms; the note's wording in the contract and `research.md` R5.
6. **P1**: one step in `quickstart.md`.

### 🤔 Questions (Need Stakeholder Input)
1. **X1**: keep and track, bound now, or go back?
2. **E8**: fold the `gh`-not-on-path wording into this feature, or open an issue?
3. **E9**, and the issue under X1: open them?

### Not run by anyone
- Whether Claude Code shows the line to the user (P1), and what it does with a hook that times out (E9).
- The rows as real tests in the repo; they were run as scratch rows only.
- The rows that make a folder read-only, when run as root.

---

**Severity Legend**:
- 🎯 **Must-Address**: Blocks proceeding to implementation
- 💡 **Recommendation**: Strongly suggested improvement
- 🤔 **Question**: Needs stakeholder input to resolve

---

*Generated by `/speckit.critique` — Dual-lens strategic and technical review for spec-driven development.*
