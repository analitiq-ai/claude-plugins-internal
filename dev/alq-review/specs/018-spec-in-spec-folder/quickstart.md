# Quickstart: validate the change end to end

Prerequisites: the branch's worktree, `gh` authenticated as the bot, a scratch issue in a scratch repo.
Run unit tests from `dev/alq-review/`: `python3 -m unittest discover tests`.

1. **Form.** `tests/test_speclocation.py` passes: every row of `data-model.md` parses to its value, and each
   malformed shape (old whole-spec comment, out-of-repo path, two comments) is refused with its next step.
2. **Gate, the refusals (Story 2).** In a temp checkout on `feat/1-demo` with the fake `gh`, launch a review
   round with (a) no location comment, (b) a comment naming a missing folder. Each launch is denied, opens no round, and the reason names the folder/branch or `design-doc`.
3. **Gate, the folder it names (Story 1).** Change files in two spec folders; the comment names the first. The
   reviewers' prompts and `briefs.py --ref <ref>` carry the first folder's `spec.md` and its path, and no other.
4. **`none`.** `speclocation.py none <checkout> "docs only"` posts `spec: none` and a reason; the reviewers' prompts
   say no spec is needed with the reason; an empty reason exits 2 and posts nothing.
5. **Workflow (Story 3).** Run `design-doc #<issue>` on the scratch issue to completion: exactly one location
   comment, no spec text in it. Run again: still one, updated. Reject at grill: none.
6. **Skills (Story 4).** `speclocation.py show <issue>` prints the location comment; `alq-issue-tackle` on an issue with no
   comment stops naming `design-doc`. `python3 -m unittest tests.test_spec_source` passes.

Expected: every unit test passes; steps 2 to 6 behave as written; neither "spec lives on the issue" nor "its only
home" appears in the skills or the gate (SC-004).
