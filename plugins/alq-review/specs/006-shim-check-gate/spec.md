# Feature Specification: Shim check before commit

**Feature Branch**: `feat/49-shim-check-gate` (#49)

**Created**: 2026-10-02

**Status**: Draft

**Input**: The code quality gate design, version 2: [Refuse the shim at the commit](https://claude.ai/artifact/REN6tz6DW1KFhjoDLYv7M8).
Its 0.1 table names four code problems (C1–C4) and its 0.2 table four gaps (CG1–CG4). This spec builds the one
open gap with a decided solution, CG1. Its sibling page, the [prose quality gate](https://claude.ai/artifact/7A7296Sc2WdUpoYDkYiu4H),
takes the prose and mixed hunks.

## Clarifications

### Session 2026-10-02

- Q: Which commits are checked: only on a branch with an open PR, or every commit like the claim check? → A: Every
  commit, on any branch of a GitHub repo, PR or not, like the claim check.
- Q: Does the check's own setting ship as `log` or `enforce`? → A: `enforce` from the first release; no
  record-only phase.
- Q: What may the assessor rule on a contested site? → A: Three rulings: shares the defect, does not share it, or
  shares it but is deferred to a named open issue; a deferred site counts as covered only with that issue.
- Q: What limits repeated refusals? → A: Count refusals per bug, across all its sites. A commit continues a refused
  bug when it edits a site that refusal listed or a line the earlier fix changed. At the 3rd refusal of one bug a
  deep sweep sets the full site list; if the next commit is still refused, the user is asked. (Release revised by
  the critique E2 answer below.)
- Q: How are sweep misses detected? → A: Automatically, per bug: a later refusal of the same bug, or its deep
  sweep, that names a site present at an earlier check but not listed by it is logged as that check's miss. The user
  reads the log; nothing acts on it.
- Q: Where does a bug's count apply? → A: To one branch; a commit on another branch never continues it.
- Q: (critique X1) The `level` question assumes a defect; should non-fix commits be judged? → A: No. The
  classifier first decides whether the commit fixes a defect; only fixes are swept and judged, other commits pass
  with that answer logged. Non-fix commits are replayed before release.
- Q: (critique E1) Should the deep sweep use the `alq-anti-pattern` duplication agent? → A: No. Its third agent is
  an alq-review sweeper that searches from the callers of the changed code.
- Q: (critique P1) Should the every-commit scope be reviewed after a trial period? → A: No. Every commit stays
  checked; there is no review trigger.
- Q: (critique E2) How does the user let a commit through a check that refuses, is stuck or failed, and how long
  does it last? → A: One typed override per check, offered in every refusal. It covers that bug on that branch until
  a commit lands, however often the author re-stages; it never returns to the check in that time. It replaces the
  `unlock` of the earlier answer.
- Q: (critique P2) Should a refusal say which listed sites the change touched? → A: Yes, as a git fact per site.
- Q: (implementation, replay) What does SC-001 measure? → A: Only the evidence fixes are scored, each against its
  expected verdict: a patch is caught, a complete fix passes. Non-fix commits are not scored. 053e0ec9 is expected
  `patch`.
- Q: (critique E7) How is the release made safe for the bot? → A: Before the version is bumped, one classifier call
  must succeed on the bot.

## Background

When an agent fixes a defect it patches the site a reviewer named and leaves the same defect at other sites
(C1). The review loop sees this only when it recurs: every signal alq-review computes starts at round two, so
round one cannot tell that a fix left siblings unfixed. Plugins #352 took several rounds to notice.

What already covers the other three problems, and why they are out of scope here:

| Problem | Gap | State | In this spec |
|---|---|---|---|
| C1 Fix patches the named site only | CG1 | Designed and replayed, not built | **Yes** |
| C2 The fix causes the next finding | CG2 | Stop-and-ask after 2 fix-induced rounds; not decided, needs the user's approval | No |
| C3 Design rebuilt inside the review loop | CG3 | Third-edit rule built (0.1.3); effect not measured | No |
| C4 Findings acted on before every reviewer reports | CG4 | review-round + assess-round, enforced since 2026-09-18 | No (closed) |

Evidence, not restated here: the 14-commit replay and the 36-branch sibling-sweep replay, both on the design page,
section 2.

## User Scenarios & Testing *(mandatory)*

The author is an agent that edits files and commits, on any branch, with or without a PR. The user owns the repo
and is asked only when the gate escalates. The assessor is an independent, read-only judge agent of alq-review:
not the author and not the user. The review-round assessor is bound to a PR's round, so a contested site gets a
fresh judge of the same standing (plan R7).

### User Story 1: A fix that leaves sibling sites is refused at commit (Priority: P1)

When the author commits a change with code that fixes a defect, a sweep finds every site in the repo that performs the same operation
as the changed code, as the tree stood before the change. The fix is then judged on two questions: does it act on
the defect's cause or correct the symptom afterwards, and does it reach every same-operation site that has the
same defect. A fix that acts on the cause and leaves no listed site with the defect is complete and the commit
goes through. Anything else is a patch: the commit is refused and the refusal lists the sites it left out and
both answers.

**Why this priority**: this is the gap. Without it, a sibling left behind is found only by recurrence, rounds
later.

**Independent test**: in a stub repo with the same unchecked-input defect in two functions, fix one and commit.
The commit is refused and the refusal names the other function's file and line.

**Acceptance scenarios**:

1. **Given** a staged fix that corrects one of two sites with the same defect, **When** the author commits,
   **Then** the commit is refused and the refusal lists the unfixed site with file, line, function and what it
   does, and states level `cause` and coverage `edited_only`.
2. **Given** a staged fix that corrects both sites at their cause, **When** the author commits, **Then** the
   commit goes through.
3. **Given** a staged fix that corrects the wrong value after it is produced, at every site, **When** the author
   commits, **Then** the commit is refused with level `symptom`.
4. **Given** a staged feature or refactor change that corrects no defect, **When** the author commits, **Then**
   the classifier labels it `not_fix`, no sweep runs, the label is logged and the commit goes through.
5. **Given** a staged change whose hunks are all labelled prose, **When** the author commits, **Then** no
   sweep runs and this gate adds nothing.
6. **Given** a staged change with a hunk labelled mixed, **When** the author commits, **Then** that hunk is
   swept here and also sent to the prose gate.

---

### User Story 2: A contested site is ruled once, by the assessor (Priority: P2)

The author may contest a listed site: it does not share the defect, or it does but its fix belongs in another
change. The assessor rules the site, not the user.
The ruling is stored per repo, whether or not the branch has a PR, so the same site is not raised again for the same
bug.

**Why this priority**: the sweep lists by behaviour and can over-list. Without a ruling path, the author either
edits code that is already right or the gate has no exit.

**Independent test**: refuse a commit on a site that does not share the defect, contest it, and retry. The
assessor rules the site out, the commit goes through, and a second retry does not re-ask.

**Acceptance scenarios**:

1. **Given** a refusal listing a site, **When** the author contests it and the assessor rules it does not share
   the defect, **Then** coverage is judged without that site and the ruling is stored.
2. **Given** the assessor rules a contested site does share the defect, **When** the author retries without
   fixing it, **Then** the commit stays refused.
3. **Given** a stored ruling for a site, **When** the same bug is checked again, **Then** the site is not
   re-contested or re-ruled.
4. **Given** a contested site that shares the defect but whose fix belongs in another change, **When** the
   assessor rules it `deferred` naming an open issue, **Then** the site counts as covered and the commit can go
   through; a `deferred` ruling without an open issue is not accepted.

---

### User Story 3: A bug that keeps turning up new sites gets a deep sweep (Priority: P2)

The sweep is repo-wide, yet it misses sites (2 in 14 replayed commits). When a fix to a.py is refused for b.py,
the fix to b.py is refused for c.py, and the fix to c.py is refused for d.py, each refusal is the same bug. At the
third, the gate stops trusting the single sweep: a deep sweep finds every site of that bug, and the fix must cover
that whole list. If the bug is refused once more after that, the user decides.

**Why this priority**: without it, a recall miss turns into a site-by-site chase, which is exactly C1 again, one
commit at a time.

**Independent test**: in a stub repo with one defect at four sites, where the normal sweep is stubbed to list one
new site per check, commit three partial fixes. The third refusal runs the deep sweep and lists all remaining
sites; one more refused commit asks the user.

**Acceptance scenarios**:

1. **Given** a `patch` refusal listing b.py, **When** the next commit edits b.py, **Then** it counts as the same
   bug's 2nd attempt; a commit editing neither a listed site nor the earlier fix's lines starts a new count.
2. **Given** a `symptom` refusal, **When** the next commit edits the same lines again, **Then** it counts as the
   same bug.
3. **Given** a bug's 3rd refusal, **When** the refusal is issued, **Then** the deep sweep runs and the refusal
   lists every site it found; that list, not the single sweep's, is the bug's coverage target from then on.
4. **Given** a bug that has had its deep sweep, **When** a further commit for it is refused, **Then** the commit
   stays refused and the refusal asks the user; **When** the user types the override it names, **Then** the commit
   goes through, and so does every re-staged version of that bug's change until a commit lands.
5. **Given** any refusal by this check (not checked, running, failed, `patch`), **When** the user types the
   override it names, **Then** the check is off for that bug on that branch until a commit lands; the override is
   logged.
6. **Given** a `complete` verdict for a bug, **Then** its count ends.

---

### User Story 4: The check is paid for once per staged tree (Priority: P3)

A check is recorded against the staged tree it judged. Retrying a commit of the same tree reuses that verdict;
any change to the staged tree needs a new check. The cost of each check is visible.

**Why this priority**: the sweep is the expensive step (100–135k tokens, 2–4 minutes), and a commit is often
retried after an unrelated hook failure.

**Independent test**: run a check, retry the commit with the tree unchanged, and see no second sweep; change one
line and see a new one.

**Acceptance scenarios**:

1. **Given** a recorded verdict for a staged tree, **When** the author retries the commit unchanged, **Then** the
   recorded verdict applies and no sweep runs.
2. **Given** a recorded verdict, **When** the staged tree changes, **Then** the commit is refused until a new
   check runs for the new tree, and the refusal names that check.

---

### Edge Cases

- The sweep or the classifier fails or does not report: the commit stays refused; the refusal says the check
  failed, not that the fix is a patch, and names the retry.
- The code diff is too large for the classifier: the check fails and the refusal says to split the commit.
- The sweep files a real duplicate under callers instead of same operation (seen on 49320e88): coverage is
  judged only on the same-operation list, so the gate passes it. This is a known limit of sweep recall, not a
  gate error. It is logged as a miss once a later refusal of the same bug names that site (SC-004), not patched over.
- The fix is a class fix for the files it touched but not for the repo (bf12120a): it is a patch, because
  coverage is repo-wide by decision.
- The classifier would answer "complete?" differently from the two answers: its own overall answer is not asked;
  the verdict is composed from the two answers only.
- A commit on a branch with no PR: checked like any other; a contested site is still ruled and stored (FR-009).
- A commit outside a branch of a GitHub repo (detached HEAD, no GitHub origin): not checked, as for the claim check.
- A fix-induced defect or a design problem (C2, C3): not visible to this check; the 36-branch replay showed many
  later turns come from these.
- One commit edits sites of two refused bugs: it counts toward both (FR-015 applies to each).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On every branch of a GitHub repo, PR or not, the commit gate MUST refuse a commit whose staged change
  has any hunk labelled code or mixed, until a shim check is recorded for that staged tree. The refusal MUST name the check to run.
  The commit gate's existing exemptions apply unchanged: an empty commit and a commit that concludes a merge,
  cherry-pick or revert are not checked; files marked `linguist-generated` and binary files have no hunks.
- **FR-002**: Hunks MUST be labelled `CODE`, `PROSE` or `MIXED` by the claim check's existing reader, per hunk.
  File extension MUST NOT decide it. Prose-only changes MUST NOT be swept.
- **FR-003**: The sweep MUST receive the staged diff and the complete tree before the change, and nothing else.
  It MUST judge by behaviour, not by name, MUST only find (never edit), and MUST return exactly two lists:
  SAME OPERATION and CALLERS/CONSUMERS, each entry as file:line, function, and what it does. Its output MUST
  conform to a pinned schema; non-conforming output fails the check.
- **FR-004**: Coverage scope MUST be the whole repo.
- **FR-005**: The classifier MUST first be asked, over the code and mixed hunks' diff alone, **kind** (`fix` |
  `not_fix`: does the change correct a defect in existing behaviour?). A `not_fix` commit MUST NOT be swept; it
  passes and the label is logged. For a `fix`, after the sweep, it MUST be asked exactly two choice questions over
  the diff and both lists: **level** (`cause` | `symptom`) and **coverage** (`all` | `edited_only` |
  `none_other`).
- **FR-006**: The verdict MUST be computed, not asked: `complete` iff kind is `not_fix`, or level is `cause` and
  coverage is `all` or `none_other`; otherwise `patch`.
- **FR-007**: A commit MUST NOT land while this check is anything but `complete` for its tree, unless the user
  has overridden it (FR-017). A `patch` verdict MUST refuse it and list the SAME OPERATION sites plus both answers,
  marking for each site whether the staged change touches it (a git fact, not a judgement).
- **FR-008**: Each check MUST be recorded against its staged tree with the verdict, both answers and the listed
  sites. A retry on the same tree MUST reuse it.
- **FR-009**: A contested site MUST be ruled by the assessor, per site, as one of: `shares` (the site stays and must
  be fixed), `not_shared` (the site is dropped from coverage), or `deferred` (the site shares the defect but its fix
  belongs in another change; the ruling MUST name an open GitHub issue, and the site counts as covered only while
  it does). Rulings are stored per repo, outside any PR's review ledger, so a branch without a PR can contest too and
  the site is not raised again for the same bug (FR-015).
- **FR-010**: A failed sweep or classifier call MUST leave the commit refused, with a refusal that says the check
  failed and names the retry.
- **FR-011**: The check MUST run on every repo the plugin is installed in, private repos included.
- **FR-012**: Each check MUST report its cost in the gate log: agents run, wall time, and the classifier's billed
  cost. Sweep tokens are not reported: the workflow runtime cannot attribute tokens to one workflow (spec 005 R10).
- **FR-013**: The gate MUST reuse the commit gate's existing shapes (refusal naming the next call, schema-pinned
  structured output checked by the hook, ledger entry keyed by staged tree) rather than add new ones.
- **FR-014**: The check MUST have its own setting, `log` or `enforce`, like `spec_checks` and `claim_checks`, so it
  can be rolled back alone. It ships as `enforce`. Under `log` a `patch` verdict is recorded as a would-deny and the
  commit goes through.
- **FR-015**: Refusals MUST be counted per bug, not per site or commit, and each count belongs to one branch. A commit
  MUST count as the same bug as an earlier `patch` refusal on its own branch when it edits a site that refusal
  listed or a line the refused fix changed; a `complete` verdict ends the count.
- **FR-016**: At a bug's 3rd refusal the gate MUST run a deep sweep: two independent sweeps with the standard
  prompt plus one sweep that searches from the callers and consumers of the changed code, all alq-review agents,
  their SAME OPERATION lists merged. That merged list MUST be the
  bug's coverage target for every later check of it.
- **FR-017**: After the deep sweep, the next refusal of that bug MUST ask the user. Every refusal of this check
  MUST name an override the user can type. A user-typed override MUST switch this check off for that bug on that
  branch until a commit lands, whatever the check's state; re-staged changes of the same bug MUST NOT be checked
  again in that time. Only a user prompt can override; the override MUST be logged. Other checks are not affected.
- **FR-018**: The gate MUST log a sweep miss against an earlier check whenever a later refusal of the same bug, or
  its deep sweep, names a site that was in the tree at that check but absent from its SAME OPERATION list.

### Key Entities

- **Hunk label**: per staged hunk, code / prose / mixed, from the claim check's reader.
- **Sweep result**: the two site lists for one staged tree.
- **Shim verdict**: staged tree, level, coverage, composed verdict, listed sites, cost.
- **Bug chain**: the run of refusals on one branch counted as one bug (FR-015), its count, and its deep-sweep site
  list once it has one.
- **Site ruling**: the assessor's per-site decision on a contested site, kept per repo, PR or not.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Replayed on the commits of the design's evidence table, the built check gives the right verdict on
  every commit the table marks right (both class fixes complete, the 8 patches patch, bf12120a patch), and gives
  053e0ec9 patch (the gate sees no commit message; the table's `complete` was obtained with it).
- **SC-002**: 0 commits whose hunks are all prose are swept.
- **SC-003**: A checked commit adds at most 4 minutes in the typical case, and a retry of an unchanged tree adds
  no sweep.
- **SC-004**: Every sweep miss detectable through a bug chain is logged against the check that missed it (a site
  named by a later refusal of the same bug, or by its deep sweep, that was in the tree at the earlier check but not
  listed). The design's baseline is 2 misses in 14 commits. The log is read by the user; no threshold acts on it.
- **SC-005**: 0 contested sites are ruled twice for the same bug.

## Assumptions

- Jev (via OpenRouter) is the classifier; its terms are accepted for private source.
- The hunk-labelling reader ships in alq-review 0.7.0 (merged); the installed copy must be at least that version.
- The prose gate is a separate feature; a mixed hunk is handed to it once it exists, and this spec does not wait
  for it.
- The same override for the claim check belongs to spec 005 and is tracked separately.
- Before a release that enables the check is installed on the bot, one classifier call must succeed there.
- CG2 (stop after two fix-induced rounds) is not part of this feature and waits for the user's approval.
