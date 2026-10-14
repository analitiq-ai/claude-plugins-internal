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

## R1: Shipping order: records first, then one PR per user story, stacked where a story needs another

- **Decision**: (1) the decision record, drafted from this plan with `speckit-adrkit-draft`, in its own PR on `104-adr-<slug>`,
  with the README's pointer to it; it replaces ADR-0016 decision 6 and the blob-id part of decision 4, replaces the
  `spec.md`-blob part of ADR-0019 decision 3 (open PR #93) and that record's closing line "ADR-0016, decision 6, and ADR-0018
  stand", and changes ADR-0018 so a `RESHAPE_SPEC` lock is released by `unlock <ref>` when the spec stands and by `rebase <ref>`
  after a spec change; PR #105's hand-written ADR-0020 is closed. (2) The engineering `git-workflow.md` change, in that repo:
  the spec changes through its own spec-only PR, never in a story PR. (3) Code, one PR per user story on `104-us<N>-<slug>`: US1
  (the hook and the commit backstop) off the default branch; US2 (the hold deleted) stacked on US1; US3 (`rebase`, the conflict
  resolver) stacked on US2; US4 (the diff check) and US5 (the rescope, in `alq-plan`) off the default branch. The README changes
  with the code of each story. The plugin's version moves once, in the last alq-review story to merge, and that bump turns on
  US1; alq-plan's US5 release ships no later than it.
- **Rationale**: constitution VI puts the governing record apart from the code. The spec's priorities order the stories, and US2
  says it comes after US1; US3's release reads a lock US2 reshapes. The stacking rule is git-workflow.md's. The spec.md of this
  folder never changes on these branches, so the hold that is live until US2 merges does not bite. US5's release goes first
  because the rescope route the lock text names must work the day the rule is live: a rescope in the story worktree is refused
  at its first write once US1 is on.
- **Existing tools**: `speckit-adrkit-draft` and `draft.sh`, the tools ADR-0016–0018 were written with. The git-workflow
  stacking rule, as written. The release practice the repo used for 0.12.0 and 0.13.0 (019 R2).

## R2: What a spec.md and a story branch are, defined once

- **Decision**: `specbinding.py` gains three pure functions and loses `text_step`. `spec_md_folder(path) -> str | None`: the spec
  folder of a repo-relative `path` named `spec.md` whose folder passes `shape_problem`, else None (`docs/spec.md`,
  `specs/x/plan.md` give None). `story_issue(branch) -> str | None`: the issue number of a branch named `<digits>-us<digits>-...`,
  else None. `story_write_refusal(branch, path, staged: bool) -> str | None`: the one refusal text for a write of `path` on
  `branch`, None when the branch is not a story branch or the path is not a spec.md; it names the file, the branch, the rule,
  and the next step with `<issue>-spec`, and for a staged change the restore command. The module's docstring becomes: what a
  spec folder and a spec.md are, the review-round `spec` argument, its binding, and the two rules that keep a spec.md out of a
  story PR.
- **Rationale**: the spec's Terms define a spec.md by `shape_problem`, so the rule reuses it rather than re-declaring what a
  spec folder is. One text for the three sites (R3–R5) is the spec's "the same words". P3 puts the decision in a pure function.
- **Existing tools**: `specbinding.shape_problem`, reused. `worktree.locate`, which gives the branch. A regex of the branch
  name in `gate.py`: rejected, the rule would live in a handler.

## R3: The rule on `Edit`, `Write` and `NotebookEdit`

- **Decision**: `gate.on_edit` judges the story rule right after `worktree.locate(path)` and before `target(where)`: the path
  relative to `where.root`, `where.branch`, through `specbinding.story_write_refusal`; a text refuses with `hookio.refuse(payload,
  "spec-write", text, Target(where.slug, None, where.branch, where.root))`. Nothing of the ledger or GitHub is read first.
- **Rationale**: FR-001 reads the branch and nothing from the ledger; scenario 6 has no PR and no ledger, and `target()` may ask
  GitHub. `hookio.refuse` is under `mode`, which FR-005 asks for.
- **Existing tools**: `worktree.locate`, `hookio.refuse`, `Target`, reused.

## R4: Bash writes, read by the one shell reader

- **Decision**: `shell.classify` gains the kind `write`, one `Action` per written path, with a new field `paths: tuple[str, ...]`
  holding the path as written. The paths a segment writes, by the spec's table: a redirection target (`>`, `>>`, `&>`, `n>`,
  attached or as the next word); `tee`'s non-option words; the last non-option word of `cp`; every non-option word of `mv`, `rm`,
  `truncate` (after `-s <size>` / `--size=`), and of `sed` or `perl` when `-i`, `-i<suffix>` or `--in-place` is among its options;
  for `git`: the non-option words of `rm` and `mv`, the words after `--` of `checkout`, and the non-option words of `restore`
  except the value of `-s` / `--source`. Heredoc bodies are already cut away. `gate.on_bash` resolves each path against
  `action.cwd` (`~` expanded), locates its checkout, and judges it as R3 does; a refusal returns before the other actions.
