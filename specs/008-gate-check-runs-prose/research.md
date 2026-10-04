# Research: Gate verdicts are check runs (#9)

State of the branch at plan time: commit `2e484ad` already rewrites both files, and the working tree
holds an uncommitted edit to `pr-review-loop.md:15` that applies the 2026-10-04 clarification (the
rule points to the skill and no longer restates the 👍 or the title). After critique, SKILL.md's
state list is replaced by a pointer to the printed runs (R3). The decisions below settle
what that diff must say; tasks finish and verify it rather than start over.

## R1: Name the object agents read: a check run from the `analitiq-pr-gate` App

- **Decision**: Both files call `codex-review` (and SKILL.md also `internal-review`) a check run that
  the `analitiq-pr-gate` App posts on the PR head. Neither says "commit status" or "description" about
  the gate.
- **Rationale**: On main the gate exists only as App check runs (spec, User Story 1, observed on
  plugins #496). The poller already filters on that App: `GATE_APP="analitiq-pr-gate"`
  (`poll-pr-review.sh:52`) and `.checkSuite.app.slug == $gate_app` (`:176`), because another check
  may carry the same name (`:51`).
- **Existing tools**: `poll-pr-review.sh` already reads the runs (#8, 0.8.2) and is reused as-is; no
  new reader is needed.

## R2: Gate behaviour lives in the skill only; the rule points to it

- **Decision**: `pr-review-loop.md:15` names the run and its App, then points to the
  `alq-github-pr-review` skill for its states. The rule says nothing about the 👍 or the title.
- **Rationale**: Spec clarification 2026-10-04 and FR-001/SC-002. One prose copy of `pr-gate.js`
  means one place to drift instead of two (define once, `coding-principles.md`).
- **Existing tools**: The skill is where the gate prose already lives; the rule links to it rather
  than duplicating it.

## R3: SKILL.md lists no gate states; agents read the state and title the poller prints

- **Decision**: SKILL.md drops its three-state list and success conditions. It says to act on the
  `codex-review` run's state and title as the poller prints them under *Gate check runs*, the title
  giving the reason.
- **Rationale**: Critique P1, accepted 2026-10-04. Read this session at `pr-gate.js@9bd2b2997c03`: every outcome sets a
  reason as the title — clean verdict and 👍 (`.github/scripts/pr-gate.js:215`), pending reasons
  (`:218`, `:239`, `:245`, `:257`, `:263`), waiver (`:229`), internal review clean (`:253`),
  version-only release (`:511`) — and `:446-448` maps success/error/pending to
  completed-success/completed-failure/`in_progress`. The poller prints `name: state — title`
  (`poll-pr-review.sh:235`). A list in the skill would be a second copy of that mapping with no drift
  test (`schema-contracts.md`: un-gated prose copies get deleted); the printed title is generated.
- **Existing tools**: The poller's report (reused as-is) is the reader; no new text describes states.

## R4: "gate statuses" → "gate check runs", the poller's heading

- **Decision**: SKILL.md's *settled* paragraph and exit `4` row say "gate check runs".
- **Rationale**: FR-004. This matches the report's heading `Gate check runs:`
  (`poll-pr-review.sh:235`), so an agent can find the line the prose talks about.
- **Existing tools**: The poller's own heading is reused verbatim.

## R5: Sentences that describe the poller match its code

- **Decision**: These clauses in `2e484ad` stay: the settle rule leaves out gate runs and ignored
  checks; a lagging in-progress `codex-review` holds the round only when nothing is left to triage,
  and only for 20 min after Codex's answer. There is one gate sweep. Severity is given only for
  Codex, CodeRabbit and DeepSource, and threads opened by the PR author are left out.
- **Rationale**: FR-005. Checked against the code: `$running` excludes `.gate` (`:190`) and ignored
  checks (`:186`); `gate_lags` (`:213-215`, `GATE_SWEEP_MINUTES=20` at `:56`) only counts when
  `.findings == 0` (`:229`); `dispatched` is set once (`:339-341`); `severity` parses only those
  three bots (`:137-140`); author threads are filtered (`:196`).
- **Existing tools**: Not applicable. These are corrections to existing sentences, and no new
  mechanism is added.

## R6: no override-merge sentence

- **Decision**: Do not write "override-merge is the owner merging in the UI".
- **Rationale**: Analitiq-Bot is still `admin` on engine and plugins, and `pre-merge-gate.py` (`:37`,
  `:86`, `:288`) still implements override-merge as it works today. The issue's sentence would be
  false now. It moves to #17, item 3 (spec, Edge Cases; FR-006).
- **Existing tools**: Not applicable. No change is made.
