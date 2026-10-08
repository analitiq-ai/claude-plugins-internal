# Research: The spec lives in the spec folder

Every unknown the plan had is settled below. Paths are from the repo root.

## R1: One module owns the location comment's form

- **Decision**: A new `plugins/alq-review/scripts/speclocation.py` holds the form of the location comment in one place: `render(spec, branch)` / `render_none(reason)` write it, `parse(body)` reads it into `Located(folder, branch)` or `NoSpec(reason)` or raises `SpecLocationError` naming the form. Nothing else in the repo spells the marker, the keys, or the regex.
- **Rationale**: FR-002 and FR-010 make the form binding on three consumers (the gate, the tackle/root-cause skills, the posting step). Defined once, they cannot drift (coding principles: define once).
- **Existing tools**: `github.issue_spec` selected a comment that contains the marker anywhere and refused two with a plain `RuntimeError`. That does not fit: a pasted refusal contains the marker, and the gate reads a `RuntimeError` as gh failing. `github.py` does not know the marker: `issue_comments` reads an issue's comments and `write_issue_comment` rewrites the comment with a given id, or posts a new one. `speclocation.py` holds the marker, picks the comment whose first line is the marker, and refuses two with a `SpecLocationError`. A YAML/JSON parser was looked at and does not fit: the form is two plain `key: value` lines under a marker and `spec: none` carries free text, so a YAML load would accept shapes (nested keys, lists) FR-010 must refuse. `.specify/feature.json` already names a feature folder, but only in one checkout and untracked state, so it cannot answer "which folder does the issue name" from another checkout.

## R2: One resolver turns a branch into the spec the gate hands out

