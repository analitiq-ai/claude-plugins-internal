# Feature Specification: A PR labelled cleanup gets no alq-review gating

**Feature Branch**: `114-spec`

**Created**: 2026-10-14

**Status**: Draft

**Input**: Issue #114 — "alq-review: a PR that only deletes files under specs/ is gated for internal and Codex review". A retire-spec PR made by `/alq-post-merge` step 7 is refused at ready and at merge, and its Codex review is requested and waited on, although the skill says it needs no review. When every change in the PR is a deletion of a file inside a `specs/` directory, no internal and no Codex review is required; anything else in the diff brings the gate back. Open point: step 7 also removes citations of the spec from files outside `specs/`, which would keep such a PR gated.

Superseded by the Clarifications: the `cleanup` label decides, not the diff.

## Clarifications

### Session 2026-10-14

- Q: Where is the spec-deletion-only check decided: the org pr-gate (and this repo adopts it) or alq-review alone? → A: alq-review alone. Only alq-review logic changes; the org pr-gate is left alone. A PR that only deletes files under `specs/` gets none of alq-review's gating: no internal review, no Codex request or wait, no DeepSource grade check, nothing else alq-review applies. (Superseded: the diff wording by the next answer, the label; "nothing else" by FR-013, which keeps the holds that are not reviews.)
- Q: What identifies a PR that gets no alq-review gating, and who may mark it? → A: The PR label `cleanup` alone, whatever the diff. Only the user adds it, on GitHub. (Not enforced by this feature: see the last answer and FR-010.)
- Q: Does the exemption survive pushes made after the label was added? → A: Yes. The label exempts the PR whatever is pushed to it later; only removing the label brings the gate back.
- Q: Does this feature change `/alq-post-merge` (citation removal, step 7)? → A: No. The work is alq-review only.
- Q: Does the label also skip alq-review's commit-time checks (claim-check, shim-check)? → A: Yes. Commits on a branch whose PR carries `cleanup` skip both.
- Q: Does this feature refuse an agent's command that adds the label? → A: No. The user adds a separate hook later that refuses a fixed set of `gh` forms; this feature refuses no label command.
- Q: A branch can have open PRs to more than one target. Whose label decides its commits? → A: The PR `pr_target` already resolves for the branch (the first open PR gh lists). No other multi-PR handling.

### Session 2026-10-15

- Q: The agent runs `gh pr create` without `--draft` from a branch. Whose label decides it? → A: The same as `gh pr ready` run from the checkout: the label of the branch's open PR, read as for its commits. A branch with no open PR has no label, so its create is gated as today.
- Q: Which poller runs on a cleanup PR? → A: Today's poll loop, report and exit codes, with the Codex, review-thread and hand-over terms switched off. The skill says what each exit means on a cleanup PR. No new exit code. (Superseded in part by the next answer: the review-thread and hand-over terms stay on.)
- Q: Does the label lift the repo's own GitHub rules on a cleanup PR? → A: No. alq-review drops only its own gates. Both default-branch rulesets of `claude-plugins-internal` require every review thread resolved before merge; on a cleanup PR the poller reports and hands over threads, and the agent triages them, as on any PR. Cleanup mode only stops the poller waiting on Codex.
- Q: When does the agent mark a draft cleanup PR ready? → A: At once, as today's draft step gives; it merges once CI is green.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A cleanup PR is readied and merged without review (Priority: P1)

An agent finishing `/alq-post-merge` opens a draft PR that retires a spec folder. The user adds the `cleanup`
label to it on GitHub. The agent marks the PR ready and, once CI is green, merges it.
Neither step is refused for a missing internal round or attestation, and alq-review waits for no Codex review.
The user runs no `!` command.

