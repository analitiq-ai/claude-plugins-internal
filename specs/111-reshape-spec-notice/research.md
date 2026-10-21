# Research: A RESHAPE_SPEC ruling names its spec and tells the spec's issue

Paths are from the repo root. Every decision below was read against the code at `25bd2e2`; none was run.

## R1: The bound spec folder reaches assess-round by both launch paths, and is returned as given

- **Decision**: `briefs.spec_folder(state) -> str | None` returns the bound folder's path, or None for `spec: null`
  or no binding. `briefs.assess_args` and `briefs.review_args` both inject it as `spec_folder`. `review-round.js`
  forwards `args.spec_folder` in its nested `workflow('alq-review:assess-round', …)` call, and `assess-round.js`
  returns `spec_folder: args.spec_folder` next to its existing fields. `briefs.brief` reads the same function for
  its `spec_folder` key. The ruling's open decision, rationale and `spec_gap` findings already reach the caller:
  `user_decision` is top-level, and `assessment` (returned whole) holds `rationale` and every finding with `kind`,
  `mechanism` and `spec_ref`. The workflow filters and renders nothing (FR-002).
- **Rationale**: assess-round runs two ways. A direct launch passes through `gate.on_workflow`, which replaces its
  args with `briefs.assess_args`. A nested launch from review-round is a script call, not a tool call, so no hook sees
  it: review-round already forwards `assess` and `findings` by hand for this reason, so `spec_folder` has to travel
  the same way. If only `assess_args` carried it, internal and audit rounds (most rulings) would return no folder.
- **Existing tools**: `briefs.brief` already computes `spec_folder` inline, so it is moved into a function and both
  callers use it. `briefs.bound_spec` returns the parsed `Folder | NoSpec | None` and is kept for `_reshape_brief`,
  which has to tell `NoSpec` apart. The `args.spec` an agent passes to review-round cannot be reused, because
  `on_workflow` replaces the agent's args wholesale (`updatedInput: dict(call, args=injected)`), and that value is
  only what the agent claimed, not the binding.

## R2: One renderer for the reshape summary

- **Decision**: `reshape.summary(folder: str, ruling: dict) -> str` renders `Open decision: … Why: … Spec gaps: …
  Spec folder: …` from the assessment. `gate._reshape_brief` keeps its `NoSpec` branch and, for a folder, returns
  `"It was held by a RESHAPE_SPEC ruling. " + reshape.summary(...)`. `reshape.comment(...)` (R4) embeds the same
  call.
- **Rationale**: FR-003 / SC-005: both texts come from one function, so they cannot differ. The text it renders is
  the text `_reshape_brief` renders today, without the unlock-only opener.
- **Existing tools**: `_reshape_brief` (`reviewer/plugin/scripts/gate.py`) is the only renderer today. It is
  split, not copied: its folder branch becomes `reshape.summary`.

## R3: The issue comes from the spec folder's name alone

- **Decision**: `reshape.issue_of(folder: str) -> int | None`: the last path segment matched against
  `^([1-9][0-9]*)-`. None means the name gives no issue (`020-decision-review`, `login`), and the notice is then a
  stored failure naming the folder, with no GitHub call (spec Edge Cases). The repository is the PR's,
  `state["repo"]`.
- **Rationale**: FR-005 settles the rule. One pure function makes it testable without git or GitHub. Requiring no
  leading zero stops the repo's sequential folders from posting to issue 20.
- **Existing tools**: `specbinding.shape_problem` checks the folder's shape and returns no number, so it does not
  fit. `pre_merge_gate.PullRequest.named` parses `owner/repo#N`, not a folder name.

## R4: Claim the notice in the ruling's own transaction, call GitHub outside it, then store the outcome

- **Decision**: In `gate.after_structured_output`, inside the `open_ledger` block that calls
  `ledger.record_assessment`, the gate calls `ledger.claim_notice(state, ref, issue)` when the recorded round's
  verdict is `RESHAPE_SPEC` and the PR is bound to a folder. That sets `rnd["notice"]` with each call's outcome as
  `None` (not yet answered). After the block commits, the gate makes the GitHub calls (R5): the comment first, then
  the edit, whatever the comment returned. It then opens the ledger again and stores both outcomes with
  `ledger.record_notice(state, ref, outcomes)`. A PR bound to `spec: null` or to nothing gets no `notice` key and
  makes no call (FR-012).
