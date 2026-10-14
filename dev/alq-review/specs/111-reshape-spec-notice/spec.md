# Feature Specification: A RESHAPE_SPEC ruling names its spec and tells the spec's issue

**Feature Branch**: `111-spec`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "https://github.com/analitiq-ai/claude-plugins-internal/issues/111 — alq-review: RESHAPE_SPEC ruling reports spec folder + redesign summary, and posts them to the spec's issue"

## Clarifications

### Session 2026-10-14

- Q: Which issue gets the notice? → A: The spec folder's `<issue>-` prefix only; branch name and the PR's linked issues are not used.
- Q: How does the session receive the summary? → A: The gate passes the bound spec folder in the `assess-round` args at launch and the workflow returns it with the ruling's fields as data; the gate posts the notice when the ruling lands (`after_structured_output`). The assessor never posts. (Its "next gate event" message was dropped; see the last entry.)
- Q: Assignee fixed or configured? → A: Configured: `config.json` key `escalate_to`, set to `Analitiq-Bot-Wonka`, read from config and never hardcoded. It names the account the plugin escalates to: reshape assignment now, and later reassigning issues or review requests.
- Q: What if the `reshape_spec` label does not exist? → A: Fail loudly; the gate never creates labels, they are set up by hand per repo.
- Q: When does the `reshape_spec` label come off? → A: The gate never removes it; whoever completes the reshape removes it by hand. `unlock` leaves the label and assignee as they are.
- Q: When is a failed notice retried? → A: Never. One attempt when the ruling lands: `gh issue comment`, then one `gh issue edit` adding the label and the assignee. The outcome (posted, or failed with GitHub's error) is stored on the round; a failure is fixed by hand.
- Q: What does the issue comment link to? → A: The PR number and the round (stage and number), e.g. `#118, internal round 3`. Every `RESHAPE_SPEC` ruling has a PR: only review rounds rule it, and a round cannot open without an open (possibly draft) PR.
- Q: Is a message at the session's next gate event needed? → A: No; it is dropped for a simpler design. The `assess-round` result already carries the folder and the ruling's fields. The stored notice outcome is shown only where the gate already speaks about a locked branch: the lock refusal and the `unlock` reply.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The ruling says which spec to reshape and why (Priority: P1)

An agent runs `assess-round` and the round is ruled `RESHAPE_SPEC`. The result it gets back names the spec
folder the PR is bound to, next to the ruling's open decision (`user_decision`), rationale and `spec_gap`
findings (mechanism and the spec section each cites). The agent can hand the user the whole ruling at once,
instead of the user learning the spec folder and gaps only when they type `unlock`.

**Why this priority**: Every `RESHAPE_SPEC` ruling locks the branch. Without the folder and gaps, the user
cannot start the reshape until after they unlock, which is backwards.

**Independent Test**: Feed the gate a recorded `RESHAPE_SPEC` assessment for a PR bound to a spec folder and
check that the `assess-round` result carries the folder and the ruling's fields.

**Acceptance Scenarios**:

1. **Given** a PR bound to `specs/123-login`, **When** its round is ruled `RESHAPE_SPEC` with two `spec_gap`
   findings, **Then** the `assess-round` result names `specs/123-login` and carries the open decision, the
   rationale and both gaps (mechanism and spec reference).
2. **Given** that ruling, **When** the user later types `unlock #<pr>`, **Then** the summary in the unlock
   reply is the same text as the summary in the issue comment.
3. **Given** a round ruled anything other than `RESHAPE_SPEC`, **When** it is assessed, **Then** no notice is posted
   and no GitHub call is made.

---

### User Story 2 - The spec's issue records that a reshape is waiting (Priority: P1)

When a round is ruled `RESHAPE_SPEC` on a PR bound to a spec folder, the gate posts the reshape summary as a
comment on the issue the spec belongs to, adds the `reshape_spec` label to that issue and assigns it to the
account `config.json` names in `escalate_to` (`Analitiq-Bot-Wonka`). Anyone watching GitHub sees
that the spec has to be redesigned and what in it, whether or not the session that ruled it is still alive.

**Why this priority**: Today the only durable copy of the ruling is the local ledger. This is the part that
reaches the spec's owner.

**Independent Test**: With GitHub calls replaced by a recorder, record a `RESHAPE_SPEC` assessment and check
exactly two calls were made, on the issue the folder name gives: one comment, and one edit adding the label
and the assignee.

**Acceptance Scenarios**:

1. **Given** a PR in `owner/repo` bound to `specs/123-login`, **When** its round is ruled `RESHAPE_SPEC`,
   **Then** issue `owner/repo#123` gets one comment carrying the reshape summary, the spec folder, the PR
   number and the round, the label `reshape_spec`, and the `escalate_to` account as assignee.
2. **Given** the repo has no `reshape_spec` label, **When** the notice is posted, **Then** the edit call
   fails (User Story 3) with GitHub's error naming the missing label; the gate does not create it.
3. **Given** the notice for a round has been attempted, **When** the gate handles any later event, **Then**
   it makes no GitHub call for that round: the notice runs only when the ruling is recorded, which happens
   once.
4. **Given** a later round on the same PR is ruled `RESHAPE_SPEC` again, **When** it is assessed, **Then**
   that ruling gets its own notice: one notice per ruling, not per PR.

---

### User Story 3 - A notice that cannot be posted is said, not swallowed (Priority: P2)

A GitHub call for the notice fails (no network, no permission, issue not found, label missing, assignee not
allowed on the repo). The gate stores which call failed and GitHub's own error on the round, and shows it
where it already speaks about the locked branch: the lock refusal and the `unlock` reply. The gate does not
retry: whoever reads it fixes the cause and finishes the notice by hand.

**Why this priority**: A notice silently missing looks the same as no reshape waiting, which is the harm this
feature removes.

**Independent Test**: Make the recorder fail the edit call; check the lock refusal and the `unlock` reply both
name the failed edit with the error, and that no later event calls GitHub again.

**Acceptance Scenarios**:

1. **Given** the comment was posted and the edit failed, **When** the agent's next edit, commit or push on the
   locked branch is refused, **Then** the refusal says the edit failed on issue #N with GitHub's error and
   what is left to do by hand.
2. **Given** that failure, **When** the user types `unlock #<pr>`, **Then** the unlock reply says the same.
3. **Given** the comment call fails, **When** the ruling lands, **Then** the edit is still attempted, and the
   stored outcome names each call's result.
4. **Given** both calls succeeded, **When** the lock refusal or `unlock` reply is shown, **Then** neither adds
   a notice line: only a failure is reported.
5. **Given** a notice call fails, **When** the ruling is recorded, **Then** the ruling still stands and the
   branch is still locked: the notice neither undoes nor delays the lock.

---

### Edge Cases

- **PR bound to `spec: null`, or bound to nothing**: no GitHub notice is posted. The `unlock` reply stays as
  it is today: close the PR and restart the work on a new PR bound to a spec that settles the decision. There
  is no spec owner to tell; the remedy is a new PR.
- **Spec folder whose name does not give an issue number** (it does not start with `<digits>-`, or the digits
  start with `0`, as the sequentially numbered `020-decision-review` does): the issue cannot be told, so this
  is a notice failure (User Story 3) naming the folder, never a guess.
- **Nested spec folder** (`dev/alq-review/specs/111-…`): the issue number comes from the folder's own name,
  the last path segment.
- **The issue is closed**: the notice is still posted; the comment, label and assignee are what tell its
  owner it has to be reopened.
- **`ESCALATE`, a second-audit lock, or a hold for a changed `spec.md`**: no notice. Only a `RESHAPE_SPEC`
  ruling by the assessor posts one.
- **Rounds of every stage** (internal, audit, github): a `RESHAPE_SPEC` ruling posts a notice whichever stage
  it was ruled in.
- **Plugin in `log` mode**: the notice is posted. It is not a refusal, so log mode does not turn it off.
- **Plugin switched off**: no round is assessed, so no notice.
- **Failed notice after `unlock`**: a failed comment or label/assign call is shown only in the lock refusal and
  the `unlock` reply. Once unlocked, no refusal shows it and the reply is shown once, so after that it is shown
  nowhere; the issue lacks its comment or label until someone fixes it by hand. Accepted (FR-010).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The gate MUST pass the PR's bound spec folder, or null for no spec, in the `assess-round` args
  at launch, and the `assess-round` result MUST return it.
- **FR-002**: The `assess-round` result for a `RESHAPE_SPEC` ruling MUST carry the ruling's open decision,
  rationale, and every `spec_gap` finding with its mechanism and spec reference, as data. The workflow renders
  no summary text.
- **FR-003**: The reshape summary in the GitHub comment and in the `unlock` reply MUST be rendered by one
  function, so the two cannot differ.
- **FR-004**: For a `RESHAPE_SPEC` ruling on a PR bound to a spec folder, the gate MUST post the reshape
  summary, naming the spec folder, as a comment on the spec's issue.
- **FR-005**: The spec's issue MUST be found by one rule only: the issue in the PR's repository whose number
  is the `<issue>` prefix of the spec folder's name (`<issue>-<slug>`, `<issue>` a number without a leading
  zero). The branch name and the PR's linked issues are not consulted.