**Why this priority**: It is the defect. Today every retired spec folder costs the user a manual `gh pr ready`
and `gh pr merge` (observed on #113).

**Independent Test**: Label a PR `cleanup`; `gh pr ready` and `gh pr merge` run by the agent both go through
with no internal round recorded on the branch and no attestation comment.

**Acceptance Scenarios**:

1. **Given** a draft PR labelled `cleanup` and no internal round on the branch, **When** the agent runs
   `gh pr ready`, **Then** it is allowed.
2. **Given** the same PR, ready, with no attestation comment, **When** the agent runs `gh pr merge`, **Then**
   the alq-review gate allows it.
3. **Given** a PR without the `cleanup` label, whatever its diff, **When** the agent runs `gh pr ready` or
   `gh pr merge`, **Then** it is refused exactly as today, naming the internal review as the next step.
4. **Given** a PR whose `cleanup` label was removed, **When** the agent runs `gh pr ready` or `gh pr merge`,
   **Then** it is refused as for any unlabelled PR.

---

### User Story 2 - The poller and the skill apply no review gating to a cleanup PR (Priority: P2)

After opening or readying a cleanup PR, the agent follows the GitHub review skill. The skill and the poller
recognise it as needing no review: no `@codex review` is posted, no Codex answer is waited on, and the DeepSource
grade gate is not run.

**Why this priority**: Without it the agent still spends a Codex round, ~10–15 minutes of waiting and a
DeepSource check on a cleanup PR, even once the hooks let the merge through.

**Independent Test**: Run the poller against a cleanup PR with no Codex activity on it; it finishes without
waiting on Codex and without telling the agent to post `@codex review` or run `deepsource-pr-gate.sh`.

**Acceptance Scenarios**:

1. **Given** a ready cleanup PR with no Codex comment, **When** the poller runs, **Then** it ends without
   waiting for a Codex answer and does not tell the agent to request one.
2. **Given** a cleanup PR on which a reviewer (Codex unasked, DeepSource or a human) left an unresolved
   thread, **When** the poller runs, **Then** it reports the thread as on any PR: the repo's rulesets, not
   alq-review, require it resolved before merge.
3. **Given** a PR without the label, **When** the poller runs, **Then** it behaves as today.

---

### Edge Cases

- The label is read from GitHub at each check (ready, merge, commit, poll). When it cannot be read, the PR is
  treated as unlabelled and gated, and the ready refusal and the poller say the label could not be read.
- The user adds the label on GitHub: the PR is a cleanup PR.
- Removing the `cleanup` label brings the gate back.
- A round in flight, a lock or `--admin` without `override-merge` still refuses a cleanup PR (FR-013).
- A comment carrying the internal-review attestation marker on a cleanup PR is refused as on any PR without a clean round: the org pr-gate takes it for the review (FR-011).
- A commit on a branch with no open PR, or whose open PR (the one `pr_target` resolves) has no `cleanup` label, is checked by claim-check and
  shim-check as today.
- A push after the label was added leaves the PR a cleanup PR: the exemption is bound to the PR, not to a
  head commit.
- A PR labelled `cleanup` in a repo whose rulesets require the org pr-gate's checks stays held by those
  checks (FR-005).
- A cleanup PR is still held by its repo's GitHub rulesets: in `claude-plugins-internal` an unresolved review
  thread blocks the merge. Its threads are triaged as on any PR.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A PR is a *cleanup PR* when it carries the label `cleanup` at the time of the check. Its diff is
  not read, and no head commit is bound to the label: commits pushed after it was added are exempt too.
- **FR-002**: alq-review decides whether a PR is a cleanup PR in one function, which every alq-review
  component that acts on it calls (the ready and merge hooks, the commit hooks, the poller); no two components decide it
  separately.
- **FR-003**: For a cleanup PR, marking it ready MUST be allowed without a clean internal round at its head.
- **FR-004**: For a cleanup PR, merging MUST be allowed without an internal-review attestation for its head.
- **FR-005**: The org pr-gate and its `codex-review` / `internal-review` check runs are not changed. In a repo
  whose rulesets require those checks, a cleanup PR stays held by them; that is outside this feature.
- **FR-006**: For a PR that is not a cleanup PR, ready, merge, the commit checks, the poller and the skill
  behave exactly as before this change.
- **FR-007**: When the label cannot be read, the PR is not a cleanup PR. A ready refusal then also says the label
  could not be read, and the poller prints a warning saying so.
- **FR-008**: For a cleanup PR, the poller MUST NOT wait for a Codex answer or tell the agent to post
  `@codex review`. It reports review threads and hands them to the gate as on any PR.
- **FR-009**: The GitHub review skill MUST state that a cleanup PR needs no `@codex review`, no DeepSource
  grade check (`deepsource-pr-gate.sh`), that its review threads are triaged as on any PR, and that the `cleanup`
  label is what marks one.
- **FR-010**: This feature refuses no command that adds or removes a label. Refusing an agent's label add is
  left to a separate hook the user adds later; until then a label an agent adds exempts the PR as one the user
  adds does.
- **FR-011**: Only the `cleanup` label and the version-only release exempt a PR from review; no other path
  (agent-posted comment, check run from another app) releases the hold.
- **FR-012**: A `git commit` on a branch whose open PR, the one `pr_target` resolves, carries the `cleanup` label MUST NOT be held by
  claim-check or shim-check. When the PR or its label cannot be read, both checks apply as today.
- **FR-013**: The label releases only the review holds FR-003, FR-004, FR-008 and FR-012 name. A cleanup PR is
  still refused while an internal round is in flight or its branch is locked (a lock keeps the releases its
  own decision record names), and `gh pr merge --admin` on it still needs `override-merge`.

### Key Entities

- **Cleanup PR**: a PR carrying the `cleanup` label (exists in `claude-plugins-internal`: "Code cleanup, dead
  code removal, or refactor with no behaviour change"; no PR in the org's main repos carries it today).
- **Review exemption**: the reason a PR needs no review — today only the version-only release title on the org
  gate's `internal-review` check run, read by alq-review; this feature adds the cleanup PR, decided by
  alq-review itself.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a repo where the org pr-gate does not run (today `claude-plugins-internal`), a retire-spec PR from
  `/alq-post-merge` is readied and merged by the agent with zero `!` commands from the user (was 2 on #113); the user's only action is adding the label on GitHub.
- **SC-002**: A cleanup PR gets zero `@codex review` requests, zero internal review rounds, zero DeepSource
  gate runs, and zero claim-check or shim-check runs on its commits.
- **SC-003**: Every PR without the label is gated as before: in the test suite, every existing ready/merge
  refusal case still refuses.

## Assumptions

- The org pr-gate (`analitiq-ai/.github`) runs only in repos whose workflows call it (`analitiq-core`,
  `claude-code-plugins`); there the org `pr-gate` ruleset requires `codex-review` and `internal-review`.
  `claude-plugins-internal` runs no org pr-gate and requires no status check; its rulesets require every review
  thread resolved before merge, which binds a cleanup PR as any PR. This feature changes only alq-review, so it
  fully applies where the org pr-gate does not run.
- Codex may still review a PR unasked when it is marked ready. This feature does not stop Codex from
  reviewing; its threads are triaged as on any PR.
- The repo's CI still runs on such a PR and must be green before merge.

## Why this is worth doing

### harm
Answer: A retire-spec PR made by /alq-post-merge step 7 is refused at `gh pr ready` (no clean internal round at the head) and at `gh pr merge` (no internal-review attestation for the head), and the Codex review is requested and waited on. The skill tells the agent the PR needs no review and can merge once CI is green, so the agent hits the refusal and stops; the user has to ready and merge it by hand with `!`. Every retired spec folder costs one manual intervention, or a pointless review round over a deletion.
Source: code: plugins/alq-review/scripts/policy.py:216-231 (mark_ready), gate.py:376-378, pre_merge_gate.py:383-397 (unmet); code: cto/.claude/skills/alq-post-merge/SKILL.md:153-154 ("needs no review ... merged as soon as CI is green"); user: issue #114.

### reachable
Answer: observed. PR #113 (retire dev/alq-review/specs/101-codex-card-status) had both the ready and the merge refused on main's gate; the user ran them with `!`.
Source: user: issue #114; reproduction: gh pr view 113 (spec-folder deletions plus dev/alq-review/tests/test_codexstate.py +2 -2).

### change-alters
Answer: Only together with the open point. With the rule, a head diff that is nothing but deletions under specs/ passes mark_ready and pre_merge_gate the way a version-only release already does (`released=True`), and the poller skips the Codex request/wait. But #113 itself also edited two docstrings in test_codexstate.py, because step 7 puts citation removal in the same PR; under the rule #113 would still be gated. So the outcome changes for retire-spec PRs only if citation removal leaves the removal PR (or the rule is widened), which is the issue's open point.
Source: code: policy.py:216-221 (released short-circuit), pre_merge_gate.py:395; code: alq-post-merge SKILL.md:124-151 (step 7 = citations + git rm in one PR); reproduction: PR #113 file list.

### owner
Answer: No owner for spec deletions. The only review exemption is the version-only release: the org pr-gate (analitiq-ai/.github pr-gate.js versionOnlyRelease) classifies the PR diff and posts both `codex-review` and `internal-review` check runs titled "version-only release: OLD → NEW"; alq-review's github.released reads that title for mark_ready and pre_merge_gate. The skill's "needs no review" sentence is a procedure with no enforcement behind it, and it contradicts the gate.
Source: code: analitiq-org-github origin/main .github/scripts/pr-gate.js:400-440,510-511; code: plugins/alq-review/scripts/github.py:11-81, pre_merge_gate.py:27-31,350-355.

### inherited
Answer: Yes, from the /alq-post-merge step 7 decision that a spec-removal PR needs no review. It holds: a deletion under specs/ changes no code path, and spec folders are read only by review rounds bound to an open PR, which step 5 rules out before step 7 runs. The decision was never carried into the gate, which is this issue.
Source: code: alq-post-merge SKILL.md:81 (step 5, spec no longer in use), 124-154; code: plugins/alq-review/scripts/specbinding.py.

### needs-spec
Answer: It has decisions. (1) Where the classification lives: in the org pr-gate next to versionOnlyRelease (one classifier, both check runs, alq-review only reads) or inside alq-review reading the diff itself. The org gate is a second repo (analitiq-ai/.github), so this also fixes the PR order. (2) The open point: split citation removal into its own reviewed PR, stop removing citations in step 7, or widen the rule. (3) How the poller/skill learn not to request or wait for Codex on such a head.
Source: user: issue #114 "Open point"; code: pr-gate.js versionOnlyRelease; code: plugins/alq-review/skills/alq-github-pr-review (no release handling today).

## Root cause

Observed: PR #113 (retire `dev/alq-review/specs/101-codex-card-status`): `gh pr ready` and `gh pr merge` refused by the alq-review gate, reported in issue #114; the file list (spec-folder deletions plus `dev/alq-review/tests/test_codexstate.py` +2 -2) is from `gh pr view 113` in the premise report. Not re-run for this spec.

The gate knows exactly one reason a head needs no review: the org pr-gate's version-only release. The wrong
decision is made in two places that both consult only that reason. `policy.mark_ready`
(`plugins/alq-review/scripts/policy.py:216-230`) allows a ready only when `released` is true or the last
internal round is settled at the head; `released` comes from `github.released`
(`plugins/alq-review/scripts/github.py:77-81`), which reads the org gate App's `internal-review` check-run
title for the `version-only release:` prefix. `pre_merge_gate.unmet`
(`plugins/alq-review/scripts/pre_merge_gate.py:383-397`) allows a merge only when the head is attested or the
same `released` reader says yes. Nothing anywhere classifies a deletion under `specs/`, so a retire-spec PR
falls through to "no clean internal round" and "no attestation". The org gate posts `codex-review` and
`internal-review` for the same single case. Where it runs (`analitiq-core`, `claude-code-plugins`, through
their `.github/workflows/pr-gate.yml`), the org `pr-gate` ruleset requires both checks, so they would stay unmet
even if alq-review let the commands through. `claude-plugins-internal`, where #113 happened, runs no org
pr-gate and its rulesets require no status check: the alq-review hooks are its only gate, and `github.released` can
never be true there. The poller (`plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh:203-207`)
knows one exemption only, a `codex-review` run whose description starts `WAIVED:` (Codex out of credits), and
none for a release or a spec deletion.

- **Other callers**: `gate.on_bash` → `policy.mark_ready` for `gh pr ready` (`gate.py:375-378`) (predicted);
  `pre_merge_gate` main → `unmet` for `gh pr ready` / `gh pr merge` (`pre_merge_gate.py:444`) (predicted);
  org `pr-gate.js` `readRelease` → `versionOnlyRelease` → `codex-review` / `internal-review` check runs
  (`analitiq-ai/.github` `.github/scripts/pr-gate.js:400-440,510-511`): it compares `base...head` for the head
  commit, reads each file's `status`, and classifies nothing past 300 changed files.
- **Examined and ruled out**: `github.released` misreading the check run — it behaves as written; the head
  simply has no release title. `policy._obstacle` (in-flight rounds, locks) — its refusals name a different
  reason than the one seen on #113.
- **`gh pr create` without `--draft`**: `shell.py:149-150` classifies it as `ready`, so it reaches
  `policy.mark_ready` through `gate.on_bash`, judged against the branch's open PR as `gh pr ready` from the
  checkout is.
