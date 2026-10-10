# Research: split alq-review into review, plan and build plugins

Read for this: `plugins/alq-review/scripts/{gate,briefs,policy,ledger,hookio,config,speclocation,settled_design,premise_report,rootcause,github,worktree}.py`,
`workflows/{review-round,assess-round}.js`, `hooks/hooks.json`, `config.json`, `plugin.json`, the README, the three
skills, `skills/alq-spec/scripts/drive_workflow.py`, `speckit/**`, `.claude-plugin/marketplace.json`,
`.github/workflows/tests.yml`, every test file in `dev/alq-review/tests/`, ADRs 0001–0015 and the constitution, all on
main at `7179e9e`; ADRs 0016–0018 as merged in #69 (main at `0fb1766`). Nothing below was run unless it says so.

## R1: Two pull requests: behaviour first, then the move

- **Decision**: the code ships as two PRs after the decision records. PR 1 changes behaviour inside today's single
  plugin: review takes `spec`, the location comment and `speclocation.py` are deleted, the settled-design check and
  the rescope route leave the gate, planning closes a not-worth-doing issue, `issue-tackle` takes `spec` and `branch`.
  PR 2 moves files into `plugins/alq-plan/` and `plugins/alq-build/`, renames the skills, splits the tests and the
  `dev/` folders, and adds the two plugins to the marketplace. Agreed with the user.
- **Rationale**: each PR deploys working on its own. A move mixed with behaviour changes hides the changes in rename
  noise and puts every touched file far past the three-edits tripwire. After PR 1 the only link left between planning
  and review is the folder they share, so PR 2 is a move with renames and no logic change.
- **Existing tools**: `git mv`, which keeps history through the move. The repo's PR review loop, which reviews
  "only what changed": a pure move reviews as renames.

## R2: Three plugin folders, one marketplace, skills named by their folders

