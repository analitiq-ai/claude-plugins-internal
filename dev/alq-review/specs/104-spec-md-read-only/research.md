# Research: spec.md is read-only on a story branch

Read for this: `plugins/alq-review/scripts/{gate,policy,specbinding,ledger,briefs,hookio,shell,worktree,github,pre_merge_gate}.py`,
`hooks/hooks.json`, `agents/assessor.md`, `workflows/review-round.js`, the README, `plugins/alq-plan/skills/issue-spec/SKILL.md`,
`dev/alq-review/tests/{helpers,test_gate,test_policy,test_specbinding,test_shell,test_worktree_facts}.py`,
`dev/alq-plan/tests/{test_spec_source,test_guards}.py`, ADRs 0002, 0004, 0009, 0011, 0012, 0016–0018, the constitution, the
engineering `git-workflow.md`, and `.github/workflows/tests.yml`, all on main at `735c172`. Nothing below was run unless it
says so. The spec cites "ADR-0019 decision 1": record 0019 is not on main; it is a draft on `origin/81-adr-name-the-user-story`,
open PR #93 (`git show origin/81-adr-name-the-user-story:dev/alq-review/docs/adr/`, run, and the record read there). Its
decision 1 stands. Its decision 3 binds the `spec.md` blob and its closing line says "ADR-0016, decision 6, and ADR-0018
stand": the decision record replaces both (R1).

Scope, as the user narrowed it (spec Clarifications, 2026-10-14): the review-round launch's diff check (US4) is the gate that
keeps the graded spec from changing beside code; the story rule (US1) refuses only `Edit`, `Write` and `NotebookEdit` of a
spec.md, by path. No Bash write, commit or rebase-in-progress refusal: what they carry is caught at the next launch.

## R1: Shipping order: records first, then one PR per user story, stacked where a story needs another

