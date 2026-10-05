# Research: spec-folder checks

Phase 0 of `/speckit-plan`, 2026-09-29. Four research agents ran; their measurements are recorded here.

**Status: the plan stopped at Phase 0.** R1 to R4 show that the spec's requirements do not match what the
existing folders and PR 1135 contain. Each "Proposed" in R1 to R8 waited on the user. R9 and R10 record what was
built afterwards (analitiq-ai/engineering#34 and #38); the other three checks were not built.

The measuring scripts were in the session scratchpad, which is not kept. The numbers below are what they
printed.

## R1: What the four checks would have caught in infra PR 1135

**Evidence** (13 commits, all under `specs/001-deploy-pipeline/`; findings from GitHub threads and the
`alq-review` ledger, 42 findings, 22 distinct):

| Class of finding | Count | Seen by a check? |
|---|---|---|
| Drift between files | 5 | No. None is a word-for-word repeat. |
| Untested command or code in prose | 4 | No |
| Tick or record without evidence | 3 | Yes, on form only |
| Wrong fact | 3 | No |
| Broken or stale reference | 2 | No. Both point at identifiers that resolve. |
| Other | 2 | No |
| Design change mixed with status | 1 | Yes |
| Open design question | 1 | No. It carried no marker. |
| Paraphrase that lost meaning | 1 | No |

- The checks touch 4 of 22 findings.
- The branch was mixed (design and status) from its first commit, `5e7d6156`, and stayed mixed.
- No success criterion was removed in this PR. `spec.md` is untouched by all 13 commits. `c8edc0a2` removed a
  citation of SC-003 and a sentence; `99e996c2` restored both.
- 8 tick events, none with a citation on the line. 2 of the 8 ticks were false (T045i, T050a at `1f738712`).
  The check refuses all 8 alike.
- `a15a02bb` ticked T050a and rewrote T050a's check 3 in one commit.

**Proposed**: reword SC-001 to what a replay in `log` mode would report: the 8 tick events; the branch mixed
from `5e7d6156`; T050a ticked and altered at `a15a02bb`; nothing at `c8edc0a2`, recorded as a known miss.

## R2: Repeated wording in the existing folders

**Evidence** (five folders: engineering 001 to 004, infrastructure 001):

| Matching rule | Matches in all five folders |
|---|---|
| Identical lines, 8+ words | 0 |
| Identical sentences, 8+ words | 1 |
| Shared runs of 12+ words | 15 |

- Of 121 requirements and success criteria, 1 shares a 12-word run with another file.
- 14 of the 15 runs are real restatements. None matches spec-kit template text.
- Below 8 words the matches are mostly section-name citations and shared noun phrases.
- No marked quote of a data-model constraint exists in any folder. The spec-kit tasks skill asks for verbatim
  quoting and defines no mark.
- infrastructure 001 already states an ownership model in `plan.md` ("Where each rule lives"): `data-model.md`
  owns every rule under a named section, and files cite the section name in quotation marks (296 citations,
  all resolve).

**Proposed**: drop the repeated-wording rule (FR-009) and the marked-quote rule (FR-011). Restating happens by
paraphrase, which no deterministic check finds.

**Alternatives**:
- Keep a 12-word run rule. It costs 0.4 s on the largest folder and would find 15 cases today and none in
  PR 1135.
- Off-the-shelf duplicate finders (jscpd, sim_text, JPlag, copydetect): none knows which file owns an item, and
  each is a third-party runtime.

## R3: Identifiers and references

**Evidence**:
- Kinds in use: `FR-nnn`, `SC-nnn`, `Tnnn` with an optional letter, research decisions, user stories, and in
  engineering 002 `Vn` and delivery phases. Each kind is defined in one file only.
- Research decisions are written `R-01` in the two 001 folders, `R1.` in 002 and `R1:` in 003.
- References that do not resolve today: `R1` to `R8` in both 001 plans (no definition found anywhere); removed
  task `T060` still cited at infrastructure `tasks.md:223`; one reference crosses repos.
- A plain pattern match also hits `S3`, `SHA256`, `DL3008`. Ranges (`T045a–T045m`) and pairs (`T087/T088`)
  imply identifiers that are not written out.
- Off-the-shelf: no tool resolves bare identifiers in unchanged spec-kit markdown. lychee resolves references
  only once each is a markdown link to an anchor. OpenFastTrace, Doorstop, StrictDoc and sphinx-needs each
  need their own markup.

**Proposed**: keep reference resolution (FR-010) as a small check of our own. It finds real defects at low
cost. It found none in PR 1135.

## R4: Evidence on ticks and records

**Evidence**:
- Ticked tasks carrying any PR, number, run or commit: 4 of 54, 4 of 26 and 4 of 55. Most of those are context,
  not proof.
- A task's own definition can contain PR numbers (T050a names three), so evidence needs its own syntax.
- `facts.md`: 10 of 60 entries in engineering 001 cite a PR, run or commit. The rest cite dates, commands and
  cloud resource IDs.
- Correct records that FR-012 to FR-014 would refuse: commits on spike branches that never merge; runs in
  another repo; an issue as evidence (3 of 13 numbers checked are issues); observations with nothing to cite.
- Engineering 001 cites infrastructure commits. All 6 are absent from the engineering repo.
- Off-the-shelf: no tool verifies that a cited PR, run or commit exists.
- Practice: regulated-industry sources require documented objective evidence for verification. They also count
  inspection and manual actions as evidence.

**Proposed**: needs the user's decision. The options are in the completion report.

## R5: Mixed changes

**Evidence**:
- No off-the-shelf tool classifies changed lines as design or status. Path-based tools cannot: a tick and a
  design edit are both in `tasks.md`.
- Practice supports the principle: changes to acceptance criteria during execution are recorded as deviations
  (EU GMP Annex 15); Kubernetes keeps status writes apart from spec writes.
- The PR 1135 case needs a narrower rule than FR-016 to be named: the same task is ticked and its own text
  changed.

**Proposed**: keep FR-015 and FR-016, and add the per-task rule.

## R6: Settled design

**Evidence**:
- No `plan.md` in any folder lists its mechanisms. FR-017 fails every existing folder.
- 64 of 69 research decisions record an alternative. Whether it is off-the-shelf cannot be read by rule.
- Every `NEEDS CLARIFICATION` string in the folders is a mention, not an open question. The spec-kit checklist
  itself contains the line "No [NEEDS CLARIFICATION] markers remain".
- The one open design question in PR 1135 carried no marker.

**Proposed**: drop this check (FR-017 to FR-019). It would have seen nothing in PR 1135.

## R7: Where the gate can see a commit

**Evidence** (`alq-review` 0.2.0, as measured on 2026-09-29; the plugin has changed since, as noted):
- The hook runs before the command. For `git add -A && git commit`, the files `git add -A` stages are not in
  the index yet when the hook reads it. This is the usual form.
- Not recognised as a commit: `bash -c`, scripts, `env`/`command`/`time` prefixes, aliases, and `merge`,
  `cherry-pick`, `revert`, `rebase`, `pull`.
- The gate skips repos without a GitHub origin and checkouts on a detached HEAD.
- A review round launch is refused when the branch has no open PR. No function returns the default branch.
- 0.2.0 had no notion of a first round. Since built: `policy.first_internal_round` asks whether any internal
  round was completed in any epoch, so an escalation audit does not make the next round first again.
- 0.2.0 wired every refusal and the crash handler to one `mode`. Since built: the spec checks have their own
  `spec_checks` setting (`hookio.refuse_spec`); `refuse()` and the crash branch were left as they were.
- A hook call took about 85 to 100 ms. `gh` calls through `github.py` time out at 20 s and a fetch at 30 s.
- A user-level git hook (`core.hooksPath` set globally) would see the exact commit. The infrastructure and
  plugins checkouts already set their own `core.hooksPath`, which overrides a global one.

**Proposed**: gate at the review round launch, on every round, where the content is exact and a PR exists.
Report after a command that moved the branch tip, so the author hears early.

**Alternatives**:
- Refuse at commit, as the spec says. The content is not readable for the usual command form.
- A git hook per repo. Exact, and it covers commits made outside a session, but two repos need their own
  wiring and `--no-verify` skips it.

## R8: Community spec-kit extensions

**Evidence**:
- `gates` v0.3.3: shell scripts. Formatting, protected files, commit message form, secret patterns, and
  acceptance commands run from marked blocks in `tasks.md`. On a copy of 001 it parsed 0 criteria.
- `arch-governance` 1.2.3: Python with pydantic and pyyaml. Checks ADR citations in YAML front matter. On a copy
  of 001 it found 0 citations and failed.
- Neither knows `FR`, `SC`, `T` or research identifiers, evidence citations or change kind.

**Decision**: do not adopt either. Neither covers any part of the four checks.

## R9: The settled-design check refuses the first internal review round

- **Decision**: Keep the settled-design check (FR-017, FR-018) and run it when the first internal review round
  launches, not at commit. `plan.md` lists its mechanisms under `## Mechanisms`, one `- <mechanism>: R<n>` line
  each; every cited `## R<n>:` decision in `research.md` carries Decision, Rationale and Existing tools fields.
  A check that cannot run refuses the round (FR-021). The same check runs on demand from
  `scripts/settled_design.py` (FR-005).
- **Rationale**: R6 found no plan listing its mechanisms, so the list is written by hand until the templates
  change; R7 found that the round launch sees the exact content where a commit hook does not. The check proves
  a decision was recorded; whether it is right is left to critique and review.
- **Existing tools**: None fit. Looked at: the spec-kit community extensions `gates` and `arch-governance` (R8).

## R10: A design-document change needs a spec folder

- **Decision**: A branch that changes a design document and no spec folder is refused at the first internal
  round, naming the document at line 1 and the next step (FR-004). Design documents are path patterns in
  `config.json` `design_documents`: `README.md`, `CLAUDE.md` and `AGENTS.md` at any depth, `docs/adr/**` and
  `.claude/rules/**`.
- **Rationale**: an unsettled design was the main cause in the churn study, and without this rule a design
  document edited with no spec folder would leave the settled-design check nothing to grade.
- **Existing tools**: None fit. Looked at: the spec-kit community extensions `gates` and `arch-governance` (R8),
  which check neither which files a branch changes nor whether a spec folder came with them.