- **Rationale**: one reader of a command (ADR-0005, the docstring of `shell.py`); the table is the spec's, and what it misses is
  caught at the commit (R5) and the launch (R11). A path is judged by its own checkout, so an absolute path into another
  worktree is judged by that worktree's branch (edge case). A word that is not a path, such as a `sed` script, locates nothing and
  is not a hit, so the reader need not tell the file from the script.
- **Existing tools**: `shell._segments`, `_words`, `_git`'s option walk and `_HEREDOC`, reused. `pre_merge_gate.tokenize`:
  looked at; it is the merge gate's own reader, kept there because that script must answer without the plugin's modules.

## R5: The commit backstop

- **Decision**: in `gate.on_bash`, a `commit` action is judged for the story rule before `claimgate.on_commit` and
  `shimgate.on_commit`: `worktree.to_commit(root, staging)` lists the paths the commit would record (`git diff --cached
  --name-only --no-renames -z`, plus `git diff --name-only --no-renames -z` when `action.staging`), and the first that
  `story_write_refusal(branch, path, staged=True)` refuses refuses the commit through `hookio.refuse(payload, "commit", ...)`.
  The text names the path and the restore command (`git restore --staged --worktree -- <path>`; for a path not in HEAD,
  `git rm --cached -- <path>` and delete it).
- **Rationale**: scenario 3 refuses "whatever the claim and shim checks' settings", so the refusal is under the plugin's `mode`
  alone, not `refuse_claim` or `refuse_shim`, and runs first. `--no-renames` so a spec.md moved away is listed by its own name.
- **Existing tools**: `worktree._listed` and `_DIFF`'s pinned options, reused with `--no-renames` in place of `--find-renames`;
  `claimgate.on_commit`'s `worktree.locate(action.cwd)`, the same locate.

## R6: The branch under a rebase is the checkout's branch

- **Decision**: `worktree.locate` returns the branch a rebase in progress is rebasing when HEAD is detached: a new
  `worktree.rebasing(root) -> str | None` reads `head-name` under `git rev-parse --git-path rebase-merge` or `rebase-apply`
  (`refs/heads/` stripped; None when no rebase is in progress or it names no branch); `locate` uses it where it returned None
  for `HEAD`. Every reader of `locate` sees the branch under rebase, so the story rule (R3–R5) holds the session and the
  conflict resolver during the rebase that follows `rebase <ref>` (R9, R10) as on the branch, reading nothing from the ledger
  (FR-001).
- **Rationale**: the spec's edge case: during a rebase the story rule reads the branch being rebased. `_held` compares
  `here.branch` with the ledger's; with None it stops watching a checkout exactly when a rebase runs in it.
- **Existing tools**: `git rev-parse --git-path`, which `worktree.concluding` already uses for `MERGE_HEAD`.

