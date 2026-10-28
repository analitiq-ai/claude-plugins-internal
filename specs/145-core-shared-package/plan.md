# Implementation Plan: core, the shared package every Codeworks component imports

**Branch**: `145-spec` (#145) | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/145-core-shared-package/spec.md`

## Summary

`core/` becomes a TypeScript package run by Node's type stripping, with no build step. Its shipped part,
`core/src/`, reaches a plugin through a symlink a git-hosted marketplace install copies; the plugin pins core's
three runtime dependencies (zod, smol-toml, yaml) in its own `package.json` and lockfile, which Claude Code
installs. A guard makes a hook refuse when a dependency is missing; the Stop hook's refusal fails open. CI checks
every carrier's link and pins, and fails a change to `core/src` or its pins unless every carrier bumps its
`version`. core holds: a GitHub client taking its token from the caller, with GitHub's clock; one git runner with
no global config or credential helper; the branch grammar, story identity and DONE; eight value sets as Zod enums
and the finding-source grammar; three Zod contracts (Finding, Snapshot, SpecFacts) with generated, drift-checked
JSON Schemas; `codeworks.toml` `[shared]`, with the board and the four App logins; the state module (the reviewer
App's newest comment, whatever its body; read, rounds, hold placement stamped with GitHub's time, the rescope hold
keyed by its spec PR, release; a new comment each time; one working snapshot for every answer; the one release
rule, a Ready move on the board and an admin's comment after the hold, or `/codeworks reset`,
naming the releasing comment); attestation from a stage 1 round in the head's history, lapsing on changed
governing documents, a merge other than git's clean one, or a comment release; the validator contract, loading
each package of `validators/<name>/` that `[shared] validators` lists, with PASS and FAIL only for the head asked
and SILENT at the caller's `review_timeout`; the threads module, which never counts a codeworks App, and the
required-checks reader, each returning COULD_NOT_RUN as an outcome; key reading behind the managed-settings gate,
one source, exempt only for the planner App's key on the admin machine; token minting for the four Apps. No
command, no carrier and no provider package in this spec. One PR per story: US1, US2, US3, US5; `tests.yml` in admin PRs of their own (R6). Decisions in
[research.md](research.md), shapes in [data-model.md](data-model.md), interfaces in [contracts/](contracts/).

## Technical Context

**Language/Version**: TypeScript, run by Node ≥ 22.18 type stripping (planning machine: Node 22.18.0); type
checked by `tsc` 7.0.2 (R1)

**Primary Dependencies**: runtime `zod` 4.6.7, `smol-toml` 1.9.1, `yaml` 2.9.1, each exact, none with dependencies
of its own (R2); otherwise Node's `fetch`, `node:crypto`, `node:child_process`, `node:fs`, `node:test`; git 2.38 or
later for `merge-tree --write-tree` (planning machine: 2.47.3; R16)

**Storage**: GitHub (state comments on story issues); key files in `~/.config/codeworks/`

**Testing**: `node --test` in `core/tests/` after `tsc`, run by CI's matrix through a node branch for that suite
(R6); pure rules on fixtures; GitHub through a recorded fake client or a local HTTP server; git in scratch
repositories; the validator contract on a fixture package (R20); each test seen to fail first

**Target Platform**: Linux, on the agent machine, and on the admin machine for the planner App's mint; checked
key reads refuse other platforms (R23)

**Project Type**: library carried by plugins; no command

**Performance Goals**: none set. Measured while planning: a `.ts` hook starts in about 84 ms bare and 155 ms
importing all three dependencies, so a hook imports only the core modules it uses

**Constraints**: a hook that runs core blocks on any failure (`onFailure: "block"`, exit 2), but the Stop hook,
which exits 1 and fails open (R4); no fallback credential or ambient gh login (R12); no state comment edited or
deleted (FR-018); COULD_NOT_RUN never reads as PASS, FAIL or an empty list (FR-024); no environment variable reads
a setting (FR-006); core imports no component (FR-005) and no provider logic (root ADR-0003 d6); only erasable
TypeScript (R1)

**Scale/Scope**: new `core/` (about 16 modules, 3 schemas, tests, a fixture plugin, a fixture validator package, 2
repo scripts); `.github/workflows/tests.yml`, in admin PRs (R6); `.gitignore`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | New shapes, Finding, Snapshot, SpecFacts, the value sets, the finding-source grammar, the hold-question tag and the validator contract, none in the org contracts map. Each is defined once in core: a Zod schema or enum with its JSON Schema generated (R7, R8), the tag by `questionTag`, which the orchestrator writes with and core reads by (R27), the contract by `validation/contract.ts`, which every package meets (R18). See Complexity Tracking. |
| II. Ownership & trust boundaries | core lives in this repo's `core/` (root ADR-0001); provider logic lives in each package in `validators/<name>/`, which reaches core only through the contract and the `deps` it is handed (R18); `codeworks.toml`, comments, timeline events, GitHub answers, front matter, a package's answers and the managed settings file are validated where read (R9, R14, R15, R19, R23). Tokens come from callers and key files. Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | No fallback: a mint to another credential, an untagged, edited or deleted newest state comment to an older one for the held answer, a board the reader cannot see to "no Ready", a missing dependency to running anyway, a second managed-settings source to the file alone (R4, R15, R23, R24). Missing spec facts fail (R9); a package missing a part of the contract fails to load (R18). Pass. |
| IV. Test-first | Every rule is a pure function tested on fixtures before code, the release rule's fixtures fed to the orchestrator's read and reviewer's release alike (SC-002); GitHub through a recorded fake; git in scratch repositories; the contract on a fixture package; tests pin the schemas, `SECURITY.md` §3 and §5, and the value strings (R7, R8, R16, R20, R23, R24, R27). Pass. |
| V. Smallest complete change | Each story adds only its modules (R26); no carrier, no provider package and no switch of a component to core (spec Assumptions); three dependencies, the rest from Node and git (R2). Pass. |
| VI. Governing rule ships apart | No rule file changes. `check-carriers.ts` governs carriers, of which none exists, so it lands before any code it grades. `values.ts` and the value-string test land in US1 with `SpecKind` and `RootCauseObserved`, the first code they grade, and before the US2 and US3 code that uses the other values. The import and no-command tests land in US1 with the first code they grade, and each drift test with what it pins: see Complexity Tracking. |
| P1, P3 (reviewer, planner) | Not core's; core gives them pure functions with thin readers (R10–R22), and every refusal names its cause and release (R4, R16). |
| P2. Only an approved entity releases a hold | core adds no hold kind. Its writes never drop a hold row (R16). The approver is an admin: an admin's comment after the hold with a Ready move on the board, whoever made it, or an admin's reset, as reviewer ADR-0013 d2, d3 and ADR-0011 d2 name; one function decides it over one working snapshot (R15, R27), and only `releaseOnClaim`, called by reviewer's hook on the claim, moves a row OPEN → RELEASED. No codeworks App's comment counts, and no move on another project. Tampered state reads as held exactly as P2 lists it (R15). Pass. |
| P4. Could not run is its own outcome | COULD_NOT_RUN is a check-outcome value core returns over every module and from the required-checks reader; WAIVED passes through from a package (root ADR-0003 d6; R19). Identity and state reads that get no answer throw, so their caller does nothing (R12). Pass. |
| P5. Settled design, existing tools first | Every mechanism below cites an R with Existing tools. Pass. |
| P6. One writer per state | State comment: reviewer's hook as the reviewer App (R16). A hold's question comment: the orchestrator's App (orchestrator ADR-0010 d1), core reading it (R27). A provider's review request: a package's `trigger`, with the writer the orchestrator's hook passes (R18, R19). A carrier's version: the PR that changes core (R5). Pass. |
| P7. Facts as data | Core reads no review text: a provider's verdict is read in its package alone (root ADR-0003 d6). Spec facts from front matter keys (R9). The state tag decides validity, not which comment is state (R15). The release rule reads a status name, a project URL, an author login, an association, an edit marker, a tagged first line and the exact command `/codeworks reset`, never wording (R27). Pass. |
| P8. Generic over repositories | Per-repo values in `[shared]`, the board and the four App logins among them; provider logins come from their packages. Pass. |
| P9. Trust only named identities | Threads trusted by the first comment author's login; no codeworks App ever (R21); state comments by `Bot` type and login (R15); an admin by the author's repository role and none of the four App logins, a Ready move by its board alone (R27); done by a `User` closer with write permission (R13). Pass. |

Re-check after Phase 1: unchanged. The contracts add no shape beyond the three schemas, the value sets, the
finding-source grammar, the hold-question tag and the validator contract.

## Project Structure

### Documentation (this feature)

```text
specs/145-core-shared-package/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api.md
│   ├── carrying-core.md
│   ├── state-comment.md
│   ├── codeworks-toml.md
│   └── key-files.md
├── checklists/requirements.md
├── critiques/
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
core/
├── package.json                # private, "type": "module", engines node >=22.18, exact pins, no bin (R2, R25)    US1
├── package-lock.json                                                                                          US1
├── tsconfig.json               # strict, noEmit, erasableSyntaxOnly (R1)                                      US1
├── src/                        # the package; a carrier's core symlink names it
│   ├── guard.ts                # requireDependencies (R4)                                                     US1
│   ├── github.ts               # client, GitHubUnanswered, GitHubRefused (R12)                                US1
│   ├── git.ts                  # runGit, GitFailed (R11)                                                      US1
│   ├── tree.ts                 # Tree, gitTree, gitHubTree (R11)                                              US1
│   ├── identity.ts             # branch grammar, spec issue and folder, PR, requirement, done (R10, R13)      US1
│   ├── values.ts               # the eight value sets, the finding source (R7)                                US1
│   ├── contracts/
│   │   ├── spec-facts.ts       # (R9)                                                                         US1
│   │   ├── snapshot.ts         # (R8)                                                                         US2
│   │   └── finding.ts          # (R8)                                                                         US3
│   ├── settings.ts             # codeworks.toml, Shared (R14)                                                 US2
│   ├── state.ts                # read, write, place holds, release rule, release (R15, R16, R27)              US2
│   ├── attest.ts               # attestation and its lapses (R16)                                             US2
│   ├── outcomes.ts             # required checks' GitHub states → check outcome (R17)                         US3
│   ├── validation/                                                                                            US3
│   │   ├── contract.ts         # loadValidators; trigger, status, findings over a module (R18, R19)
│   │   ├── threads.ts          # reviewThreads, threadsModule (R21)
│   │   └── required-checks.ts  # (R22)
│   ├── keys.ts                 # key files, the managed-settings gate (R23)                                   US3
│   └── tokens.ts               # mint for the four Apps (R24)                                                 US5
├── schemas/{spec-facts,snapshot,finding}.schema.json   # generated (R8)
├── scripts/
│   ├── write-schemas.ts        # (R8)                                                                         US1
│   └── check-carriers.ts       # link, pins, bumps (R5)                                                       US1
├── tests/
│   └── fixtures/
│       ├── carrier-plugin/     # a plugin with core → ../../../src, package.json, lockfile, hook              US1
│       └── validators/fixture/ # a package meeting the contract, answering what each test sets (R20)          US3
└── docs/adr/
.github/workflows/tests.yml     # node branch for core/tests; carriers job (R6)                              admin
.gitignore                      # + node_modules/                                                              US1
```

**Structure Decision**: `core/` at the root beside the components (root ADR-0001 d1, d2; FR-001), with `src/` as
the package a carrier links. `validators/` is not created: no package is built in this spec. Existing files this
plan changes, and their callers: `.github/workflows/tests.yml`, run by GitHub Actions on `pull_request` and on
push to `main`, whose matrix run step today runs `python -m unittest -v` for every suite, so it branches for
`core/tests`, in admin PRs of their own, since a story never changes `.github/` (reviewer ADR-0002 d4; R6);
`.gitignore`, read by git. Nothing else existing is edited. Every new core function has no
caller in this repo but its tests and the fixtures; the components' switch to core is follow-up work (spec
Assumptions).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New contracts, Finding, Snapshot, SpecFacts, the value sets, the finding-source grammar, the hold-question tag and the validator contract, not in the org contracts map (Principle I) | root ADR-0003 d1, d3, d6, ADR-0009 d1, ADR-0010 and planner ADR-0008 d1 decide them, in core, as Zod schemas with generated JSON Schemas, and the validator contract as the one interface every package meets; the tag is the one key by which core's release rule finds the question orchestrator ADR-0010 d1 has the orchestrator post. Codeworks-internal shapes no org artifact covers. Each is defined once | an adapter against an existing contract: none covers review findings, reviewer state, spec facts, these values, a validator or the question; a copy per component: what root ADR-0003, ADR-0005 and ADR-0010 exist to stop; the orchestrator's own key format read by core: core would import a component's rule (FR-005) |
| Each schema's drift test lands in the PR that adds its schema (Principle VI) | the test compares a file to what the schema generates; it grades no design choice and has nothing to check before the schema exists. FR-013 asks for it | an earlier PR: fails on a schema that does not exist; a later one: a schema merges unchecked |
| The import and no-command tests land in US1 with the first `core/src` code (Principle VI) | a new package has no earlier code to grade; each test is proven red on a fixture (an outside import, a `commands/` folder) before it passes, and later stories' code is graded by it unchanged | a PR holding only the tests: grades an empty folder, and proves nothing the red fixture does not |
| The value-string test lands in US1 with `values.ts` and `SpecKind` and `RootCauseObserved`, the first code it grades (Principle VI) | the values are new, so there is no earlier code to grade; the test fails on a value's string quoted outside the file that defines it (R7), is proven red on a fixture holding one before it passes, and grades US2's and US3's code unchanged | a PR holding only the test: grades values that do not exist; a later one: US1's code merges unchecked |
| The tests pinning core's tables to `SECURITY.md` §3 and §5 land with `keys.ts` and `tokens.ts` (Principle VI) | drift tests, like the schema ones: they compare a table to the document it copies and have nothing to compare before the table exists | an earlier PR: no table; a later one: a table merges unchecked |