- **Rationale**: Exactly once (FR-009, SC-003). The claim lands in the same transaction as the ruling, and a round
  is recorded as assessed only once: `on_structured_output` denies a second assessor output for a round no longer
  `awaiting_assessment`, in every mode. If the same PostToolUse is delivered twice anyway, `claim_notice` sees the
  existing `notice` and returns None, and the gate calls GitHub only for a notice it has just claimed. The calls are made
  outside the transaction because `ledger.db` is held under `BEGIN IMMEDIATE`, and two `gh` calls (up to 20 s each)
  would stall every other hook. If the hook dies between claim and outcome, the outcomes stay `None`. R7 shows that
  as "GitHub's answer was not recorded", never as success (P4).
- **Existing tools**: `ledger.open_ledger` and `record_assessment` are reused unchanged. `ledger.ingest_inbox` uses
  a similar record-then-act shape for poller drops. The ledger has no retry or outbox, and none is added (FR-010:
  never retried).

## R5: GitHub writes go through `github._answer`, which raises

- **Decision**: Add `github.comment_issue(slug, number, body)` (`gh issue comment N --repo slug --body body`) and
  `github.escalate_issue(slug, number, label, assignee)` (`gh issue edit N --repo slug --add-label label
  --add-assignee assignee`). Both call `_answer`, which raises `RuntimeError` in gh's own words. The gate catches
  each call's `RuntimeError` separately and stores its message as that call's outcome. It never creates labels
  (FR-006): a missing label surfaces as gh's own error on the edit.
- **Rationale**: FR-009 makes exactly two calls and requires the second whatever the first returned, so each call
  is caught on its own. Catching and storing the message is handling, not swallowing: the error is shown wherever
  the branch's lock is shown (R7).
- **Existing tools**: `github._answer` (raises) and `github._gh` (returns None). `_gh` would discard gh's error
  text, which FR-010 requires, so it does not fit.

## R6: `escalate_to` is read from config.json with no default

- **Decision**: `config.json` gains `"escalate_to": "Analitiq-Bot-Wonka"`. `hookio.escalate_to() -> str` returns
  it, and raises `ValueError` naming the key when it is missing, not a string, or blank. The gate reads it just
  before the edit call. A `ValueError` becomes the edit call's stored failure, so `gh issue edit` is not run, and
  the comment is still posted.
- **Rationale**: FR-007 forbids the name in code and requires a loud failure with no default. The read comes after
  the ruling is recorded and the notice claimed, so a broken config neither undoes the ruling (FR-011) nor turns
  into a silently missing notice. It is shown like any failed call (SC-004).
- **Existing tools**: `hookio.max_review_files` reads a config key and validates it the same way, and is the model
  here. `hookio._setting` only accepts `log`/`enforce`, so it does not fit.

## R7: A failed notice is shown by one renderer, in the lock refusal and the unlock reply

- **Decision**: `reshape.notice_failures(rnd) -> str` returns `""` when every call is done, or when there is no
  `notice`. Otherwise it returns one sentence per failure: the issue, the call (comment, or label and assignee),
  GitHub's error (or "GitHub's answer was not recorded" for `None`, or "the spec folder names no issue"), and what
  is left to do by hand. `policy._holds` appends it to the verdict-lock hold's "why" (this is what
  `policy.mutation` refuses with), and `gate._unlock` appends it to its reply.
- **Rationale**: FR-010 / SC-004 name both places, and one renderer keeps them the same. A failure adds text only
  where the gate already speaks about a locked branch, which is the spec's "simpler design" clarification. The
  notice releases nothing: `_verdict_locked` does not read `notice`, so the lock is unchanged (FR-011).
- **Existing tools**: `policy._holds` already renders each hold's "why" and question, and is extended, not
  duplicated. `_unlock` already appends `_reshape_brief`.

## R8: The reshape rules live in a new pure module, `scripts/reshape.py`

- **Decision**: `reshape.py` holds `issue_of`, `summary`, `comment` and `notice_failures`. All are pure functions
  of the folder, the round and its assessment. It imports nothing that does I/O. `gate.py` does the I/O,
  `ledger.py` stores, and `github.py` calls GitHub. README's Layout table gets a row.
- **Rationale**: P3 requires rules to be pure and handlers to carry none. `gate.py` is the hook entrypoint and
  already 800+ lines, and `policy.py` is "what is permitted next", which a comment body is not. `policy` imports
  `reshape` for R7. `reshape` imports neither `policy` nor `gate`, so no import cycle is created.
- **Existing tools**: `briefs.py` renders agent prompts, and a GitHub comment is not one. `specbinding.py` is about
  the `spec` argument and its binding, and could hold `issue_of` alone, but then the summary and failure renderers
  would be split across two modules for one feature.
