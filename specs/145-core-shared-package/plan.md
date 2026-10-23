# Implementation Plan: core, the shared package every Codeworks component imports

**Branch**: `145-spec` (#145) | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/145-core-shared-package/spec.md`

## Summary

`core/` becomes a TypeScript package run by Node's type stripping, with no build step. Its shipped part,
`core/src/`, reaches a plugin through a symlink a git-hosted marketplace install copies; the plugin pins core's
three runtime dependencies (zod, smol-toml, yaml) in its own `package.json` and lockfile, which Claude Code
installs. A guard makes a hook refuse when a dependency is missing. CI checks every carrier's link and pins, and
fails a change to `core/src` or its pins unless every carrier bumps its `version`. core holds: a GitHub client
taking its token from the caller; the branch grammar, story identity and DONE; the nine value sets as Zod enums;
three Zod contracts (Finding, Snapshot, SpecFacts) with generated, drift-checked JSON Schemas; `codeworks.toml`
`[shared]`; the state module (the reviewer App's newest comment, whatever its body; read, write, rescope hold,
release; a new comment each time; attestation from a stage 1 round that passed at the head or a commit in its
history); the Codex, CodeRabbit and DeepSource modules, the threads module
and the required-checks reader, each returning COULD_NOT_RUN as an outcome; key reading behind the
managed-settings gate; App token minting. No command and no carrier in this spec. One PR per story: US1, US2, US3,
US5. Decisions in [research.md](research.md), shapes in [data-model.md](data-model.md), interfaces in
[contracts/](contracts/).

## Technical Context

**Language/Version**: TypeScript, run by Node ≥ 22.18 type stripping (planning machine: Node 22.18.0); type
checked by `tsc` 7.0.2 (R1)

**Primary Dependencies**: runtime `zod` 4.6.7, `smol-toml` 1.9.1, `yaml` 2.9.1, each exact, none with dependencies
of its own (R2); otherwise Node's `fetch`, `node:crypto`, `node:child_process`, `node:fs`, `node:test`

**Storage**: GitHub (state comments on story issues); key files in `~/.config/codeworks/`

**Testing**: `node --test` in `core/tests/` after `tsc`, run by CI's matrix through a node branch for that suite
(R6); pure rules on fixtures; GitHub through a recorded fake client or a local HTTP server; each test seen to fail
first

**Target Platform**: Linux, in the agent environment and where planner runs; checked key reads refuse other
platforms (R23)

**Project Type**: library carried by plugins; no command

**Performance Goals**: none set. Measured while planning: a `.ts` hook starts in about 84 ms bare and 155 ms
importing all three dependencies, so a hook imports only the core modules it uses

**Constraints**: a hook that runs core blocks on any failure (`onFailure: "block"`, exit 2; R4); no fallback
credential or ambient gh login (R12); no state comment edited or deleted (FR-018);
COULD_NOT_RUN never reads as PASS, FAIL or an empty list (FR-024); no environment variable reads a setting
(FR-006); core imports no component (FR-005); only erasable TypeScript (R1)

**Scale/Scope**: new `core/` (about 15 modules, 3 schemas, tests, a fixture plugin, 2 repo scripts);
`.github/workflows/tests.yml`; `.gitignore`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | Three new shapes, Finding, Snapshot, SpecFacts, and the value sets, none in the org contracts map. Each is defined once as a Zod schema or enum in core, its JSON Schema generated (R7, R8). See Complexity Tracking. |
| II. Ownership & trust boundaries | core lives in this repo's `core/` (root ADR-0001); `codeworks.toml`, comments, GitHub answers, front matter and the managed settings file are validated where read (R9, R14, R15, R23). Tokens come from callers and key files. Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | No fallback: DeepSource `api` to `github`, a mint to another credential, an untagged, edited or deleted newest state comment to an older one, a missing dependency to running anyway (R4, R15, R20, R24). Missing spec facts fail (R9). Pass. |
| IV. Test-first | Every rule is a pure function tested on fixtures before code; GitHub through a recorded fake; tests pin the schemas, `SECURITY.md` §3 and §5, and the value strings (R7, R8, R23, R24). Pass. |
| V. Smallest complete change | Each story adds only its modules (R26); no carrier and no switch of a component to core (spec Assumptions); three dependencies, the rest from Node (R2). Pass. |
| VI. Governing rule ships apart | No rule file changes. `check-carriers.ts` governs carriers, of which none exists, so it lands before any code it grades. `values.ts` and the value-string test land in US1, before the US2 and US3 code that uses the values. The import and no-command tests land in US1 with the first code they grade, and each drift test with what it pins: see Complexity Tracking. |
| P1, P3 (reviewer, planner) | Not core's; core gives them pure functions with thin readers (R10–R22), and every refusal names its cause and release (R4, R16). |
| P2. Only an approved entity releases a hold | core adds no hold. Its writes never drop a hold row (R16). `releaseState` reposts after a human's Ready (reviewer ADR-0011 d2); OPEN → RELEASED is written only by reviewer's hook. Tampered state reads as held exactly as P2 lists it (R15). Pass. |
| P4. Could not run is its own outcome | COULD_NOT_RUN is a check-outcome value returned by every module and the required-checks reader; WAIVED only for Codex out of credits (R17, R18). Identity and state reads that get no answer throw, so their caller does nothing (R12). Pass. |
| P5. Settled design, existing tools first | Every mechanism below cites an R with Existing tools. Pass. |
| P6. One writer per state | State comment: reviewer's hook as the reviewer App (R16). `@codex review`: the orchestrator's hook, with the writer it passes (R18). A carrier's version: the PR that changes core (R5). Pass. |
| P7. Facts as data | Codex's verdict and out-of-credits text only in the Codex module (the exception). CodeRabbit's outside-diff items from its review body: see Complexity Tracking. Spec facts from front matter keys (R9). The state tag decides validity, not which comment is state (R15). |
| P8. Generic over repositories | Per-repo values in `[shared]`; vendor logins are the vendors'. Pass. |
| P9. Trust only named identities | Threads trusted by the first comment author's login; the session App never (R21); state comments by `Bot` type and login (R15); done by a `User` closer (R13). Pass. |

Re-check after Phase 1: unchanged. The contracts add no shape beyond the three schemas and the value sets.

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
│   ├── tree.ts                 # Tree, gitTree, gitHubTree (R11)                                              US1
│   ├── identity.ts             # branch grammar, spec issue and folder, PR, branch, requirement, done (R10, R13)  US1
│   ├── values.ts               # the nine value sets (R7)                                                     US1
│   ├── contracts/
│   │   ├── spec-facts.ts       # (R9)                                                                         US1
│   │   ├── snapshot.ts         # (R8)                                                                         US2
│   │   └── finding.ts          # (R8)                                                                         US3
│   ├── settings.ts             # codeworks.toml, Shared (R14)                                                 US2
│   ├── state.ts                # read, write, rescope hold, release, attests (R15, R16)                       US2
│   ├── outcomes.ts             # GitHub state → check outcome (R17)                                           US3
│   ├── validators/                                                                                            US3
│   │   ├── index.ts            # enabledModules, threadsModule, requiredChecks
│   │   ├── threads.ts          # (R21)
│   │   ├── codex.ts            # (R18)
│   │   ├── coderabbit.ts       # (R19)
│   │   ├── deepsource.ts       # (R20)
│   │   └── required-checks.ts  # (R22)
│   ├── keys.ts                 # key files, managed-settings gate (R23)                                       US3
│   └── tokens.ts               # mint (R24)                                                                   US5
├── schemas/{spec-facts,snapshot,finding}.schema.json   # generated (R8)
├── scripts/
│   ├── write-schemas.ts        # (R8)                                                                         US1
│   └── check-carriers.ts       # link, pins, bumps (R5)                                                       US1
├── tests/
│   └── fixtures/carrier-plugin/  # a plugin with core → ../../../src, package.json, lockfile, hook            US1
└── docs/adr/
.github/workflows/tests.yml     # node branch for core/tests; carriers job (R6)                                US1
.gitignore                      # + node_modules/                                                              US1
```

**Structure Decision**: `core/` at the root beside the components (root ADR-0001 d1, d2; FR-001), with `src/` as
the package a carrier links. Existing files this plan changes, and their callers: `.github/workflows/tests.yml`,
run by GitHub Actions on `pull_request` and on push to `main`, whose matrix run step today runs `python -m
unittest -v` for every suite, so it branches for `core/tests` (R6); `.gitignore`, read by git. Nothing else
existing is edited. Every new core function has no caller in this repo but its tests and the fixture plugin; the
components' switch to core is follow-up work (spec Assumptions).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New contracts, Finding, Snapshot, SpecFacts, and the value sets, not in the org contracts map (Principle I) | root ADR-0003 d1, d3, ADR-0009 d1, ADR-0010 and planner ADR-0008 d1 decide them, in core, as Zod schemas with generated JSON Schemas; Codeworks-internal shapes no org artifact covers. Each is defined once | an adapter against an existing contract: none covers review findings, reviewer state, spec facts or these values; a copy per component: what root ADR-0003, ADR-0005 and ADR-0010 exist to stop |
| Each schema's drift test lands in the PR that adds its schema (Principle VI) | the test compares a file to what the schema generates; it grades no design choice and has nothing to check before the schema exists. FR-013 asks for it | an earlier PR: fails on a schema that does not exist; a later one: a schema merges unchecked |
| The import and no-command tests land in US1 with the first `core/src` code (Principle VI) | a new package has no earlier code to grade; each test is proven red on a fixture (an outside import, a `commands/` folder) before it passes, and later stories' code is graded by it unchanged | a PR holding only the tests: grades an empty folder, and proves nothing the red fixture does not |
| The tests pinning core's tables to `SECURITY.md` §3 and §5 land with `keys.ts` and `tokens.ts` (Principle VI) | drift tests, like the schema ones: they compare a table to the document it copies and have nothing to compare before the table exists | an earlier PR: no table; a later one: a table merges unchecked |
| CodeRabbit's outside-diff items read from its review body (P7) | root ADR-0003 d7 makes them findings and CodeRabbit publishes them nowhere else; read in the CodeRabbit module alone, keyed by CodeRabbit's own id; a review declaring more items than parse is COULD_NOT_RUN (R19) | leaving them out: FR-026 requires them; parsing them outside core: two readers of one prose |

## Open points

Open, from research:
1. Whether US1's end-to-end install test can run in CI (research Open 1); else it is a recorded manual check.
2. CodeRabbit's verdict source at a head (R19); settled from recorded responses in US3.
3. Claude Code's dependency install under the agent environment's managed settings (research Open 3); matters
   from the first carrier.

Readings of the spec, stated so they can be checked:
- FR-004 "a change to `core/`" is read as a change to what a carrier ships: `core/src/**` or core's dependency
  pins (R5).
- FR-006 "the raw text of its own section" is read as the section parsed and unvalidated (R14).
- FR-026a "`api` takes both from DeepSource's API" covers status and thread-less items; DeepSource's review
  threads come from GitHub in both sources, as FR-028 requires (R20).
- FR-026a's "exact message text" in a key is carried as its SHA-256, which identifies the same text (R20).
- FR-016 "deleted after the state comment" counts a deletion in the same second as after: GitHub's times are
  whole seconds, so the order is unknown and the story is held (R15).

Deferred, not in scope: `.deepsource.toml` has no JavaScript analyzer and names `dev/*/tests/**`, so DeepSource
will not analyse `core/`.

## Mechanisms

- TypeScript by type stripping, erasable syntax only, `tsc` check: R1
- `core/` layout, three pinned dependencies, Node built-ins for HTTP, signing and tests: R2
- A carrier's symlink, `"type": "module"`, pinned `package.json` and lockfile: R3
- `guard.ts` and the hook import order: R4
- `check-carriers.ts`: link, pins, version bumps: R5
- CI runs core's suite with node, and the carriers job: R6
- Value sets as Zod enums, value-string test: R7
- Zod contracts, generated JSON Schemas, drift test: R8
- Spec facts from `spec.md` front matter: R9
- Branch grammar `parseBranch`: R10
- `Tree` with `gitTree` and `gitHubTree`: R11
- GitHub client over `fetch`, reader and writer, the no-answer signal: R12
- Spec issue, spec folder, story PR, story branch, requirement, done: R13
- `codeworks.toml` and the `Shared` schema: R14
- State read: the reviewer App's newest comment, causes: R15
- State write, rescope hold, release, attestation: R16
- GitHub states to check outcomes: R17
- Codex module: R18
- CodeRabbit module: R19
- DeepSource module, two sources, no fallback, thread-less key: R20
- Threads module and the trust split: R21
- Required-checks reader: R22
- Key files and the managed-settings gate: R23
- App token minting and permission sets: R24
- No commands, import boundary test: R25
- One PR per story, US1 → US2 → US3 → US5: R26