- **FR-006**: The gate MUST add the label `reshape_spec` to that issue. It MUST NOT create the label: a
  repository without it is a failed edit call (FR-010) that names the missing label, since labels are set up
  by hand per repository.
- **FR-007**: The gate MUST assign that issue to the account named by the `escalate_to` key of the plugin's
  `config.json`, shipped as `Analitiq-Bot-Wonka`. The name MUST NOT appear in code. A missing or empty
  `escalate_to` MUST fail loudly when the config is read, with no default.
- **FR-008**: The comment, label and assignment MUST be made by the gate's code when the ruling lands
  (`after_structured_output`, after the assessment is validated and recorded), never by the assessor or any
  other agent.
- **FR-009**: The notice MUST be attempted exactly once per `RESHAPE_SPEC` ruling, when the ruling is
  recorded: one `gh issue comment` call, then one `gh issue edit` call adding the label and the assignee, the
  second made whatever the first returned. No later event makes a GitHub call for that ruling.
- **FR-010**: The outcome of each call (done, or failed with GitHub's error) MUST be stored on the round. A
  failed call MUST be named, with its error and the issue, in the lock refusal and in the `unlock` reply for
  that PR; a notice whose calls all succeeded adds nothing to either. A failed call is never retried; it is
  fixed by hand.
- **FR-011**: A notice MUST NOT change the ruling or the lock. Only the user's `unlock` releases the branch
  (ADR-0018); posting, failing to post or the label on the issue release nothing.
- **FR-011a**: The gate MUST NOT remove the `reshape_spec` label or the assignee, at `unlock` or at any other
  event; whoever completes the reshape removes the label by hand.
- **FR-012**: A PR bound to `spec: null`, or to nothing, MUST get no GitHub notice, since no spec folder names
  an issue (FR-005). Its `unlock` reply keeps today's close-and-restart text.
- **FR-013**: The comment MUST carry the reshape summary, the spec folder's repo-relative path, the PR number
  and the round's stage and number (e.g. `#118, internal round 3`). The gate adds nothing else: no checkout
  path, ledger content or session detail. The assessor's text (`user_decision`, `rationale`, `mechanism`) is
  posted as written in every repository, public included, since it describes the repository's own code.

### Key Entities

- **Reshape summary**: the text built from one `RESHAPE_SPEC` ruling and the PR's bound spec: open decision,
  rationale, `spec_gap` findings (mechanism, spec reference), spec folder.
- **Reshape notice**: the two GitHub calls for one ruling (comment; edit adding label and assignee) on one
  issue, attempted once, with each call's outcome stored on the round that was ruled.
- **Spec's issue**: the issue in the PR's repository numbered by the bound spec folder's name.
- **`escalate_to`**: the `config.json` setting naming the GitHub account the plugin escalates to; this feature
  is its first reader.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every `RESHAPE_SPEC` ruling on a PR bound to a spec folder, the `assess-round` result
  names the folder and carries the ruling's fields: 100% of rulings, checked by test.
- **SC-002**: Within the hook run that records such a ruling, the spec's issue shows the comment, the
  `reshape_spec` label and the `escalate_to` assignee when GitHub answers.
- **SC-003**: Zero duplicate comments for one ruling, across repeated hook runs.
- **SC-004**: Every failed notice call appears in the PR's lock refusal and `unlock` reply: zero failures
  recorded but not shown there.
- **SC-005**: The summary in the issue comment and the one in the `unlock` reply are identical in 100% of
  tested rulings.

## Assumptions

- Spec folders follow the org convention `specs/<issue>-<slug>` (git-workflow.md). The repo's older
  sequentially numbered folders (`004-…` to `020-…`) are retired after merge; one still bound to a PR fails
  the notice loudly rather than posting on the wrong issue.
- The spec's issue lives in the same repository as the PR.
- The token the gate's `gh` calls carry can comment on, label and assign issues in the repositories the plugin
  runs in. When it cannot, that is a notice failure (FR-010).
- Each repository the plugin runs in has a `reshape_spec` label, created by hand; this repository's is created
  before the feature ships.
- The comment is a notice that points to the spec folder, not a copy of the spec, so it stays within
  ADR-0008, and it is posted by alq-review, not alq-plan, so spec 019 FR-019 does not bar it.

## Why this is worth doing

### harm
Answer: A round gets ruled RESHAPE_SPEC and the branch locks. The session sees only `user_decision` and `next_step`; it is not told the spec folder or the spec-gap list. The brief that has both (spec folder, rationale, spec gaps) appears only later, when the user types `unlock`. Nothing is written to GitHub: the spec's issue gets no comment, no label and no assignee. Nobody outside the session learns that the spec has to be redesigned, or what in it. If the session ends before an unlock, the only copy is the local ledger.
Source: code: plugins/alq-review/workflows/assess-round.js (the return value), plugins/alq-review/scripts/gate.py `_reshape_brief` (docstring: "the user carries to planning by hand: nothing else hands it over") and `_unlock`.

### reachable
Answer: predicted. On main, every RESHAPE_SPEC ruling takes this path. `assess-round` returns no spec folder, and no code path calls GitHub for a ruling.
Source: code: assess-round.js; grep for an issue comment, label or assign call in plugins/alq-review/scripts finds none.

### change-alters
Answer: Yes. When the ruling is made, the round result names the bound spec folder and the summary (decision, rationale, spec gaps). The same summary is posted to the spec's issue, which is labelled `reshape_spec` and assigned to Analitiq-Bot-Wonka. Someone can then find the reshape from GitHub without the session.
Source: code: gate.py `_reshape_brief` already builds this summary; user: issue #111.

### owner
Answer: Partly. The lock refusal shows `user_decision` word for word, the ledger stores the assessment, and `unlock` prints the full brief. None of these puts it on GitHub, and none gives the spec folder when the ruling is made.
Source: code: gate.py `_unlock`/`_reshape_brief`, plugins/alq-review/README.md lines 16-21, 46-48.

### inherited
Answer: It touches three earlier decisions without reversing any. ADR-0018 says only `unlock` releases the lock; a comment releases nothing. Spec 019 FR-019 bars alq-plan from posting on the issue; this change has alq-review post a ruling notice, not a spec. ADR-0008 keeps the spec out of issue comments; the comment is a notice that points to the spec folder.
Source: code: dev/alq-review/docs/adr/0018-*.md, 0008-*.md; dev/alq-review/specs/019-split-planning-plugin/spec.md FR-019.

### needs-spec
Answer: It has decisions. Open: how to get the issue number (spec-folder prefix or the PR's linked issue); what to do with a no-spec PR; whether the gate or the workflow posts; how to make sure each ruling posts once; who creates the label; whether the assignee is fixed or set in config; what happens to the ruling when a GitHub call fails.
Source: user: issue #111 "Notes / open questions".

## Root cause

Observed: nothing; this trace is a hypothesis from reading the code.

The ruling lands in `after_structured_output` (`plugins/alq-review/scripts/gate.py:715`), which calls
`ledger.record_assessment` (`ledger.py:464`) and records a log line; it makes no GitHub call and builds no
summary. That is where the wrong decision is made: the one deterministic point that sees a `RESHAPE_SPEC`
ruling land treats it as ledger state only. The workflow then returns
(`plugins/alq-review/workflows/assess-round.js:25`) only `round_verdict`, `next_step`, `user_decision` and the
raw assessment; the spec folder injected into its args by `briefs.assess_args` (`briefs.py:197`) is not passed
back. The summary that joins folder, rationale and gaps, `_reshape_brief` (`gate.py:128`), has a single
caller, `_unlock` (`gate.py:224`), reached only from a `unlock <ref>` prompt.

- **Other callers**: `_unlock` → `_reshape_brief` via `policy.reshape_spec_ruling` (predicted); `github.py`
  exposes only reads (`issue_state`, `repo_visibility`, `pr_head`, `pr_target`, `released`), none of which
  writes to an issue (predicted).
- **Examined and ruled out**: `on_structured_output` (`gate.py:679`) — validates the assessment before it
  lands and refuses bad ones; it cannot post, since the ruling is not yet recorded there. `policy.locked`
  and the lock refusal — they show `user_decision` only and never the folder or gaps.
- **Not investigated**: the github-stage path that opens rounds from poller drops (`ledger.ingest_poll`)
  beyond confirming its rounds are assessed through the same `after_structured_output`; whether the `gh`
  token in every repo the plugin runs in may create labels and assign the `escalate_to` account.
