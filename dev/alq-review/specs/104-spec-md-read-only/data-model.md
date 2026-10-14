# Data model: spec.md is read-only on a story branch

## A spec.md, a story branch, a spec branch (pure, `specbinding.py`)

| Term | Function | Examples |
|---|---|---|
| A spec.md | `spec_md_folder(path)` → the folder when `path` is `<folder>/spec.md` and `shape_problem(folder)` is None | `dev/x/specs/123-login/spec.md` → `dev/x/specs/123-login`; `docs/spec.md`, `dev/x/specs/123-login/plan.md` → None |
| Story branch | `story_issue(branch)` → the issue when `branch` matches `^(\d+)-us\d+-` | `123-us2-reset` → `123`; `123-spec`, `123-retire-spec`, `123-adr-hold`, `main`, `feat/1-demo` → None |
| Spec branch | `<issue>-spec`, written into every next step from `story_issue` | `123-spec` |

`path` is repo-relative, as git names it. The gate resolves an edit's or a command's path against its checkout
(`worktree.locate`) before asking. During a rebase HEAD is detached, and `locate` reports the branch being rebased
(`worktree.rebasing`, R6), so the story rule holds there as on the branch.

## Ledger doc, per PR (`ledgers (repo, pr) -> doc`)

| Field | Set by | Read by | Gone |
|---|---|---|---|
| `spec` | the first review-round launch that opens a round (`null` or the folder) | `_spec_step` (bind), `_assess_spec_step`, `briefs.bound_spec`, `policy.review_call`, `_rebase` | – |
| `regraded_from` | the writer matrix below: the index of the first round after the release by `rebase <ref>` | `ledger.regraded_rounds` only, the slice `rounds[regraded_from:]`, which `counted(..., regraded_only=True)` filters; callers: R15 | –; absent reads as 0; not `epoch` (R15) |
| `rebased_onto` | the writer matrix below: the default branch the release by `rebase <ref>` checked and the sha its fetch brought | `gate.on_workflow`, which passes it whole to `policy.launch_round` (the launch row below) | – |
| `unlocked_at`, `unlocks[]` | `ledger.unlock`, by `unlock <ref>` and by `rebase <ref>` | `ledger.released` | – |
| `spec_blob`, `spec_held` | nothing | nothing | deleted; a stored one is ignored |

The writers of `regraded_from` and `rebased_onto`, by the state before. `r0`, `o0` are the values an earlier release by
`rebase <ref>` set; `n` is `len(rounds)` at the release. FR-010 is the rule: `unlock <ref>` changes neither. T033 has one
test per cell.

| Writer | Both absent before | `r0`, `o0` before |
|---|---|---|
| `rebase <ref>`, row `release` | `regraded_from = n`, `rebased_onto = {"branch": <default>, "sha": <onto>}` | the same: both replaced |
| `unlock <ref>`, its release | both absent | `r0`, `o0` |
| `rebase <ref>`, any failing row, `names` to `changed` | both absent | `r0`, `o0` |

| State of a PR | Review-round launch with value v | Assess-round launch |
|---|---|---|
| no `spec` key | v parsed and shaped; for a folder, `spec.md` present at the reviewed commit; the round opens and `spec = v` in the same save | refused: no round awaits assessment |
| `spec != v` | refused naming both; nothing changes | – |
| `spec == v`, folder | `spec.md` present at the reviewed commit, whatever its text; the round opens | the same presence check |
| `spec == v == null` | the round opens | opens |

## Shell actions (`shell.Action`)

| kind | fields | Judged by |
|---|---|---|
| `commit` | `cwd, staging, alone` | story rule on `worktree.to_commit` (first), then claim and shim gates |
| `push`, `rerequest`, `ready` | as today | `policy.mutation` / `rerequest` / `mark_ready` |
| `unlock` | as today | refused to agents |
| `write` | `cwd, path` (New interfaces) | story rule, each path against its own checkout |

The written paths of a segment, by the spec's table:

| Form | Written paths |
|---|---|
| `>`, `>>`, `&>`, `n>` | the target, attached or the next word |
| `tee` | every non-option word |
| `cp` | the last non-option word |
| `mv`, `rm` | every non-option word |
| `truncate` | every non-option word after `-s <size>` / `--size=<size>` |
| `sed`, `perl` with `-i`, `-i<suffix>` or `--in-place` | every non-option word |
| `git rm`, `git mv` | every non-option word after the verb |
| `git checkout` | the words after `--` |
| `git restore` | every non-option word after the verb, except the value of `-s` / `--source` |

## `rebase <ref>` (`gate._rebase`)

Read only when the whole prompt, trimmed, is `rebase <ref>`; any other prompt starting with `rebase` gets no reply
(None). Its git work is what FR-009 allows: the fetch of row `fetch` and the reads of the rows after it. The checks, in
order; the first that fails replies its next step (contracts, by row), keeps the lock and records nothing:

| Row | Check | Fails: next step |
|---|---|---|
| `names` | `ref` names one locked ledger (`_names`, as `_unlock`) | none or several: as `unlock`'s replies |
| `ruling` | the lock is a `RESHAPE_SPEC` ruling (`policy.reshape_spec_ruling`) | another hold: `unlock <ref>` once the user has decided |
| `bound` | `state["spec"]` is a folder | no spec: close the PR and restart on a PR bound to a spec |
| `checkout` | the locked round's `root` exists | the checkout is missing |
| `default` | `github.default_branch(slug)` gives `<default>` | gh's words |
| `base` | `github.pr_target(slug, branch)` is None, or its base is `<default>`. None, the branch with no open PR (`<ref>` is then the branch, `policy.unlock_ref`), passes: there is no PR base to be stacked on | gh's words; a stacked story PR: land the parent PR first |
| `fetch` | `worktree.fetch_target(root, <default>)` updates `origin/<default>`; `<onto>` is its sha | git's words |
| `onto read` | `_spec_md_blob(root, <onto>, <spec>)` returns | RuntimeError: git's words |
| `onto spec.md` | it is a blob, not None (missing or empty) | the binding never changes: close this PR and restart the story on the new folder |
| `head read` | `_spec_md_blob(root, <head_sha>, <spec>)`, at the locked round's `head_sha`, returns | RuntimeError: git's words |
| `changed` | the two blobs differ | the spec PR has not reached `<default>`: land it first, or `unlock <ref>` if the spec stands |

Where each reply placeholder comes from. Two functions render the replies: `gate._rebase` (rows `names` to
`release`) and `policy.launch_round` (row `contains`, from its `unrebased_onto` parameter, the whole `rebased_onto`
record). A reply names only what its renderer has from its own row, an earlier row or its parameter:

| Placeholder | `gate._rebase` | `policy.launch_round` |
|---|---|---|
| `<ref>` | `policy.unlock_ref(state)`, the branch when there is no PR | `policy.unlock_ref(state)` |
| `<branch>`, `<root>`, `<n>`, `<head_sha>` | the ledger and its locked round, row `names` | – |
| `<hold>` | the lock reason, row `ruling` | – |
| `<spec>` | `state["spec"]`, row `bound` | – |
| `<issue>` | `specbinding.story_issue(<branch>)` | – |
| `<default>` | row `default` | `unrebased_onto["branch"]` |
| `<base>` | row `base` | – |
| `<onto>` | row `fetch` | `unrebased_onto["sha"]` |
| `<sha>` | the failing read row's sha: `<onto>` for `onto read`, `<head_sha>` for `head read` | – |

`_spec_md_blob` (gate, kept from today, R7) is the reader because it tells the cases apart: `ls-tree` exits 0 with no
entry for a missing path and fails for a sha the checkout does not know. `worktree.tree_blob` answers None to both.

The release (row `release`), in one save: `ledger.unlock(state, "user prompt: rebase ...", now)`, the release `unlock
<ref>` makes; `regraded_from` and `rebased_onto` as the writer matrix gives them; `record("rebase", "released")`. The
reply names every hold released and the session's next step.

The launch after it, at a review-round launch of any stage, after the lock and dirty checks:

| Row | Check | Fails |
|---|---|---|
| `contains` | `rebased_onto` is unset, or `worktree.contains(root, rebased_onto["sha"])` (New interfaces) is True | False: `gate.on_workflow` passes `policy.launch_round` `unrebased_onto=rebased_onto`, the whole record, never the PR's base, which refuses; RuntimeError: refused as `_review_base`'s |

Once HEAD contains it the round opens, a full round (R15). The attestation needs no check of its own: it is allowed only
as research R11 Rejected gives, and the last round before the release was ruled `RESHAPE_SPEC`, so a round settled at
HEAD is one this launch admitted.

The conflict-resolver agent (contracts) runs under the hooks as any agent does: no gate code dispatches, admits or
watches it, and the story rule holds it on the branch under the rebase.

## The mixed-diff rule (`specbinding.mixed_diff_refusal`)

Input: `[(status, path)]`, status one of git's `A M D R C T`; `worktree.name_status` strips the score from `R<score>` and
yields the destination path. For each `(s, p)` with `s != "D"` and `spec_md_folder(p)` set, the first `(_, q)` with `q` not
under that folder refuses. Readers of the fact:

| Site | Reader | Base |
|---|---|---|
| review-round launch, any stage | `worktree.name_status(root, base)` | `_review_base`, as the round's `base_sha` |

## New interfaces

The signatures and outcomes of `shell.Action.path`, `github.default_branch`, `worktree.fetch_target` and
`worktree.contains`, declared here once. An outcome's reply is its contracts row.

| Name | Signature | Outcome | Reply (contracts) | Tested by |
|---|---|---|---|---|
| `shell.Action.path` | `path: str \| None = None` | kind `write`: one written path, as written; one Action per path of "The written paths of a segment" | "The story rule", edit, Bash write | T010, T012 |
| | | any other kind: None | – | T010 |
| `github.default_branch` | `(slug: str) -> str`, through `_answer`: `gh repo view --json defaultBranchRef` | the default branch's name | `rebase <ref>` row `default` passes | T033 |
| | | gh fails: RuntimeError in gh's words | `rebase <ref>` row `default` | T033 |
| `worktree.fetch_target` | `(root: str, target: str) -> str`, factored out of `review_base`, which calls it | `origin/<target>` updated from the remote; returns its sha | `rebase <ref>` row `fetch` passes; the sha is `<onto>` | T031, T033 |
| | | git fails: RuntimeError in git's words | `rebase <ref>` row `fetch`; through `review_base`, `_review_base`'s refusal as today | T031, T033 |
| `worktree.contains` | `(root: str, sha: str) -> bool`: `git merge-base --is-ancestor <sha> HEAD` | exit 0: True | launch row `contains` passes | T031, T034 |
| | | exit 1: False | `contains`, exit 1 | T031, T034 |
| | | any other exit, such as a sha the checkout does not know: RuntimeError in git's words | `contains`, any other exit | T031, T034 |