## R7: The hold goes, and the binding is the `spec` value alone

- **Decision**: delete `gate._spec_text`, `SpecStep.holds`, `_refuse_spec`, `_admit_spec`'s hold clearing and `_spec_md_blob`'s
  blob id; `_head_spec_md` becomes `_spec_md_present(root, head, folder, restore) -> str | None` (the refusal when `spec.md` is
  missing, empty or unreadable at `head`, by the same `ls-tree -l` read). `_spec_step` binds `{"spec": value}` only; on a bound
  PR it checks presence and binds nothing. `_assess_spec_step` checks presence only. Delete `specbinding.text_step` and its
  `released` import; `policy._spec_held` and the hold in `_holds`; the README's hold, `spec_blob` and `spec_held` text; the
  tests of the hold (R13). Nothing reads `spec_blob` or `spec_held` from a stored ledger; no migration.
- **Rationale**: decisions 4 and 5 of issue #104: every round grades against `spec.md` at the reviewed commit, and the gate keeps
  no copy. The presence check is ADR-0016 decision 3, which stands.
- **Existing tools**: `_spec_md_blob`'s `ls-tree -l -z` read, kept for size and type. `ledger.released`, kept for the verdict lock.

## R8: What a `RESHAPE_SPEC` lock says

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

## R9: `rebase <ref>`: the gate checks and releases; the session rebases

