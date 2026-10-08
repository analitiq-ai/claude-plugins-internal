# Research: a held region stays the same through rewording

Read for this: `plugins/alq-review/scripts/{claimcheck,claimgate,shimcheck,shimgate,ledger,worktree,gate,hookio}.py`,
`hooks/hooks.json`, the README, `.github/workflows/tests.yml`, `dev/alq-review/tests/test_{claim,shim}_gate.py`,
ADRs 0001, 0002, 0009, 0013, 0014, and issue #17 as pasted into the plan command. Issues #15 and #16 could not
be opened from this session, so their steps are taken from #17's Evidence and the spec.

Nothing below was run. `python3` and `gh` calls were not permitted in the session that wrote this, so every
statement about `diff-match-patch` and about git's output for two blobs is from reading and from memory, and is
marked **To measure** where a task has to confirm it before the code that rests on it.

A decision marked **Derived** is not in #17 or an ADR. It follows from them, but the user has not said it.

## R1: A claim's lineage is one record, named by its first WRONG words, kept when it ends

- **Decision**: one row per lineage in a new table `claim_lineages (repo, branch, id, opened)`. `id` is the
  claim id of the version first ruled `WRONG`; `opened` is the ref of the check that minted it. The count is not
  stored: it is computed from the chain (R7). A lineage that ends keeps its row with `state: ended` and the
  reason (`correct`, `deleted`, `merged`). **Derived**: a branch has at most one open lineage per id, so a claim
  ruled `WRONG` whose own id is an open lineage's id joins that lineage; an ended lineage is never opened
  again, so the same words ruled `WRONG` later mint a new row with a new `opened`.
- **Rationale**: #17 D1 and ADR-0001 point 1 give the id and say it is carried. They do not say what happens
  when the first words come back: a lineage reworded from W1 to W2 and a new sentence W1 elsewhere would both be
  `claim-<hash of W1>`. Joining is the reading that keeps one id meaning one lineage. `opened` in the key is
  what lets an ended row stay (ADR-0002 point 5, FR-018) while US1-4 still starts the next one at 1.
- **Existing tools**: `claimcheck.claim_id`: the id, reused unchanged. `ledger._Records._get/_put`: one JSON
  doc per key, reused. `claim_holds (repo, base, file)`: keyed on `HEAD`'s tree and shaped as hunks, which is
  the defect; not reused (R14).

## R2: "The previous check" is the last completed check that had the file in it

- **Decision**: a new table `seen_files (repo, branch, gate, file)` keeps the file's text as the last
  completed check of that gate on that branch saw it. A check moves a file's lineages, and replaces its seen
  text, only when the file is among its staged hunks, and only when it completes. **Derived**: a file that is
  not in the check is left alone, lineages and seen text both. That includes a file that was deleted or moved
  away: its lineages stay open and unused, and are not marked ended.
- **Rationale**: this is what makes #15 hold. To commit another file the agent must unstage the wrong words, so
  the check of that commit sees the file as `HEAD` has it. Diffing that against the last version would read the
  claim as deleted, end the lineage, and start the words at 1 when they are staged again: the same reset by
  another route. Leaving the file alone keeps the count at 2 (US1-2). The text is kept, not a blob id, because
  wrong words never reach a commit: their blob is unreachable and `git gc` prunes it after two weeks, and a
  check that then cannot map has no next step that can succeed (ADR-0009 point 3). Advancing at completion,
  inside the ledger's transaction, means a check that is replaced before it completes moves nothing.
- **Existing tools**: `worktree.tree_text`: reads the staged file; reused, and `claimgate._reader_of` already
  caches it per check. `claim_checks (repo, tree)`: holds a tree id from which the text could be read again, but
  only while git keeps the objects; not enough alone. `shim_checks.doc.diff`: the precedent for source text in
  the store (ADR-0002, Trade-offs).

## R3: The two versions are diffed by git, as blobs

- **Decision**: `worktree.text_hunks(root, old, new)` writes both texts as blobs with
  `git hash-object -w --stdin`, runs `git diff -U0 <old blob> <new blob>` and returns what the existing
  `_hunks` parser gives. Both sides come from text the gate holds, so the diff never depends on which objects
  git kept.
