# Feature Specification: On/off switch for alq-review

**Feature Branch**: `feat/35-on-off-switch` (#35)

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "I would like to add an on/off switch to alq-review plugin as a whole and also to each of the 2 workflows: code shim scan and prose claim verification. This would be done with a keywork that I would need to type, just like do now with "unlock *"."

**Scope, settled 2026-10-07**: the switch for the whole plugin is needed now and is this feature. Switches for
the claim check and the shim check were wanted for later needs and are left out; see Assumptions.

## Terms

- **The plugin**: alq-review as a whole, meaning every rule it enforces on an agent's actions.
- **Switch**: the on/off setting of the plugin for one session.
- **Typed keyword**: words the user types at the start of a prompt, the way `unlock #<pr>` is typed today.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn the plugin off and on again (Priority: P1)

The user wants the plugin out of the way in one session: an urgent fix, work the review process does not
apply to, or a suspicion that the plugin itself is misbehaving. They type one keyword and no alq-review rule
stops the agent in that session. They type the opposite keyword and every rule applies again.

**Why this priority**: it is the whole feature.

**Independent Test**: In a session on a branch that has an unassessed review round, type the keyword that turns
the plugin off and see an agent edit and commit on that branch without refusal. Type the keyword that turns it
on and see the same edit refused again.

**Acceptance Scenarios**:

1. **Given** the plugin is on and a branch's round is unassessed, **When** the user types the keyword that turns the plugin off, **Then** edits, commits and pushes on that branch are no longer refused in that session, and the user is told the plugin is off.
2. **Given** the plugin is off, **When** an agent commits, **Then** neither the claim check nor the shim check is required, and the agent is not told to run them.
3. **Given** the plugin is off, **When** an agent in that session posts the internal-review attestation, marks a PR ready, merges (with `--admin` or through `gh api` included), or works on a branch locked for the user's decision, **Then** alq-review does not refuse it.
4. **Given** the plugin is off, **When** the user turns it on, **Then** every rule applies from the state its records are in at that moment, with nothing reset and nothing released.
5. **Given** the plugin is off in one session, **When** an agent in another session acts on the same repo, **Then** every rule applies to it as if no switch had been typed.
6. **Given** the plugin is off, **When** an agent launches one of the plugin's own workflows, **Then** the workflow does not start, and the answer says the plugin is off for this session and to carry on without it.

---

### User Story 2 - Know that it is off (Priority: P2)

A switch that is off and forgotten is a review that silently no longer happens. The switch lasts only for the
session it was typed in, and the user is reminded of it when they come back to that session.

**Why this priority**: it adds no capability; it keeps the first story safe to use.

**Independent Test**: Turn the plugin off, leave the session and resume it, and see the user told that the
plugin is off before any action. Start a new session and see it on.

**Acceptance Scenarios**:

1. **Given** the plugin is off in a session, **When** that session is resumed, **Then** the user is told it is off.
2. **Given** the plugin was turned off in a session that has ended, **When** a new session starts, **Then** the plugin is on.
3. **Given** the plugin was turned off or on, **When** the user later asks what happened, **Then** the plugin's record shows each change, when it was made, the session and the words that made it.
4. **Given** the user types the keyword followed by a word that is not part of it, **When** the prompt is submitted, **Then** nothing changes and the user is told the two valid forms.

---

### Edge Cases

- The keyword for a state the plugin is already in changes nothing and says so.
- The keyword appears in the middle of a prompt, or inside text an agent or a quoted issue wrote: it is not a switch. Only words at the start of a prompt the user typed count, as with `unlock`.
- An agent types the keyword in its own text, passes it to a subagent, or tries to write the plugin's state with an edit: nothing changes. Two routes are outside what the plugin holds today, for the switch as for locks; see Assumptions.
- A review round or a commit check is running when the plugin goes off: what its agents return is not recorded, and the run is treated as one that died. When the plugin is on again it is launched afresh.
- One of the plugin's own agents is still running when the plugin goes off: it stays confined to what it may read.
- Commits are made while off on a branch with a round in progress, then the plugin is turned on: the round's records are as they were, and the next round reviews what was committed since.
- A session is compacted or resumed while off: it is still off; the user is told on resume and the agent is told again after compaction.
- The switch cannot be read (its record is damaged): the plugin counts as on, and the user is told it could not be read.
- The plugin is in `log` mode: the switch works the same way; turning it on returns to `log` behaviour, not to refusing.
- The user types `unlock`, `override` or `override-merge` while off: they work as they do when on.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to turn the plugin off and on by a typed keyword.
- **FR-002**: The keyword MUST count only when it starts a prompt the user typed. The same words anywhere else MUST change nothing.
- **FR-003**: The typed keyword MUST be the only way the plugin offers to change the switch. The same words from an agent or a subagent, and an edit to the plugin's state, MUST change nothing.
- **FR-004**: While the plugin is off, no alq-review rule MUST refuse, delay or redirect the session's own work. This includes both commit checks, the attestation, ready and merge rules, the refusal of `--admin` and `gh api` merges, and branches locked for the user's decision.
- **FR-005**: Turning the plugin off MUST NOT release, reset or shorten anything the plugin holds: locks, round counts, claim holds and overrides stay recorded as they were, keep applying to every other session, and apply again in this one when it is on.
- **FR-006**: Off MUST apply only to the session it was typed in, including the subagents and workflows that session starts, and MUST end with that session. No other session, running or later, is affected.
- **FR-007**: Each change MUST be confirmed to the user.
- **FR-008**: Each change MUST be recorded with the time, the session and the user's words.
- **FR-009**: When a session that has the plugin off is resumed, the user MUST be told it is off.
- **FR-010**: The keyword followed by a word that is not part of it MUST change nothing and MUST name the valid forms.
- **FR-011**: A switch whose state cannot be read MUST count as on, and the failure MUST be reported to the user, never passed over.
- **FR-012**: The plugin MUST be on in every session until the user turns it off in that session.
- **FR-013**: The switch MUST be separate from the existing `log` / `enforce` settings: turning it on restores whatever those settings say.
- **FR-014**: While the plugin is off, its own workflows MUST NOT start, and a launch MUST be answered by saying the plugin is off for this session, that the user turns it on, and that the agent carries on without it.
- **FR-015**: An agent of the plugin that is already running when the plugin goes off MUST stay confined to what it may read.
- **FR-016**: The user's other keywords (`unlock`, `override`, `override-merge`) MUST work while the plugin is off.

### Key Entities

- **Switch**: whether the plugin is on or off, and the session it belongs to.
- **Switch change**: one turn of the switch — to which state, when, in which session, and the user's words.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The user turns the plugin off or on with one typed line, and sees the result confirmed before the agent's next action.
- **SC-002**: With the plugin off, 0 of the session's actions are refused by alq-review, and the agent spends no steps on its checks.
- **SC-003**: With no keyword typed, the plugin behaves as it did before this feature: its existing tests pass unchanged.
- **SC-004**: The same words from an agent or subagent, and an edit to the plugin's state, turn the plugin off in 0 attempts.
- **SC-005**: After any sequence of switch changes, turning the plugin on leaves every lock, count and hold exactly as it was before the first change.
- **SC-006**: Off in one session lifts 0 rules in any other session.
- **SC-007**: A user who returns to a session with the plugin off learns it is off, without asking, before the agent's first action.

## Assumptions

- Off means everything off (clarified 2026-10-07), the refusal of `--admin` and `gh api` merges included (clarified 2026-10-07 after the critique). The organisation's own gate on GitHub is a separate system and is not affected. It trusts the internal-review attestation, so with the plugin off an agent can post one for a review that did not run, and can merge past the server's requirements. The user chose this knowingly.
- A switch belongs to one session (clarified 2026-10-07). The same session resumed later is the same session.
- The keywords are `alq-review off` and `alq-review on` (settled at planning, research R3).
- Off is different from the existing `log` setting. In `log` a rule still judges and records what it would have refused. Off means no rule judges at all; only the switch change is recorded, so `gate.log` shows nothing between the off line and the on line.
- Switches for the claim check and the shim check alone are out of scope. The shim check takes its code/prose labels from the claim check, so the claim check cannot be off alone until reading hunks is made a step both share; the user's suggestion to share it stands for that later feature. Nothing is built for them now.
- Two routes by which an agent could change the switch are not closed here, because they exist today for locks and merge overrides and are one problem: a shell command that writes the plugin's state files directly, and any way Claude Code has of delivering text an agent chose as if it were a typed prompt. The second is measured in this feature (research R3) and recorded. Closing both means keeping the state where an agent cannot write it, which is its own feature.
- Work done while off is not checked after the fact by the commit checks. Review rounds cover the whole change on a branch, so commits made while off are reviewed in the next round.