- **Decision**: (1) the decision record, drafted from this plan with `speckit-adrkit-draft`, in its own PR on `104-adr-<slug>`,
  with the README's pointer to it; it replaces ADR-0016 decision 6 and the blob-id part of decision 4, replaces the
  `spec.md`-blob part of ADR-0019 decision 3 (open PR #93) and that record's closing line "ADR-0016, decision 6, and ADR-0018
  stand", and changes ADR-0018 so a `RESHAPE_SPEC` lock is released by `unlock <ref>` when the spec stands and by `rebase <ref>`
  after a spec change; PR #105's hand-written ADR-0020 is closed. (2) The engineering `git-workflow.md` change, in that repo:
  the spec changes through its own spec-only PR, never in a story PR. (3) Code, one PR per user story on `104-us<N>-<slug>`: US1
  (the edit rule) off the default branch; US2 (the hold deleted) stacked on US1; US3 (`rebase`, the conflict resolver) stacked
  on US2; US4 (the diff check) and US5 (the rescope, in `alq-plan`) off the default branch. The README changes with the code of
  each story. The plugin's version moves once, in the last alq-review story to merge, and that bump turns on US1 and US4;
  alq-plan's US5 release ships no later than it.
- **Rationale**: constitution VI puts the governing record apart from the code. The spec's priorities order the stories, and US2
  says it comes after US1; US3's release reads a lock US2 reshapes. The stacking rule is git-workflow.md's. The spec.md of this
  folder never changes on these branches, so the hold that is live until US2 merges does not bite. US5's release goes first
  because the rescope route the lock text names must work the day the rule is live: a rescope in the story worktree is refused
  at its first edit once US1 is on.
- **Existing tools**: `speckit-adrkit-draft` and `draft.sh`, the tools ADR-0016–0018 were written with. The git-workflow
  stacking rule, as written. The release practice the repo used for 0.12.0 and 0.13.0 (019 R2).

## R2: What a spec folder, a spec.md and a story branch are, defined once

- **Decision**: `specbinding.py` gains four pure functions and loses `text_step`. `spec_folder(path) -> str | None`: the
  `<…>/specs/<name>` folder a repo-relative `path` lies under, by `shape_problem`, else None. `spec_md_folder(path) -> str | None`:
  that folder when `path` is `<folder>/spec.md`, else None (`docs/spec.md`, `specs/x/plan.md` give None).
  `story_issue(branch) -> str | None`: the issue number of a branch named `<digits>-us<digits>-...`, else None.
  `story_edit_refusal(branch, path) -> str | None`: the refusal text for an edit of `path` on `branch`, None when the branch is
  not a story branch or the path is not a spec.md. The module's docstring becomes: what a spec folder and a spec.md are, the
  review-round `spec` argument, its binding, and the two rules that keep a spec.md out of a story PR.
- **Rationale**: the spec's Terms define a spec.md by `shape_problem`, so the rule reuses it rather than re-declaring what a
  spec folder is; the diff check (R8) needs the folder of any path to tell a folder move from code. P3 puts the decision in a
  pure function.
- **Existing tools**: `specbinding.shape_problem`, reused. `worktree.locate`, which gives the branch. A regex of the branch
  name in `gate.py`: rejected, the rule would live in a handler.

## R3: The rule on `Edit`, `Write` and `NotebookEdit`

- **Decision**: `gate.on_edit` judges the story rule right after `worktree.locate(path)` and before `target(where)`: the path
  relative to `where.root`, `where.branch`, through `specbinding.story_edit_refusal`; a text refuses with
  `hookio.refuse(payload, "spec-edit", text, Target(where.slug, None, where.branch, where.root))`. Nothing of the ledger or
  GitHub is read first. A detached HEAD (`where.branch` None), a rebase in progress included, is no story branch.
- **Rationale**: FR-001 reads the branch and nothing from the ledger; scenario 4 has no PR and no ledger, and `target()` may
  ask GitHub. `hookio.refuse` is under `mode`, which FR-005 asks for. The path is resolved by `locate` against its own
  checkout, so an absolute path into another worktree is judged by that worktree's branch (edge case).
- **Rejected**: Bash writes, the commit and the branch under a rebase (the earlier R4–R6). Each needed a reader of git or shell
  state whose edge cases review rounds on PR #108 kept finding; the diff check at the launch sees what all of them leave.
- **Existing tools**: `worktree.locate`, `hookio.refuse`, `Target`, reused.

## R4: The hold goes, and the binding is the `spec` value alone

- **Decision**: delete `gate._spec_text`, `SpecStep.holds`, `_refuse_spec` and `_admit_spec`'s hold clearing; `_head_spec_md`
  becomes `_spec_md_present(root, head, folder, restore) -> str | None` (the refusal when `spec.md` is missing, empty or
  unreadable at `head`), through `_spec_md_blob`, which stays whole: the one reader of a spec.md at a commit, whose blob id
  `rebase <ref>` compares (R6). `_spec_step` binds `{"spec": value}` only; on a bound PR it checks presence and binds nothing.
  `_assess_spec_step` checks presence only. Delete `specbinding.text_step` and its `released` import; `policy._spec_held` and
  the hold in `_holds`; the README's hold, `spec_blob` and `spec_held` text; the tests of the hold (R10). Nothing reads
  `spec_blob` or `spec_held` from a stored ledger; no migration.
- **Rationale**: decisions 4 and 5 of issue #104: every round grades against `spec.md` at the reviewed commit, and the gate keeps
  no copy. The presence check is ADR-0016 decision 3, which stands.
- **Existing tools**: `_spec_md_blob`, kept. `ledger.released`, kept for the verdict lock.

## R5: What a `RESHAPE_SPEC` lock says

- **Decision**: in `policy._holds`, the verdict-lock entry for `RESHAPE_SPEC` keeps `user_decision` as the question and
  `_lock_reason` ends, when a `RESHAPE_SPEC` ruling holds the branch, with: the spec is rescoped on `<issue>-spec` (the issue from
  `specbinding.story_issue(state["branch"])`, "the issue's spec branch" when the branch is not a story branch) and lands as a
  spec-only PR while this branch stays locked; once it merges the user starts a prompt with `rebase <ref>`, which releases the
  lock for this branch to be rebased on it; `unlock <ref>` releases it instead when the user rules the spec stands. With no
  `RESHAPE_SPEC` ruling the closing sentence is today's, less "Editing the spec or changing files another way does not release
  it". `gate._reshape_brief` (the `unlock` reply) adds the spec branch the rescope runs on.
- **Rationale**: FR-009 and US3 scenario 1 and 6. The lock's text is the one place the agent learns the route (P1: every refusal
  names the next legal step).
- **Existing tools**: `_holds`, `_lock_reason`, `unlock_ref`, `_reshape_brief`, edited in place.

## R6: `rebase <ref>`: the gate checks and releases; the session rebases

- **Decision**: `gate._on_release` reads `rebase <ref>` only when it is the whole prompt, trimmed: the word `rebase`, one ref
  and nothing else; `unlock <ref>` is read as today (ADR-0004: first words). `gate._rebase` is data-model "`rebase <ref>`": its
  checks in order, its release, and the launch check after it, under FR-009. New: `github.default_branch`,
  `worktree.fetch_target` and `worktree.contains` (data-model "New interfaces"). The spec.md reads are `gate._spec_md_blob`
  (R4), which tells a missing path from an unknown commit.
