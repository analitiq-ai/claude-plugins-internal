# Data model: builder's step

Builder-owned shapes live in `builder/plugin/lib/step.ts` as Zod schemas; every fact in them is read through
core (research R5–R12). Core additions B1–B7 are listed in `plan.md`.

## StepFacts (input of `decideStep`)

Gathered in this order, the default branch fetched after `shared` (R16 step 3); a stop decided at one stage reads nothing after it, so a later field may be absent.

| Field | Type | From |
|---|---|---|
| `story` | issue number `s` | argument |
| `session` | `{repo, issue}` \| `null` | `readSessionRecord` (R6) |
| `origin` | `owner/name` | main checkout's origin |
| `shared` | `Shared` | `codeworks.toml` at the HEAD of the checkout given (R7, R16), returned for `prFindings` and `internalReviewAt` |
| `issue` | `{state: open\|closed, title, body}` | REST issue |
| `done` | boolean | `isDone` |
| `lane` | `Lane` \| `null` (no card) | `laneOf`, board from `shared` (R7) |
| `spec` | `p` | `specIssue` |
| `branch` | `{github: string\|null, local: string\|null}` | `issueStory`; `git branch --list '<s>-us*'` |
| `worktree` | `{path, branch: string\|null, mergeInProgress: boolean, dirty: string[]}` \| `null` | `git worktree list --porcelain` at `../<repo>.worktrees/<branch>`; `MERGE_HEAD`; `git status --porcelain` |
| `pr` | `{number, head, merged, closed}` \| `null` | `issueStory` (B3) |
| `head` | sha | `git rev-parse HEAD` in the worktree |
| `headVsPr` | `same` \| `ahead` \| `behind` \| `diverged` | `git merge-base --is-ancestor` both ways |
| `merge` | `{needed: boolean, why: string[]}` | `readStoryStopFacts` (B7) against the default tip it fetched (R16), R9: spec PR merge commit, `governingDiff` over every `specs/<p>-*`, `merge-tree` |
| `folder` | `SpecFolderAnswer` \| `{noSpecs: true}` | `specFolder` at the head the work is on: the worktree's HEAD, or the ref it would start from (R10, R16) |
| `requirement` | `{kind, source, observed}` | `requirement`, `readSpecFacts` |
| `tasks` | `StoryTask[]` | `storyTasks(tasks.md at HEAD, s)` (B2) |
| `attested` | boolean | `internalReviewAt(pr.head)` (B5) |
| `findings` | `Finding[]` | `prFindings` (B6): required checks and threads, then a failed `<module>-review` check run as its module's one finding; no validator package opened, provider logins from core `validatorLogins` |

A read that does not answer is no field: the script exits 2 naming it (R3).

## StoryTask (core, B2)

| Field | Type | Rule |
|---|---|---|
| `id` | `T<nnn>` | Spec Kit's task id |
| `ticked` | boolean | `[x]` or `[X]` vs `[ ]`, read by core's `readTaskLine` |
| `story` | `k` \| `null` | the line's `[US<k>]` tag, read by core's `readTaskLine`; two different tags refuse |
| `line` | string | the task line as written |

Only lines inside a phase block labelled `Story issue: #<s>` (planner ADR-0008 d2).

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

`NO_SESSION_RECORD`, `OTHER_SESSION_ISSUE`, `OTHER_REPOSITORY`, `CLOSED`, `DONE`, `LANE` (Backlog, Blocked),
`NO_CARD`, `SPEC_ISSUE_ELSEWHERE`, `SEVERAL_BRANCHES`, `BRANCH_MISMATCH`, `WORKTREE_ON_OTHER_BRANCH`,
`NO_SPECS`, `NO_SPEC_FOLDER`, `SEVERAL_SPEC_FOLDERS`, `HEAD_BEHIND_PR`, `UNCOMMITTED_CHANGES`, in upper snake case (root ADR-0010 d2), so no value equals a GitHub state string
such as `closed` that core quotes elsewhere. One enum, defined
once in core beside the stop rule and the read of its facts (B7), which builder's step script and the orchestrator's Stop hook both call
(spec FR-025).

### Decision order (pure)

1. session: none → `NO_SESSION_RECORD`; issue ≠ s → `OTHER_SESSION_ISSUE`; repo ≠ origin → `OTHER_REPOSITORY`
2. `done` → `DONE`; closed → `CLOSED`
3. lane null → `NO_CARD`; Backlog/Blocked → `LANE`; parent in another repository → `SPEC_ISSUE_ELSEWHERE`
4. branch: several → `SEVERAL_BRANCHES`; github and local both present and different → `BRANCH_MISMATCH`;
   worktree on another branch → `WORKTREE_ON_OTHER_BRANCH`; no worktree (no branch anywhere, a branch on GitHub
   only, or a local branch) → stage 5 has no worktree to read, stages 6–7 are decided at the ref the worktree would
   start from (R16), and only when no stage stops does the script add the worktree, cutting the branch when
   there is none (R8), and re-read
5. worktree: merge in progress → `merge` (resolve and commit); uncommitted changes → `UNCOMMITTED_CHANGES`
6. `merge.needed` → `merge`, after stage 9's `HEAD_BEHIND_PR`, which is decided first
7. folder → `NO_SPECS` / `NO_SPEC_FOLDER` / `SEVERAL_SPEC_FOLDERS`
8. pr null or closed unmerged → `implement`
9. local head behind or diverged from pr head → `HEAD_BEHIND_PR`; ahead, or not attested → `internal_round`
10. findings → `github_round`; else `nothing_to_do`

Stages 1–4, 6, 7 and the stop half of 5 and 9 are core's stop rule (B7), the stop half of 9 decided before stage 6
and stage 6 returning `null` when a merge is due; builder's `decideStep` calls it first. Their facts (`session` through `worktree`, `merge`, `folder`, `pr`,
`head`, `headVsPr`) are read by core's `readStoryStopFacts` (B7); builder reads `requirement`, `tasks`, `attested`
and `findings` itself.

## State transitions across steps

```
(no branch) --cut--> implement --commit,tick,round clean--> [turn ends; Stop pushes, opens draft, attests]
draft unattested --> internal_round --clean--> attested
attested + findings --> github_round --> (FIX commits) --> unattested or attested
any step: default branch moved (R9), or a merge left unfinished --> merge --> re-run step
any step: lane Backlog/Blocked, closed, done --> stop
```