## Open points

Open, from research:
1. Whether US1's end-to-end install test can run in CI (research Open 1); else it is a recorded manual check.
2. Claude Code's dependency install under the agent machine's managed settings (research Open 2); matters from
   the first carrier.

Readings of the spec, stated so they can be checked:
- FR-004 "a change to `core/`" is read as a change to what a carrier ships: `core/src/**` or core's dependency
  pins (R5).
- FR-006 "the raw text of its own section" is read as the section parsed and unvalidated (R14).
- FR-016 "since that round" is read, for a release, as a hold row's `released` after the round's `at`; and "a merge
  of the default branch" as every merge commit between the round's commit and the head, a story branch merging
  only the default branch (builder ADR-0004).
- FR-019a "newer than the state comment that placed it" is read as a later second than the row's `since`,
  GitHub's time just before that comment's post (R16, R27).
- FR-019a "the comment that releases it" is read as the reset, or else the newest admin comment meeting the rule.
- FR-019b is read as written: a reset after a hold's `since` makes it releasable with no Ready condition of its
  own; the claim it releases on comes from Ready anyway (reviewer ADR-0013 d3).
- FR-012's "an escalation hold's question" is the text the orchestrator posts (orchestrator ADR-0010 d1); the
  snapshot carries it so the orchestrator reads it through core.
