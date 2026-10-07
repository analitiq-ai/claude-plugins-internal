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

Every rule about a chain's state is in this section. Other documents cite it and decide nothing about state.

| Field | Meaning |
|---|---|
| `id` | first 16 hex of sha256(repo \0 branch \0 first tree); never recomputed |
| `count` | raised by one by each `sweep` or `rejudge` check that ends `patch` on a tree not in `trees`; the deep check raises nothing (R10) |
| `trees` | every tree whose `patch` was applied to the chain, counted or not, the deep check's tree included; a tree is applied once |
| `tree`, `ranges` | the tree the ranges are in the coordinates of; per file, the new-side ranges of every member check's hunks plus listed sites' lines, each carried there (R9) |
| `target` | the deep sweep's merged SAME OPERATION and CALLERS/CONSUMERS lists, once run |
| `override` | `{head, count}`: the branch's `HEAD` and the chain's count when the user typed `override shim-<id>`; empty until then (R11) |
| `ended` | `complete`, set by a `complete` check, or `merged`; empty while the chain is open. An ended chain is not changed again |
| `seen` | per site id listed so far, the trees whose checks listed it (R12) |

### State

Derived from the stored fields and the branch's `HEAD`, never stored, for an open chain. Ordered; the first
match is the state.

1. `held`: `count` is 4 or more, and `override` is empty or `count` is above `override.count`.
2. `overridden`: `override.head` is the branch's `HEAD`.
3. `deep due`: `count` is 3 or more and `target` is empty.
4. `checked`: any other chain.

### Tree rule

The one place that says which bug a staged tree has to do with. The launch, the commit and a completed check
use it unchanged.

Input: the stored open chains of the repo and branch, the branch's `HEAD`, and the new-side ranges of the
staged tree's code or mixed hunks (R2). Every range of every open chain is carried to the staged tree (R9). The
tree matches a chain when one of its ranges overlaps a carried range.

A tree that matches several chains has to do with one bug, made of all of them (decision record 0014). The
bug's state is read in the order of the State list:

1. No chain is matched → the check may be launched in `sweep` mode, and the commit is decided by the tree's
   check.
2. A matched chain is `held` → the launch and the commit are both refused, with the question for the user.
3. None is `held` and one is `overridden` → the commit is allowed without a check. The launch is refused and
   names `git commit`, since the check is off for that bug.
4. Otherwise the merged chain is `deep due` → the check may be launched in `deep` mode.
5. Otherwise → the check may be launched, in `rejudge` mode against the merged chain's `target` when it has
   one, else in `sweep` mode.

In 4 and 5 the commit is decided by the tree's check.

The merged chain is a pure function of the matched chains. No field of it decides `held` or `overridden`;
clauses 2 and 3 read the matched chains themselves. For one matched chain it is that chain.

| Field of the merged chain | Value |
|---|---|
| `id` | that of the chain with the largest `count`; at equal counts, the smaller `id` |
| `count` | the largest, never the sum |
| `trees`, `ranges`, `seen` | the union |
| `target` | the union of the targets when every matched chain has one; else empty, so the deep sweep runs for the whole bug |
| `override` | the matched override with the largest `count`; empty when no matched chain has one |

The merged chain is stored at two events only: an allowed launch (clauses 4 and 5) and the user's override by
tree id. Every other matched chain then gets `ended: merged`, and the rows of `shim_rulings` of every matched
chain are keyed again to the merged chain; a site ruled differently in two of them loses its ruling and is
judged again. A stored merge never makes a bug `held`: at an allowed launch no matched chain is `held`, so the
chain with the largest `count` is below 4 or has an override at that count or above, and the merged chain
keeps the largest one.

The user's override has two forms, and each reads something different:

- `override shim-<chain id>` reads the ledger only. It sets `override` on that one chain and merges nothing.
- `override shim-<tree id>` reads the staged tree and every chain it matches. It stores the merged chain and
  sets its `override`. For a tree that matches no chain it opens one seeded with that tree's hunk ranges, with
  `count` 0.

Both set `override` to the branch's `HEAD` and the chain's `count`. A refusal prints the form that, once typed,
lets that same staged tree commit: the chain id when the tree matches one chain, the tree id when it matches
several or none.

### Transitions

A completed check is applied to the merged chain stored at its launch. The column is that chain's state before
the check. The state after an event is read from the State list.

A `held` or `overridden` chain is changed by the user's override and by nothing else: clauses 2 and 3 of the
tree rule refuse the launch of every tree that matches one, so no check reaches it and no launch stores a
merge over it, and a check that was already running writes nothing to it. A commit writes nothing; an
`overridden` chain is then in the state the list gives for its count.

| Event | `checked` | `deep due` |
|---|---|---|
| An allowed launch | the merged chain is stored; `ranges` are stored as carried to the staged tree, with that `tree` | the same |
| A `sweep` or `rejudge` check ends `patch` on a tree not in `trees` | its hunk ranges and listed sites are added to `ranges`, the tree to `trees`; `count` rises by one | cannot occur: clause 4 launches `deep` mode for a `deep due` chain |
| The `deep` check ends `patch` | cannot occur: only clause 4 launches `deep` mode | `target` is set, its sites are added to `ranges` and the tree to `trees`; `count` is unchanged |
| A check ends `patch` on a tree in `trees` (a restart, a contest) | `ranges` and `seen` are brought up to date; nothing is counted | the same |
| A check ends `complete` | `ended: complete` | `ended: complete` |
| A check fails or is replaced | nothing written | nothing written |
| The user's override, by chain id or by tree id | `override` is set as the tree rule says | the same |
| A commit, an amend or a rebase lands | nothing written | nothing written |

The user's override on a `held` or `overridden` chain sets `override` the same way, so a `held` chain is then
`overridden`.

A `patch` check under clause 1 opens a chain at count 1.

So a bug overridden at the 4th refusal or later is not `held` once the commit lands: its next tree is checked,
a `complete` ends it, and the next `patch` that counts makes it `held` at once. When a merge has emptied its
`target` it is `deep due` first, and the deep check's `patch` counts nothing. A bug overridden earlier goes on
from its count: the deep sweep is still due at 3 if it has not run, and it is `held` at 4.

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
step → `complete`: allow. Every refusal names the `override shim-<id>` form the tree rule gives (R11). The chains are passed in with their
ranges already carried, so the function stays pure.