- **Decision**: `gate._on_release` reads `rebase <ref>` only when it is the whole prompt, trimmed: the word `rebase`, one ref
  and nothing else. Any other prompt that starts with `rebase` ("rebase this on main", "rebase #12 now") gets None, and the hook
  stays silent. `unlock <ref>` is read as today (ADR-0004: first words). `gate._rebase` runs the checks of data-model "`rebase
  <ref>`" in order, finding the one locked ledger `ref` names as `_unlock` does: a `RESHAPE_SPEC` ruling, a bound folder, the
  locked round's `root`, the PR's base the default branch (`github.default_branch(slug)`: `gh repo view --json
  defaultBranchRef`, new; `github.pr_target`), the fetch (`worktree.fetch_target(root, <default>)`, factored out of
  `review_base`, which calls it), and the bound `spec.md` at `origin/<default>` present and different from the one at the
  locked round's `head_sha` (`worktree.tree_blob`). A check that fails replies its next step and keeps the lock. When all pass,
  `_rebase` releases through `ledger.unlock`, sets `regraded_from` (R15) and `rebased_onto`, the sha it fetched, and replies
  the session's next step: the rebase, the conflict resolver on conflicts (R10), `git push --force-with-lease`, the next round.
  The gate runs no git command but the fetch and the reads. At a review-round launch it passes `policy.launch_round` the PR's
  base as `unrebased_onto` while `rebased_onto` is not an ancestor of HEAD (`worktree.contains`, new: `git merge-base
  --is-ancestor`), and the launch is refused: rebase onto `origin/<default>` first.
- **Rationale**: the user's decision in Clarifications (2026-10-14), which replaces the hook-run rebase. The default branch,
  never the PR's base: the spec PR merges into the default branch, so a stacked story PR's base never receives it, and its
  parent lands first. A missing spec.md is a moved folder, and the binding never changes (ADR-0016 decision 5). The release
  comes before the rebase because the rebase and the push are mutations the lock refuses; what keeps a round from grading the
  old code against the new spec is the launch refusal, and `rebased_onto` is the one fact it needs, the commit whose spec.md
  the check saw; a branch rebased onto a later default-branch commit contains it too. The whole-prompt match keeps an ordinary
  request that starts with `rebase` from running a fetch. One release predicate, `ledger.unlock` and `released`, so `rebase`
  and `unlock` release the same way and nothing else does; `rebase` releases every hold the branch has, as `unlock` does, and
  the reply names each: a second stamp would be a second release mechanism. Every check reads only, so the keyword is safe to
  repeat; typed again after a release it names no locked PR.
- **Rejected**: the hook rebasing itself, first in place, then in a throwaway worktree: every partial failure between the
  rewrite and the push needed handling inside the gate, and four review rounds kept finding states it got wrong. A gate checks
  state and the worker changes it, as GitHub's "branch must be up to date" rule does.
- **Existing tools**: `_unlock`, `_names`, `policy.locked`, `reshape_spec_ruling`, `ledger.unlock`, `worktree.review_base`'s
  fetch, `tree_blob`, `github.pr_target`, reused; `github.default_branch` and `worktree.contains`, new. `ledger.py unlock` CLI,
  unchanged.

## R10: The conflict-resolver agent ships in the plugin

- **Decision**: a new `agents/conflict-resolver.md` (tools Read, Grep, Glob, Edit, Bash), which the session dispatches, as the
  `rebase <ref>` reply says, when its rebase stops on conflicts, with the checkout as its prompt (contracts "The conflict
  resolver"). It resolves each unmerged file, `git add -- <file>`, `git rebase --continue`, and repeats; it never edits a
  spec.md and never runs `git rebase --skip`; on a spec.md among the unmerged files, or a file it cannot resolve, it runs `git
  rebase --abort` and reports the files for the session to raise to the user. No gate code dispatches, admits or watches it:
  it works under the hooks as any agent does, and the story rule holds it on the branch under the rebase (R6).
- **Rationale**: the user asked that a conflict be resolved without them (Clarifications). A story commit never changes a
  spec.md (US1), so a spec.md conflict is no agent's to settle; the user decides it. A hook cannot run an agent, so the reply
  names the dispatch, a deviation from P1 the plan's Complexity Tracking records; it fails safe, since no round opens until the
  branch contains `rebased_onto` (R9).
- **Existing tools**: the plugin's `agents/` and `test_agents.py`'s frontmatter reader, reused; `test_shipped_tree.py` lists the
  agent as `alq-review:conflict-resolver`.

## R11: A PR changes the spec or the code, never both

- **Decision**: `specbinding.mixed_diff_refusal(changes: list[tuple[str, str]], branch, then) -> str | None`, pure: `changes`
  are `(status, path)` pairs, status git's letter (`A`, `M`, `D`, `R`, `C`, `T`); for each path with status other than `D` whose
  `spec_md_folder` is set, the first changed path (any status) not under that folder refuses, naming the spec.md, that path, the
  rule, and the next step (land the spec change as a spec-only PR on `<issue>-spec`, with `story_issue(branch)` or "the issue's
  spec branch", rebase this branch on it, then `then`). A renamed spec.md counts at its destination. Two sites, two readers of
  the same fact: at a review-round launch of any stage, after `_review_base` and before `ledger.open_round`,
  `worktree.name_status(root, base)` (`_DIFF --name-status -z base...HEAD`, which with `--find-renames` strips the score from
  `R<score>` and yields the destination path), refused through `hookio.refuse(payload, "launch", ...)` with `then` "launch
  again"; at the attestation, after `policy.mark_ready` allows, `github.pr_files(slug, pr)` (`gh api --paginate
  repos/<slug>/pulls/<pr>/files`, GitHub's `status` mapped to git's letter; None when gh cannot answer, or when the list reaches
  3000 files, GitHub's cap for that endpoint, past which the diff cannot be verified; None refuses as `_unknown_pr` refuses, P4)
  with `then` "mark it ready again". Assess-round launches run no diff check.
- **Rationale**: FR-004: one function decides for both sites. The launch has a checkout and a base; a `gh pr ready` may run from
  anywhere, and GitHub lists the PR's files with their status, so the attestation site needs no checkout. A deleted spec.md
  grades nothing (Clarifications). Under `mode` (FR-005). An audit launch is a review-round launch (edge case).
- **Existing tools**: `worktree.changed_files` and `_DIFF`, reused with `--name-status`; `github._gh`, the `--paginate` form
  `released` uses; `_review_base`, `hookio.refuse`. Reusing the settled round's `base_sha` and `root` at the attestation: rejected,
  the root may be gone and `released` PRs have no round.

## R12: The rescope runs on the spec branch

- **Decision**: `plugins/alq-plan/skills/issue-spec/SKILL.md`, the `rescope` form: `CHECKOUT` is the worktree of `<issue>-spec`,
  created per the repo's branch rules off the default branch when there is none; before any write the skill reads `git fetch
  origin` then `git branch -a --merged origin/<default>` and stops, naming it and asking the user to delete it, when a local or
  remote `<issue>-spec` is already merged. Step 8's commit and push land on that branch; its closing lines name the folder and the
  branch, and then, once, the user's next steps: open the spec-only PR, approve it, rebase the story branch with `rebase <ref>`,
  relaunch the review. It names no other plugin's command.
- **Rationale**: FR-006. With US1, a rescope in the story PR's worktree is refused at its first write. A merged branch reused
  would carry a merged history into a new PR.
- **Existing tools**: the skill's two forms and its `DRIVE` steps, unchanged; `git-workflow.md`'s worktree command.

## R13: Tests, red first, in the two suites

- **Decision**: `dev/alq-review/tests`: the story rule's gate tests join `test_gate.py` as a class `StoryBranch(Gate)` whose
  fixture checks out `123-us2-reset` and commits `dev/x/specs/123-login/spec.md`; the shell reader's write table in
  `test_shell.py`; the pure functions in `test_specbinding.py` (`SpecMdFolder`, `StoryIssue`, `StoryWriteRefusal`, `MixedDiff`,
  replacing `TextStep`); the lock text and the launch refusal in `test_policy.py`; `rebase <ref>` and the diff check in
  `test_gate.py` (`Rebase(HeldBranch)`, `MixedDiff(SpecArgument)`), the gh stub answering `api repos/*/pulls/*/files` from
  `GH_PR_FILES` and `repo view --json defaultBranchRef`; `Rebase` covers, besides the scenarios: each failed check refused with
  the lock kept and nothing recorded (no locked PR or several, another hold, bound to `null`, the checkout missing, gh or the
  fetch failing); the release with `regraded_from` and `rebased_onto` set, and the story branch, its checkout, the remote
  branch and `git worktree list` unchanged; a review-round launch refused until HEAD contains `rebased_onto`, then a full round
  with no delta, its facts counting only commits since the release and comparing it with no round before it (R15); `rebase
  onto main` and `rebase #<pr> now` answered with no reply; the agent file in `test_agents.py`: it exists with its tools, and
  its prose says it never edits a spec.md and runs `git rebase --abort` on a spec.md conflict; `worktree.rebasing`, `contains`,
  `fetch_target`, `to_commit`, `name_status` in `test_worktree_facts.py`, `name_status` with a renamed spec.md giving `R` and
  the destination path; `policy.launch_round` with no `delta_from` across `regraded_from`, and still refused by the round cap
  on rounds from before it, in `test_policy.py` and `facts.round_facts` reading only the rounds from it on in
  `test_worktree_facts.py`. US2's tests name `spec_blob` and `spec_held`, a stored ledger carrying them and holding nothing, so
  SC-003's grep covers `plugins/alq-review` and not the tests. Deleted with the hold: `test_gate.py` `SpecArgument`'s hold tests
  (today's lines 442–470, 599–672, 709–760, 777–790, 852–877), `held()`, `assertHeldWithTheDiff`, `spec_blob` in
  `HeldBranch.lock` and three `state.update` calls; `test_policy.py` `hold_spec`, `spec_held_state`, `SPEC_HOLD_NAMES`, four
  `Mutation` tests and the "spec hold" case of the every-hold test; `test_specbinding.py` `TextStep`;
  `test_worktree_facts.py:298`. `dev/alq-plan/tests/test_spec_source.py`: the rescope test becomes the spec-branch test. Each
  test is written, run and seen to fail for the expected reason before its code (constitution IV). Before the hold's tests are
  deleted in US2, they are run once on main and the result is recorded in the PR, so the spec's "did not converge" is observed
  (its Root cause ran nothing).
- **Rationale**: SC-001 and FR-008. The harness drives each hook event in-process (`Gate.hook`), with a bare origin for the
  fetch (`serve_remote`).
- **Existing tools**: `Gate`, `HeldBranch.lock`, `SpecArgument.commit_files`, `Repo.serve_remote`, the gh stub, reused.

## R14: What the README says

- **Decision**: item 2: a `RESHAPE_SPEC` lock's two releases and the rescope route; the changed-spec hold sentence goes. Item 5:
  the binding is the `spec` value; `spec.md` is read at the reviewed commit each round; the hold paragraph is replaced by the
  diff check. A new item 8: a story branch never changes a spec.md (the three sites, the writes table's forms, the next step).
  Mode: the story rule and the diff check are made through `hookio.refuse`. What the user types: `rebase`, and the session's
  next step after it. State: the ledger's `spec`, `regraded_from` and `rebased_onto` records. Layout: `specbinding.py`'s new
  line, `agents/conflict-resolver.md`. Nothing names `spec_blob`, `spec_held` or `text_step` (SC-003).
- **Rationale**: FR-007; the README is the plugin's description and changes with its code (019 R17).
- **Existing tools**: the README's sections, edited in place.

## R15: After a release by `rebase`, the story is measured afresh

- **Decision**: the release of `rebase <ref>` (data-model "`rebase <ref>`") sets `state["regraded_from"] = len(state["rounds"])`
  beside `ledger.unlock`, in the same save; `unlock <ref>` sets nothing. Every reader of round history that measures the story
  reads only `state["rounds"][state.get("regraded_from", 0):]`. `policy.launch_round` counts as `done` only the internal rounds
  there, so the first round after the release has `scope="full"` and no `delta_from`, and the brief's delta diff
  (`briefs._review_prompt`, `git diff <delta_from>..HEAD`) gives way to the whole change, `git diff <base>...HEAD`.
  `facts.round_facts` takes `first_reviewed` and the original `base` from the first of them, not `rounds[0]`, so `added_lines`,
  `commits_per_file` and both `additions` count only commits since the release; it takes `earlier`, the finding counts behind
  `count_not_falling`, and `seen`, the spots behind `repeat_unit`, from them too, and so `burden`. Its callers,
  `gate.on_structured_output` (the assessor's admissible verdicts), `briefs.churned` and `briefs.brief`, change nothing. The
  round caps (`policy._capped`) and `briefs.brief`'s `earlier_rounds` span the release on purpose: a rebase settles no round, so
  the cap counts the rounds before it too, and earlier rounds are the assessor's context, not a gate. The field is not the
  ledger's `epoch`, which an escalation audit advances.
- **Rationale**: the rebase rewrites every commit of the story branch, so a head recorded before it is no ancestor of the
  rewritten HEAD: `<old head>..HEAD` holds every rewritten commit of the story and every commit the default branch gained, so a
  delta round would brief the whole rebase as a delta, and a file the story edited in three commits before it would read as at a
  third edit. The whole story is regraded against the new `spec.md`, which is a full round. A round before the release graded
  another `spec.md` and another history, so neither its finding count nor its spots say whether the story converges now: the
  first full round after it, with more findings than the last round before it, is no count that failed to fall. `unlock <ref>`
  rewrites nothing, so its rounds are measured as before.
- **Existing tools**: `policy.launch_round`'s `done` and `facts.round_facts`, edited; the briefs, unchanged. The escalation
  `epoch`: rejected, since advancing it also restarts the round cap (`_capped` counts `counted` rounds, which `epoch` filters)
  and changes the round refs, neither of which a spec change asks for.