- FR-036's App IDs: core validates none; each component's spec names its ID keys in its own section.
- FR-016 "deleted after the state comment" counts a deletion in the same second as after: GitHub's times are
  whole seconds, so the order is unknown and the story is held (R15).

Deferred, not in scope: `.deepsource.toml` has no JavaScript analyzer and names `dev/*/tests/**`, so DeepSource
will not analyse `core/`.

## Mechanisms

- TypeScript by type stripping, erasable syntax only, `tsc` check: R1
- `core/` layout, three pinned dependencies, Node built-ins for HTTP, signing and tests: R2
- A carrier's symlink, `"type": "module"`, pinned `package.json` and lockfile: R3
- `guard.ts`, the hook import order, Stop failing open: R4
- `check-carriers.ts`: link, pins, version bumps: R5
- CI runs core's suite with node, and the carriers job: R6
- Value sets as Zod enums, the finding-source grammar, value-string test: R7
- Zod contracts, generated JSON Schemas, drift test: R8
- Spec facts from `spec.md` front matter: R9
- Branch grammar `parseBranch`: R10
- `runGit` with no global config or credential helper; `Tree` with `gitTree` and `gitHubTree`: R11
- GitHub client over `fetch`, reader and writer, the no-answer signal, GitHub's clock: R12
- Spec issue, spec folder, story PR, requirement, done: R13
- `codeworks.toml` and the `Shared` schema, `board` included: R14
- State read: the reviewer App's newest comment, causes, the working snapshot, the board's visibility: R15
- State write, hold placement stamped with GitHub's time, the rescope hold by spec PR, release on the claim, attestation and its lapses: R16
- Required checks' GitHub states to check outcomes: R17
- The validator contract and loading a package: R18
- Core's answers over a module: head check, SILENT, findings validation: R19
- The fixture validator package: R20
- Threads module, one thread reader, the trust split: R21
- Required-checks reader: R22
- Key files and the managed-settings gate, one source: R23
- App token minting and permission sets: R24
- No commands, import boundary test: R25
- One PR per story, US1 → US2 → US3 → US5: R26
- The release rule, one function for the orchestrator and reviewer: R27