- **Rationale**: the user's decision in Clarifications (2026-10-14), which replaces the hook-run rebase. The default branch,
  never the PR's base: the spec PR merges into the default branch, so a stacked story PR's base never receives it, and its
  parent lands first. A missing spec.md is a moved folder, and the binding never changes (ADR-0016 decision 5). The release
  comes before the rebase because the rebase and the push are mutations the lock refuses; what keeps a round from grading the
  old code against the new spec is the launch refusal, and `rebased_onto` is the one fact it needs; a branch rebased onto a
  later default-branch commit contains it too. The whole-prompt match keeps an ordinary request that starts with `rebase` from
  running a fetch. One release predicate, `ledger.unlock` and `released`, so `rebase` and `unlock` release the same way and
  nothing else does. Its one git write is FR-009's fetch, so the keyword is safe to repeat.
- **Rejected**: the hook rebasing itself, in place or in a throwaway worktree: every partial failure between the rewrite and the
  push needed handling inside the gate, and four review rounds kept finding states it got wrong. A gate checks state and the
  worker changes it, as GitHub's "branch must be up to date" rule does.
- **Existing tools**: `_unlock`, `_names`, `policy.locked`, `reshape_spec_ruling`, `ledger.unlock`, `worktree.review_base`'s
  fetch, `_spec_md_blob`, `github.pr_target`, reused. `ledger.py unlock` CLI, unchanged.

## R7: The conflict-resolver agent ships in the plugin

- **Decision**: a new `agents/conflict-resolver.md`, contracts "The conflict resolver", which the session dispatches as the
  `rebase <ref>` reply says. No gate code dispatches, admits or watches it.
- **Rationale**: the user asked that a conflict be resolved without them (Clarifications). A spec.md conflict is no agent's to
  settle; its prompt says so, and if a spec.md change survives the rebase anyway, the next launch refuses it (US4). A hook
  cannot run an agent, so the reply names the dispatch, a deviation from P1 the plan's Complexity Tracking records; it fails
  safe, since no round opens until the branch contains `rebased_onto`.
- **Existing tools**: the plugin's `agents/` and `test_agents.py`'s frontmatter reader, reused; `test_shipped_tree.py` lists the
  agent as `alq-review:conflict-resolver`.

## R8: A PR changes the spec or the code, never both

- **Decision**: `specbinding.mixed_diff_refusal(changes: list[tuple[str, str]], branch: str) -> str | None`, pure. `changes` are
  `(status, path)` pairs, a rename split into its deletion and its addition (`worktree.name_status`). For the first path with
  status other than `D` whose `spec_md_folder` is set, the changed paths (any status) not under that folder decide: none, it
  passes; one or more in no spec folder, reply `mixed`, naming the spec.md and the first such path; all in other spec folders,
  reply `folders`, naming the two folders and the two-PR route. One site: a review-round launch of any stage, after
  `_review_base` and in its `try`, before `ledger.open_round`, refused through `hookio.refuse(payload, "launch", ...)`; a git
  failure is refused as `_review_base`'s is. Assess-round launches run no diff check.
- **Rationale**: FR-004 and the spec's Clarifications: this is the gate, and it reads the diff whatever wrote it. A deleted
  spec.md grades nothing. A folder's move is no spec-and-code mix, so `mixed`'s "land the spec change as a spec-only PR" would
  send the agent nowhere; `folders` names the route that passes. Under `mode` (FR-005). An audit launch is a review-round
  launch (edge case).
- **Rejected**: a second check at the internal-review attestation (`ready`): it is allowed only for a version-only release or a
  settled internal round at `head_sha`, whose launch already ran this check on the same commit; a second gate over the same diff
  (one gate per document).
- **Existing tools**: `worktree.changed_files` and `_DIFF`, the model for `name_status`; `_review_base`, `hookio.refuse`.

## R9: The rescope runs on the spec branch

- **Decision**: `plugins/alq-plan/skills/issue-spec/SKILL.md`, the `rescope` form: `CHECKOUT` is the worktree of `<issue>-spec`,
  created per the repo's branch rules off the default branch when there is none; before any write the skill fetches and stops,
  naming it and asking the user to delete it, when a local or remote `<issue>-spec` is already merged into the default branch.
  Step 8's commit and push land on that branch; its closing lines name the folder and the branch, and then, once, the user's
  next steps: open the spec-only PR, approve it, rebase the story branch with `rebase <ref>`, relaunch the review. It names no
  other plugin's command.
