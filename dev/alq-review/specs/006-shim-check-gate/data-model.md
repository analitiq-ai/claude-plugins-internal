# Data model: Shim check before commit

All records live in `ledger.db` (R14), as JSON documents under the keys named. Shapes are defined once in
`scripts/shimcheck.py`.

## Site

| Field | Meaning |
|---|---|
| `id` | first 16 hex of sha256(`file` \0 `function`) (R5) |
| `file`, `line` | path and line in `HEAD` |
| `function` | enclosing function or symbol, as the sweeper names it |
| `does` | what the site does |

## shim_checks — key (repo, tree)

| Field | Meaning |
|---|---|
| `ref` | `shim-<repo>-<tree[:12]>`, the id agents' outputs carry |
| `repo`, `root` | `owner/name` slug; the checkout's absolute path |
| `tree`, `head`, `branch` | staged tree (`git write-tree`), `HEAD` sha, branch |
| `chain` | chain id, set at launch (R9) |
| `mode` | `none` (all prose) · `not_fix` · `sweep` · `deep` · `rejudge` |
| `kind` | Jev's `fix` / `not_fix` answer, asked at launch |
| `hunks` | code/mixed hunks: file, old/new ranges, patch-id |
| `diff` | the staged diff of the files with code/mixed hunks, which Jev is asked over |
| `expected`, `outputs` | the sweeper briefs the mode runs (`standard`, `callers-first`); their recorded lists, by agent |
| `same_operation`, `callers` | merged Site lists |
| `level`, `coverage` | Jev's answers |
| `verdict` | `complete` · `patch` |
| `status` | `sweeping` → `judging` → `complete`, or `failed`; `ruling` while contested sites await their judges |
| `reason` | why the check failed, or `replaced by <ref>` |
| `contests` | site id → the author's reason, for each contested site not yet ruled |
| `snapshot` | the folder the sweepers read, until the check ends or is replaced (R3) |
| `started` | when the latest launch began |
| `cost` | `agents`, `seconds`, `jev_usd` |

Transitions: launch asks `kind`; a failed or timed-out `kind` call → `failed` with no answers, and a relaunch
asks it again; `not_fix` or all prose → `complete` with no sweep; otherwise `sweeping` (or
`judging` for `rejudge`); last expected output → `judging`; Jev answer → `complete`; any failure → `failed`. A launch that starts or restarts a check at a checkout turns
every `sweeping` or `judging` check of another tree or `HEAD` there into `failed`, `replaced by <ref>` (R3). A
relaunch of any tree that is not `complete` restarts it: `sweeping` or `failed` before lists → sweep again;
`judging` with lists recorded → Jev only. An accepted contest → `ruling`; the last ruling → `judging`. A restart never adds to the chain's count. A contest or deep run on the same tree replaces `level`/`coverage`/`verdict` without counting (R8, R10).

## shim_chains — key (repo, chain id)

| Field | Meaning |
|---|---|
| `id` | first 16 hex of sha256(repo \0 branch \0 first tree); never recomputed |
| `branch` | the chain is only matched on this branch (R9) |
| `count` | completed `patch` checks of distinct trees |
| `tree`, `ranges` | the tree the ranges were last carried to; per file, the new-side ranges of every member check's hunks plus listed sites' lines, in that tree's coordinates (R9) |
| `override_head` | the branch's `HEAD` when the user's override was typed; empty otherwise (R11) |
| `target` | the deep sweep's merged SAME OPERATION and CALLERS/CONSUMERS lists, once run |
| `state` | `open` → `deep_due` (count 3) → `deep_done` → `held` (count 4); `overridden` from any state by the user's `override shim-<id>`, and no check changes it; `ended` on a `complete`. An override is over once the branch's `HEAD` differs from `override_head`; the chain then has the state its count gives. A commit changes nothing else |
| `seen` | per site id listed so far, the trees whose checks listed it (R12) |

## shim_rulings — key (repo, chain id, site id)

| Field | Meaning |
|---|---|
| `ruling` | `shares` · `not_shared` · `deferred` |
| `issue` | issue number, required for `deferred`; dropped when the issue closes (R8) |
| `reason`, `evidence` | the author's reason; the judge's `file:line` evidence |

## Commit decision (pure, `shimcheck.commit_decision`)

Order, first match wins: shared preconditions (R1) → a hunk has no label yet: refuse, name the claim check (R2) →
no hunk is code/mixed: allow → chain `held`: refuse with the user question → tree matches an `overridden` chain:
allow → no check for the tree: refuse, name the launch → check not `complete`: refuse, say the check failed or
is running and name the relaunch → `patch`: refuse with sites (each with the line ranges the staged change alters in its
file), answers, chain count, and at count 3 the deep-sweep step → `complete`: allow. Every refusal names
`override shim-<id>` (R11).
