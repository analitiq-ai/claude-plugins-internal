# Feature Specification: Gate verdicts are check runs (#9)

**Feature Branch**: `docs/9-gate-check-runs-prose`

**Created**: 2026-10-03

**Status**: Draft

**Input**: analitiq-ai/engineering#9 and its `analitiq-spec` comment. Plan phase B5 of
`specs/002-pr-gate`: update `.claude/rules/pr-review-loop.md` and
`.claude/skills/alq-github-pr-review/SKILL.md` so they say the gate's verdict is a check run from
`analitiq-pr-gate`. Own PR, apart from the code (Principle VI).

## Clarifications

### Session 2026-10-04

- Q: Where is gate behaviour described: in both the rule and the skill, or only the skill? → A: Only the skill. The rule names the `codex-review` check run from the `analitiq-pr-gate` App and points to the `alq-github-pr-review` skill for its states.
- Q: Should SKILL.md keep its own list of the run's states and success conditions (critique P1)? → A: No. SKILL.md tells agents to act on the run's state and title as the poller prints them; every gate outcome carries its reason in the title, so no state list is copied.

## User Scenarios & Testing *(mandatory)*

The users are agents that follow the rule file and the skill while a PR is open.

### User Story 1 - Agent reads the gate's verdict from the right object (Priority: P1)

An agent waiting on Codex reads the prose and looks for the `codex-review` and `internal-review`
verdicts. Today the prose calls them commit statuses with a description. On main they exist only
as check runs from the `analitiq-pr-gate` App (observed 2026-10-03 on plugins #496: the only commit
statuses there are `CodeRabbit`, `DeepSource: Python` and `DeepSource: Secrets`). An agent that
follows the prose finds nothing, so it decides the gate has not answered, or re-requests Codex on
the wrong cue.

**Why this priority**: this is the whole issue. Every PR in the Codex loop runs into it.

**Independent Test**: read both files. The rule names `codex-review` as a check run from the
`analitiq-pr-gate` App and points to the skill. The skill names `codex-review` and
`internal-review` as check runs from that App, and says the run's title explains what is missing.

**Acceptance Scenarios**:

1. **Given** the updated `pr-review-loop.md`, **When** an agent looks up where Codex's verdict is,
   **Then** it is told to read the `codex-review` check run from the `analitiq-pr-gate` App on the
   head, and is pointed to the `alq-github-pr-review` skill for that run's states.
2. **Given** the updated SKILL.md, **When** an agent reads the poller's exit-4 row, **Then** it is
   told to act on the "gate check runs", the heading the poller prints.

---

### User Story 2 - Agent reads the gate's verdict from its title (Priority: P2)

Every gate outcome carries its reason in the run's title (`pr-gate.js@9bd2b2997c03`, `.github/scripts/pr-gate.js:215-263`,
`:511`): what is missing while the run is in progress, why it passed (a clean verdict comment, a 👍
tied to the head, `WAIVED: …`, a version-only release), or the gate's error. Under *Gate check runs*
the poller prints each gate run not passed to `--ignore-check`, with its state (`PENDING` while in
progress) and its title verbatim. The skill therefore sends agents to that
line instead of keeping its own list of states, so nothing in it can drift from the gate's mapping.

**Why this priority**: once agents read the right object (Story 1), this tells them how to read it.

**Independent Test**: SKILL.md tells agents to act on the run's state and title as the poller prints
them, and lists no gate states or success conditions of its own.

**Acceptance Scenarios**:

1. **Given** the updated SKILL.md, **When** an agent sees `codex-review` in any state, **Then** the
   skill tells it to act on the state and the title the poller prints.
2. **Given** the updated SKILL.md, **When** the gate adds or renames an outcome, **Then** no SKILL.md
   sentence becomes false, because none lists the outcomes.

### Edge Cases

- Other places say "commit status", but not about the gate: `deepsource-pr-gate.sh:5` (DeepSource
  grade) and `alq-prs-review/SKILL.md:61` plus `pr_dossier.sh` (generic `statusCheckRollup`). They
  are correct and stay as they are.
- No `codex-review` run on the head: the poller prints `WARNING: no codex-review check run from the
  analitiq-pr-gate App` (`codex_gate_missing`). What an agent should do then (a repo with no gate
  caller, or a gate that has not run yet) is new guidance, not a correction, and is out of scope.
- override-merge: the issue says it is "the owner merging in the UI". Analitiq-Bot is still
  `admin` on engine and plugins, and `pre-merge-gate.py` still implements override-merge as it
  does today, so writing that sentence now would make the prose false. Neither file mentions override-merge today, and
  this change adds no sentence about it; it moves to #17 item 3.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `pr-review-loop.md` MUST name `codex-review` as a check run that the
  `analitiq-pr-gate` App posts on the head, and MUST point to the `alq-github-pr-review` skill for
  its states. It MUST NOT restate gate behaviour itself: the skill is the one prose copy of
  `pr-gate.js`.
- **FR-002**: SKILL.md MUST describe `codex-review` and `internal-review` as check runs from the
  `analitiq-pr-gate` App, and MUST NOT call them commit statuses or speak of their "description".
- **FR-003**: SKILL.md MUST tell agents to act on the gate run's state and title as the poller
  prints them, and MUST NOT list the gate's states or success conditions itself.
- **FR-004**: SKILL.md MUST say "gate check runs" wherever it now says "gate statuses", which
  matches the heading the poller prints.
- **FR-005**: Where an edited sentence describes the poller, it MUST match what the poller does
  now. The edit replaces existing sentences and states no new gate facts.
- **FR-006**: The PR MUST NOT add a sentence about override-merge to either file.
- **FR-007**: The PR MUST change prose only. No code, hook or script changes go in it.

### Key Entities

- **Gate check run**: `codex-review` or `internal-review`, posted by the `analitiq-pr-gate` App on
  the PR head. It has a state (in progress, success or failure) and a title that holds the reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `grep -rn "commit status" .claude/rules .claude/skills/alq-github-pr-review/SKILL.md`
  prints nothing.
- **SC-002**: Both files name the `analitiq-pr-gate` App. Only SKILL.md describes the run's states
  and title. The rule file has no sentence about the 👍 or the title.
- **SC-003**: SKILL.md has no list of gate states: no bullet naming `success`, `pending`, in
  progress or `failure` for `codex-review`.
- **SC-004**: The PR diff touches only Markdown under `.claude/rules/`, `.claude/skills/` and
  `specs/`.

## Assumptions

- `pr-gate.js` in `analitiq-ai/.github` owns the gate's behaviour. The prose copies it and nothing
  checks the copy for drift. A Markdown file read by agents cannot import a script from another
  repo, so the prose points agents at the poller's printed report, which is generated, instead of
  restating the gate. What remains copied is the run's name, its App, and the 👍 paragraph's two
  facts (the gate may count a 👍; a reaction starts no workflow).
- `poll-pr-review.sh` already reads the App's runs and prints them under "Gate check runs:"
  (#8, alq-review 0.8.2). No poller change is needed.
- Out of scope: retiring the old reusable `pr-gate.yml` and the override-merge semantics (both
  #17).
