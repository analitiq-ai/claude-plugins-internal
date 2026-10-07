# Feature Specification: Merge override grants in the state folder

**Feature Branch**: `bugfix/36-merge-grants-state-folder` (#36)

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "The feature in issue #36" (issue #36, "alq-review: keep the merge override grants in the state folder, through the session-state helper")

**Decided before this spec (2026-10-07)**: the grants move into the state folder. It is the user's decision and
answers action item 2 of decision record 0002 (draft, PR #31).

**Settled here**: what a session id that is not a plain name means for the merge gate (FR-010). Issue #36 left
it to this spec; the user confirmed it on 2026-10-07 (Clarifications).

**Changed by the plan (2026-10-07)**: FR-011's words cannot be given where the session's switch fails first,
as when a file sits where the state folder should be. Found by running it. FR-011 and Edge Cases say so; the
merge is refused either way.

**Changed after the first critique (2026-10-07)**, by the user's answers to it
([critique](critiques/critique-20261007-merge-grants.md), Clarifications): a grant is asked for only by a merge
that needs one, and a recorded override is shown to the user.

**Changed after the second critique (2026-10-07)**, by the user's answers to it
([critique](critiques/critique-20261007-merge-grants-2.md), Clarifications): an override names its PR with the
repo, `override-merge owner/repo#N`, and a refusal that offers an override gives that line in full or says why
none can apply. The Terms, Today, US2, US3, FR-005, FR-010, FR-011, FR-017, FR-018, the Edge Cases, SC-004,
SC-008, SC-009 and the Assumptions changed with it.

## Clarifications

### Session 2026-10-07

- Q: When the merge gate gets a session id that is not a plain name, should it refuse, or carry on as if no override had been typed? → A: Refuse. Nothing is granted and the user is told why; a merge that needs an override is refused and told the same (FR-010). As first answered an attested merge was refused too; the third answer withdrew that.
- Q: Should this feature also stop an agent's file edit to the state folder in `log` mode and in a session that has the plugin off, or leave that to an issue of its own? → A: An issue of its own, #38. This feature leaves the write guard as it is (FR-003).
- Q: When should the merge gate ask for a grant: for every merge, or only for a merge it would otherwise refuse? → A: Only for a merge it would otherwise refuse. A merge that meets its requirements passes without the grants being read, and a grant is spent only by a merge that needed it (FR-005, FR-011).
- Q: Should the user be shown a line when an override is recorded? → A: Yes, one line. Silence then means the keyword was not recognised (FR-005).
- Q: An override that no merge has used yet is matched by PR number alone, so it can be spent on the same number in another repo. Should it stay that way? → A: No. An override is for a PR, so it names the PR: `override-merge owner/repo#N`, one form. `override-merge #N` grants nothing and is answered with what to type. A refusal that offers an override gives the line in full (FR-005, FR-017, FR-018).
- Q: With `gh` not on the hook's path the `--admin` refusal names an override that cannot help. Fix the wording here, or in an issue? → A: Here (FR-018).

## Terms

- **PR name**: `owner/repo#N`, GitHub's own short reference to a PR. Names are compared without regard to capitals.
- **Merge override**: the user's `override-merge owner/repo#N`, typed at the start of a prompt. It allows one merge of that PR in that session, past the merge gate and the server's rules.
- **Grant**: the plugin's record that a session holds an unspent merge override for a PR.
- **Needs an override**: said of a merge the merge gate refuses without one. It has `--admin`, or GitHub gives no head commit for its PR, or the commit it merges carries neither the internal-review attestation nor a version-only release.
- **State folder**: the folder outside every repo where the plugin keeps its records. One setting, `ALQ_REVIEW_STATE_DIR`, moves it.
- **Session record**: a record in the state folder that belongs to one session.
- **Write guard**: the plugin's refusal of an agent's file edit to anything in the state folder.
- **Plain name**: a session id made only of letters, digits, `_` and `-`.

## Today

Run on 2026-10-07 against main at `2ec150f`, with throwaway folders:

- Grants are kept in a folder of their own, outside the state folder. With `ALQ_REVIEW_STATE_DIR` set, a typed override is still recorded in that other folder.
- With the plugin on and enforcing, an agent's file write into that folder is let through. The same write to a session record in the state folder is refused.
- An override is `override-merge #N` and is matched by number alone. One typed for PR 12 lets a `--admin` merge of another repo's PR 12 through in that session.
- For a session id that is not a plain name, a typed override is dropped and nobody is told. A merge is then judged as if no override had been typed, and its `--admin` refusal still tells the user to type the override.
- With `gh` not on the hook's path, an `--admin` merge is refused and the user is told to type `override-merge #12`, which changes nothing there.
- When the grants folder cannot be created, a typed override ends in a program trace, not an answer.
- A recorded override shows the user nothing. So does a mistyped one, such as `override-merge 12`.
- A merge of a PR that GitHub can name reads the grants and writes them back before its attestation is looked at. So a merge that meets its requirements spends a grant it did not need, and a grant file that cannot be read refuses a merge that carries the attestation.
- When that write fails, the grant file is left empty, and the next typed override ends in a program trace.
- The plugin's other gates already treat a session id that is not a plain name as a failure (feature 016). Two were run: a reviewer's start is reported and goes on; the contest judge's fetch is refused.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An agent's file edit cannot write a merge override (Priority: P1)

A merge override lets one merge past every check, so it must exist only because the user typed it. Today its
record sits where the write guard does not reach, and an agent can create it with a file edit. The user wants
the grants under the same guard as every other record the plugin keeps, so that they get every guard the state
folder has or is given later.

**Why this priority**: it is the hole issue #36 names. A grant an agent wrote costs a merge past CI, the review
and the approval. This closes one way of writing a grant, not every way: a shell command still can
(Assumptions).

**Independent Test**: With the plugin on and enforcing, have an agent try to write the session's grant with a
file edit and see it refused. Then put a file where grants used to be kept and see `gh pr merge <n> --admin`
still refused.

**Acceptance Scenarios**:

1. **Given** the plugin is on and enforcing, **When** an agent tries to create or change a session's grant with a file edit, **Then** the edit is refused with the answer an edit to any other record in the state folder gets.
2. **Given** no override was typed for a PR in this session and a file naming it sits where grants were kept before this feature, **When** an agent merges that PR past its requirements, **Then** the merge is refused as if the file were not there.

---

### User Story 2 - The override is for one PR, kept in the one state folder (Priority: P2)

The user types an override and gets one merge of that PR past its requirements, in that session. The override
names the PR in full, `override-merge acme/demo#12`, because every repo has a PR 12 and a session can work in
several repos. The user does not have to work the line out: the refusal that offers an override prints it. The
record of it sits with the session's other records, so the setting that moves the state folder moves the
grants too, and the merge gate's tests can run against a throwaway folder the way every other gate's tests do.
The user is shown that the override was recorded, and a merge that did not need the override leaves it for one
that does.

**Why this priority**: it is the promise that closing the hole takes away nothing the user meant to have, and
it ends the second place state is kept.

**Independent Test**: Point the state folder at an empty throwaway folder. Run an `--admin` merge and see the
refusal give the line to type. Type it. See a line saying it is granted, the grant inside that folder and
nothing written outside it. See one merge of that PR past the requirements pass and the next refused, and a
merge of the same number in another repo refused.

**Acceptance Scenarios**:

1. **Given** the state folder is set to a folder F, **When** the user types `override-merge acme/demo#12`, **Then** the grant is recorded inside F, nothing is written outside F, and the user is shown one line saying one merge of `acme/demo#12` is granted.
2. **Given** that grant, **When** an agent runs a merge of `acme/demo#12` that needs an override in that session, **Then** the merge is let through, and a second such merge is refused.
3. **Given** that grant, **When** an agent runs a merge of `acme/demo#12` that needs no override, **Then** the merge is let through and the grant is still there for a merge that needs it.
4. **Given** that grant, **When** an agent in another session merges `acme/demo#12` past its requirements, or the same session so merges `acme/demo#13` or another repo's PR 12, **Then** the merge is refused and the grant is still there for its own PR.
5. **Given** an override typed anywhere but the start of a prompt, **When** the prompt is submitted, **Then** nothing is granted and nothing is shown.
6. **Given** the plugin is off in the session, **When** the user types the override, **Then** it is granted and recorded as when on.
7. **Given** an `--admin` merge of `acme/demo#12` with no grant, **When** it is refused, **Then** the refusal gives the line `override-merge acme/demo#12`, and typing that line as given is recorded.
8. **Given** the user types `override-merge #12`, **When** the prompt is submitted, **Then** nothing is granted, and the user is shown one line saying so and what to type.
9. **Given** the user types the name with other capitals, `override-merge Acme/Demo#12`, **When** an agent merges that PR past its requirements, **Then** the merge is let through.

---

### User Story 3 - A grant that cannot be kept is never a grant, and never silent (Priority: P3)

When the plugin cannot record or read a session's grants, there is no grant: a merge that needs one waits, and
a merge that needs none is not held up. The user who typed an override must learn it did not take, in the
plugin's words, and what can be done. Today one such case is silent, another ends in a program trace, and two
refusals tell the user to type an override that cannot help.

**Why this priority**: these cases do not arise in a healthy session. They decide what a broken one is told.
No merge can pass wrongly either way: a grant only ever turns a refusal into a pass, so grants that cannot be
read let nothing through.

**Independent Test**: Make the state folder unwritable, type the override and see the user told that nothing was
granted and why. Damage a session's grant record, merge a PR without the attestation and see the refusal name
the record and the repair. Merge an attested PR and see it pass.

**Acceptance Scenarios**:

1. **Given** the grant cannot be recorded, **When** the user types the override, **Then** nothing is granted and the user is told so, with the reason.
2. **Given** a session's grants cannot be read, **When** an agent runs a merge that needs an override, **Then** the merge is refused for what it lacks, and the refusal also says the grants could not be used and why.
3. **Given** a session's grants cannot be read, **When** an agent runs a merge that needs no override, **Then** the merge is let through and the grant record is left as found.
4. **Given** a grant record that is damaged, **When** the user types the override or a merge is refused over it, **Then** the answer names the record and says the user deletes it and types the override again; it does not repeat what the record holds; once the record is deleted the override is recorded.
5. **Given** a session id that is not a plain name, **When** the user types the override, **Then** nothing is granted, no record is created for it, and the user is told that no override can be kept in that session and what can be done.
6. **Given** a session id that is not a plain name, **When** an agent runs a merge that needs an override, **Then** it is refused as in scenario 2, with the same words about that session.
7. **Given** a session's grants cannot be read, **When** an agent runs a command that consults no grant, **Then** it is judged as it is today.
8. **Given** `gh` is not on the hook's path, or the PR has no address on github.com, **When** an `--admin` merge is refused, **Then** the refusal says no override can apply and why, and names no line to type.

---

### Edge Cases

- The override is typed twice for one PR before any merge: one merge is granted, not two.
- Several merges of the same PR that need the override run at once on one grant: one is let through on it; the others are refused.
- A session is open across the upgrade and holds an unspent grant: the grant is gone. The user types the override again, in the new form.
- `override-merge #12`, typed out of habit: nothing is granted and one line says what to type. Nothing is written.
- An override for `acme/demo#12`, and a merge of another repo's PR 12 in that session: refused; the grant stays for its own PR.
- A grant no merge has needed stays until a merge of its own PR needs it. Nothing else ends it, and it cannot be withdrawn. See Assumptions.
- The repo is renamed after the override is typed: GitHub gives the PR its new name, the grant no longer matches, and the refusal gives the new line to type. Not run; it follows from how names are compared.
- A PR whose address is not on github.com cannot be named, so no override applies to it. An `--admin` merge of it is refused and told so. On main a number-only override lets it through. See Assumptions.
- A grant record holds something the plugin did not write, such as a list in the old form: it counts as unreadable, never as a grant, and is not passed over without a word. What it holds is not repeated in any answer.
- A command that consults no grant (publishing a draft, `gh pr ready --undo`, `gh pr merge --disable-auto`, a merge that needs no override, anything that is not a merge) is judged as today whatever state the grants are in.
- GitHub's answer about a version-only release cannot be read, with a grant held: a merge without `--admin` is refused with the merge gate's general failure answer and the grant is kept. The same merge with `--admin` passes on the grant. On main the first passes on the grant. See Assumptions.
- The session's switch (feature 016) cannot be read and that failure cannot be written to the plugin's error log, as when a file sits where the state folder should be: the switch is read before any grant and fails first. A merge or a publish is refused with the merge gate's general failure answer, which names what could not be written. Run on 2026-10-07: main does this today, and it is not changed here (issue #49). A typed override is still answered as FR-009 says.
- A write of the grant record fails part-way, as on a full disk: the record can be left empty. It then counts as damaged and is repaired as one. Main does the same today (issue #48).
- The plugin is in `log` mode, or off in the session: the write guard does for a grant what it does for every record then, which is to record the edit or not to run. Issue #38; see Assumptions.
- A shell command writes into the state folder: it is not stopped, for grants as for every record. Issue #50; see Assumptions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A grant MUST be kept in the state folder, with the session's other records, and nowhere else.
- **FR-002**: The setting that moves the state folder MUST move the grants with it. Recording or spending a grant MUST write nothing outside the state folder.
- **FR-003**: The write guard MUST cover a grant as it covers every other record in the state folder: the same answer, the same behaviour under `log` and `enforce`, and no rule of its own.
- **FR-004**: The folder where grants were kept before MUST NOT be read, written or created. A file there MUST grant nothing. Nothing is moved from it.
- **FR-005**: An override typed at the start of a prompt MUST grant one merge of the PR it names, in that session, and the user MUST be shown one line saying so. Typed anywhere else it MUST grant nothing and nothing is shown. It is spent by the first merge of that PR that needs it; a merge that needs no override MUST NOT spend it. It does not apply to another PR or another session. It is granted while the plugin is off.
- **FR-006**: A grant MUST be spent once. Of several merges of one PR that need it, running at once on one grant, exactly one MUST be let through on it.
- **FR-007**: The plugin MUST have one way of keeping a session record. The grants MUST be kept that way, and the merge gate MUST keep no second copy of it.
- **FR-008**: The plugin MUST have one rule for which session ids a record can be kept under. The merge gate MUST keep no copy of it.
- **FR-009**: When a grant cannot be recorded, nothing MUST be granted, and the user MUST be told that nothing was granted and why. Where the grant record is damaged, the answer MUST name the record and say how the user repairs it, and MUST NOT repeat what the record holds.
- **FR-010**: A session id that is not a plain name MUST count, for the merge gate, as grants that cannot be reached. It MUST NOT be passed over without a word. FR-009 and FR-011 apply, no record is created for it, and the answer MUST say that no override can be kept in that session and what can be done: the merge waits for what it lacks, or is run from another session.
- **FR-011**: When a session's grants cannot be read or written, a merge that needs an override MUST be refused for what it lacks, and the refusal MUST also say that the grants could not be used, and why. Where the grant record is damaged, it MUST name the record and say how the user repairs it. A merge that needs no override MUST be judged without the grants and MUST NOT open their record. Where the session's switch fails first, a merge is refused in the words that case gets today (Edge Cases).
- **FR-012**: A grant record that is not in the form the plugin writes MUST count as unreadable.
- **FR-013**: A command that consults no grant MUST NOT be refused because the grants cannot be read. A merge that needs no override is such a command.
- **FR-014**: The README's State section MUST list the grant record under the state folder and MUST name no other folder for grants. Where the README gives the override, it MUST give it in the form the merge gate takes.
- **FR-015**: The merge gate's tests MUST keep their state in a throwaway folder chosen by the setting the other gates' tests use.
- **FR-016**: A failure to record or to read a session's grants MUST be written to the plugin's error log, when the log can be written.
- **FR-017**: An override MUST name its PR as `owner/repo#N`, and there MUST be one such form. A grant MUST let through only a merge of the PR it names: the same repo and the same number, names compared without regard to capitals. `override-merge #N` MUST grant nothing, and the user MUST be shown one line saying so and what to type.
- **FR-018**: A refusal that tells the user they can override MUST give the line to type in full, so that typing it as given is recorded. Where no override can apply, the refusal MUST say that and why, and MUST NOT name a line to type: `gh` is not on the hook's path, or the PR has no address on github.com.

### Key Entities

- **Grant**: that a session may merge one PR once, past its requirements. It names the session and the PR, by its PR name. It exists from the user's override until a merge of that PR that needs it spends it.
- **Session record**: what the plugin keeps for one session in the state folder. The grants become one of these.
- **State folder**: the one place the plugin's records are kept, and the one place the write guard covers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the plugin on and enforcing, 0 of an agent's file edits to a grant are let through.
- **SC-002**: A file placed where grants used to be kept lets 0 merges through.
- **SC-003**: After an override is typed and spent with the state folder set to an empty folder, 0 files exist outside that folder that were not there before.
- **SC-004**: The existing tests of the override are kept. Each changes in what it types, in the address its stand-in PR has, and in where its state is kept; each still shows what its name says.
- **SC-005**: In every case where a grant cannot be recorded or read, no merge passes on a grant, no merge that needs none is refused for it, and the user or the agent is told the reason in the plugin's words every time.
- **SC-006**: The plugin keeps a session record one way and holds one rule for a session id, where it had two of each.
- **SC-007**: The plugin's code and README name one place for grants. The old folder is named in neither.
- **SC-008**: Every typed override shows the user a line: recorded, not recorded and why, or not an override and what to type.
- **SC-009**: An override for a PR of one repo lets 0 merges of another repo's PR through.

## Assumptions

- **Why a session id that is not a plain name is answered, not passed over** (the user's decisions, 2026-10-07). A session's id is supplied by Claude Code, not by the agent, so this decides only what a payload without a usable id gets. Passed over, the user's override is dropped without a word, and the merge gate needs a rule of its own for that case. Answered, the merge gate does what the plugin's other gates already do. Safety is the same either way: a grant only turns a refusal into a pass, so grants that cannot be reached let no merge through. That is also why a merge that needs no override is not refused for them.
- **The switch is not changed.** Feature 016 counts the plugin as on for a session id that is not a plain name. That stays.
- **No migration**, by the user's decision in issue #36. A grant is spent once and belongs to one session. The old folder is deleted by hand.
- **The old form is not kept** (the user's decision, 2026-10-07). `override-merge #N` grants nothing after this feature. It is still recognised, only so that the user who types it is told what to type.
- **An override names a PR on github.com.** The plugin reads a PR's repo from its github.com address, as the version-only release check already does. A PR on another host cannot be named, so no override applies to it and the refusal says so. On main a number-only override lets such a merge through (run on 2026-10-07). Nobody here uses another host; not tracked.
- **A grant has no end but its spending** (the user's decision of 2026-10-07 to keep "only when needed"). An override that no merge has needed stays in the record, across a resume of the session, until a merge of its own PR needs it. It cannot be withdrawn. After this feature it can be spent on the PR it names and no other.
- **`log` mode and a session that is off leave a gap that this feature does not close.** Run on 2026-10-07: in `log` mode an agent's write to a session record in the state folder is recorded, not refused, while the merge gate refuses in either mode. With the plugin off in a session, a write to another session's record in the state folder is not refused. So after this feature an agent could still write a grant by a file edit in those two cases. This is how the write guard treats every record, and closing it changes what `log` and off mean for all of them. By the user's decision of 2026-10-07 it is issue #38, not part of this feature.
- **A shell command that writes the state folder is not stopped** (issue #50). Run on 2026-10-07 on a scratch copy of this feature as first planned: a shell command wrote a grant, and a merge with `--admin` then passed with no override typed. Closing it means keeping the state where an agent cannot write, which is its own feature.
- **A grant is spent when the gate lets a merge through on it**, whether or not GitHub then merges. Unchanged.
- **A damaged grant record is repaired by hand.** The user deletes it and types the override again. The plugin does not replace it, and does not repeat what it holds, so that a person opens the file itself.
- **A grant record is written in place**, as every session record is, so a write that fails can leave it empty (issue #48). After this feature a merge that needs no override no longer writes it.
- **GitHub's answer about a version-only release is asked for before the grant** by a merge without `--admin`. When that answer cannot be read, such a merge is refused with a grant held, where main passes it. The way through is `--admin`, which is judged before that answer is asked for. It is the cost of asking for a grant last.
- **The merge gate's hook has 45 s and its two calls to GitHub may take 50 s.** What Claude Code does with a hook that runs out of time has not been run by anyone. Issue #52; not changed here.
- **An override and its spending leave no line in the plugin's log of decisions** (issue #51). Not added here.
- **Session records are not deleted when a session ends** (decision record 0002, decision 8, not built). Grant records stay as the others do.
- **Depends on feature 016** (merged 2026-10-07, PR #37). It made a session id that is not a plain name a failure where a session record is located. What is left is the merge gate's own copy of that rule.
- **Decision record 0002 and the README table are in PR #31**, which is open. The record is updated there, apart from this feature's PR, so the record and the code it governs do not move together. PR #31 adds a merge-gate row and a note to the README's State section; whichever of the two PRs lands second removes them. FR-014 holds in either order, and SC-007 is checked by a test.
