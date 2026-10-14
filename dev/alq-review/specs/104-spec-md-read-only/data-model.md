# Data model: spec.md is read-only on a story branch

## A spec folder, a spec.md, a story branch, a spec branch (pure, `specbinding.py`)

| Term | Function | Examples |
|---|---|---|
| Spec folder | `spec_folder(path)` → the `<…>/specs/<name>` folder `path` lies under, by `shape_problem` | `dev/x/specs/123-login/tasks.md` → `dev/x/specs/123-login`; `b.py`, `docs/spec.md` → None |
| A spec.md | `spec_md_folder(path)` → `spec_folder(path)` when `path` is `<folder>/spec.md` | `dev/x/specs/123-login/spec.md` → `dev/x/specs/123-login`; `dev/x/specs/123-login/plan.md` → None |
| Story branch | `story_issue(branch)` → the issue when `branch` matches `^(\d+)-us\d+-` | `123-us2-reset` → `123`; `123-spec`, `123-retire-spec`, `123-adr-hold`, `main`, `feat/1-demo` → None |
| Spec branch | `<issue>-spec`, written into every next step from `story_issue` | `123-spec` |

`path` is repo-relative, as git names it. The gate resolves an edit's path against its checkout (`worktree.locate`)
before asking; `locate` gives no checkout for a detached HEAD, a rebase in progress included, so the rule is never asked
there and every `branch` it reads is a `str`.

## Ledger doc, per PR (`ledgers (repo, pr) -> doc`)

| Field | Set by | Read by | Gone |
|---|---|---|---|
| `spec` | the first review-round launch that opens a round (`null` or the folder) | `_spec_step` (bind), `_assess_spec_step`, `briefs.bound_spec`, `policy.review_call`, `_rebase` | – |
| `regraded_from` | a review-round launch whose decision has `regrade` (data-model "The review-round launch") | `ledger.regraded_rounds` only (research R12) | –; absent reads as 0 |
| `rebased_onto` | the release by `rebase <ref>`: `{"branch": <default>, "sha": <onto>}` | `policy.launch_round`, row 3 | – |
| `unlocked_at`, `unlocks[]` | `ledger.unlock`, by `unlock <ref>` and by `rebase <ref>` | `ledger.released` | – |
| `spec_blob`, `spec_held` | nothing | nothing | deleted; a stored one is ignored |

A release by `rebase <ref>` sets `rebased_onto`, replacing an earlier one; `unlock <ref>` and a refused `rebase <ref>`
leave it. Neither keyword writes `regraded_from` (FR-010).

| State of a PR | Review-round launch with value v | Assess-round launch |
|---|---|---|
| no `spec` key | v parsed and shaped; for a folder, `spec.md` present at the reviewed commit; the round opens and `spec = v` in the same save | refused: no round awaits assessment |
| `spec != v` | refused naming both; nothing changes | – |
| `spec == v`, folder | `spec.md` present at the reviewed commit, whatever its text; the round opens | the same presence check |
| `spec == v == null` | the round opens | opens |

## `rebase <ref>` (`gate._rebase`)

Read only when the whole prompt, trimmed, is `rebase <ref>`; any other prompt starting with `rebase` gets no reply. Its
one git write is the fetch of `fetch`. The checks, in order; the first that fails replies its next step (contracts, by
check), keeps the lock and records nothing:

| Check | Passes when | Fails: next step |
|---|---|---|
| `names` | `ref` names one locked ledger, as `unlock` resolves it | none or several: as `unlock`'s replies |
| `ruling` | the lock is a `RESHAPE_SPEC` ruling | another hold: `unlock <ref>` once the user has decided |
| `bound` | `state["spec"]` is a folder | no spec: close the PR and restart on a PR bound to a spec |
| `checkout` | the locked round's checkout exists | the checkout is missing |
| `default` | GitHub gives the default branch | gh's words |
| `base` | the branch has no open PR, or its PR's base is the default branch | gh's words; a stacked story PR: land the parent PR first |
| `fetch` | `origin/<default>` is fetched; `<onto>` is its sha | git's words |
| `onto spec.md` | `<spec>/spec.md` at `<onto>` is read and present | git's words; missing or empty: the binding never changes, close this PR and restart on the new folder |
| `head spec.md` | `<spec>/spec.md` at the locked round's `head_sha` is read | git's words |
| `changed` | the two differ | the spec PR has not reached `<default>`: land it first, or `unlock <ref>` if the spec stands |

The release, in one save: `ledger.unlock`, the release `unlock <ref>` makes; `rebased_onto`; a `rebase released`
record. The reply names every hold released and the session's next step: rebase, the conflict
resolver on conflicts, push, launch.

The conflict-resolver agent runs under the hooks as any agent does: no gate code dispatches, admits or watches it.

## The review-round launch (`gate.on_workflow`, `policy.launch_round`)

