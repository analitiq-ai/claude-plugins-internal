# Quickstart: verify #9

Run from the worktree root. Steps 1–2 are the red/green checks: run them on `main` first and confirm
they fail there for the stated reason.

1. **No gate "commit status" (SC-001)**
   ```bash
   grep -rn "commit status" .claude/rules .claude/skills/alq-github-pr-review/SKILL.md
   ```
   - On `main`: it matches `pr-review-loop.md:15`, `SKILL.md:12` and `SKILL.md:20`. This is the red check.
   - On the branch: no output.

2. **App named in both files, behaviour only in the skill (SC-002)**
   ```bash
   grep -c "analitiq-pr-gate" .claude/rules/pr-review-loop.md .claude/skills/alq-github-pr-review/SKILL.md
   grep -nE "👍|title|WAIVED" .claude/rules/pr-review-loop.md
   ```
   - Expected: each count is at least 1, and the second grep prints nothing.

3. **No state list; remaining gate facts match the gate (SC-003)** — required
   ```bash
   grep -nE "^- .*(success|pending|in progress|failure)" .claude/skills/alq-github-pr-review/SKILL.md
   ```
   - Expected: no output.
   - Read `.github/scripts/pr-gate.js` at `pr-gate.js@9bd2b2997c03` (`gh api "repos/analitiq-ai/.github/contents/.github/scripts/pr-gate.js?ref=9bd2b2997c038dd60dea1f1464189c029ac33cfa"`):
     every outcome sets a reason as its title (`:215-263`, `:511`), and a 👍 tied to the head counts
     (`:131-156`). Compare with `SKILL.md:12` and `:14` (branch lines).

4. **The poller's wording matches (FR-004)**
   ```bash
   grep -n "Gate check runs" .claude/skills/alq-github-pr-review/poll-pr-review.sh
   grep -n "Gate check runs\|gate check runs\|gate statuses" .claude/skills/alq-github-pr-review/SKILL.md
   ```
   - Expected: SKILL.md has "Gate check runs" / "gate check runs", and no "gate statuses".

5. **Prose only (SC-004, FR-007)**
   ```bash
   git diff --name-only main...HEAD
   ```
   - Expected: only `.md` files under `.claude/rules/`, `.claude/skills/` and `specs/`.

6. **Contract**: read both files against [contracts/gate-prose.md](contracts/gate-prose.md).
