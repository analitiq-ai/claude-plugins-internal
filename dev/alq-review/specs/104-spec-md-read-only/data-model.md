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
| `regraded_from` | the release by `rebase <ref>`, `len(rounds)` then: the index of the first round after it | `facts.round_facts` (`first_reviewed`, `base`, `earlier` for `count_not_falling`, `seen` for `repeat_unit`, so `burden`) and `policy.launch_round` (`done`), each reading only `rounds[regraded_from:]`; not the round caps or `briefs.brief`'s `earlier_rounds` (R15) | –; absent reads as 0; `unlock <ref>` leaves it; not `epoch`, which an escalation audit advances (R15) |
| `rebased_onto` | the release by `rebase <ref>`: the sha of `origin/<default>` as its fetch brought it | `gate.on_workflow`, for `policy.launch_round`'s `unrebased_onto` | –; the next release by `rebase <ref>` replaces it; `unlock <ref>` leaves it |
| `unlocked_at`, `unlocks[]` | `ledger.unlock`, by `unlock <ref>` and by `rebase <ref>` | `ledger.released` | – |
| `spec_blob`, `spec_held` | nothing | nothing | deleted; a stored one is ignored |

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
| `write` | `cwd, paths=(path,)`, one per written path | story rule, each path against its own checkout |

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
(None). The gate runs `gh`, one fetch and two blob reads; it never rebases, pushes or adds a worktree: the session does
(spec Clarifications, 2026-10-14). The checks, in order; the first that fails replies its next step and keeps the lock:

| Check | Fails: next step |
|---|---|
| `ref` names one locked ledger, held by a `RESHAPE_SPEC` ruling (`policy.reshape_spec_ruling`) | as `unlock`'s replies; another hold: `unlock <ref>` once the user has decided |
| `state["spec"]` is a folder | no spec: close the PR and restart on a PR bound to a spec |
| the locked round's `root` exists; git runs there | the checkout is missing |
| `github.default_branch` gives `<default>`, `github.pr_target` the PR's base, and the base is `<default>` | gh's words; a stacked story PR: land the parent PR first |
| `worktree.fetch_target(root, <default>)` brings `origin/<default>`; `<onto>` is its sha | git's words |
| `tree_blob(<spec>/spec.md)` at `<onto>` is not None | the binding never changes: close this PR and restart the story on the new folder |
| it differs from `tree_blob(<spec>/spec.md)` at the locked round's `head_sha` | the spec PR has not reached `<default>`: land it first, or `unlock <ref>` if the spec stands |

The release, in one save: `ledger.unlock(state, "user prompt: rebase ...", now)`, the release `unlock <ref>` makes;
`regraded_from = len(rounds)` (R15); `rebased_onto = <onto>`; `record("rebase", "released")`. The reply names every hold
released and the session's next step: in `<root>`, rebase `<branch>` onto `origin/<default>`; on conflicts dispatch the
conflict-resolver agent with `<root>`; push with `git push --force-with-lease`; then run the next round, a full round.

The launch after it: at a review-round launch of any stage, when `rebased_onto` is set and not an ancestor of HEAD
(`worktree.contains(root, sha)`: `git merge-base --is-ancestor`; exit 1 is False, any other failure is git's words,
refused as `_review_base`'s), the gate passes `policy.launch_round` `unrebased_onto=<the PR's base>`, and it refuses,
after the lock and dirty checks: rebase onto `origin/<default>` first. Once HEAD contains it, the round opens, a full
round (R15). The attestation needs no check of its own: `mark_ready` admits only a clean internal round at HEAD, and the
last round before the release was ruled `RESHAPE_SPEC`, so a clean one is a round this launch admitted.

The conflict-resolver agent (contracts) runs under the hooks as any agent does: no gate code dispatches, admits or
watches it, and the story rule holds it on the branch under the rebase.

## The mixed-diff rule (`specbinding.mixed_diff_refusal`)

Input: `[(status, path)]`, status one of git's `A M D R C T`; `worktree.name_status` strips the score from `R<score>` and
yields the destination path. For each `(s, p)` with `s != "D"` and `spec_md_folder(p)` set, the first `(_, q)` with `q` not
under that folder refuses. Readers of the fact:

| Site | Reader | Base |
|---|---|---|
| review-round launch, any stage | `worktree.name_status(root, base)` | `_review_base`, as the round's `base_sha` |
| attestation (`ready`) | `github.pr_files(slug, pr)`: GitHub `added→A`, `modified`/`changed→M`, `removed→D`, `renamed→R`, `copied→C`; None at 3000 files, GitHub's cap, so the ready is refused | the PR's base, as GitHub diffs it |
