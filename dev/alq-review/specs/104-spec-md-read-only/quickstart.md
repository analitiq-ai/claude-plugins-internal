# Quickstart: validate the read-only spec.md

Prerequisites: Python 3.13, git, `pip install specify-cli==1.0.7 diff-match-patch==20241021`, as in CI. No network: the
suites serve a bare origin and stub `gh`.

## Suites

```bash
(cd dev/alq-review/tests && python -m unittest -v)
(cd dev/alq-plan/tests && python -m unittest -v)
```

Expected: green, with every scenario of [spec.md](spec.md) covered as [research.md](research.md) R13 lists, and
`spec_blob`, `spec_held`, `text_step` nowhere in the plugin (US2's tests name the first two, to prove nothing reads them):

```bash
grep -rn 'spec_blob\|spec_held\|text_step' plugins/alq-review ; test $? -eq 1
```

## Red first

Before each story's code, run its new tests and read the failure: an `AttributeError` for a function not yet there, an
`assertEqual` on a decision that is `None` where a deny is expected, a `KeyError` on `rebased_onto`. A test that passes before
its code is wrong.

## End to end (manual, after each story merges)

1. **US1.** In a worktree on `123-us1-x` of a repo with `specs/123-y/spec.md`: `Edit` it: refused, naming the file and
   `123-spec`. `echo x >> specs/123-y/spec.md`: refused. `cat specs/123-y/spec.md`: not refused. Stage a change by hand and
   `git commit`: refused with the restore command. On `123-spec` the same edit passes.
2. **US2.** On a draft PR bound to a folder, merge a spec change into its branch and launch review-round: the round opens; the
   ledger (`python3 scripts/ledger.py status --worktree <root>`) shows `spec` and no `spec_blob`.
3. **US3.** Have a round ruled `RESHAPE_SPEC`. The refusal names `123-spec`, `rebase <ref>` and `unlock <ref>`. Type `rebase
   #<pr>` before the spec PR merges: the reply says it has not reached the default branch, and the lock stays. Merge a
   spec-only PR, type it again: the lock is released, the ledger shows `rebased_onto`, the reply gives the session the rebase,
   the conflict-resolver dispatch and the push, and nothing in git has changed. Launch review-round before rebasing: refused,
   rebase onto `origin/<default>` first. Rebase (with a conflicting change on the default branch, dispatch the conflict
   resolver as the reply says), push, launch again: a full round.
4. **US4.** Commit a spec.md change and a code change on one branch and launch: refused naming both; `gh pr ready`: refused
   the same way. Split them: both pass.
5. **US5.** `/alq-plan:issue-spec rescope specs/123-y #123`: the run works in `.claude/worktrees/123-spec`, ends with the
   folder, the branch and the user's next steps once.
