# Implementation Plan: A held region stays the same through rewording

**Branch**: `feat/17-lineage-count` (#17) | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/018-lineage-count/spec.md`

## Summary

Both commit checks count failed rulings and stop for the user at a bound. Today the claim check counts per
hunk under `HEAD`'s tree and the shim check per chain under the `HEAD` commit, so a commit of anything else
starts both again. This plan moves each count onto a lineage: a record minted at the first failed ruling,
found by repo and branch, and carried from one version of the file to the next by a diff of the two versions.

One new pure module, `lineage.py`, answers "where is this text in the next version": lines outside the changed
ranges shift, text inside a rewritten range is mapped by `diff-match-patch`. The claim check uses it for
sentences, the shim check for line ranges. The hunk hold, its line ranges and `touches` matching are deleted
from the claim check. Bugs that one staged change overlaps become one (ADR-0014). A refusal of a patch lists
the lines the staged change alters in each site's file, in place of the `touched` mark.

Decisions are in [research.md](research.md), shapes in [data-model.md](data-model.md), the module's functions,
the refusals and the test sequences in [contracts/lineage.md](contracts/lineage.md).

Some decisions in research.md are marked **Derived**: they follow from #17 and the ADRs but the user has not
said them. They are listed under Open points.

## Technical Context

**Language/Version**: Python 3 (CI runs 3.13), as the rest of `scripts/`

**Primary Dependencies**: `diff-match-patch`, new, installed not vendored (ADR-0001 Option N). It is the
plugin's first import from outside the standard library on the hook path; the README's Dependencies section
says there is none today and changes with this. Git, as today

**Storage**: `ledger.db` under the state root. New tables `claim_lineages`, `shim_bugs`, `seen_files`.
`claim_holds` and `shim_chains` are no longer created or read; their rows are left (R14)

**Testing**: `python3 -m unittest discover -s tests` in `dev/alq-review/`. The contract's sequence tables are
the test list: one failing test per row before any code. `tests.yml` installs the library, pinned

**Target Platform**: any machine running Claude Code with the plugin enabled

**Project Type**: Claude Code plugin (hooks, workflows, agents)

**Performance Goals**: a file with no open lineage or bug costs nothing new. A file with one costs two
`git hash-object`, one `git diff` and one character diff per rewritten range that holds its text, inside the
hook's 60 s; a mapping over its budget is a failed check, not a pass (R4). Not measured; R4 names the measurement

**Constraints**: nothing keyed on `HEAD`, a tree or a commit; no model and no similarity threshold decides
succession (ADR-0001 point 4); the mapping is a function of the two texts alone (R4); a missing library
refuses, never passes (ADR-0009)

**Scale/Scope**: one new module; `claimcheck.py`, `claimgate.py`, `shimcheck.py`, `shimgate.py`, `ledger.py`,
`worktree.py`, the README and `tests.yml` change. Workflows, agents and briefs do not

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | No shape from the contracts map is added. The lineage and bug docs are defined once, in `data-model.md` and `ledger.py`. Pass. |
| II. Ownership & trust boundaries | All in alq-review, this repo. The file texts and reader quotes the mapping takes are the ones the gate already validates. Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | No migration and no reader for old rows (R14). A missing library refuses (R13). A quote that cannot be found in its file raises (R5). Three places where this layer cannot meet the rule are named with the real fix: a site is one line (R9), an unmeasured cost (R4), the install command on a system-managed Python (R13). Pass. |
| IV. Test-first | The contract's 29 sequences are written and seen to fail first (R15). The mapping is a pure function tested without git. Pass. |
| V. Smallest complete change | One module. The hunk hold is deleted, not kept beside the lineage: `touches`, `find_hold`, `hunk_state`, `_refuse_hunk`, `_name_claims`, `count_refusals`, `standing`, `release`, `_old_side`, `Claims.holds`, `save_holds`, `claim_holders`, `chains_at`, `shimcheck.touched`. Pass. |
| VI. Governing rule ships apart | No rule file, lint, guard or schema check changes. The README describes the plugin and changes with it, its sentence on imports included: no test or hook enforces that sentence. `tests.yml` gains one install line and grades nothing differently. The note ADR-0001 needs on merging is a decision record and goes in its own PR. Pass. |
| P1. Code decides | Succession, count, hold and release are computed on the hook path. Each refusal names its next step: `unlock`, `override`, or the install command. Pass. |
| P2. Only an approved entity releases a hold | Claim lineage: the user, `unlock claim-<id>`. Bug: the user, `override shim-<id>`. Nothing else lowers a count. A lineage ends, without the user, on `CORRECT` or deletion, which ADR-0001 point 3 names as the end of the churn. A moved file and a moved-and-reworded sentence start a count again: see Complexity Tracking. |
| P3. Rules are pure | `lineage.py` does no I/O. Count, hold and merge live in `claimcheck.py` and `shimcheck.py`. The handlers read git and the ledger, call them and save. Pass. |
| P4. A check that could not run is its own outcome | The missing library is a failed check with a next step, in both checks, at launch and at commit (R13). Pass. |
| P5. Settled design | Every mechanism below cites a decision with its existing tools. R3, R4 and R13 each hold a fact to measure as a first task. Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/018-lineage-count/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/lineage.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
plugins/alq-review/
├── scripts/
│   ├── lineage.py        # new: span_of, carry, succeed, differ
│   ├── claimcheck.py     # the hunk-hold section replaced by count, held, release, the chain's wording
│   ├── claimgate.py      # launch and commit carry without saving; completion and contests settle lineages
│   ├── shimcheck.py      # range overlap moves in; merge; altered ranges; held at 4 or more
│   ├── shimgate.py       # bugs found by branch; ranges carried; override ends on a commit of the bug's code
│   ├── ledger.py         # claim_lineages, shim_bugs, seen_files; holds and chains_at removed
│   └── worktree.py       # text_hunks
└── README.md             # items 7 and 8, State, Layout, Dependencies

.github/workflows/tests.yml     # installs diff-match-patch, pinned

dev/alq-review/tests/
├── test_lineage.py       # new: the pure sequences
├── test_claim_gate.py    # #15, #16, amend, unlock then reword, moved file, missing library
├── test_claimcheck.py    # hold tests replaced by count and held
├── test_shim_gate.py     # two tests rewritten; bug across a commit, converge, override, altered ranges
└── test_shimcheck.py     # touched replaced by altered; merge
```

**Structure Decision**: the plugin's existing layout, one PR. Callers of what changes, read in the code:
`claimcheck`'s hold functions are called only from `claimgate` (`_completed`, `on_commit`, `on_launch`,
`after_output`, `on_prompt`) and, for `touches`, from `shimcheck.overlaps`; `Shims.chains_at` only from
`shimgate` (`on_commit`, `on_launch`, `_save`, `_override_tree`) and the tests; `shimcheck.touched` only from
`_patch_report`; `gate.py` reaches both gates through `on_bash`, `on_workflow`, the output handlers and
`_on_release`, and does not change.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| P2: a file moved to a new path starts its claims' counts again without the user | ADR-0013 decides it | Carrying the count needs old and new path paired, which git does by a similarity index (ADR-0013 Option C, ADR-0001 point 4) |
| P2: a sentence moved and reworded in one step, and the far half of a split, start at 1 | ADR-0001's known gap, accepted in the spec's Assumptions | Following them needs similarity matching (ADR-0001 Option H) |

## Open points

Derived, for the user to confirm; the plan is written as if each stands:

1. A check moves a file's lineages only when that file is in the check. Otherwise unstaging the wrong words to
   commit something else would end the lineage (R2).
2. Text that is still there but that no reader quoted keeps its lineage open (R6).
3. The first words of an open lineage, ruled `WRONG` again, join it; an ended lineage is never reopened (R1).
4. An upheld contest lowers no count, and a held lineage stays held when reworded (R7).
5. An override of a bug lasts until a commit changes that bug's code (R11).
6. Converging bugs at 1 and 3 are one bug at 3, and the patch that merged them then counts once, to 4 (R10).
7. A file the staged tree and the checkout both lack has its lineages ended `deleted`; a file only unstaged keeps
   them (R2).

To measure first: git's header for two blobs (R3), the character diff's time on a large range (R4), the
install command and the version to pin (R13).

To file: a site is one line, so a patch lower in the function does not match its bug by the site (R9).

## Mechanisms

- A claim's lineage record, named by its first WRONG words and kept when it ends: R1
- The seen text of a file, advanced only by a completed check that had the file: R2
- The diff of two versions of a file by git, as blobs written from text: R3
- Carrying a span: shifted outside the changed ranges, mapped by diff-match-patch inside them: R4
- Finding a sentence's character span from its line and quote: R5
- Inheritance by place and by id, split, merge at the higher count, and the two ways a lineage ends: R6
- The count as distinct refs of WRONG rulings and rejected contests, the hold at 3, and a release tied to the words: R7
- The hold decided at launch and at commit by carrying without saving, shown with the whole chain: R8
- Bugs found by branch with ranges carried across commits, and no key on HEAD: R9
- Bugs overlapped by one staged change merged into one at the higher count: R10
- An override that ends when a commit changes the bug's code: R11
- The altered line ranges per site in a patch refusal, replacing the touched mark: R12
- The required diff library, its guarded import and the refusal that names its install: R13
- New tables for the new shapes, with the old rows neither read nor deleted: R14
- Sequence tests written first, and the two shim tests rewritten: R15