- **Rationale**: ADR-0001 point 2 decides git's diff of two blobs. Hashing both sides from text gives one path
  with no fallback; for a file read as it was written the blob already exists and nothing is added.
  `git write-tree` in `worktree.staged_tree` already writes objects, so the gate writes nothing of a new kind.
- **Existing tools**: `worktree._hunks`, `worktree._stdin`: reused. `git diff --no-index`: needs two files on
  disk outside the repo and exits 1 on a difference; not used. `difflib.unified_diff`: a second differ beside
  git's, whose hunks would not agree with the ones the check reads; not used.
- **Measured** (git 2.47.3, 2026-10-08): `git diff -U0 <old blob> <new blob>` prints `diff --git a/<sha> b/<sha>`, `---`, `+++ b/<sha>` and the
  hunks; `_hunks` reads it and gives each hunk's `file` as the new blob's sha, with removed and added lines. Nothing to change.

## R4: A span is carried by shifting outside the changed ranges and by `diff-match-patch` inside them

- **Decision**: `lineage.carry(spans, old, new, hunks)` maps each end of a character span on its own. An offset
  on a line outside every hunk keeps its column and moves by the lines earlier hunks added or removed. An offset
  inside a replaced range is mapped by `diff_main(removed, added)` with `Diff_Timeout = 0`, then
  `diff_cleanupSemantic`, then `diff_xIndex`. An offset inside a pure deletion maps to the point where the text
  was. A span whose two ends meet is gone.
- **Rationale**: ADR-0001 point 2 and #17 D2, D8. Mapping the two ends apart covers a sentence that starts
  outside a hunk and ends inside one with no special case. `Diff_Timeout` defaults to one second, after which
  the library returns a coarser diff, so the answer would depend on the machine's speed; 0 makes it a function
  of the two texts. `diff_cleanupSemantic` takes no parameter and drops the chance one-letter matches that
  would smear a sentence's ends across its neighbours.
- **Existing tools**: `diff-match-patch`: `diff_main`, `diff_cleanupSemantic`, `diff_xIndex`; used.
  `worktree.Hunk`: gives each hunk's removed and added lines, the two texts the mapping needs; reused. For the
  shift past earlier hunks: None fit. Looked at: `worktree.added_lines`, `claimcheck.paragraph`, the survey of
  2026-10-06 in #17 (Gerrit, GitLab, Phabricator and Sourcegraph port comments this way but ship no library).