- **Decision**: `speclocation.resolve(slug, branch, root)` is the only path from a branch to a spec. It returns `None` when the branch names no issue (FR-014), `NoSpec(reason)` for `spec: none`, or `FoundSpec(folder, text)` (the text of `spec.md` as committed at the checkout's HEAD). It raises `SpecLocationError`, whose message names the missing thing and the one next step, for: no location comment, malformed / repeated / out-of-repo comment, folder not in the checkout (naming the `branch:` value), `spec.md` missing or empty. `briefs.branch_spec` is deleted; gate launch, assess launch and `briefs.brief` all call `resolve`.
- **Rationale**: FR-005..FR-010 and SC-001: three call sites with the same refusals must be one function (consistent semantics). Reading from HEAD, not the working tree, matches what is committed and reviewed; an uncommitted `spec.md` edit is not graded.
- **Existing tools**: `issue_number` (branch to issue) moves from `briefs.py` to `speclocation.py` with its body unchanged, and the issue's comments come from `github.issue_comments` (R1). `worktree.head_tree` + `worktree.tree_text` already read a file as committed at HEAD and are reused for `spec.md`. `settled_design.spec_folders` guesses folders from the diff: that is the behaviour FR-006 forbids for this lookup, so it does not fit (it stays for the settled-design check).

## R4: Posting the comment is `speclocation.py post`, an upsert through `gh api`

- **Decision**: `python3 scripts/speclocation.py post <checkout>` derives the repo (`worktree.locate`), the branch, the issue (`speclocation.issue_number`) and the spec folder (`.specify/feature.json`'s `feature_directory`, prefixed by the checkout's path to the project root), then creates the one location comment, or PATCHes it in place when the issue already has one. `none <checkout> <reason>` does the same for `spec: none`, and exits 2 on an empty reason. Both read the existing comment with the same paginated lookup the gate uses.
- **Rationale**: FR-003 and FR-004 want an upsert (one comment per issue), written by code so that a skill cannot post a hand-typed variant the gate would refuse (P1). Sharing `render` with the gate's `parse` means the text posted is the text read.
- **Existing tools**: `gh issue comment --edit-last` edits the caller's last comment on the issue, not the marker comment, so it can overwrite a different comment: does not fit. `gh api -X PATCH repos/{slug}/issues/comments/{id}` is the call `alq-shape` already uses to update its spec in place, and `github._answer` already wraps `gh api` (reused, with a body file passed on stdin as `-F body=@-` so issue and reason text never reach a command line).

## R5: After its run completes, the `design-doc` skill commits the spec folder, pushes the branch and posts the comment

- **Decision**: When the workflow reports `completed`, the `design-doc` skill commits the spec folder, pushes the branch, then runs `speclocation.py post <checkout>`, and reports the comment's URL. The workflow file is not changed. A run that is rejected at grill or critique, or that fails, never reports `completed`, so nothing is committed, pushed or posted. The skill's `#<issue> none <reason>` entry runs `speclocation.py none` and starts no workflow.
- **Rationale**: Clarifications decided "at the end, after `tasks.md`", and the user decided the order: commit, push, then post, so the branch the comment names holds the folder when `alq-issue-tackle` checks it out. A workflow step cannot post, because `tasks.md` is written by the step before it and is not committed yet. A rescope run re-posts the same comment, which the upsert makes harmless.
- **Existing tools**: the skill already acts on the workflow's `completed` report (its step 6), and commits and pushes with plain `git`, as every branch in this repo does. Posting reuses `speclocation.py post` (R4). A `post-location` workflow step was looked at and does not fit, for the reason above.

## R6: Skills read the location comment by running the script, not by re-spelling a `gh api` filter

- **Decision**: `alq-issue-tackle` and `alq-root-cause-check` run `python3 scripts/speclocation.py show <n>` (path from the skill's base directory, as `design-doc` already does for `settled_design.py`), which prints `spec:` and `branch:` or the refusal. Tackle checks out the named branch, then reads `spec.md` from the named folder. Its "forbids a copy in the worktree" paragraph and the Hand-maintained surfaces stop are deleted; its `alq-shape` fallback is replaced by a refusal naming `design-doc`. `alq-root-cause-check` reads `spec.md` and, with no Root cause section, returns CANNOT TELL (accepted gap until #57). `alq-shape` is untouched.
- **Rationale**: FR-011 and FR-012. The skills' copies of the `--jq 'select(contains(marker))'` filter are exactly the duplicate selectors `test_spec_source.py` had to pin; running `show` removes them instead of pinning them.
- **Existing tools**: `design-doc/SKILL.md` already runs a plugin script by path relative to the skill (`SETTLED`), and `speclocation.py` is run the same way. No skill-side parser fits: it would be a second parser of the form.

## R7: The gate resolves the spec at assess launch as well as review launch

- **Decision**: `gate.on_workflow` calls `speclocation.resolve` for an internal review launch (replacing `briefs.branch_spec`) and for an assess launch; a `SpecLocationError` goes through `refuse` with its message. `briefs.brief` calls `resolve` too and gets the same value; `none` and "no issue number" both render as today's `spec` line, saying why no spec is graded. Audit review launches still get no spec.
- **Rationale**: SC-001 says no run ends with an empty spec and no message. Today assess launch does not look at the spec at all, so a missing comment would first surface in `briefs.py --ref` inside the assessor's session. Refusing at launch puts the next step in front of the user.
- **Existing tools**: `gate.refuse` / `hookio.refuse` render a refusal with its next step (reused). The existing `RuntimeError` path for a gh failure (P4: a check that could not run) is kept: `resolve` lets gh's `RuntimeError` through unchanged.

## R8: The reviewer prompt names the folder and quotes `spec.md`

- **Decision**: `briefs._graded_against` takes `FoundSpec` (or `NoSpec`) and says: the spec is in `<folder>` of the checkout, its `spec.md` quoted between the lines, other files there may be opened. For `NoSpec` it says the issue needs no spec and gives the reason, so reviewers raise no acceptance-criterion findings. `None` (no issue number) leaves the prompt as today.
- **Rationale**: Clarification 3 (text of `spec.md` plus the folder path) and Story 1 scenario 4.
- **Existing tools**: `_graded_against` and `_review_prompt` are the place the quoted spec is built today; changed in place. The prompt wording is not a contract anyone else reads.

## R9: Tests replace the old pin in the same files that carry the gate's tests

- **Decision**: `tests/test_spec_source.py` is rewritten to pin FR-001/FR-011/FR-012 (the three skills call `speclocation.py show`, name no comment as the spec's home, name `design-doc` in their refusals, and contain none of "spec lives on the issue" / "its only home"). A new `tests/test_speclocation.py` covers `parse`/`render`, `resolve` against a temporary git checkout, and `post`/`none` against the fake `gh` already used by `tests/test_gate.py`. `IssueSpec` in `tests/test_gate.py` is rewritten for the folder form. Each test is written and seen to fail first.
- **Rationale**: FR-013; constitution IV.
- **Existing tools**: `tests/test_gate.py`'s `Gate` base class and its fake `gh` (`GH_ISSUE_COMMENTS`, `GH_LOG`, `GH_COMMENTS_ERROR`) already exercise the gate's reads of an issue's comments; they are extended with a PATCH/POST log, not duplicated. `tests/helpers.py` puts `scripts/` on the path.