The rounds a round's facts are measured from are `ledger.regraded_rounds(state)`; their heads, for the launch, are
`ledger.measured_heads(state)`: the `head_sha` of the first and of the last round of that slice, of any stage and epoch, or
none when it is empty. Nothing else picks a head to check.

`launch_round` takes `contains`, a function of one sha, and asks it only about the shas it reaches below. The gate passes
`worktree.contains` bound to the checkout and wraps the call: a RuntimeError is refused in git's words, as `_review_base`'s
failure is, and no round opens. The first row that holds decides:

| # | When | Decision |
|---|---|---|
| 1 | the lock or another obstacle, as today | refused, as today |
| 2 | tracked files are dirty | refused, as today |
| 3 | `rebased_onto` is set and `contains(rebased_onto["sha"])` is False | refused: contracts `rebased_onto` not contained, `<default>` and `<onto>` from `rebased_onto`, `<ref>` from `unlock_ref(state)` |
| 4 | stage `internal` and a round cap is reached | the cap refusal, as today |
| 5 | `contains` is False for a head of `measured_heads(state)` | allowed, `scope="full"`, no `delta_from`, `regrade=True`; an audit's `escalation` as today |
| 6 | stage `audit` | allowed, `scope="full"`, `escalation` as today |
| 7 | `counted(state, "internal", regraded_only=True)` is empty | allowed, `scope="full"` |
| 8 | HEAD is its last round's `head_sha` | refused: nothing was committed, as today |
| 9 | otherwise | allowed, `scope="delta"`, `delta_from` its last round's `head_sha` |

On `regrade` the gate sets `regraded_from` to the index of the round `ledger.open_round` returns, after it drops a dead
`collecting` round, in the save that opens it, replacing an earlier value. A launch refused after `launch_round` allowed
saves no `regraded_from`.

After `rebase <ref>`, the launch at the locked head stops at row 3; once rebased, HEAD contains `<onto>` and not the old
heads, so row 5 regrades. After an escalation audit, the next epoch's internal rounds are not yet counted, but the audit's
head is measured, so a rebase there regrades too.

## The diff check (`specbinding.mixed_diff_refusal`)

Input: the PR's changed paths as `(status, path)`, a rename split into its deletion and its addition, read at a
review-round launch of any stage against the round's base. A spec.md counts when its status is not `D`; its folder is
`F`. The changed paths not under `F` decide:

| Paths outside `F` | Outcome |
|---|---|
| none, or no spec.md counts | passes |
| at least one in no spec folder | reply `mixed`: the spec.md and the first such path |
| all in other spec folders (two folders, or a folder's move) | reply `folders`: `F`, the other folder, and the two-PR route |

## New interfaces

Each reply named is its contracts row.

| Name | Interface | Outcomes |
|---|---|---|
| `specbinding.spec_folder`, `spec_md_folder`, `story_issue` | pure, the table at the top | the folder or the issue; None |
| `specbinding.story_edit_refusal` | `(branch: str, path: str) -> str \| None`, pure | the text of contracts "The edit rule" when `branch` is a story branch and `path` a spec.md; None otherwise |
| `specbinding.mixed_diff_refusal` | `(changes: list[tuple[str, str]], branch: str) -> str \| None`, pure | `mixed` or `folders` text; None when it passes |
| `github.default_branch` | `(slug: str) -> str` | the default branch's name; gh fails: RuntimeError in gh's words |
| `worktree.fetch_target` | `(root: str, target: str) -> str`, factored out of `review_base`, which calls it | `origin/<target>` updated, its sha returned; git fails: RuntimeError in git's words |
| `worktree.contains` | `(root: str, sha: str) -> bool`: `git rev-parse --verify --quiet <sha>^{commit}`, then `git merge-base --is-ancestor <sha> HEAD` | the first exits 1 (the checkout does not know `sha`): False; the second exits 0: True, 1: False; any other exit of either: RuntimeError in git's words |
| `ledger.regraded_rounds` | `(state) -> list[dict]`: `state["rounds"][state.get("regraded_from", 0):]` | the rounds the facts are measured from (R12) |
| `ledger.counted` | `(state, stage, *, regraded_only: bool = False) -> list[dict]` | today's filter, over `regraded_rounds` when `regraded_only` |
| `ledger.measured_heads` | `(state) -> list[str]` | the `head_sha` of the first and the last of `regraded_rounds`; `[]` when it is empty |
| `policy.launch_round` | `(state, stage, *, head_sha, dirty, inflight, contains: Callable[[str], bool]) -> Decision`; `Decision` gains `regrade: bool = False` | "The review-round launch", rows 1–9; a RuntimeError from `contains` propagates to the gate |
| `worktree.name_status` | `(root: str, base: str) -> list[tuple[str, str]]` | each path changed from the merge base of `base` and HEAD, once, as `(status, path)`, a rename as its `D` and its `A`; git fails: RuntimeError in git's words |