- **Decision**: `plugins/alq-plan/` holds `skills/issue-spec/` (today's `alq-spec`, with `scripts/drive_workflow.py`),
  `scripts/{premise_report,rootcause,settled_design}.py` and `speckit/`. `plugins/alq-build/` holds
  `skills/issue-tackle/` and `skills/root-cause-check/`. Each has `.claude-plugin/plugin.json` with no
  `dependencies` field, starting at version `0.1.0`. `alq-review` goes to `0.12.0`. `.claude-plugin/marketplace.json`
  lists all three.
- **Rationale**: Claude Code names a skill `/<plugin>:<skill folder>`, so the folder names give the agreed commands
  `/alq-plan:issue-spec`, `/alq-build:issue-tackle` and `/alq-build:root-cause-check`. Leaving `dependencies` out is
  what "none requires another" means in the manifest.
- **Existing tools**: the marketplace and `plugin.json` formats the repo already uses. Claude Code's `dependencies`
  field: looked at, and left out on purpose.

## R3: The planning driver names its own root

- **Decision**: `drive_workflow.py` sets `ALQ_PLAN_ROOT` to its plugin's folder, still found from `__file__`.
  `workflow.yml` calls `$ALQ_PLAN_ROOT/scripts/...` at every place it calls `$ALQ_REVIEW_ROOT` today.
  `ALQ_REVIEW_ROOT` is gone from every file.
- **Rationale**: the workflow runs as a Spec Kit subprocess, so the driver has to pass the root through the
  environment. Only the name changes. With no compatibility, a run started before the change fails on resume, which
  the spec accepts.
- **Existing tools**: `${CLAUDE_PLUGIN_ROOT}`, looked at. Claude Code sets it for hooks and MCP servers, not for a
  subprocess a skill starts, so it doesn't reach `specify`. The driver's `PLUGIN = Path(__file__).resolve().parents[3]`
  is reused.

## R4: The settled-design check keeps only its single-folder mode

- **Decision**: `settled_design.py` keeps `problems(folder)` and its one-folder command line. `branch_problems`,
  `spec_folders`, `_spec_folder`, `design_documents`, `--branch`, `--spec-folders`, the docstring's paragraph about
  them, and the `config` and `worktree` imports are deleted. Planning's
  `settled-design` workflow step calls it on the run's folder, as it does today.
- **Rationale**: the gate was the only caller of the branch mode, and the gate stops checking spec folders. Rescope
  now takes the folder as its argument, so `--spec-folders` has no caller. With no review imports left, the module
  loads in a plugin on its own.
- **Existing tools**: `settled_design.problems`, reused unchanged. `config.load` and `worktree.changed_files`: review
  modules that planning must not import.

## R5: A not-worth-doing pick closes the issue with `gh`

- **Decision**: the workflow gains a required input `issue`, which the skill fills from `#<issue>` in both entry forms (R6). The
  `record-outcome` step becomes `close-not-worth-doing`, which runs only on that pick:
  `gh issue close "$ISSUE" --repo "$(git remote get-url origin)" --reason "not planned" --comment "$reason"`, where `$reason` comes from
  `premise_report.py reason <report>`. The driver passes the issue to the step as `ISSUE` in the environment, as it
  passes `SPEC_DIR`, rebuilt from the run's saved inputs on a resume: input text is never spliced into shell source. The new `reason` command prints the report's `Reason:` line and exits
  non-zero when it is empty. `record` and the `speclocation` import are deleted from `premise_report.py`. A
  "no spec needed" pick runs nothing.
- **Rationale**: closing as not planned is GitHub's own record for "not worth doing". The script stays free of
  GitHub, and the workflow step only orchestrates. A failed `gh` fails the step, and with it the run, loudly.
- **Existing tools**: `gh issue close --reason "not planned" --comment`, the GitHub CLI the plugins already use.
  `github.py`, a review module, looked at and not imported (R2). No closing code exists in the repo today.

## R6: The planning skill's entry points

- **Decision**: `/alq-plan:issue-spec` accepts two forms. `#<issue> [<dir>]` starts a run with no issue-comment
  lookup and no "already located" stop. `rescope <spec folder> #<issue>`, both required, starts at grill on that
  folder. The run's spec input is the issue's title and description, read with the same `gh issue view` the
  `#<issue>` form uses, followed by the open decision from the conversation as plain text (agreed with the user: the
  folder may hold the wrong scope, so the issue is the reference). The `#<issue> none <reason>` form
  is deleted, because it only posted the comment. A completed run's last message gives the spec folder and the
  output of `git rev-parse --abbrev-ref HEAD`. It names no command of another plugin.
- **Rationale**: these are the spec's planning requirements. The rescope folder check is the one `select-spec`
  already makes (`specs/<feature>`, `spec.md` present).
- **Existing tools**: the workflow's `spec_dir` input and its `select-spec` step, reused; the skill's
  `gh issue view <issue> --json url,title,body` line, reused for rescope. `speclocation status/show`, deleted.

## R7: One review module owns the `spec` argument

- **Decision**: a new pure module `scripts/specbinding.py` replaces `speclocation.py` on the review side. It has
  `parse(value) -> Folder | NoSpec` (`null` gives `NoSpec()`; a string, stripped, gives `Folder`; it raises on an
  empty string or any other type), `shape_problem(folder) -> str | None` (relative, no `..`, parent named `specs`),
  `bind(recorded, given) -> str | None` (the refusal text when they differ; called only when the PR has a binding,
  since `null` is itself a bound value), and `text_step(bound_blob, head_blob, held_at, unlocked_at)`, which R18
  defines. The git fact, the type, blob id and size of `<folder>/spec.md` (missing, empty or present), is read in
  the gate with `git ls-tree -l -z <head sha> -- <folder>/spec.md`, at the head sha the round is pinned to, not
  symbolic HEAD. `NoSpec` moves into `specbinding.py` with no field. `FoundSpec` goes: `specbinding.Folder` serves,
  and `briefs.Spec` points at `Folder` and `NoSpec`.
- **Rationale**: the constitution's rule that decisions live in pure functions (P3) puts parse, shape and bind where
  they can be tested without git. The verification runs in the spec's order, and each failure names its step.
- **Existing tools**: `worktree.git`, reused for the `ls-tree` read; it raises with git's error.
  `worktree.tree_text` and `worktree.tree_blob`, looked at: not used and not changed (#73). `speclocation.NoSpec`,
  moved. `speclocation.FoundSpec` and `speclocation.resolve`, deleted.

## R8: The binding is a top-level field of the PR's ledger

- **Decision**: the ledger doc gains `spec`, the value as given: the folder string, stripped, for example
  `specs/019-split-planning-plugin`, or `null`; and `spec_blob`, the git blob id of `<folder>/spec.md` in HEAD, or
  `null` with no spec. On a review-round launch the gate parses and verifies the value. When the doc has no `spec`
  key, both are set, in the same save that opens the round. When it has one, a different value is refused, and
  `spec_blob` changes only as R18 says. Assess-round launches carry no `spec`. Assess-round, the assessor's brief
  (`briefs.brief`) and the reviewer prompt read `state["spec"]` and give the folder's path; the reviewers and the
  assessor read `<folder>/spec.md` from the worktree themselves. Nothing is quoted into a prompt or brief, and the
  gate never reads the bound blob's text. A PR started before this change has no binding; no code handles it
  (no backwards compatibility). A launch refused before its round opens records no binding (agreed with the user; a
  branch with no PR is #70); the one thing a refused launch records is R18's hold, and only when the refusal blocks.
- **Rationale**: ADR-0002 decision 3 allows no record outside the one store. Per-PR facts already sit at the top
  level of the ledger doc (`github_clean_sha`, `unlocked_at`). Recording in the round's own save means a refused
  launch cannot bind a PR. The hold of R18 refuses a round whose HEAD `spec.md` is not the bound blob, so every round
  and assessment reads the bound text (ADR-0016).
- **Existing tools**: `ledger.open_checkouts_ledger` and `_save`, reused. `setdefault`-style late fields, which have
  precedent in the doc. A separate table, looked at: a per-PR fact needs no key of its own.

## R9: The verification reads only `spec.md` and never crashes the gate

- **Decision**: the gate turns every failure while reading the binding into a refusal under `mode` that names the
  step and the file: a missing or empty `spec.md`, and any `RuntimeError` from git while reading `spec.md`'s entry
  or diffing the bound blob against HEAD's. Nothing else in the folder is read. A launch whose round cannot open (no
  open PR, no readable review base, no round awaiting assessment) is denied in every mode by a new `hookio.block`,
  which records the deny: `log` mode lets a launch past a rule it breaks, never past a round that cannot exist.
  Today those three `return refuse(...)` return nothing in `log` mode, and the workflow starts without its round.
- **Rationale**: this is the spec's requirement that review reads only `spec.md` and refuses loudly. Today an
  exception in `on_workflow` reaches the top-level handler. That handler denies in enforce mode and fails open with a
  `systemMessage` otherwise. A named refusal is clearer than "the gate crashed" in both modes.
- **Existing tools**: `hookio.refuse`, reused; `hookio.deny` and `record`, which `block` combines. The top-level handler (`gate.py` `main`), kept as the last resort and
  not relied on.

## R10: The reviewer prompt names no spec headings

- **Decision**: `briefs._graded_against` says: "This change implements the spec in {folder}/spec.md of {root}. Read
  it. Every requirement the spec states that the change does
  not meet is a finding: quote the requirement in its title. What the spec excludes bounds what you may ask for." The
  `null` text becomes: "The caller says this change needs no spec. Raise no finding about an unmet requirement of a
  spec."
- **Rationale**: the spec's requirement that the prompt name no headings. The template has no "Acceptance
  criterion" or "Out of scope" heading.
- **Existing tools**: `_graded_against`, edited in place.

## R11: The settled-design check, its settings and its refusal leave the gate

- **Decision**: delete `gate._spec_problems` and its call, `policy.first_internal_round`, whose only caller is that
  call, `import settled_design`, `hookio.refuse_spec` and
  `spec_checks_mode`, `spec_checks` and `design_documents` from `config.json`, and their README and test coverage.
  `hookio._refuse_under` stays, because `refuse_claim` and `refuse_shim` still call it.
- **Rationale**: the spec says review runs no check of the folder's contents, and these settings have no other
  reader.
- **Existing tools**: `hookio.refuse`, which now carries the spec refusals under `mode`.

## R12: Only `unlock` releases a RESHAPE_SPEC lock, and its reply carries the ruling

- **Decision**: delete `policy.RESCOPE`, `RESCOPE_SKILL`, `gate.RESCOPE_SKILLS`, the rescope branch of `_on_release`
  and `_unlock`, and the rescope sentence in `_lock_reason`. When `unlock <ref>` releases a RESHAPE_SPEC lock, the
  reply adds the ruling's open decision, its rationale, the spec gaps and the bound folder, which is what
  `_rescope_brief` formats today, renamed `_reshape_brief`. When the binding is `null`, the reply instead says:
  "This PR has no spec. Close it and restart the work on a new PR bound to a spec that settles this decision."
- **Rationale**: the constitution's rule of one approved entity and one action per hold (P2). The ruling has to reach
  the user, because the user carries it to planning by hand.
- **Existing tools**: `policy.reshape_spec_ruling` and `_rescope_brief`, reused. ADR-0004's keyword rule, unchanged.

## R13: Every call text the gate prints carries `spec`

- **Decision**: `policy.REVIEW_CALL` becomes
  `Workflow(name='alq-review:review-round', args={worktree: '<absolute worktree path>', stage: '%s', spec: %s})`.
  One function, `policy.review_call(state, stage)`, `state` being `None` when none is at hand, builds it, and every
  user calls it. It fills `spec` with the PR's recorded value when there is one, `'<folder>'` or `null`, and with
  `'<spec folder>' | null` when there isn't. The users are the dead-round relaunch, the audit cap, mark-ready,
  `on_agent`, `on_skill` and the gate's spec refusals. `workflows/review-round.js` `meta.whenToUse` names
  `args.spec` (`'<spec folder>' | null`). The README's hand-written calls change to match.
- **Rationale**: the spec's requirement that a refusal give the full call. Quoting the recorded value means the agent
  can't pass a different one by mistake.
- **Existing tools**: `REVIEW_CALL` and its five users, edited to go through `review_call`.

## R14: `issue-tackle` takes `spec` and `branch`, and acts on every verdict

- **Decision**: the skill's argument is `<n> spec=<folder|null> [branch=<branch>]`, with `branch` required
  for a folder. Step 1 checks out or reuses `.claude/worktrees/<n>` on `branch`, then reads
  `git show HEAD:<folder>/spec.md`, and stops before writing code when it is missing or empty. With `null`, it creates
  `<type>/<n>-<short-description>`. The review step launches review-round with the same `spec`, and stops with "the
  review step needs alq-review" when that workflow is not installed. After the internal loop ends clean, it runs
  root-cause-check and acts on all four verdicts as the spec lists them. With `null`, the check doesn't run.
  The root-cause check runs once, after the internal loop's clean round, as today (agreed with the user).
  `root-cause-check` takes the spec folder as its argument instead of reading the location comment.
- **Rationale**: these are the spec's build requirements. The skills are instructions, not code, so the steps are
  written as plain instructions.
- **Existing tools**: today's two `SKILL.md` files, edited. `speclocation show`, deleted.

## R15: Each plugin's test suite stands alone

- **Decision**: in PR 2, `dev/alq-plan/tests/` takes `test_premise_report`, `test_rootcause`, `test_settled_design`,
  `test_drive_workflow`, `test_plan_template` and `test_critique_report`. `dev/alq-build/tests/` takes the
  `IssueTackle` class of `test_agents` and the skill-text tests. Each suite has its own `paths.py` naming its plugin
  and a copied two-line `git` helper. Planning's fake `gh` is a small stub in its suite that records `issue close`
  calls. `test_speclocation.py`, `IssueSpec`, `SpecChecks`, `SettledDesign`, `DesignDocuments`, the rescope tests and
  `test_spec_source.py` are deleted or rewritten in PR 1. `test_gate.py` no longer imports `test_settled_design`.
  Each suite gets two guard tests: every script of its plugin loads from a copy holding only that plugin, and no file
  of its plugin names another plugin's command (FR-004's two exceptions are listed in the test).
- **Rationale**: CI already picks up every `dev/**/tests` folder (`tests.yml`), so no CI change is needed. The guard
  tests are what make "none requires another" fail loudly instead of resting on prose.
- **Existing tools**: `tests.yml` discovery, unchanged. `test_shipped_tree.py`, which already covers every plugin and
  stays in review's suite. `test_gate.Gate`'s fake `gh`, looked at: it's built on review's harness, which planning
  can't import.

## R16: Each plugin gets its own Spec Kit project in its own PR, before the move

- **Decision**: a PR between the decision records and PR 1 creates `dev/alq-plan/` and `dev/alq-build/`, each with
  `specify init` at Spec Kit 1.0.7, the same extensions as `dev/alq-review` (adrkit, assess, critique, grill), a
  constitution, and an ADR log. The constitution holds the inherited principles I–VI verbatim, plus plugin principles
  chosen for that plugin. The ADR log opens with new records deciding again, agreed with the user: for alq-plan ADR-0008
  decision 1, ADR-0009, ADR-0011 and ADR-0012 decision 1; for alq-build ADR-0008 decisions 1 and 2. ADR-0016 leaves
  two more to the new logs, so alq-plan's also decides the part of ADR-0008 decision 2 about the skill that shapes an
  issue, and what planning does with an issue that needs no spec or is not worth doing. Plugin principles, agreed with the user: alq-plan takes P1 reworded (every planning rule is decided by
  a workflow step that runs a script, since planning has no hooks), P3, P4 and P5; alq-build takes P4 and P5. Neither
  takes P2: neither has a hold.
- **Rationale**: governing documents ship apart from the code they govern (constitution VI), so they land before the
  code that moves under them.
- **Existing tools**: `specify init` and the adrkit draft skill, the tools `dev/alq-review` was built with.

## R17: Order of everything that ships

- **Decision**: (1) the `cto` rule file's review-round call gains `spec`; (2) the alq-review decision records (#69,
  merged as ADR-0016 to ADR-0018); (3) the two new Spec Kit projects with their constitutions and records (R16);
  (4) PR 1, behaviour, with the README items it changes; (5) PR 2, the move; (6) the alq-review constitution
  amendment, whose P2 and P5 sources change in (4) and (5); (7) a `cto`
  follow-up renaming `alq-review:alq-root-cause-check` and `alq-issue-tackle` in the skills that name them. The
  spec's order step that put the constitution and README with the records is corrected to this.
  alq-review is disabled for (1) to (4), and the user reviews those PRs by hand with `/pr-review-toolkit:review-pr`
  (agreed with the user). It is re-enabled once PR 1's release is installed, so PR 2 onwards is reviewed by the new
  gate with `spec`.
