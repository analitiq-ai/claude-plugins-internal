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
| `push`, `rerequest`, `ready` | as today | `policy.mutation` / `rerequest` / `mark_ready`; `ready` then the diff check |
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

Once HEAD contains it the round opens, a full round (R15). The attestation needs no check of its own: `mark_ready`
admits only a clean internal round at HEAD, and the last round before the release was ruled `RESHAPE_SPEC`, so a clean
one is a round this launch admitted.

The conflict-resolver agent (contracts) runs under the hooks as any agent does: no gate code dispatches, admits or
watches it, and the story rule holds it on the branch under the rebase.

## The mixed-diff rule (`specbinding.mixed_diff_refusal`)

Input: `[(status, path)]`, status one of git's `A M D R C T`; `worktree.name_status` strips the score from `R<score>` and
yields the destination path. For each `(s, p)` with `s != "D"` and `spec_md_folder(p)` set, the first `(_, q)` with `q` not
under that folder refuses. Readers of the fact:

| Site | Reader | Base |
|---|---|---|
| review-round launch, any stage | `worktree.name_status(root, base)` | `_review_base`, as the round's `base_sha` |
| attestation (`ready`) | `github.pr_files(event.repo, event.pr)` (New interfaces), by the rule below | the PR's base, as GitHub diffs it |

### The attestation's diff check

The attestation reads from GitHub only what can change its decision, and every refusal a failed read produces states
only facts true in every state that reaches it.

When `gate.target(where, action.repo, action.pr)` raises, `_unknown_pr` refuses as today; when it returns None, form (d)
below, nothing is judged, `mark_ready` included, as today. Otherwise its `Target` is `event`, and for a `ready` action
`on_bash`:

1. Takes `commit` and `head_branch`. With `event.root` set: `worktree.head_sha(event.root)` and `event.branch`. With
   `event.root` None, form (b) only: `github.pr_head(event.repo, event.pr)`.
2. Calls `policy.mark_ready` with `head_sha=commit` and `released=lambda: github.released(event.repo, commit) is not
   None`, keeping the callable's answer. `mark_ready` calls it only after `_obstacle` passes and the last counted
   internal round is not clean at `commit` (New interfaces). A clean round at `commit` never reads the release check,
   so a clean round at an unpushed HEAD passes as today.
3. Once `mark_ready` allows, applies the rule below.

A RuntimeError from `pr_head` or from `released` is refused through `hookio.refuse(payload, "ready", text, event)`, and
no later step runs, in either mode. `released`'s RuntimeError leaves `mark_ready` uncaught. Each text is its contracts
row of "The diff check", rendered from `event.repo`, `event.pr`, `commit[:7]` and gh's words:

| Read | Fails in | Contracts row |
|---|---|---|
| `pr_head` | form (b): a PR gh cannot find, or gh cannot answer | `head fails` |
| `released` | any form, only when no clean round is at `commit`: an unpushed `commit`, or gh cannot answer | `release fails` |

No failure becomes `''`, False or None. `release fails` names no PR, since form (c) has none.

The rule, over `released`: the answer kept in step 2, or unread.

1. `released` read and True: no diff check, in any form, because a version-only release changes no spec.md (ADR-0003).
2. Otherwise, `event.pr` None: unreachable. `decide` reads an empty ledger, which holds no internal round, so
   `mark_ready` read `released` and allowed only on True.
3. Otherwise, `event.pr` set: `github.pr_files(event.repo, event.pr)`, by its outcomes in New interfaces. A clean round
   reaches this rule even for a version-only release, which passes it because it changes no spec.md. The `mixed` text
   is rendered from `event.repo`, `event.pr`, `head_branch` and the pairs only:

| Outcome | Result | Contracts row |
|---|---|---|
| the pairs | `specbinding.mixed_diff_refusal(pairs, head_branch, "mark it ready again")`: a text refuses, None passes | `mixed` |
| RuntimeError | refused, in gh's words | `files fail` |
| `FileListCapped` | refused; the user splits the PR | `file cap` |

`head_branch` is a str, so the domain of `mixed_diff_refusal`'s `branch` and of `story_issue` stays str.

The forms of `event`, by what `target` returns, and the reads and rules each can reach:

| Form | When | Reads | Rules |
|---|---|---|---|
| (a) `Target(repo, pr, branch, root)` | a checkout of the repo where `pr_of(where)` gives a PR, and the action names that PR or none | `released` only with no clean round at `commit`; `pr_files` | 1, 3 |
| (b) `Target(repo, pr)` | a named PR, run from no checkout of the repo or from one where `pr_of(where)` does not give it | `pr_head`; `released` only with no clean round at `commit`; `pr_files` | 1, 3 |
| (c) `Target(repo, None, branch, root)` | a checkout of the repo where `pr_of(where)` is None, because no ledger names the branch or GitHub reports no open PR, and the action names no PR | `released` | 1, 2 |
| (d) None | no checkout of the repo and no named PR | none | none |

