# Feature Specification: Claim check before commit

**Feature Branch**: `feat/43-claim-check-gate`
**Created**: 2026-10-01
**Status**: Draft
**Issue**: [#43](https://github.com/analitiq-ai/engineering/issues/43)
**Input**: The claim-check study run in session 60700fd1 and the three decisions the user took there: the check
lives in the `alq-review` plugin as a gate, only a `WRONG` verdict blocks a commit, and it covers every repo the
plugin is installed in.

## Clarifications

### Session 2026-10-01

- Q: Should a `WRONG` verdict be confirmed by a second checker before it refuses a commit? → A: No. One checker's
  `WRONG` stands; the author looks into it and fixes whatever makes the claim inaccurate.
- Q: When is blocking turned on? → A: From the first release. There is no record-only phase and no accuracy bar
  to pass first.
- Q: Can the author contest a verdict? → A: Yes, but a contest must rest on facts and research (evidence the
  checker can verify), not on assumption.
- Q: Who re-judges a contest? → A: A fresh checker, given the claim, the first verdict and the evidence.
- Q: How many refusals of one claim before the user decides? → A: 3.
- Q: How does the user release a claim refused 3 times? → A: With the existing user-typed `unlock`, naming the
  claim. It covers that claim at its current text and ends when the claim changes. (The count after a release
  is settled on 2026-10-06, below.)
- Q: Does rewording a flagged claim reset its refusal count? → A: No. The 3 refusals count attempts at that
  claim, however it is reworded; after 3 attempts the user is involved.
- Q: May a contest cite an outside source? → A: Yes. The checker that re-judges a contest may fetch a cited
  source; it still cannot change any file.
- Q: Are commit messages checked? → A: No; only the staged diff.
- Q: Cap on claims judged per commit? → A: No cap. A commit with more than 20 claims gets a warning; every claim
  is still judged, and the user decides whether to split it into several PRs.
- Q: What happens to the commit when the checker itself fails? → A: It stays refused, and the refusal says the
  check failed, not that a claim is wrong, and names the retry.

### Session 2026-10-02

- Q: What unit does the refusal count use? → A: One count per git hunk, as git makes it; a new file is one hunk.
  Counts are never summed across hunks or files. The user is involved as soon as any one hunk reaches 3.
  (Replaced on 2026-10-06, below.)
- Q: Does a contest count toward the bound? → A: A rejected contest counts as one refusal; an upheld one counts
  none and replaces the verdict.
- Q: Is a change that only removes text checked? → A: Yes. Removing words can change what a claim says.
- Q: Can the claim check be switched off on its own? → A: Yes, it has its own setting, separate from the review
  gate's; it ships blocking.
- Q: What if the repo's commit hook reformats files after the check? → A: Nothing happens. The repo's commit
  hooks are cosmetic checks and validations; what they change is not checked again.
- Q: What if every judged claim is about another repo, so every verdict is an uncited `UNSURE`? → A: The check is
  complete and the claims are notes. A check fails only when a reader or judge did not report.
- Q: May the contest checker follow links? → A: Yes, within the sites the contest cites, and nowhere else.
- Q: Who decides whether the check works well enough? → A: The user, by reading its log. No threshold is built in.

### Session 2026-10-06

Recorded in issue #17 and ratified as ADR-0001.

- Q: What unit does the refusal count use? → A: One count per claim, followed through its rewordings as a
  lineage. Not per hunk: a hunk shares one count across every claim in it, and a new file is one hunk. Counts
  are never summed across claims.
- Q: Does a commit of other work change a count? → A: No. No count and no lineage is keyed on `HEAD` or on a commit.
- Q: How is a reworded claim known to be the same claim? → A: By a diff of the two versions of its file, never
  by a model and never by a similarity threshold.
- Q: What is not followed? → A: A claim moved and reworded in one step, and the half of a split that lands in
  a pure insertion. Each starts a new count.
- Q: What happens to the count after `unlock`? → A: It stays. The release covers the words as they are; a later
  rewording is checked again, and one more `WRONG` brings the user back.
- Q: May a check be launched while a claim is stopped and not yet released? → A: No. The gate waits for the
  user. A `CORRECT` ruling or a deletion ends a count only below the bound or after a release.

## Background

Prose written by an agent states facts about the code next to it: what a validator does, which cases a rule
covers, what a step runs. A reviewer finds the wrong ones late, in review rounds, after they were committed and
copied into other documents. The study ran a four-step pipeline over a sample of commits to see whether wrong
claims can be found before the commit.

Evidence, not restated here:
- The sample, the method of each step and every per-hunk label: [the study](./plugins-random-commits.md).
- Which of the `WRONG` verdicts were spot-checked and how: the same file, Step 4, and the session history of
  60700fd1.

## User Scenarios & Testing *(mandatory)*

The author is an agent that edits files and then commits. The user is the person who owns the repo and reads
the refusals when they escalate.

### User Story 1: A wrong claim is refused at commit and handed back (Priority: P1)

When the author commits a change that adds a statement of fact about the repo's own code, contracts, validator
or CI, the statement is checked against the code as it stands in the staged change. A statement the check finds
false is returned to the author with the reason, and the commit does not happen until the author has corrected
it.

**Why this priority**: this is the whole purpose. In the study sample, about a third of the checked claims were
ruled wrong, and each would otherwise have reached a reviewer.

**Independent test**: in a stub repo, commit a sentence that says a function rejects a case it accepts. The
commit is refused and the refusal quotes the sentence and names the case that falsifies it.

**Acceptance scenarios**:
1. **Given** a staged change adds the sentence "the validator rejects an empty list" and the validator accepts
   an empty list, **When** the author commits, **Then** the commit is refused and the refusal names the file,
   the line, the claim, and the empty-list case that falsifies it.
2. **Given** a staged change adds a sentence that is true of the code, **When** the author commits, **Then** the
   commit goes through and the check adds no output.
3. **Given** a staged change adds a claim about code that is not in the repo being committed, **When** the
   author commits, **Then** the commit goes through and the author is told the claim could not be checked.
4. **Given** a staged change whose added lines are all code, **When** the author commits, **Then** no claim is
   judged and the commit goes through.
5. **Given** a staged change that only removes text, **When** the author commits, **Then** the sentences around
   the removal are checked as they now read.
6. **Given** a staged change that adds a code line together with a comment stating a fact about it, **When**
   the author commits, **Then** the comment is checked and the code line is not.

---

### User Story 2: The author can correct or contest a verdict, and the loop ends (Priority: P2)

A refusal lists each wrong claim with its failing case. The author looks into each one and fixes whatever makes
it inaccurate: the claim is rewritten to what the code does, the code is fixed, or the wording that overstates
the claim is narrowed. The repair loop has a bound, and when it is reached the decision goes to the user.

**Why this priority**: a blocking check with a noisy verdict and no exit teaches the author to weaken the
wording until it passes, which hides the defect it found.

**Independent test**: in a stub repo, make the check refuse the same claim on consecutive attempts. At the bound
the commit stays refused and the refusal asks the user, by name, what to do.

**Acceptance scenarios**:
1. **Given** a refusal, **When** the author rewrites only the flagged claims and commits again, **Then** only
   the changed hunks are checked again.
2. **Given** the author contests a verdict with evidence (a file and line in the staged tree, or a cited
   source that was read), **When** the check is run again, **Then** the contested claim is re-judged by a fresh
   checker given the claim, the first verdict and that evidence, and the outcome is recorded.
3. **Given** a contest that offers only an assertion or an assumption, **When** the check is run again,
   **Then** the verdict stands, the contest is not re-judged, and the author is told what evidence is missing.
4. **Given** one claim has been ruled `WRONG` by 3 checks, with its wording changed between them or not,
   **When** the author commits again, **Then** the commit stays refused and the refusal states the open question
   for the user, with that claim's words and ruling at each check. Other claims ruled `WRONG` fewer times, in the
   same hunk or not, do not add to that count.
5. **Given** a claim stopped at 3 and not yet released, **When** the author launches a check, **Then** the
   launch is refused with the question for the user. **When** the user types the existing `unlock` naming it, **Then** the commit
   goes through with that claim as it stands. **When** the author then changes its words, **Then** it is checked
   again with its count kept, and one more `WRONG` asks the user again.
6. **Given** a claim ruled `WRONG`, **When** a commit of another file lands, or the last commit is amended, and
   the same words are staged again, **Then** its count is unchanged.
7. **Given** a claim ruled `WRONG`, **When** its sentence is split in two in place, **Then** both parts carry its
   count. **When** two such claims are merged into one, **Then** that one carries the larger count, not the sum.
8. **Given** a claim ruled `WRONG`, **When** its words are moved unchanged within the file, **Then** its count is
   unchanged.
9. **Given** a claim ruled `WRONG`, **When** a later check rules it `CORRECT`, or its words are deleted, **Then**
   its count ends.
10. **Given** one check that rules two claims of one hunk `WRONG`, **Then** each claim's count rises by one.

---

### User Story 3: The cost of a check is visible, and a large one is flagged (Priority: P3)

A check judges every claim with its own read-only search of the code, which is the expensive part. The author
and the user can see what a check cost. A commit with many claims is flagged so the user can decide to split
it; the flag never leaves a claim unjudged.

**Why this priority**: the study measured a large token cost per claim, so a commit with many claims could cost
more than the work it guards, and the user, not the gate, decides when a commit is too big.

**Independent test**: stage a change with 21 claims. The check judges all 21, warns that the commit is over 20 claims,
and shows the cost.

**Acceptance scenarios**:
1. **Given** a staged change with more than 20 claims, **When** the author commits, **Then** every claim is
   judged and the author and the user are warned that the commit is large and may be better split into several
   PRs. The warning does not refuse the commit.
2. **Given** a claim already judged in an earlier attempt and unchanged since, **When** the author commits
   again, **Then** it is not judged again.
3. **Given** a check has run, **When** the author or the user reads its result, **Then** the number of claims
   judged and the cost are shown.

---

### Edge Cases

- A claim the extraction returns as a sentence fragment: the checker is given the surrounding sentence, so it
  does not judge a wider or narrower claim than the author wrote.
- A hunk longer than the checker can read in full: the claim is still extracted from the whole added text.
- A claim about code that the same commit also changes: the staged code is the source of truth, not the last
  commit.
- An empty commit, or a commit that concludes a merge, cherry-pick or revert: nothing is checked.
- Tracked files with changes that are not staged: the check is not started until they are staged or discarded,
  so the checkers read exactly what will be committed.
- The repo's own commit hook changes files during the commit: nothing happens; its changes are cosmetic and are
  not checked again.
- A file marked generated in `.gitattributes`: nothing in it is checked.
- A command that stages and commits together (`git add -A && git commit`): refused, because the content it will
  commit is not the content that was checked. The same goes for `git commit -a` and commits that name paths.
- A claim made in a file that is renamed in the commit: it is judged as added text.
- A commit made outside the agent's session, by a person at a terminal: not covered; see Out of Scope.
- The checker cannot read the code that settles the claim: the verdict is `UNSURE`, never `CORRECT`.
- Every judged claim is about another repo: each verdict is `UNSURE`, the check is complete, and the commit
  goes through.
- The checker itself fails or times out (a reader or judge does not report): the commit stays refused, and the refusal says the check failed and
  names the retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST refuse an agent's commit until the staged change has been checked, and the refusal
  MUST name the next step, as the review gate already does. A commit command that also changes what will be
  committed MUST be refused.
- **FR-002**: The system MUST classify each hunk of the staged change by what it contains (code, prose, or both)
  and MUST check only the prose it adds or changes, including comments and docstrings in a hunk that also holds
  code, and including prose changed by removing words.
- **FR-003**: The system MUST NOT run a check for a commit with no staged change.
- **FR-004**: The system MUST find the claims in the added prose and give each one a category, from the eight
  the study used: what the repo's own code does, how an outside tool or standard behaves, a list or an
  "every / only" claim, a status mark, a recorded observation, a command, a citation, and planned behaviour.
- **FR-005**: The system MUST judge every claim about what the repo's own code, contracts, validator or CI does
  against the staged tree, one claim at a time, by reading the code that implements it. A claim in any other
  category is not judged by this feature.
- **FR-006**: The system MUST split a claim into its separate assertions, including implied ones such as
  "every", "only" and "exactly", and MUST return `CORRECT` only when each assertion is confirmed by code that was
  read and no failing case was found.
- **FR-007**: The system MUST return `WRONG` when one assertion is false or has a failing case, and `UNSURE`
  when the code that settles an assertion could not be found or read.
- **FR-008**: The system MUST refuse the commit on a `WRONG` verdict only, and one checker's `WRONG` is enough;
  no second checker confirms it first. A claim judged `UNSURE` MUST be returned to the author as a note and
  MUST NOT block.
- **FR-009**: Each `WRONG` verdict MUST carry the claim, its file and line, the failing case, and the file and
  line that settle it.
- **FR-010**: The system MUST re-judge only the claims whose hunks changed since the last check, and MUST NOT
  reuse a verdict once the claim or the code it was judged against has changed. A `WRONG` verdict MUST be
  judged again whenever anything in the staged change differs, since the fix may be in another file.
- **FR-011**: When 3 checks have ruled one claim `WRONG`, the system MUST stop the repair loop of that claim and
  put the decision to the user, who releases it with the existing user-typed `unlock` naming that claim; an
  agent MUST NOT be able to release it. The release covers the claim at its current words only and does not
  lower its count. While a claim is stopped and not released, a launch of the check MUST be refused. After the
  release, a change to the claim's words MUST be checked again, and one more `WRONG` MUST stop it again at once.
- **FR-012**: The system MUST let the author contest a verdict, and MUST re-judge the claim, with a fresh checker
  given the claim, the first verdict and the evidence, only when the contest carries evidence the checker can verify (a file and line, or a source that was read). A contest without
  evidence MUST leave the verdict standing.
- **FR-013**: The system MUST judge every claim in the commit, MUST warn when a commit has more than 20 claims
  without refusing it, and MUST show the claims judged and the cost of each check.
- **FR-014**: The system MUST apply in every repo the plugin is installed in, and a claim whose settling code
  is outside the repo being committed MUST come back `UNSURE`.
- **FR-015**: The system MUST refuse the commit when the check itself fails or times out, that is when a reader
  or judge does not report, MUST say the check failed rather than that a claim is wrong, and MUST name the
  retry. A check whose verdicts all are `UNSURE` has not failed.
- **FR-016**: The checkers MUST be unable to change any file in the repo.
- **FR-017**: A refusal is counted once per claim, per completed check that rules it `WRONG`, and once per
  rejected contest; an upheld contest counts none. Repeating a commit, or a check of the same staged tree, does
  not count. A claim MUST be followed from one version of its file to the next as ADR-0001 says: by a diff of
  the two versions, never by a model and never by a similarity threshold. Rewording in place keeps the count, a
  split passes it to both parts, a merge takes the larger count, and words moved unchanged within the file keep
  it. A commit, an amend or a rebase MUST NOT change a count. Counts are never summed across claims. A claim
  moved and reworded in one step is not followed and starts a new count.
- **FR-018**: The system MUST record for each check the claims judged, their verdicts, the refusals, contests and
  their outcomes, releases by the user, and the cost, for the user to read.
- **FR-019**: The claim check MUST have its own blocking setting, separate from the review gate's, and MUST ship
  with blocking on.
- **FR-020**: When the repo's own commit hook changes the committed files after the check, the system MUST NOT
  check them again or refuse the push.
- **FR-021**: The checker that re-judges a contest MUST be able to fetch only pages on the sites the contest
  cites.

### Key Entities

- **Hunk**: one contiguous change in a staged file, with the lines it adds and removes.
- **Claim**: a statement of fact found in added prose, with its file, line, category and the sentence it sits in.
- **Verdict**: `CORRECT`, `WRONG` or `UNSURE` for one claim, with its assertions, the evidence for each, and for
  `WRONG` the failing case.
- **Check record**: the claims judged for a commit, their verdicts, and the cost.
- **Contest**: the author's evidence for disputing a verdict, and the outcome of the re-judgement.
- **Lineage**: one claim followed through the versions of its file since a check first ruled it `WRONG`, with
  its words and ruling at each check. The refusal count belongs to it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Replaying the 30 claims of the study sample, the check returns a verdict for all 30 and names a
  file and line for each assertion it settled.
- **SC-002**: In a manual acceptance run (it needs a model, so CI cannot run it) on a stub repo seeded with 10 wrong claims and 10 true ones, the commit is
  refused for every wrong claim the checker rules `WRONG` and for no true one.
- **SC-003**: A commit that adds or changes no prose judges no claim and is let through; an empty commit runs
  no check.
- **SC-004**: A commit adding up to 30 claims is decided within 5 minutes of the commit attempt.
- **SC-005**: Committing again after rewriting one flagged claim judges only that claim.
- **SC-006**: No checker changes a tracked or untracked file in the repo during a check.

## Assumptions

- The check runs inside the agent's session, in the same place the review gate runs; a commit made by a person
  outside that session is not intercepted.
- The measured behaviour of the four steps on the study sample is representative enough to design from; it is
  not accuracy evidence.
- Verdicts rest on reading the code. The checkers have no way to run it in the study setting, so a claim that
  can only be settled by running code comes back `UNSURE`.
- A claim's category and a hunk's kind are labelled by a model, and neither label has been checked against
  hand-labelled truth. The user accepts that the verdicts are unmeasured and blocks from the first release.
- The checkers read the author's working tree, which the gate requires to match the staged change, and cannot
  write to it.

## Out of Scope

- Commit messages: only the staged diff is checked.
- Claims in any category other than the repo's own behaviour. A cited file, field or rule can be checked
  deterministically; that is a separate feature.
- Commits made outside the agent's session.
- Fixing the wrong claim. The check names the failing case; the author corrects it.
- Judging whether prose is well written, or a design is sound.