- **Rationale**: the constitution's governance says to change a principle's source file first, in its own PR, and
  then the constitution. The README describes the plugin, so it changes with the code. Step (1) is safe first: today
  the gate rebuilds the workflow's args from `worktree` and `stage` alone, so an extra `spec` is dropped, not refused
  (read in `on_workflow`, not run).
  Until PR 1 ships, today's gate checks every `…/63-…` branch against #63's one location comment, so the PRs of (2)
  and (3), which don't hold spec 019, would be refused; and with alq-review on, `/pr-review-toolkit:review-pr` is
  refused too (`gate.py` `REVIEW_SKILLS`).
- **Existing tools**: the rule file and constitution governance as written.

## R18: A changed `spec.md` holds the PR until the user unlocks it

- **Decision**: on a review-round launch on a PR bound to a folder, after the value is verified and bound,
  `specbinding.text_step(bound_blob, head_blob, held_at, unlocked_at)` decides, pure: `same` when the blob ids are
  equal; `bind` when they differ and a later unlock released the recorded hold; `hold` otherwise. One predicate,
  `ledger.released(at, unlocked_at)`, says whether a hold or lock recorded at stamp `at` was released by a later
  unlock; equal stamps are still held. The ledger owns both stamps. `policy`'s
  verdict lock, its spec-hold lock and `text_step` all use it. On `hold` the gate refuses with
  `git diff <bound> <head>`, read through `worktree.git`, and, when the refusal blocks (`enforce`), records
  `state["spec_held"] = {"bound", "head", "at"}` when it is absent. In `log` mode the launch is logged as a
  would-deny, the binding stays as it was, no hold is recorded, and the round opens. On `bind` it sets `spec_blob`
  to HEAD's, whatever HEAD's `spec.md` is then. The save that opens a round deletes `spec_held`,
  so a later change is held again, including the one a rescope commits after a RESHAPE_SPEC unlock. `policy.locked`
  (which `_unlock` reads) and `_lock_reason` (which `_obstacle` reads) also hold a PR whose `spec_held` no later
  unlock released, so edits and git moves are refused as under a RESHAPE_SPEC lock; the reason names the folder, both
  blob ids, the `git diff` command and `unlock <ref>`. `_lock_reason` names every hold active on the PR (the verdict
  lock, spent audits, the spec hold), since one unlock releases them all.
  The spec steps run before `policy.launch_round`, so a launch on a held PR is refused with the diff each time.
- **Rationale**: ADR-0016 decision 6. The hold is a lock in the ledger, released by today's `unlock`, so it needs no
  release path of its own (constitution P2).
- **Existing tools**: `ledger.unlock` and `unlocked_at`, `policy.locked`, `_lock_reason` and the gate's `_unlock`,
  reused; the verdict lock's comparison of `unlocked_at` with the stamp it locked at, made the one predicate;
  `git diff` between two blob ids through `worktree.git`.
