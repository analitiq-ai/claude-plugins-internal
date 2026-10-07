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

## shim_chains — key (repo, branch, chain id)

Every rule about a chain's state is in this section and in the tree rule below. Other documents cite them and
decide nothing about state.

| Field | Meaning |
|---|---|
| `id` | first 16 hex of sha256(repo \0 branch \0 first tree); never recomputed |
| `count` | completed `patch` checks of distinct trees, the deep check left out (R10) |
| `trees` | the trees already counted, so a tree is counted once |
| `tree`, `ranges` | the tree the ranges are in the coordinates of; per file, the new-side ranges of every member check's hunks plus listed sites' lines, each carried there (R9) |
| `target` | the deep sweep's merged SAME OPERATION and CALLERS/CONSUMERS lists, once run |
| `override` | `{head, count}`: the branch's `HEAD` and the chain's count when the user typed `override shim-<id>`; empty until then (R11) |
| `ended` | set by a `complete` check that overlaps; nothing else ends a chain, and an ended chain is not changed again |
| `seen` | per site id listed so far, the trees whose checks listed it (R12) |

### State

Derived from the stored fields and the branch's `HEAD`, never stored, for a chain that has not ended. Ordered; the
first match is the state.

1. `held`: `count` is 4 or more, and `override` is empty or `count` is above `override.count`.
2. `overridden`: `override.head` is the branch's `HEAD`.
3. `deep due`: `count` is 3 and `target` is empty.
4. `checked`: any other chain.

### Transitions

A completed check is applied to every chain its staged tree matches (tree rule). The column is the chain's state
before the check. The state after an event is read from the list above.

A `held` or `overridden` chain is changed by the user's override and by nothing else: the tree rule refuses the
launch for both, and a check that was already running writes nothing to either.

| Event | `checked` | `deep due` |
|---|---|---|
| A `sweep` or `rejudge` check ends `patch` on a tree not in `trees` | its hunk ranges and listed sites are added to `ranges`, the tree to `trees`; `count` rises by one | cannot occur: the launch runs `deep` mode |
| The `deep` check ends `patch` | cannot occur: `deep` mode runs only for a `deep due` chain | `target` is set and its sites are added to `ranges`; `count` is unchanged |
| A check ends `patch` on a tree in `trees` (a restart, a contest) | `ranges` and `seen` are brought up to date; nothing is counted | the same |
| A check ends `complete` | `ended` is set | `ended` is set |
| A check fails or is replaced | nothing written | nothing written |
| An allowed launch | `ranges` are stored as carried to the staged tree, with that `tree` | the same |
| The user types `override shim-<chain id>`, or the id of a tree that matches the chain | `override` is set to the branch's `HEAD` and `count` | the same |
| A commit, an amend or a rebase lands | nothing written | nothing written |

The same events on the other two states: the user's override sets `override` in both, so a `held` chain is then
`overridden`; a commit writes nothing, and an `overridden` chain is then in the state the list gives for its
count. Every other event cannot occur or writes nothing, as said above.

A `patch` check whose tree matches no chain opens one at count 1. The user's `override shim-<tree id>` for a
tree that matches no chain opens one seeded with that tree's hunk ranges, with `count` 0 and `override.count` 0.

So a bug overridden at the 4th refusal or later is `checked` once the commit lands: its next tree is checked, a
`complete` ends it, and a `patch` makes it `held` at once. A bug overridden earlier goes on from its count: the
deep sweep is still due at 3 if it has not run, and it is `held` at 4.

### Tree rule

How a staged tree is matched to chains before any check of it exists. The launch and the commit use it unchanged.

Every range of every chain of the repo and branch that has not ended is carried to the staged tree (R9). The tree
matches a chain when a new-side range of its code or mixed hunks overlaps a carried range. A tree can match
several chains.

- A matched chain is `held` → the launch and the commit are both refused, with the question for the user for
  each held chain.
- None is `held` and one is `overridden` → the commit is allowed without a check. The launch is refused and
  names `git commit`, since the check is off for that bug.
- Otherwise the check may be launched, and the commit is decided by the tree's check. The mode is `deep` when a
  matched chain is `deep due`, else `rejudge` against the `target` of a matched chain that has one, else `sweep`.

## shim_rulings — key (repo, chain id, site id)

| Field | Meaning |
|---|---|
| `ruling` | `shares` · `not_shared` · `deferred` |
| `issue` | issue number, required for `deferred`; dropped when the issue closes (R8) |
| `reason`, `evidence` | the author's reason; the judge's `file:line` evidence |

## Commit decision (pure, `shimcheck.commit_decision`)

Order, first match wins: shared preconditions (R1) → a hunk has no label yet: refuse, name the claim check (R2) →
no hunk is code/mixed: allow → the tree rule of `shim_chains`: a matched chain is `held`: refuse with the user
question; else one is `overridden`: allow → no check for the tree: refuse, name the launch → check not
`complete`: refuse, say the check failed or is running and name the relaunch → `patch`: refuse with sites (each
with the staged-tree line ranges of the hunks in its file), answers, chain count, and at count 3 the deep-sweep
step → `complete`: allow. Every refusal names `override shim-<id>` (R11). The chains are passed in with their
ranges already carried, so the function stays pure.
