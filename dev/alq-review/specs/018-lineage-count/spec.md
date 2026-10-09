# Feature Specification: A held region stays the same through rewording

**Feature Branch**: `feat/17-lineage-count` (#17)

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "The feature in issue #17" (issue #17, "alq-review: decide what makes a held region the same over time (claim holds, shim chains)")

**Decided before this spec**: ADR-0001 (follow a piece of text across edits by a lineage), ADR-0013 (a moved file starts the count again) and ADR-0014 (bugs that converge are one bug), and the decisions recorded in #17. This spec states what they mean for the user; it does not reopen them. It is the only requirements document for the rule: it is written from #17 and the ADRs, not from any earlier spec or pull request.

## Clarifications

### Session 2026-10-08

- Q: Where does the lineage rule live? → A: In this spec alone, written from scratch from #17 and the ADRs; it refers to no earlier spec or pull request.

## Terms

- **Claim**: a sentence in a staged prose change that the claim check rules on.
- **Bug**: a defect in staged code that the shim check tracks across its attempts to fix it.
- **Lineage**: the run of versions of one claim (or one bug) as it is reworded or patched. It has one count.
- **Count**: the number of completed checks in a lineage that ruled it `WRONG` (a claim) or left the bug unfixed (a bug), plus rejected contests. Each gate keeps the stop it has today: the claim check holds at 3; the shim check runs its deep sweep at 3 and holds at 4.
- **Hold**: the stop at a gate's count. Only the user releases it: `unlock claim-<id>` for a claim, `override shim-<id>` for a bug.

## Today

- The claim count restarts when any commit lands on the branch, even one that never touched the claim. It defeats the bound: an agent can reword a wrong claim for ever, committing something else in between.
- The shim count restarts the same way when the branch's head moves. A bug patched, then left while another file is committed, is a new bug at count 1.
- One check can add two refusals to one hold, so a hold is reached a check early.
- A change that reaches two held regions continues only the first.
- The "not touched" mark for a bug's site reads wrong when an edit lands inside a function but not on its first line: a site is one line, the function's first.
- A hunk is the unit of the claim count, so three claims, each wrong once, reach 3 in one hunk of a new file and stop the user's work on progress.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The count follows a claim through its rewordings (Priority: P1)

An agent reworks a sentence through review rounds. Each rewording that is still wrong adds to one count for that claim, however the sentence is reworded, moved within the file, or whatever else is committed meanwhile. At 3 the commit is refused and the user is shown the whole chain.

**Why this priority**: It is the bound's purpose: bring a human in on too much churn on one claim, and on nothing else. It closes #15.

**Independent Test**: Walk a claim through three `WRONG` rulings, each on a reworded version, with an unrelated commit and an amend between them. The third ruling holds.

**Acceptance Scenarios**:

1. **Given** a claim ruled `WRONG` once, **When** it is reworded in place and ruled `WRONG` again, **Then** the count is 2.
2. **Given** a claim at count 2, **When** an unrelated file is committed, or the last commit is amended, **Then** the count is still 2.
3. **Given** a claim at count 2, **When** a third reworded version is ruled `WRONG`, **Then** the commit is refused, and the refusal lists each version's words and ruling.
4. **Given** a claim ruled `WRONG`, **When** a later version is ruled `CORRECT`, **Then** the lineage ends and a later `WRONG` claim there starts at 1.
5. **Given** the same check run twice on the same staged change, **Then** the count rises once.

---

### User Story 2 - Only the user lowers the count, and a release lasts (Priority: P1)

At a hold the user types `unlock claim-<id>`, naming either the current words or the lineage. The release covers the words as they are. If the claim is reworded later the lineage keeps its chain and count, and one more `WRONG` brings the user back.

**Why this priority**: A release that reset the count would give the agent a second way out (constitution P2).

**Independent Test**: Hold a claim, unlock it, reword it, rule it `WRONG`: the hold returns at once. Nothing else lowers the count.

**Acceptance Scenarios**:

1. **Given** a held claim, **When** the user types `unlock claim-<id>` with the current words' id or the lineage's id, **Then** the commit is allowed.
2. **Given** an unlocked claim, **When** it is reworded and ruled `WRONG`, **Then** it is held again with the chain and count it had.
3. **Given** a held claim, **When** the agent does anything but the user's `unlock` (commits elsewhere, amends, reflows the file), **Then** the hold stays.

---

### User Story 3 - Splitting, merging, moving and deleting are followed (Priority: P2)

A sentence split in two keeps one lineage for both halves. Two held claims merged into one carry the higher count, never the sum. A claim moved elsewhere in the file, unchanged, is still the same claim. A claim deleted ends its lineage.

**Why this priority**: Without it, the easiest way round the bound is to reshape the text.

**Independent Test**: Walk each of split in place, merge two, delete, move unchanged; each ends with the count the rules above give.

**Acceptance Scenarios**:

1. **Given** a claim at count 2, **When** it is split into two sentences in place, **Then** both belong to its lineage at count 2.
2. **Given** two claims at counts 1 and 2, **When** they are merged into one sentence, **Then** it carries count 2.
3. **Given** a claim at count 2, **When** its words are deleted with nothing in their place, **Then** the lineage ends.
4. **Given** a claim at count 2, **When** its words move elsewhere in the file unchanged, **Then** the count is 2.
5. **Given** a claim at count 2, **When** it is moved and reworded in one step, **Then** the result is a new claim at count 1. (A known gap, stated, not hidden.)
6. **Given** a claim at count 2 in a file that is then moved to a new path, **Then** the count starts again at the new path (ADR-0013).

---

### User Story 4 - A bug's count follows it too (Priority: P2)

A bug patched across several attempts is one lineage whatever else is committed. Two tracked bugs that one staged change overlaps are one bug from then on, at the higher count. A refusal shows, for each listed site, the line ranges the staged change alters in its file.

**Why this priority**: The shim check has the same defect as the claim check. It closes #16.

**Independent Test**: Patch one bug twice with another file committed between. The count survives. Overlap two bugs with one change: one bug, higher count. Edit line 333 of a function starting at 329: the refusal lists the ranges the change alters, line 333 among them.

**Acceptance Scenarios**:

1. **Given** a bug at count 1, **When** another file is committed and the bug is patched again, **Then** the count is 2.
2. **Given** bugs at counts 1 and 3, **When** one staged change overlaps both, **Then** they are one bug at count 3, and the commit does not count toward both.
3. **Given** a site starting at line 329, **When** the staged change edits line 333 of that function, **Then** the refusal shows line 333 among that site's altered ranges.

---

### User Story 5 - Progress is not punished (Priority: P3)

Several claims in one new file, each wrong once, do not together reach a hold. Each claim has its own count.

**Why this priority**: The unit of the count is the claim, not the hunk; it removes the false stops of the present design.

**Independent Test**: Three claims in one hunk, each ruled `WRONG` once in three checks: no hold.

**Acceptance Scenarios**:

1. **Given** three claims in one hunk of a new file, each ruled `WRONG` once over three checks, **Then** every count is 1 and nothing is held.

### Edge Cases

- A hunk that reaches two held claims continues both, each by its own words.
- One check ruling a claim `WRONG` adds one; a rejected contest on it adds one more; a re-run of the same check adds nothing.
- A split whose second half lands elsewhere in the file: the half in the reworded range keeps the lineage, the other half starts a new one.
- A lineage that ends stays on record, marked ended; only the user deletes a record (ADR-0002).
- A reflow or formatter run changes no count.
- Two claims merge when one of them was released by the user: the merged words are new, so the release does not cover them; the merged claim carries the higher count and the next `WRONG` ruling on it brings the user back (FR-007, FR-009). Two bugs merge the same way (FR-013).
- A hold that is not released stays a hold when its lineage merges with another: the merged claim or bug is held if either was (constitution P2: nothing but the user's release lowers it).
- The diff library is missing: the check does not run, refuses, and the refusal names the install command (ADR-0009, constitution P4). It is never a pass.
- A bug moved to another file: its site is gone from the old path with nothing mapped, so its lineage ends, and the code at the new path is a new bug (ADR-0013, ADR-0001 point 2). Code moved within a file is the same: nothing maps it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST keep one count for each claim, followed through every rewording, split, merge and in-file move, in one lineage.
- **FR-002**: The count MUST NOT depend on commits: a commit of any other file, an amend, or a change of the branch's head leaves it as it was.
- **FR-003**: The count MUST rise by one per completed check that rules the lineage `WRONG`, and by one per rejected contest; a re-run of a check already counted adds nothing.
- **FR-004**: The claim check MUST hold at count 3. The shim check MUST keep its deep sweep at 3 and its hold at 4.
- **FR-005**: A hold MUST show the lineage's whole chain: each version's words and its ruling.
- **FR-006**: Only the user MAY release a hold: a claim by `unlock claim-<id>`, naming the current words' id or the lineage's id; a bug by `override shim-<id>`. Nothing else MAY lower the count or start it again.
- **FR-007**: After the user's release the lineage MUST continue with its chain and count; the release covers the words as they were released.
- **FR-008**: A `CORRECT` ruling MUST end the lineage.
- **FR-009**: Claims that merge MUST carry the higher count of the merged lineages, never the sum. Claims that split MUST all inherit the one lineage.
- **FR-010**: A claim whose words are gone with nothing mapped to them MUST end its lineage.
- **FR-011**: A claim moved unchanged within a file MUST keep its lineage. A claim moved and reworded in one step is a new claim.
- **FR-012**: A moved file MUST start the count again at its new path (ADR-0013). This applies to the claim check.
- **FR-013**: Two bugs overlapped by one staged change MUST become one bug at the higher count; one change MUST NOT count toward both (ADR-0014). This applies to the shim check.
- **FR-014**: The count's unit MUST be the claim, not the hunk, so claims sharing a hunk or a new file do not share a count.
- **FR-015**: A staged change that reaches more than one held claim MUST continue each of them.
- **FR-016**: A refusal MUST show, for each listed site, the line ranges the staged change alters in the site's file, in place of the "touched" mark.
- **FR-017**: A check that cannot run because its diff library is missing MUST be refused as a failed check and name the install command (ADR-0009).
- **FR-018**: A lineage that has ended MUST stay on record, marked ended.
- **FR-019**: No count, hold or chain MAY be keyed on the branch's head, a tree, or a commit.

### Key Entities

- **Lineage**: identity (the id of its first `WRONG` version's claim), the repo and branch it lives on, an ordered chain of versions, an open or ended mark.
- **Version**: the check it came from, the words, the place in the file, the ruling.
- **Chain**: a lineage's versions, shown whole at a hold.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every walked sequence (reword in place, commit another file, amend, split in place, merge two, delete, move unchanged, unlock then reword, the same check twice) the count ends at the value stated for it; the first two sequences reproduce #15 and #16 and fail on the code before this change.
- **SC-002**: A claim that stays `WRONG` is refused on its third ruling at the latest, however many other commits, amends, reflows or in-place rewordings come between. None of these lowers the count; the gaps that start a count again are the ones named under Edge Cases and Assumptions.
- **SC-003**: After a user's `unlock`, one further `WRONG` ruling on the same lineage returns the user to the hold, in every case tried.
- **SC-004**: Three claims in one hunk, each ruled `WRONG` once, produce no hold.
- **SC-005**: A hold shows the whole chain of versions: the user can see each version's words and ruling without reading the git history.
- **SC-006**: A run with the diff library missing is refused in 100% of cases and names the install command.

## Assumptions

- The decisions in #17 and ADRs 0001, 0013 and 0014 stand. Where ADR-0001 says holds are not merged and ADR-0014 merges bugs, ADR-0014 governs the shim check; this spec's merge of claims (FR-009) is ADR-0001's own lineage merge. Which merging ADR-0001 still rules out is for a note on that ADR, not a question to the user.
- A lineage that ends is kept, marked ended (FR-018): ADR-0002 (4, 5) lets nothing but the user delete a record, so ending a lineage deletes nothing.
- Holds and chains stored before this change are not migrated (ADR-0001, Trade-offs).
- The moved-and-reworded and the split-with-a-far-half gaps are accepted as in #17; they are stated, not closed.
- The mapping of a claim's words into the next version of the file needs a text-diff library; it is a required install, not vendored.
