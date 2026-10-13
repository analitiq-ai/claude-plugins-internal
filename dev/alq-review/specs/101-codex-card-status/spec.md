# Feature Specification: The poller reads Codex's status card to know when its review of the head has ended

**Feature Branch**: `101-spec` (#101)

**Created**: 2026-10-13

**Status**: Draft

**Input**: Issue #101, "alq-review: the PR poller takes Codex's "Running" status card as Codex's answer and
exits clean"

**Settled with the user**: grill session 2026-10-13 (Clarifications below). Issue #101's "Expected" asked that
a card count as an answer only once its status is terminal; the session went further and made the card the
poller's source for whether Codex has finished reviewing the head. The critique session, the same day, settled
three more points, recorded at the end of the Clarifications.

## Clarifications

### Session 2026-10-13

- Q: Is a finished card itself Codex's answer, or only the review, comment or 👍 that follows it? → A: The poller reads the card in full. Codex has answered when the card's Code Review row says Completed for the head commit with a status time after the trigger, and that status time is the answer time. A Running row holds the poller and the waiting line names the commit and the time. A Completed row for a commit that is no longer the head is reported with the re-request the agent must make, never awaited. The 👍, the verdict comment and the review no longer decide whether Codex answered; the gate still reads them for its verdict. A card the poller cannot read ends the run with an error naming it.
- Q: When the Code Review row says Completed for a commit that is no longer the head, does the poller settle at once or wait to its deadline? → A: Settle at once: exit 2 if findings or failing checks are open, else exit 4 with "Codex reviewed <short SHA>, not the head <head>: comment `@codex review`". Waiting cannot change the fact.
- Q: What does the poller do when Codex replies with a comment and starts no review (not connected, usage limit)? → A: The poller holds a hand-rolled list of Codex's known acknowledgements, as observed now: the status card, the verdict comment, the security-review comment and the PR review. Any Codex item since the trigger that is not on the list settles the round at once as BLOCKED (exit 4), with the comment printed.
- Q: Does a Running Security Review row, or any row other than Code Review, hold the round? → A: No. Only the Code Review row decides; the reader skips every other row, known or not.
- Q: Are Codex's reactions items the reader classifies? → A: No. The list covers comments and PR reviews. The 👍 is fetched as today, for the note on a 👍 left only on the trigger comment; no other reaction is read.
- Q: Where does the Codex reading live? → A: In a standalone module of its own, with its own tests, which the poller calls; it is not baked into the poller's other code. Shape: a Python script under `plugins/alq-review/scripts/`, like the plugin's other modules, fed the snapshot's Codex items, the trigger time and the head, returning Codex's state as JSON that the poller's analysis consumes; its unit tests run without the fake `gh`.
- Q: (critique) On 2026-10-05 Codex reviewed analitiq-engine#575 and claude-code-plugins#506 with PR reviews and verdict comments and posted no card. Is a review without a card an answer? → A: No, card only. The card-less Codex is its legacy implementation. With no Code Review row dated after the trigger the poller waits and times out (exit 3), as for silence.
- Q: (critique) Codex out of credits, with the org gate's `WAIVED:` run on the head: today exit 0, under FR-010 exit 4 with no next step. → A: A `codex-review` run on the head from the analitiq-pr-gate App, SUCCESS, whose title starts `WAIVED:`, is the gate's word that Codex is waived for this head. With it, no answer and an item off the list neither hold nor block; the round settles by the merge state as today. A plain SUCCESS run does not do this.
- Q: (critique) An item off the list beside a Code Review row that says Completed for the head: block or warn? → A: Warn. An item off the list settles the round only while no Code Review row dated after the trigger gives an answer; beside a Running, Completed or superseded row it is a WARNING line in the report and an entry among the Codex comments since the trigger.

## What we want

The poller learns whether Codex has finished reviewing the head from Codex's status card, the one artifact that
names the review, the commit it is of, and whether it is still running. While the card's Code Review row says
Running, the poller waits and says what Codex is reviewing. When the row says Completed for the head, Codex has
answered, at the time the row carries. A row that says Completed for a commit that is no longer the head is
reported as such, with the re-request the agent must make. The 👍, the verdict comment and the review no longer
decide whether Codex has answered; the gate still reads them for its verdict (ADR-0003). Everything else Codex
posts is checked against a list of what it is known to post. While the card gives no answer, anything off the
list means Codex declined or changed, and the poller stops at once and prints it rather than wait for a review
that will not come; beside a card that answers, it is a warning. When the org gate has waived Codex for the
head, there is nothing to wait for and the round settles by the merge state, as today.

## Terms

- **Status card**: a PR comment by Codex (`chatgpt-codex-connector`) carrying the marker
  `<!-- codex-pull-request-review-summary -->`. Codex posts one per PR at its first review and edits it in place
  for every later one. It is a table with one row per review kind (`📝 **Code Review**`, `🔒 **Security
  Review**`), each with a Status cell, a Commit cell (the short SHA of the commit the review started on) and a
  Review trigger cell ("Draft marked ready", "Manual request", "PR opened"). The Status cell reads
  `🔄 **Running** since <relative-time datetime="…">` while reviewing and `✅ **Completed** <relative-time
  datetime="…">` when done; the `datetime` is the time the status was reached. Those are the only two statuses
  observed. Probe PR #103 (2026-10-13, comment 6146942268) drove the card through ready-for-review, two manual
  requests and a security review, with a push and then the PR's closure while a review ran; neither cancelled
  anything, each review ran to Completed for the commit it started on, and after the push the Commit cell named
  a commit that was no longer the head. Timings on #103: a row turns Running 8–17 s after the trigger; a review
  takes 75–145 s; a manual request's verdict comment ("Codex Review: Didn't find any major issues … **Reviewed
  commit:** `<sha>`", or "### 🛡️ Codex Security Review …") lands 1–2 s before the row turns Completed, while a
  ready-for-review trigger posts no comment at all; the 👍 on the description lands 4–6 s after the row turns
  Completed. A review with findings is a PR review, submitted 3 s before the row turned Completed on PR #93.
  While reviewing, Codex reacts 👀 on the trigger comment and on the description and removes its previous 👍
  from the description; on completion it removes the 👀 and adds a fresh 👍.
- **Code Review row**: the card row whose first cell is `📝 **Code Review**`: the review that `@codex review`
  and the ready-for-review event trigger, and the only one whose findings arrive as review threads. The Security
  Review row is a different review, requested separately.
- **Row for the head**: a Code Review row whose Commit cell is a prefix of the PR's head SHA.
- **Status time**: the `datetime` in the row's Status cell: when the row reached its status. It is never the
  card's creation time, which is when the PR's first review started.
- **Codex's answer** (formerly "a comment, a review, or a 👍 since the trigger"): the Code Review row says
  Completed for the head with a status time after the trigger. Its time is the status time.
- **Trigger** (unchanged): the given comment id, else the newest `@codex review` comment, else the PR's creation.
- **Codex item**: a comment or a PR review by Codex. The card is read whatever its creation time, since it is
  older than the trigger from the PR's second review on; every other item counts only if created since the
  trigger. Reactions are not items: the 👍 is fetched as today for the note on a 👍 left only on the trigger
  comment, and no other reaction is read.
- **Codex acknowledgement**: a Codex item of a form on the poller's list of what Codex posts while and after it
  reviews, as observed on 2026-10-13 (probe PR #103, PR #93), each matched by how it begins after leading
  whitespace (the review's body starts with a newline):
  - the status card: first line `<!-- codex-pull-request-review-summary -->`; after a security review a second
    marker line `<!-- codex-security-review:v1 {…json…} -->` follows it in the same comment;
  - the verdict comment: starts `Codex Review: Didn't find any major issues.` followed by a varying flourish
    ("Chef's kiss.", "Hooray!"), then `**Reviewed commit:** \`<sha10>\``;
  - the security-review comment: starts `### 🛡️ Codex Security Review`;
  - a PR review (state COMMENTED) whose body starts `### 💡 Codex Review` and carries `**Reviewed commit:**`.

  Declines observed, neither on the list: "To use Codex here, [create a Codex account and connect to
  github](…)" (PR #93, 08:05Z) and `Codex Review: Something went wrong. Try again later by commenting
  "@codex review".` (claude-code-plugins#499, 2026-09-28). A Codex item of any other form means Codex declined
  or changed what it posts, and the poller says so.
- **Codex reader**: the standalone module that reads Codex's items and returns Codex's state for the round. The
  poller calls it; nothing else in the poller reads a Codex item.
- **Waived head**: a `codex-review` check run on the head from the analitiq-pr-gate App, state SUCCESS, whose
  title starts `WAIVED:` (today `WAIVED: Codex is out of credits; <sha> was not reviewed`): the gate's word that
  this head is judged without Codex.
- **Samples**: `samples/` in this spec folder holds Codex's bodies byte for byte: the five card states sampled
  on probe PR #103, its verdict and security comments, PR #93's review with findings and not-connected decline,
  and #499's error decline. They are the fixture source; where the Terms and a sample differ, the sample is
  right.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The poller waits while Codex reviews the head (Priority: P1)

A poller run that starts while the Code Review row says Running keeps polling until the row says Completed for
the head, then reports what landed.

**Why this priority**: it is the defect. Without it a round is skipped: the poller hands `clean` to the gate
and the agent moves to merge while Codex is still reviewing.

**Independent Test**: run the poller against the fake `gh` in `dev/alq-review/tests/test_poll_pr_review.py`
with snapshots whose card is a trimmed copy of probe PR #103's, in each state, and read its exit code, report
and inbox drop.

**Acceptance Scenarios**:

1. **Given** a trigger at T, a card whose Code Review row says Running for the head with a status time after T,
   every CI check passed, no `codex-review` run, and `mergeStateStatus=CLEAN`, **When** the poller polls,
   **Then** it waits, its waiting line reads "Codex is reviewing <short SHA> since <status time>", and it writes
   no inbox drop.
2. **Given** scenario 1, **When** a later snapshot holds the row Completed for the head at T+5 and Codex's 👍 on
   the description, **Then** the poller settles CLEAN (exit 0) and the drop records the head as clean.
3. **Given** scenario 1, **When** a later snapshot holds the row Completed for the head and a Codex review with
   unresolved threads, **Then** the poller exits 2 with those findings.
4. **Given** scenario 1, **When** the deadline passes with the row still Running, **Then** the poller exits 3 and
   its TIMEOUT report names "Codex is reviewing <short SHA> since <status time>".
5. **Given** a trigger at T and either no card, or a card whose Code Review row has a status time before T,
   **When** the poller polls, **Then** it waits on "Codex has not answered since T": Codex has not started.
6. **Given** `codex-review` is not SUCCESS and the card is the only Codex comment since the trigger, **When** the
   poller reports, **Then** "Codex comments since the trigger" is not printed and the drop's `gate_comments` is
   empty: the card is status, not something Codex said.

---

### User Story 2 - A review of a superseded commit is reported, not awaited (Priority: P2)

A push while Codex reviews does not cancel the review (probe PR #103): the row turns Completed for the earlier
commit and Codex will not review the head unless asked. The poller says so instead of taking the stale answer.

**Why this priority**: the agent re-requests after every push (`SKILL.md`), but a push that lands mid-review
leaves no cue; today the poller takes the stale answer as the round's answer and, in a repo without the
pr-gate, exits CLEAN on it.

**Independent Test**: the same harness, with the row Completed for a commit that is not the head and a status
time after the trigger.

**Acceptance Scenarios**:

1. **Given** a trigger at T, a head that moved after T, and the Code Review row Completed for the earlier commit
   with a status time after T, **When** the poller polls, **Then** it settles at once: exit 2 if any finding or
   failing check is open, else exit 4 with the line "Codex reviewed <short SHA>, not the head <head>: comment
   `@codex review`". It never exits 0 on that snapshot.
2. **Given** scenario 1, **When** a later trigger (a new `@codex review` comment) is newer than the row's status
   time, **Then** the row is not an answer and the poller waits on "Codex has not answered since T" until the row
   turns Running and then Completed for the head.

---

### User Story 3 - Codex's answer time is the row's status time (Priority: P2)

In a repo with the org pr-gate, the poller holds for `codex-review` to catch up with the time the review ended.

**Why this priority**: the gate posts its run on Codex's artifacts; a run that started while Codex was reviewing
must not look newer than the answer, or the poller settles BLOCKED and tells the agent to act on a gate that is
only waiting for Codex.

**Independent Test**: the same harness, with a `codex-review` run from the `analitiq-pr-gate` App in PENDING
state started between the row's Running time and its Completed time.

**Acceptance Scenarios**:

1. **Given** a trigger at T, the row Running from T+1 and Completed for the head at T+5, and a PENDING
   `codex-review` run started at T+3, **When** the poller sees the Completed row, **Then** it waits on
   "codex-review has not caught up with Codex's answer" and dispatches one pr-gate sweep, as it does today for a
   👍 at T+5.
2. **Given** scenario 1, **When** a later snapshot holds `codex-review` SUCCESS and `mergeStateStatus=CLEAN`,
   **Then** the poller settles CLEAN.

---

### User Story 4 - A card the poller cannot read ends the run loudly (Priority: P3)

Codex's table is undocumented and has already changed once; the poller must fail on a change, not revive this
defect silently.

**Why this priority**: the other stories rest on the card being read right.

**Independent Test**: the same harness, with a card whose marker is present but whose table is altered.

**Acceptance Scenarios**:

1. **Given** a comment with the marker but no Code Review row, or a row whose Status cell is neither Running nor
   Completed, or no `datetime` in that cell, or more than one comment with the marker, **When** the poller polls,
   **Then** it exits 1 with an error naming the comment's URL and that its format changed, as it does today for
   a CodeRabbit review body it cannot parse.

---

### User Story 5 - Codex says something the poller does not know (Priority: P2)

Codex may answer a trigger with a comment and no review: "To use Codex here, create a Codex account" (PR #93,
08:05Z), "Codex Review: Something went wrong" (#499) or a usage-limit notice. It may also change what it posts,
as it did when the card appeared. The poller must not wait 15 min for something that will not come, must not
guess, and must not block every repo on a wording change when the card already says Codex finished. When the
org gate has waived Codex for the head, there is nothing to wait for.

**Why this priority**: it is how this defect's class is closed: an unknown Codex item is never read as an
answer and never silently waited on.

**Independent Test**: the same harness, with a Codex comment since the trigger whose form is not on the list,
with and without a Code Review row after the trigger, and with and without a WAIVED gate run.

**Acceptance Scenarios**:

1. **Given** a trigger at T, a Codex comment after T of a form not on the acknowledgement list, and no Code
   Review row with a status time after T, **When** the poller polls, **Then** it settles at once: exit 2 if any
   finding or failing check is open, else exit 4; the report prints the comment under "Codex comments since
   the trigger" with a line saying Codex's reply is not one the poller knows. It never exits 0.
2. **Given** scenario 1's comment and a Code Review row Running for the head after T, **When** the poller
   polls, **Then** it waits per User Story 1 and the report carries a WARNING naming the comment.
3. **Given** scenario 1's comment and a Code Review row Completed for the head after T, **When** the poller
   polls, **Then** it settles as User Story 1 scenarios 2 and 3 do, and the report carries the WARNING.
4. **Given** a trigger at T, Codex's out-of-credits comment after T, no row after T, a `codex-review` run on
   the head from the App, SUCCESS, titled `WAIVED: …`, and `mergeStateStatus=CLEAN`, **When** the poller polls,
   **Then** it settles CLEAN (exit 0) as today and prints the WAIVED title under the gate check runs.
5. **Given** scenario 4 with the Code Review row Running for the head after T, **When** the poller polls,
   **Then** it waits on "Codex is reviewing …": the waiver releases only the absence of an answer.
6. **Given** scenario 4 with a SUCCESS run whose title does not start `WAIVED:`, **When** the poller polls,
   **Then** the run releases nothing (FR-013) and the round settles as scenario 1 does: exit 4, or exit 2 with
   open findings or failing checks, printing that Codex's reply is not one the poller knows; never 0.

---

### Edge Cases

- The row turns Completed and a 👍 or review lands in the same snapshot: the answer time is the status time;
  the 👍 and the review carry no time the poller reads.
- A draft PR settles at once, unchanged: Codex does not review drafts.
- The Security Review row says Running while the Code Review row says Completed for the head: Codex has
  answered. Only the Code Review row is read; every other row is skipped, whatever it says.
- From the second review on, the card is older than the trigger: only the row's status time is compared with
  the trigger, never the card's creation time.
- The row says Completed for the head with a status time before the trigger: a new round after a finished one;
  Codex has not started (User Story 1, scenario 5).
- A snapshot between a manual request's verdict comment and the row's Completed flip (1–2 s on #103): the row
  still says Running, so the poller waits one more poll.
- A second `@codex review` while a review runs (not probed): the Running row's status time is before the new
  trigger, so Codex has not started; when the row turns Completed with a status time after the new trigger, it
  is the answer for the head if its commit matches, else superseded, although the review began before the
  trigger. For an unchanged head that is the right answer. Tested as such.
- A Codex review or verdict comment after the trigger with no Code Review row dated after the trigger (the
  legacy, card-less Codex seen on 2026-10-05): not an answer. The poller waits on "Codex has not answered
  since T" and times out (exit 3); the comment is listed under the Codex comments since the trigger.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Codex has answered the round when and only when the card's Code Review row says Completed, its
  Commit cell is a prefix of the head SHA, and its status time is after the trigger. The answer time MUST be the
  status time, and everything that reads Codex's answer time (the hold for `codex-review` to catch up, the sweep
  dispatch) MUST read it.
- **FR-002**: While the Code Review row says Running, for any commit, the poller MUST wait, and its waiting line
  and TIMEOUT report MUST name the commit and the status time.
- **FR-003**: With no Code Review row whose status time is after the trigger, the poller MUST wait on "Codex has
  not answered since <trigger>".
- **FR-004**: A Code Review row Completed for a commit that is not the head, with a status time after the trigger,
  MUST settle the round at once: exit 2 if any finding or failing check is open, else exit 4 with a line naming
  the reviewed commit, the head and the `@codex review` re-request. It MUST never settle CLEAN.
- **FR-005**: A 👍, a review or a comment by Codex MUST NOT decide whether Codex has answered. They stay in the
  report and the drop as today, and the note on a 👍 left only on the trigger comment stays, because the gate
  reads reactions on the description only.
- **FR-006**: The card MUST NOT be listed among Codex comments since the trigger, in the report or in the drop.
- **FR-007**: A comment carrying the marker that the poller cannot read MUST end the run with exit 1 and an
  error naming the comment's URL, saying its format changed, and ending with the step to take: report it on
  the plugin's repo and read the PR by hand. The reading failures are: no Code Review row; more than one Code
  Review row; a Status cell that is neither Running nor Completed; no `datetime` in the Status cell; a
  `datetime` not in the card's format (`2026-10-13T13:54:16.973698Z`, fractional seconds optional); no commit
  in the Commit cell; more than one comment carrying the marker.
- **FR-008**: Only the Code Review row MUST be read. Every other row, known or not, MUST be skipped and MUST
  neither hold nor settle the round.
- **FR-009**: The poller's header and `SKILL.md`, which say an answer is "a comment, a review, or a 👍", MUST
  state the card rule and the acknowledgement list instead.
- **FR-010**: The poller MUST hold one list of Codex's known acknowledgement forms (Terms). A Codex item since
  the trigger of any other form, while no Code Review row with a status time after the trigger gives an
  answer, MUST settle the round at once: exit 2 if any finding or failing check is open, else exit 4, with the
  item printed and named as one the poller does not know; never 0. Beside a Code Review row with a status time
  after the trigger (Running, Completed for the head, or Completed for another commit) such an item MUST be a
  WARNING line in the report and an entry among the Codex comments since the trigger, and MUST NOT hold or
  settle the round. Acknowledgements other than the card MUST NOT decide whether Codex has answered (FR-005).
- **FR-011**: The reading of Codex's items — recognising acknowledgements, reading the card, and deciding
  whether Codex has not started, is reviewing, has answered, reviewed a superseded commit, declined, or cannot
  be read — MUST live in one standalone module under `plugins/alq-review/scripts/`, with its own unit tests
  that run without the fake `gh`, which the poller calls with the snapshot's Codex items, the trigger time and
  the head and from which it takes Codex's state as JSON. No other code in the poller MUST read a Codex item.
- **FR-012**: Tests MUST be written first and seen to fail for the reason expected, covering every scenario and
  edge case above, with card fixtures that are trimmed copies of probe PR #103's sampled cards: Running and
  Completed, one row and two rows, for the head and for a superseded commit.
- **FR-013**: A waived head (Terms) MUST release the round from waiting on Codex and from FR-010's settling:
  with it, no Code Review row after the trigger and an item off the list neither hold nor block, and the round
  settles by the merge state as today, the WAIVED title printed under the gate check runs. A Running row still
  holds (FR-002) and a superseded row still settles (FR-004). A `codex-review` run whose title does not start
  `WAIVED:` MUST NOT do this.
- **FR-014**: Every report MUST carry one line after its header stating what the reader read: Codex's state,
  the commit and the status time (`Codex: reviewing a3d2db7 since 2026-10-13T13:52:41Z`; `Codex: not
  started`), so a run's log shows what the poller believed.

### Key Entities

- **Status card**: Codex's running account of a PR's reviews, edited in place. Its Code Review row has a status,
  a status time, a commit and a trigger.
- **Codex's answer**: the fact and time that the Code Review row says Completed for the head since the trigger,
  from which the poller decides whether to wait and whether the gate lags.
- **Codex's state for the round**: what the Codex reader returns: not started, reviewing (commit, since),
  answered (time), superseded (reviewed commit, head), declined (the item), or unreadable (the item). Unreadable
  comes first. Then the Code Review row, when its status time is after the trigger: reviewing, answered or
  superseded, an item off the list beside it being a warning. Declined only when no such row exists and an item
  off the list is since the trigger. Else not started.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With snapshots shaped like PR #100's at 12:50–12:54Z on 2026-10-13 (the row Running, CI passed, no
  `codex-review` run, mergeable), the poller never exits 0; with the 12:55Z shape (the row Completed for the
  head, Codex's 👍), it exits 0.
- **SC-002**: With snapshots shaped like probe PR #103's trigger 2 at 13:54Z (the row Completed for `a3d2db7`,
  head `d14438b`, no findings), the poller exits 4 at once, naming both commits, never 0.
- **SC-003**: Every scenario and edge case above has a test in `dev/alq-review/tests` that failed before the code
  and passes after: the reader's states in its own unit tests, the poller's exits and reports through the fake
  `gh`.
- **SC-004**: CI is green.

## Assumptions

- The card's shape is the one observed on probe PR #103, PR #100, PR #93 and openai/codex#51941, as the Terms
  record it: one card per PR, one row per review kind, `datetime` in the Status cell, a 7-character short SHA in
  the Commit cell. Running and Completed are the only statuses observed and Codex documents no other; a failed
  or usage-limited review was not provoked. Any other status is an error (FR-007), never an answer (constitution
  P4).
- The sampled cards from probe PR #103 (comment 6146942268 through four triggers) are the fixture source; the
  PR was closed unmerged.
- Rejected: dropping the card by its marker and keeping the 👍, review and comment as Codex's answer. It is a
  one-line fix and the probe shows those artifacts landed within 6 s of every flip, but it reads nothing, so a
  renamed marker would revive this defect silently, and it cannot tell a review of a superseded commit from one
  of the head. Also rejected: counting a terminal card as the answer without matching its commit to the head
  (the wording of the issue's "Expected"), for the second reason.
- The acknowledgement list is the set of forms observed on 2026-10-13 (Terms). A form Codex adds later is a
  WARNING beside a row that answers and blocks the round while nothing answers; the warning is the cue to extend
  the list.
- Legacy: on 2026-10-05 Codex reviewed analitiq-engine#575 and claude-code-plugins#506 (ready-for-review and
  `@codex review`) with PR reviews and verdict comments and posted no card and no 👍; on 2026-09-30 and
  2026-10-13 the same repos and this one got the card. Settled: that card-less Codex is the legacy
  implementation; a review without a card is not an answer and the poller times out on it.
- Not probed: what Codex does with a second `@codex review` while a review runs. The Edge Cases state the
  answer the rule gives and it is tested as such; FR-004 covers the agent's re-request after the first review
  ends.
- Out of scope: making a missing `codex-review` run more than a WARNING; adding the pr-gate workflow to this
  repo; what the card shows for a review that fails (its comment is observed, Terms, and is off the list).
- Unchanged: the trigger; the sweep dispatch; a draft settling at once; the exit codes and what the agent does on
  each; the gate's reading of the 👍, the verdict comment and the review; the waiver's outcome (exit 0 under a
  WAIVED run on the head).

## Why this is worth doing

### harm
Answer: A poller run that starts after Codex's status card appears and before its review lands counts the card as Codex's answer; with CI finished and no `codex-review` run to lag behind, nothing else holds it, so it prints CLEAN and exits 0 while Codex is still reviewing. The skill's exit-0 row then sends the agent to the DeepSource gate and on to merge, and `hand_over clean` records the head as clean in the alq-review inbox, so findings Codex posts minutes later are never triaged and the round is skipped.
Source: code: plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh:168 (every Codex comment after the trigger is an answer), :211 (`responded`), :227 (the only wait on Codex), :304-307 (CLEAN exits 0 and hands `clean` to the gate); SKILL.md exit-code table

### reachable
Answer: observed on analitiq-ai/claude-plugins-internal#100 on 2026-10-13: the card (comment 6145948906) was created at 12:50:58Z, 17 s after the PR was marked ready, and edited to Completed at 12:55:07Z, with Codex's 👍 on the description at 12:55:11Z; the issue reports two poller runs exiting 0 between 12:50 and 12:54, and this repo has no pr-gate workflow (`.github/workflows` holds only tests.yml), so no `codex-review` run exists and its absence is a WARNING, not a wait. Predicted in repos with pr-gate: the card's creation becomes Codex's answer time, so the poller either waits by accident under `gate_lags` when the gate's PENDING run started before the card, or settles BLOCKED (exit 4) when it started after, telling the agent to act on a gate that is only waiting for Codex.
Source: reproduction: `gh api` on PR 100's comments, reactions and timeline on 2026-10-13; code: poll-pr-review.sh:213-216, :236

### change-alters
Answer: Yes. With a card counted as an answer only when its status is terminal, the 12:50-12:54 snapshots of #100 hold one Codex comment, the Running card, so `responded` is false, WAITING_ON prints "Codex has not answered since 2026-10-13T11:57:42Z" and the poller keeps polling; the 12:55 snapshot holds the Completed card and the 👍 on the description, so it settles and prints CLEAN after Codex finished. Had Codex posted a review with findings at 12:55 instead, the same run would exit 2 with those findings.
Source: code: poll-pr-review.sh:168-173, :211, :227, :332-335, walked with PR 100's timestamps

### owner
Answer: No. The poller's tests have no fixture with the summary card: every Codex comment fixture is the older "Codex Review: Didn't find any major issues." text, so a card's status is never graded. The org pr-gate's `codex-review` run is the only thing that could hold the poller, it is absent in this repo, and the poller treats its absence as a WARNING.
Source: code: dev/alq-review/tests/test_poll_pr_review.py (no "Summary", "Running" or "review-summary" fixture), .github/workflows (tests.yml only), poll-pr-review.sh:236

### inherited
Answer: No. Spec 008 and ADR-0003 decide where the gate's verdict is read (the `codex-review` check run) and that the plugin leaves a PR's rules to GitHub; neither decides what counts as Codex's answer to the poller. That rule lives only in the poller's own header ("a comment, a review, or a 👍") and predates the status card.
Source: code: dev/alq-review/specs/008-gate-check-runs-prose/spec.md, dev/alq-review/docs/adr/0003-guard-commits-leave-the-rules-of-a-pr-to-github-and-read-the-org-gate-s-verdict.md, poll-pr-review.sh:11-13

### needs-spec
Answer: The request fixes the outcome (wait while the card says Running) but leaves decisions: (1) what terminal means, an allow-list of Codex's statuses or anything but Running, when the card's vocabulary is Codex's and undocumented here; (2) what time a terminal card answers at, its createdAt (review start, 12:50:58Z) or the `<relative-time datetime>` in its status cell (12:55:07Z), which is what `gate_lags` compares with the gate run; (3) whether a Completed card is itself an answer or only the review or 👍 that follows it (on #100 the 👍 came 4 s after the edit, and the gate reads the 👍, not the card); (4) whether the card belongs in `gate_comments`, which the report prints as "Codex comments since the trigger".
Source: code: poll-pr-review.sh:168-173, :213-219; reproduction: PR 100 comment 6145948906, created vs edited time, and its 👍

## Root cause

Observed: issue #101's report of two poller runs on analitiq-ai/claude-plugins-internal#100 exiting 0 between
12:50 and 12:54Z on 2026-10-13 while the card said "🔄 Running since 12:50:53Z", and the premise report's `gh
api` reproduction on that PR: comment 6145948906 created 12:50:58Z, edited to Completed 12:55:07Z, Codex's 👍
at 12:55:11Z. Neither was re-run in this session: `gh` calls were refused, and the trace below is from reading
the code against those timestamps.

The wrong decision is made in the `ANALYZE` jq program of `poll-pr-review.sh`, at line 168: every comment by
Codex created after the trigger becomes an entry of `$codex_comments`, by author and creation time alone, with
no reading of the body. Line 211 turns a non-empty list into `responded: true`, so `WAITING_ON` (line 227) has
nothing to say about Codex. The other waits do not hold either: `running` (line 190) is empty once CI finishes;
`gate_lags` (lines 213-215) needs a `codex-review` run and `$codex_gate` is null in this repo; the missing run is
printed as a WARNING (line 236) and waited on by nothing; the PR is mergeable. `waiting` is empty at line 333,
`settle` reports, `clean` is true, and lines 304-307 print CLEAN, hand `clean` to the gate's inbox and exit 0.
The trigger is right: PR #100 was marked ready with no `@codex review` comment, so `since` is the PR's
creation (11:57:42Z) and the card at 12:50:58Z is after it. The classification is wrong, not the time filter.

- **Other callers**: the agent, through `SKILL.md` "Waiting for the response", after opening a PR or posting
  `@codex review`, and through the `pr-review-loop` rule that routes to the skill (predicted). The outcome's
  consumer: `hand_to_gate` writes `inbox/<owner>__<repo>__<pr>.json`, and `ledger.ingest_inbox`
  (`plugins/alq-review/scripts/ledger.py:492`) stores it at the next hook event as a poll of the head
  (predicted). Tests: `dev/alq-review/tests/test_poll_pr_review.py` and `test_poller_contract.py` run the script
  against a fake `gh` (predicted; not run in this session).
- **Examined and ruled out**: the 👍 and review paths (lines 169-171): none existed between 12:50 and 12:54.
  `gate_lags`: cannot hold without a gate run. `codex_gate_missing`: a report line, not a wait. The CodeRabbit
  parsing errors (line 202): Codex comments do not reach them.
- **Not investigated**: what the card shows for a failed or usage-limited review, which the probe could not
  provoke; repos with the pr-gate, where the premise report's "reachable" answer is predicted only. The card's
  statuses, rows, commit cell, timings and reactions were observed on probe PR #103 after the draft and are
  recorded under Terms.