## New interfaces

The signatures and outcomes of `shell.Action.path`, `policy.mark_ready`, the three GitHub lookups the attestation reads
(`github.pr_head`, `github.released`, `github.pr_files`), `github.default_branch`, `worktree.fetch_target` and
`worktree.contains`, declared here once. An outcome's reply is its contracts row. `pr_head` and `released` move from
`github._gh` to `github._answer`, so each gives its answer or raises RuntimeError in gh's words. Callers of
`mark_ready`: `gate.on_bash`, the ready branch, through `decide`, and `dev/alq-review/tests/test_policy.py`
`MarkReady` (lines 382-409), which passes `released` as a bool today. Callers of `pr_head`: `gate.on_bash`, the ready
branch. Callers of `released`: `gate.on_bash`, the ready branch, through `mark_ready`'s callable, and
`pre_merge_gate.released`.

| Name | Signature | Outcome | Reply (contracts) | Tested by |
|---|---|---|---|---|
| `shell.Action.path` | `path: str \| None = None` | kind `write`: one written path, as written; one Action per path of "The written paths of a segment" | "The story rule", edit, Bash write | T010, T012 |
| | | any other kind: None | – | T010 |
| `policy.mark_ready` | `(state: dict, *, head_sha: str, inflight: int, released: Callable[[], bool]) -> Decision`; `released` was a bool | `_obstacle` gives a reason: refused with it; `released` not called | as today | T048 |
| | | the last counted internal round is settled at `head_sha`: allows; `released` not called | rule 3 | T048 |
| | | else `released()` True: allows | rule 1 | T048 |
| | | else `released()` False: refused, "has not come back clean at `<sha>`", next step `review_call(state, 'internal')` | its own text, as today | T048 |
| | | `released()` raises RuntimeError: not caught | "The diff check", `release fails` | T048 |
| `github.pr_head` | `(slug: str, pr: int) -> tuple[str, str]`, through `_answer`: `gh pr view <pr> --repo <slug> --json headRefName,headRefOid`; read in form (b) only | `(headRefName, headRefOid)`: `head_branch` and `commit` | the attestation goes on to `mark_ready` | T048 |
| | | gh fails, for a PR gh cannot find or because gh cannot answer: RuntimeError in gh's words | "The diff check", `head fails` | T048 |
| `github.released` | `(slug: str, commit: str) -> str \| None`, through `_answer`: `gh api --paginate repos/<slug>/commits/<commit>/check-runs?check_name=<RELEASE_CHECK>`; read on demand: by `mark_ready`'s callable, and by `pre_merge_gate.released` only for an unattested head | a title: pr-gate passed `commit` as a version-only release | `mark_ready` allows; rule 1 | T048 |
| | | None: no check run passes it as one | `mark_ready`'s own text | T048 |
| | | gh fails, for an unpushed `commit` (`No commit found for SHA`, HTTP 422) or because gh cannot answer: RuntimeError in gh's words. No caller catches it | `gate.on_bash`: "The diff check", `release fails`; `pre_merge_gate`: `main()`'s refuse-on-error refusal, in gh's words | T048, T063 |
| `github.pr_files` | `(slug: str, pr: int) -> list[tuple[str, str]]`, through `_answer`: `gh api --paginate repos/<slug>/pulls/<pr>/files` | the `(status, path)` pairs, GitHub's status as git's letter: `added→A`, `modified`/`changed→M`, `removed→D`, `renamed→R` at the destination path, `copied→C` | "The diff check", `mixed`, or the ready passes | T048 |
| | | gh fails: RuntimeError in gh's words | "The diff check", `files fail` | T048 |
| | | the list reaches 3000 files, GitHub's cap for that endpoint: raises `github.FileListCapped`, an `Exception` and not a `RuntimeError`, so no `except RuntimeError` reads it as gh failing | "The diff check", `file cap` | T048 |
| `github.default_branch` | `(slug: str) -> str`, through `_answer`: `gh repo view --json defaultBranchRef` | the default branch's name | `rebase <ref>` row `default` passes | T033 |
| | | gh fails: RuntimeError in gh's words | `rebase <ref>` row `default` | T033 |
| `worktree.fetch_target` | `(root: str, target: str) -> str`, factored out of `review_base`, which calls it | `origin/<target>` updated from the remote; returns its sha | `rebase <ref>` row `fetch` passes; the sha is `<onto>` | T031, T033 |
| | | git fails: RuntimeError in git's words | `rebase <ref>` row `fetch`; through `review_base`, `_review_base`'s refusal as today | T031, T033 |
| `worktree.contains` | `(root: str, sha: str) -> bool`: `git merge-base --is-ancestor <sha> HEAD` | exit 0: True | launch row `contains` passes | T031, T034 |
| | | exit 1: False | `contains`, exit 1 | T031, T034 |
| | | any other exit, such as a sha the checkout does not know: RuntimeError in git's words | `contains`, any other exit | T031, T034 |
