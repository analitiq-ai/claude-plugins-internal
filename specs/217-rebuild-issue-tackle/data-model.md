# Data model: builder's step

Builder-owned shapes live in `builder/plugin/lib/step.ts` as Zod schemas; every fact in them is read through
core (research R5–R12). Core additions B1–B7 are listed in `plan.md`.

## StepFacts (input of `decideStep`)

Gathered in this order; a stop decided at one stage reads nothing after it, so a later field may be absent.

| Field | Type | From |
|---|---|---|
| `story` | issue number `s` | argument |
| `session` | `{repo, issue}` \| `null` | `readSessionRecord` (R6) |
| `origin` | `owner/name` | main checkout's origin |
| `issue` | `{state: open\|closed, title, body}` | REST issue |
| `done` | boolean | `isDone` |
| `lane` | `Lane` \| `null` (no card) | `laneOf`, board from `[shared]` at the default branch |
| `spec` | `p` | `specIssue` |
| `branch` | `{github: string\|null, local: string\|null}` | `issueStory`; `git branch --list '<s>-us*'` |
| `worktree` | `{path, branch: string\|null, mergeInProgress: boolean, dirty: string[]}` \| `null` | `git worktree list --porcelain` at `../<repo>.worktrees/<branch>`; `MERGE_HEAD`; `git status --porcelain` |
| `merge` | `{needed: boolean, why: string[]}` | R9: spec PR merge commit, `governingDiff`, `merge-tree` |
| `folder` | `SpecFolderAnswer` \| `{noSpecs: true}` | `specFolder` at HEAD |
| `requirement` | `{kind, source, observed}` | `requirement`, `readSpecFacts` |
| `tasks` | `StoryTask[]` | `storyTasks(tasks.md at HEAD, s)` (B2) |
| `pr` | `{number, head, merged, closed}` \| `null` | `issueStory` (B3) |
| `head` | sha | `git rev-parse HEAD` in the worktree |
| `headVsPr` | `same` \| `ahead` \| `behind` \| `diverged` | `git merge-base --is-ancestor` both ways |
| `attested` | boolean | `internalReviewAt(pr.head)` (B5) |
| `findings` | `Finding[]` | `prFindings` (B6): `<module>-review` check runs and threads, no validator package loaded |

A read that does not answer is no field: the script exits 2 naming it (R3).

## StoryTask (core, B2)

| Field | Type | Rule |
|---|---|---|
| `id` | `T<nnn>` | Spec Kit's task id |
| `ticked` | boolean | `[x]` vs `[ ]` |
| `story` | `k` \| `null` | the `[US<k>]` tag right after the id, past Spec Kit's optional `[P]` |
| `line` | string | the task line as written |

A task line is Spec Kit's `- [ ] T<nnn> [P] [US<k>] <description>`, `[P]` and the tag optional, ticked `[x]`. Any
other line is no task. Only lines inside a phase block labelled `Story issue: #<s>` (planner ADR-0008 d2).

## Step (output of `decideStep`)

One JSON object, `kind` its discriminator (contracts/step-script.md).

| `kind` | Exit | Carries | When |
|---|---|---|---|
| `stop` | 1 | `state`, `reason`, `pr` (open story PR or null) | any stop of FR-005–FR-008, FR-010 |
| `merge` | 0 | `worktree`, `ref`, `why[]`, `argv` | R9, before the folder check |
| `implement` | 0 | `worktree`, `branch`, `requirement`, `tasks` (unticked), `observed` | no PR, or newest closed unmerged |
| `internal_round` | 0 | `worktree`, `head`, `args` (`{worktree, stage: "internal"}`) | open PR, head unattested or local head ahead |
| `github_round` | 0 | `worktree`, `head`, `findings` (count by source), `args` (`{worktree, stage: "github"}`) | attested, findings |
| `nothing_to_do` | 0 | `pr`, `head` | attested, no findings |

`argv` is the exact git command list the skill runs; `args` the exact round launch arguments; no other step hands
the model a command.

### Stop states (`state`)

`no_session_record`, `other_session_issue`, `other_repository`, `closed`, `done`, `lane` (Backlog, Blocked),
`no_card`, `spec_issue_elsewhere`, `several_branches`, `branch_mismatch`, `worktree_on_other_branch`,
`no_specs`, `no_spec_folder`, `several_spec_folders`, `head_behind_pr`, `uncommitted_changes`. One enum, defined
once in core beside the stop rule and the read of its facts (B7), which builder's step script and the orchestrator's Stop hook both call
(spec FR-025).

### Decision order (pure)

1. session: none → `no_session_record`; issue ≠ s → `other_session_issue`; repo ≠ origin → `other_repository`
2. `done` → `done`; closed → `closed`
3. lane null → `no_card`; Backlog/Blocked → `lane`; parent in another repository → `spec_issue_elsewhere`
4. branch: several → `several_branches`; github and local both present and different → `branch_mismatch`;
   worktree on another branch → `worktree_on_other_branch`; none anywhere → the script cuts (R8) and re-reads;
   GitHub only, or local with no worktree → the script adds the worktree on that branch (R8) and re-reads
5. worktree: merge in progress → `merge` (resolve and commit); uncommitted changes → `uncommitted_changes`
6. `merge.needed` → `merge`
7. folder → `no_specs` / `no_spec_folder` / `several_spec_folders`
8. pr null or closed unmerged → `implement`
9. local head behind or diverged from pr head → `head_behind_pr`; ahead, or not attested → `internal_round`
10. findings → `github_round`; else `nothing_to_do`

Stages 1–4, 7 and the stop half of 5 and 9 are core's stop rule (B7); builder's `decideStep` calls it first.
Their facts (`session` through `worktree`, `folder`, `pr`, `head`, `headVsPr`) are read by core's
`readStoryStopFacts` (B7); builder reads `merge`, `requirement`, `tasks`, `attested` and `findings` itself.

## State transitions across steps

```
(no branch) --cut--> implement --commit,tick,round clean--> [turn ends; Stop pushes, opens draft, attests]
draft unattested --> internal_round --clean--> attested
attested + findings --> github_round --> (FIX commits) --> unattested or attested
any step: default branch moved (R9), or a merge left unfinished --> merge --> re-run step
any step: lane Backlog/Blocked, closed, done --> stop
```