- **Measured** (`diff-match-patch` 20241021, `Diff_Timeout = 0`, Python 3.14, two unrelated texts of random words, the
  worst case; texts that share most of their words took 0.01 s for 200 lines): 2,558 chars each 0.69 s; 5,114
  chars 2.57 s; 12,673 chars 16.8 s. Time grows with the product of the two sizes, so a 2,000-line range cannot fit the
  hook's 60 s. The budget is therefore on size, not on the clock, which keeps the answer a function of the two
  texts: `lineage.CHAR_DIFF_BUDGET = 5 * 10**7`, the sum, over the replaced ranges one file's spans fall in, of `len(removed) *
  len(added)` characters (about 7,000 characters each side, about 5 s worst case). A change over it is a failed
  check that names the next step (split the change), never a pass: a hook killed by its timeout is not a
  refusal (constitution P4).

## R5: A sentence's span is found from the reader's line and quote

- **Decision**: `lineage.span_of(text, line, quote)` walks the file from the start of `line` and matches the
  words of `claimcheck.plain(quote)` in order, skipping white space and the comment marks `plain` drops. It
  returns the offsets of the first and last word matched, and raises when the words are not there.
- **Rationale**: a claim is stored as a line and a quote; the mapping needs offsets. The reader's quote is
  accepted only when `validate_reader` found those words from that line on, so a miss is a defect of the gate,
  not an input to tolerate.
- **Existing tools**: `claimcheck.plain`, `claimcheck._COMMENT_MARK`: the normalisation, reused so the span
  and the id agree on what the words are. `diff_match_patch.match_main`: a fuzzy locator with
  `Match_Threshold` and `Match_Distance`, which ADR-0001 point 4 rules out; not used. `str.find`: the quote is
  normalised and the file is not, so it misses a sentence that wraps. None fit. Looked at: those three.

## R6: What inherits a lineage, and when it ends

- **Decision**: `lineage.succeed(lineages, old, new, hunks, claims)` is the one function that answers. For
  each open lineage of the file, each place it holds is carried (R4). Then:
  - every claim whose span overlaps a carried place inherits the lineage; several is a split;
  - a claim that inherited nothing by place inherits by id, when its id is a lineage's id or the id of one of
    its places (the words moved unchanged, or R1's first words came back);
  - a claim that inherits several lineages merges them: the one with the higher count goes on, the others end
    as `merged` and name it;
  - a place carried to nothing, with no claim found by id, is dropped; a lineage with no place left ends as
    `deleted`;
  - **Derived**: a place carried to text that no claim was read in stays, moved, and the lineage stays open.
- **Rationale**: #17 D2 and ADR-0001 point 2 for the first four. The fifth is forced by how the check reads:
  it reads only the paragraphs of the staged hunks, and its readers are models. A sentence that is still there
  but outside the staged hunks, or that this reader did not quote, has not been ruled `CORRECT` and has not been
  deleted, which are the only two ends ADR-0001 gives a lineage.
- **Existing tools**: `claimcheck.find_hold` and `touches`: match by overlapping line ranges and return the
  first match, which is the defect "a hunk over two holds continues only the first"; not reused. None fit.
  Looked at: `claimcheck.py`, the survey in #17.

## R7: The count is the chain's WRONG rulings, by ref; a release covers the words it was typed for

- **Decision**: a chain entry is `{ref, claim, line, words, ruling}` plus the failing case and evidence of a
  `WRONG`. A check's ruling has the check's ref; the nth rejected contest of a claim in a check has
  `<check ref>/contest-<n>`. `claimcheck.count(lineage)` is the number of distinct refs whose ruling is `WRONG`
  and which the user had not released. Adding an entry whose ref is already there changes nothing. A lineage
  is held when its count is 3 or more and above the count it had when last released. `unlock claim-<id>`
  records the count and the ids of the words as they stand; a later `WRONG` on those same words is entered as
  released and neither counts nor refuses the commit. `CORRECT` removes the claim's place, and a lineage with
  no place left ends as `correct`. **Derived**: a contest that is upheld adds its ruling to the chain and
  removes nothing, so it lowers no count; a held lineage stays held when its words change, until the user
  releases it or the words are deleted.
- **Rationale**: #17 D3 and D4, FR-003 to FR-008. Refs make the second run of a check, and the second call of
  the completion step that #16 shows, add nothing. Comparing the count to the count at release is what makes
  D4 work without resetting anything: after `unlock` at 3 the lineage is free, and one more `WRONG` on new
  words is 4, above 3. Constitution P2 allows nothing but the user's release to lower a count, which settles
  the upheld contest and the reworded hold.
- **Existing tools**: `claimcheck.ruled_wrong`: the failing case and evidence of a verdict; reused for the
  entry. `claimcheck.REFUSALS_BEFORE_USER`: the bound, kept at 3. `claimcheck._refuse_hunk`, `hunk_state`,
  `release`: count an integer per hunk and release by patch-id; replaced. `claimcheck.check_ref`: the ref,
  reused.

## R8: A hold is decided at launch and at commit by carrying without saving

- **Decision**: `claimgate.on_launch` and `on_commit` read the staged text of each file in the staged hunks
  that has an open lineage, carry its places from the seen text (R3, R4), and refuse when a held lineage still
  has a place. They save nothing. The refusal lists the chain: each entry's place, words and ruling, the last
  failing case and evidence, and the `unlock` line.
- **Rationale**: a hold has to refuse before any reader runs ("do not try again"), and before the check of the
  staged tree exists. The decision is a pure function of the stored lineages, the two texts and git's diff
  (constitution P3). Saving at launch would move the seen text for a check that may never complete (R2).
- **Existing tools**: `claimcheck.standing` and `user_question`: decide and word today's hold from hunk
  ranges; the wording is kept and extended with the chain, the decision is replaced. `claimcheck.commit_decision`:
  kept, taking held lineages and released claim ids in place of held hunks and released hunk ids.

## R9: A bug is found by its branch, and its ranges are carried by the same mapping

- **Decision**: a bug's record moves to a new table `shim_bugs (repo, id)` without `head`; its id is
  `sha256(repo, branch, tree)[:16]` of the tree that opened it. `Shims.open_bugs(branch)` replaces
  `chains_at(branch, head)`. Ranges stay in the numbering of the tree a commit is measured against.
  `seen_files` (gate `shim`) keeps that tree's text for every file an open bug has a range in. Before bugs are
  matched, each such file whose text has changed is diffed (R3) and each range is carried as the span from the
  start of its first line to the end of its last (R4), then turned back into lines. A range carried to nothing
  is dropped; a bug with no range left ends. The carry is saved when a check settles its bugs, and computed
  without saving at launch and at commit. A check's own record stays valid only at the `HEAD` it swept.
- **Rationale**: #17 D5 and D6, FR-002, FR-019. A sweeper reads a copy of `HEAD` and a hunk is measured from
  `HEAD`, so the check record is about one `HEAD`; the bug is not. Using `carry` for lines keeps one definition
  of "the same place in the next version" for both gates.
- **Existing tools**: `lineage.carry` (R4): reused. `shimcheck.matching_chains`, `overlaps`,
  `settled_chains`: kept, fed carried ranges. `claimcheck.touches`: the range overlap they use; it moves into
  `shimcheck`, its only caller once claim holds have no ranges (#17 D5). `shimcheck.new_chain`: kept, without
  `head`.
- **Limit**: a site is still one line, the function's first, so a later patch inside the function below that
  line does not match the bug by its site. The sweeper reports no end line, so this layer cannot close it; the
  real fix is an end line in the sweeper's output. To be filed as its own issue.

## R10: Bugs that one staged change overlaps become one

- **Decision**: when a completed check matches more than one open bug, `shimcheck.settled_chains` merges them
  first: the bug with the higher count goes on with the ranges, counted trees and listed sites of all; the
  others take state `merged` and name it; their rulings on sites are copied under it where it has none. The
  merged bug is held if any was. An override on any of them is not carried. The check then counts once. An
  override lets a commit through only when the staged change reaches that bug and no other. **Derived**: the
  patch that merged two bugs counts on the merged bug, so bugs at 1 and 3 are one bug at 3 and then at 4.
- **Rationale**: ADR-0014 and FR-013; the spec's edge cases give the held and the released case. `_counted`
  sets `held` at exactly 4 today; a merged bug can pass 4 without landing on it, so it becomes "4 or more".
- **Existing tools**: `shimcheck.settled_chains`, `_with_ranges`, `_listed`, `_counted`: extended.
  `Shims.rulings`, `save_ruling`: reused for the copy.

## R11: An override lasts until a commit changes the bug's code

- **Decision**: **Derived.** An overridden bug stays overridden until its ranges are carried through a change
  of the tree commits are measured against. It then goes back to the state its count gives, count kept, so the
  next patch verdict on it holds again.
- **Rationale**: today an override ends when `HEAD` moves, because the chain is left behind. With nothing
  keyed on `HEAD` it would never end, and a bug's lines would go unchecked for good. FR-007 says a release
  covers what was released and the lineage goes on; for code, "what was released" is the change the user let
  through, and it has landed once the bug's own lines changed under a commit.
- **Existing tools**: `shimgate._override_chain`, `_override_tree`: reused; only what ends the state changes.
  The staged tree at the time of the keyword was looked at as the thing released: the prompt handler has no
  checkout, so it cannot read it. None fit beyond those. Looked at: `shimgate.on_prompt`, `ledger.checked_roots`.

## R12: A refusal shows the ranges the staged change alters in each site's file

- **Decision**: `shimcheck.altered(sites, hunks)` gives, per site, the staged hunks' line ranges in that
  site's file, in `HEAD`'s numbering like the site's own line. `_patch_report` prints them
  (`alters lines 333, 340-352 of this file`, or `this file is not in the staged change`) where it printed
  `touched` or `not touched`. `shimcheck.touched` is deleted.
- **Rationale**: #17 D6, FR-016. The gate knows a site's first line and nothing of where it ends, so it cannot
  say whether an edit is inside it. It can say exactly which lines changed and leave the reading to the agent.
- **Existing tools**: the staged hunks `commit_decision` already receives: reused. `shimcheck.touched`: the
  wrong mark; removed.

## R13: The diff library is required, looked for by the two checks, and its absence refuses

- **Decision**: `lineage.py` imports `diff_match_patch` inside the one function that builds the differ and
  raises `lineage.Unavailable` when the import fails. `claimgate` and `shimgate` call it first in `on_launch`
  and `on_commit`, whether or not a mapping is needed, and refuse through `refuse_claim` / `refuse_shim`: the
  check could not run, the work is not at fault, and the install step for the interpreter running the hook:
  `<sys.executable> -m pip install diff-match-patch` where pip can install into it, and where the interpreter is
  OS-managed (PEP 668: an `EXTERNALLY-MANAGED` file in its stdlib folder, outside a venv) the OS package
  `python3-diff-match-patch` (Debian and Ubuntu: `sudo apt install python3-diff-match-patch`) or a venv. The
  choice is a pure function, `lineage.install_step(executable, in_venv, externally_managed)`. CI installs a pinned version in `tests.yml`. The
  README's Dependencies section names the package and says which hooks need it.
- **Rationale**: #17 D7, FR-017, ADR-0009. An import at the top of the module would be reached from
  `gate.py`'s own imports, before `main()`'s guard: the hook would exit with a traceback, which Claude Code
  does not treat as a refusal, and every call would pass unchecked. Asking on every launch and commit keeps the
  outcome from depending on whether this change happens to touch a held sentence.
- **Existing tools**: `hookio.refuse_claim`, `refuse_shim`: reused, so `log` mode is respected.
  `gate.main`'s crash path: refuses, but tells the agent to set `ALQ_REVIEW_MODE=log`, the wrong next step
  here; not relied on. Vendoring the library: ADR-0001 Option N, rejected by the user.
- **Measured** (2026-10-08): latest release on PyPI is 20241021 (uploaded 2024-10-21): the CI pin. On the
  system `python3` of this machine (Debian, 3.13.5, `EXTERNALLY-MANAGED` present) the named command fails: that
  interpreter has no `pip` and no `ensurepip`, and `uv pip install --python /usr/bin/python3` is refused for the
  same reason (PEP 668). In a venv made with `uv venv --seed` the command succeeds. The distro package
  `python3-diff-match-patch` is 20241021-1, the same version. ADR-0009 point 3 needs the named step to be able to
  succeed, and the hooks run the system `python3` (`hooks/hooks.json`): which form the refusal names is open.

## R14: Records written before this change are not read and not deleted

- **Decision**: the new shapes get new tables (`claim_lineages`, `shim_bugs`, `seen_files`). `claim_holds` and
  `shim_chains` leave `SCHEMA` and no code reads them; rows already in a store stay until the user deletes
  them. `shim_rulings` is kept: its rows are keyed by a bug id and the new ids do not collide with the old.
- **Rationale**: ADR-0001, Trade-offs: no migration. ADR-0002 point 5: nothing but the user deletes a record.
  Reusing `shim_chains` would mix rows whose ranges are in a dead `HEAD`'s numbering with rows that are carried.
- **Existing tools**: `ledger.SCHEMA`, `CREATE TABLE IF NOT EXISTS`: reused. A migration: ruled out by
  ADR-0001 and by the project's rule against compatibility code.

## R15: The tests are sequences, written first

- **Decision**: `tests/test_lineage.py` walks the sequences of [contracts/lineage.md](contracts/lineage.md)
  through `lineage.succeed` and `claimcheck.count` with texts in the test, no git and no hook.
  `test_claim_gate.py` and `test_shim_gate.py` walk the ones that need commits (#15, #16, amend, the bug across
  a commit, converging bugs, the missing library) through hook payloads.
  `test_head_moving_leaves_the_chain_behind` and `test_one_patch_reaching_two_chains_counts_for_both` are
  rewritten to assert the opposite. Each is run and seen to fail for its stated reason before the code.
- **Rationale**: #17 D9, SC-001, constitution IV. The pure walks pin the mapping's rules, including the
  overlap rule of R6, which is the part most likely to be wrong and the cheapest to test.
- **Existing tools**: `test_claim_gate.ClaimGate`, `test_shim_gate.ShimChain.checked`: the harnesses, reused.
  `test_claimcheck.py`'s hold tests: assert the hunk hold; deleted with it.