- **Rationale**: FR-006. With US1, a rescope in the story PR's worktree is refused at its first edit. A merged branch reused
  would carry a merged history into a new PR.
- **Existing tools**: the skill's two forms and its `DRIVE` steps, unchanged; `git-workflow.md`'s worktree command.

## R10: Tests, red first, in the two suites

- **Decision**: `dev/alq-review/tests`: the edit rule's gate tests in `test_gate.py`, a class on a story-branch checkout with a
  committed spec.md; the pure functions in `test_specbinding.py`, replacing `TextStep`; the lock text and the launch refusal in
  `test_policy.py`; `rebase <ref>` and the diff check in `test_gate.py`, a test per check of data-model "`rebase <ref>`" and per
  reply of contracts "The diff check", with the gh stub answering each new GitHub lookup; the agent file in `test_agents.py`
  against contracts "The conflict resolver"; each new `worktree` function in `test_worktree_facts.py`; the FR-010 slice (R12)
  in `test_policy.py` and `test_worktree_facts.py`. US2's tests name `spec_blob` and `spec_held`, a stored ledger carrying them
  and holding nothing, so SC-003's grep covers `plugins/alq-review` and not the tests. The hold's tests are deleted with it
  (`SpecArgument`'s hold tests, `held()`, `assertHeldWithTheDiff`, `test_policy.py`'s spec-hold fixtures and cases,
  `TextStep`). `dev/alq-plan/tests/test_spec_source.py`: the rescope test becomes the spec-branch test. Each test is written,
  run and seen to fail for the expected reason before its code (constitution IV). Before the hold's tests are deleted in US2,
  they are run once on main and the result is recorded in the PR, so the spec's "did not converge" is observed.
- **Rationale**: SC-001 and FR-008. The harness drives each hook event in-process (`Gate.hook`), with a bare origin for the
  fetch (`serve_remote`). Exact git flags and per-case test names are the story PRs' to settle in their tests.
- **Existing tools**: `Gate`, `HeldBranch.lock`, `SpecArgument.commit_files`, `Repo.serve_remote`, the gh stub, reused.

## R11: What the README says

- **Decision**: item 2: a `RESHAPE_SPEC` lock's two releases and the rescope route; the changed-spec hold sentence goes. Item 5:
  the binding is the `spec` value; `spec.md` is read at the reviewed commit each round; the hold paragraph is replaced by the
  diff check and its two replies. A new item 8: on a story branch the edit tools never change a spec.md, and the diff check
  stands behind it for every other route. Mode: the edit rule and the diff check are made through `hookio.refuse`. What the user
  types: `rebase`, and the session's next step after it. State: the ledger's `spec`, `regraded_from` and `rebased_onto`. Layout:
  `specbinding.py`'s new line, `agents/conflict-resolver.md`. Nothing names `spec_blob`, `spec_held` or `text_step` (SC-003).
- **Rationale**: FR-007; the README is the plugin's description and changes with its code (019 R17).
- **Existing tools**: the README's sections, edited in place.

## R12: After a release by `rebase`, the story is measured afresh

- **Decision**: FR-010's measurement is one helper in `ledger.py`: `regraded_rounds(state)`,
  `state["rounds"][state.get("regraded_from", 0):]`, and `counted(state, stage, *, regraded_only=False)`, which filters that
  slice instead of every round when the keyword is set. `policy.launch_round`'s `done` and `facts.round_facts`' `earlier` call
  `counted(..., regraded_only=True)`; `round_facts`' `seen`, `first_reviewed` and `base` read `regraded_rounds`. So the first
  round after a release is full, with no `delta_from`, and the churn facts are measured from it. Unsliced: `policy._capped` (the
  round caps), `ledger._append_round`'s numbering, and `briefs.brief`'s `earlier_rounds`.
- **Rationale**: the rebase rewrites every commit of the story branch, so a head recorded before it is no ancestor of the
  rewritten HEAD: a delta round would brief the whole rebase as a delta, and a file edited in three commits before it would
  read as at a third edit. A round before the release graded another `spec.md` and another history. One slice, so no two
  readers disagree on where the release starts. The cap spans the release because a rebase settles no round; the numbering
  spans it because a round's ref must stay unique in its epoch. `unlock <ref>` rewrites nothing, so it changes neither field.
- **Existing tools**: `ledger.counted`, given the keyword; `policy.launch_round` and `facts.round_facts`, edited; the briefs,
  unchanged. The escalation `epoch`: rejected, since advancing it also restarts the round cap and changes the round refs.
