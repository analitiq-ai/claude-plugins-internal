# Feature Specification: The internal review round checks the diff against the decisions that govern it

**Feature Branch**: `88-us1-decision-review` (#88)

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Issue #88" (issue #88, "alq-review: check the PR diff against repo and org ADRs")

**Settled with the user (2026-10-12)**: a first build without a spec (#92, closed) went three review rounds on what
adrkit's `adr check` leaves unsaid. The user settled which records count, which of adrkit's findings refuse a launch,
which add a notice, which are ignored, and that every `adr` call ends by one deadline. The notice choice is recorded
as an ADR in `dev/alq-review/docs/adr`. See Clarifications. The planning-time attempt (#89) was closed: before code
exists there is no diff to match against.

## Clarifications

### Session 2026-10-12

- Q: Which records count? → A: Only records adrkit treats as governing: status `accepted`, or a status it cannot read. A finding on a `draft`, `proposed`, `rejected`, `superseded` or `deprecated` record never refuses a launch and never adds a notice (FR-004).
- Q: When is the launch refused? → A: When adrkit could not load a governing record or one of its matchers (an `error` finding, `corpus-file-skipped`, `affects-bad-pattern`, `affects-unknown-type`), when its marker scan was capped (`marker-scan-capped`, `marker-declarations-capped`), when a changed regular file could not be read, when a corpus cannot be checked at all, and when the `adr` command is missing. The refusal names the corpus and a fix that works for it. For the org corpus the fix is to fix the org's records or unset `ALQ_ORG_ADR_DIR`, never to commit (FR-008 to FR-011).
- Q: When does the round run with a notice? → A: For a governing record whose matcher adrkit cannot evaluate in one repo: a `package` or `entity` matcher (`affects-unresolvable`), or a matcher qualified with a repo (`affects-repo-not-applicable`; adrkit skips every one, this repo's included). Refusing would block every round over a matcher no round can evaluate; ignoring would hide it (FR-012). The user's choice; recorded as an ADR (FR-019).
- Q: What is ignored? → A: Files over 8 KB beyond their first 8192 bytes (adrkit scans only that much for markers, by design), symlinks and other non-regular files (adrkit does not follow them, by design), deleted files, and every other adrkit finding (FR-013).
- Q: How long may the check take? → A: Every `adr` call ends by one deadline, taken when the gate hook receives its payload: the hook's 60-second timeout less a margin. A call that reaches it is a corpus that could not be checked (FR-014).
- Q: Where do the paths come from? → A: From the git diff the round reviews. No path list is kept anywhere (FR-002).
- Q: How do the check's refusals behave in `log` mode? → A: Split as the README already splits refusals: a broken governing record (FR-008) follows the mode, like a spec refusal; a check that could not run (FR-009, FR-010) refuses in either mode, like a review base that cannot be read (FR-018).
- Q: How many user stories, and so PRs? → A: One. The repo check, the org check, the refusals and the notices are one mechanism at round launch, and a check that cannot refuse must not ship alone.
- Q: Are deleted files and symlinks given to the check? → A: Yes, every changed path. adrkit matches paths as text, so deleting code a decision governs is reviewed against it; only the marker scan skips them (FR-002).
- Q: Do org records target particular repos? → A: No. Org records apply to every repo in the organisation; a record for one repo lives in that repo's own corpus.
- Q: Does the check get its own setting? → A: Yes, `decision_checks`, as the claim and shim checks have, so it can be released alone (ADR-0011). Under `log`, a check that could not run lets the round open and the result names each corpus not checked and why (FR-021).
- Q: How big may a round's change be? → A: An internal round whose files number more than `max_review_files` (`config.json`, 50) is refused, with the next step to split the change. It replaces adrkit's own marker-scan cap of 3000 as the limit a round meets first (FR-022).
- Q: Does a skipped file in a corpus refuse? → A: Only when it is an `accepted` record adrkit could not read because of its name or place. A skipped file whose status cannot be read gets a notice; one with any other status is ignored (FR-008, FR-012).
- Q: Is the decision reviewer's record kept? → A: Yes. Each assessed round's rulings on the decision reviewer's findings are written to `gate.log`, so the reviewer can be improved from them (FR-023).

## Terms

- **Decision record**: one ADR file in a corpus, with an id, a title, a status and `affects` matchers (path, package or entity patterns, optionally qualified with a repo).
- **Corpus**: a folder of decision records. A **repo corpus** is any tracked `docs/adr` folder in the repo under review, at any depth; its records are the repo's own. The **org corpus** is the folder `ALQ_ORG_ADR_DIR` names, outside the repo; its records apply to every repo in the organisation.
- **Governing record**: a record with status `accepted`, or one whose status adrkit cannot read. `draft`, `proposed`, `rejected`, `superseded` and `deprecated` are not governing.
- **Governs the change**: a governing record whose matcher matches a file the round reviews, or that a file the round reviews names with an `@adr` marker.
- **Decision reviewer**: the reviewer added to a round when at least one record governs the change. It judges the diff against those records and reports findings like every other reviewer.
- **Notice**: a line in the round's result about a governing record the check could not evaluate here. It stops nothing.
- **Files the round reviews**: for a full round, every file the diff from the review base to HEAD touches; for a delta round, every file the diff from the previous round's commit to HEAD touches.
- **Fix that works**: the next step a refusal names, which can succeed where the refusal was made (ADR-0009, constitution P1).

## Today

Read on 2026-10-12 on `main` at `86a4b06`; nothing here was run.

- No step of a review round reads a decision record: `plugins/` has no call to `adr` and no mention of adrkit, and the internal reviewer list (`briefs.INTERNAL_REVIEWERS`) has five `pr-review-toolkit` agents and nothing else.
- The repo holds three corpora: `dev/alq-review/docs/adr` (17 records, all `accepted`), `dev/alq-plan/docs/adr` (6, all `draft`) and `dev/alq-build/docs/adr` (2, all `draft`). The ids `0001` to `0006` appear in more than one corpus.
- The org's records live in the engineering repo's `docs/adr`, which no repo's review consults.
- adrkit's Spec Kit extension offers `adr check` as an optional `after_plan` hook, with one corpus per run (`ADRKIT_DIR`, default `docs/adr`); in a headless run the offer is only printed. It runs at planning time, when there is no diff.
- The gate hook that opens a round runs with a 60-second timeout (`hooks/hooks.json`); the fetch of the review base inside it may take up to 30 seconds (`worktree.review_base`).
- The installed adrkit is `@adrkit/cli` 0.20.0. Its `check` output buckets records as `governing`, `activeProposals` and `history`, and reports findings by rule name; its marker scan reads the first 8192 bytes of a file and does not follow symlinks.
- The closed PR #92 built this without a spec; three review rounds surfaced the decisions in Clarifications.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A review round is checked against every decision that governs the change (Priority: P1)

An agent launches the internal review round of a PR. The gate lists the files the round reviews and asks every corpus, the repo's own and the org's at `ALQ_ORG_ADR_DIR`, which governing records cover them. When any does, the round gets a decision reviewer briefed with those records, and its findings reach the assessor with every other reviewer's. An org record and a repo record with the same id are two records, each named by its corpus and id. A check that could not run refuses the launch, naming the corpus and a fix that works for it. A record adrkit cannot evaluate in one repo is named in a notice; the round runs.

**Why this priority**: it is the purpose: a decision is no longer overturned in code without a superseding record (premise `harm`). The parts ship together: a check that cannot refuse would pass a change silently whenever it failed (ADR-0009, constitution P4), and the notices come from the same reading of adrkit's findings as the refusals.

**Independent Test**: launch internal rounds through the gate's hook handler, on branches and corpora built for each scenario below, and read the injected arguments, the refusal or the round's result.

**Acceptance Scenarios**:

1. **Given** a branch changing a file that an `accepted` record of a repo corpus governs, **When** the internal round launches, **Then** the round has a decision reviewer, its brief names that record by corpus and id, and the round's expected reviewers include it, so the round is incomplete until it reports.
2. **Given** the decision reviewer reports a finding, **When** the round closes, **Then** the finding goes to `assess-round` with the others and gets a FIX, PUSH_BACK or DEFER ruling like any finding.
3. **Given** a branch whose changed files no governing record covers, **When** the round launches, **Then** no decision reviewer is added and the round's result says which corpora were checked and that nothing governs the change.
4. **Given** a `draft` record of a repo corpus whose matcher covers a changed file, **When** the round launches, **Then** that record is not given to any reviewer and adds no notice.
5. **Given** a delta round, **When** it launches, **Then** the files asked about are those changed since the previous round, not the whole branch.
6. **Given** `ALQ_ORG_ADR_DIR` names a corpus with a governing record covering a changed file, **When** the round launches, **Then** the decision reviewer is briefed with that record, named by the org corpus and its id.
7. **Given** an org record and a repo record share an id, **When** both govern the change, **Then** the brief and the result carry both, each under its own corpus, and neither replaces the other.
8. **Given** `ALQ_ORG_ADR_DIR` is unset, **When** the round launches, **Then** the round opens, and its result says the org corpus was not checked because the variable is unset.
9. **Given** the org corpus has a governing record whose only matcher is qualified with a repo, **When** the round launches, **Then** the round opens, the record is not given to the reviewer, and the result carries a notice naming the record and the repo the matcher names.
10. **Given** the `adr` command cannot be found, **When** the round launches, **Then** it is refused, and the refusal names the install step.
11. **Given** a repo corpus holding a governing record with a path matcher adrkit reports as bad, **When** the round launches, **Then** it is refused, the refusal names that corpus and record, and the fix is to correct the record in this repo and launch again.
12. **Given** the org corpus holds a record adrkit skipped or could not load as governing, **When** the round launches, **Then** it is refused, the refusal names the org corpus and the record, and the fix is to fix the org's records or unset `ALQ_ORG_ADR_DIR`; it does not say to commit.
13. **Given** `ALQ_ORG_ADR_DIR` names a folder that does not exist or cannot be read, **When** the round launches, **Then** it is refused, naming the path, and the fix is to point the variable at the org corpus or unset it.
14. **Given** adrkit reports its marker scan was capped, **When** the round launches, **Then** it is refused, naming the corpus the call was for and the cap, with the next step to split the change.
15. **Given** a changed regular file the check cannot read, **When** the round launches, **Then** it is refused, naming the file.
16. **Given** an `adr` call that has not ended by the deadline, **When** the round launches, **Then** it is refused as a corpus that could not be checked, naming the corpus, the deadline and the time each step of the launch spent (review-base fetch, `gh` calls, each `adr` call).
17. **Given** adrkit answers in a shape the gate cannot read, **When** the round launches, **Then** it is refused as a check that could not run, naming the corpus and the install step of the adrkit version the plugin is built for. No such answer has been seen from adrkit 0.14 or 0.20; this is the boundary check on its output.
18. **Given** a governing record whose matcher is `package` or `entity`, **When** the round launches, **Then** the round opens and the result carries a notice naming the record, its corpus and the matcher.
19. **Given** a governing record whose matcher is qualified with a repo, this one or another, **When** the round launches, **Then** the round opens and the result carries a notice naming the record, its corpus and that repo.
20. **Given** such a record is the only one and none of its matchers is evaluated, **When** the round launches, **Then** no decision reviewer is added.
21. **Given** a governing record with one path matcher that matches a changed file and one matcher adrkit cannot evaluate here, **When** the round launches, **Then** the record is given to the decision reviewer and the result also carries a notice for the matcher it could not evaluate.
22. **Given** two `accepted` records with one id in one corpus, **When** the round launches, **Then** it is refused as a broken record (adrkit's `unique-id`), naming the corpus and both files, and the fix is to correct the records in that corpus.
23. **Given** a skipped file in a corpus (misnamed, or in a subfolder) whose status is `accepted`, **When** the round launches, **Then** it is refused, naming the file; **Given** one with no status that can be read, **Then** the round opens and the result carries a notice naming the file; **Given** one with status `draft`, **Then** nothing is said.
24. **Given** `decision_checks` is `log` and `adr` cannot be found, **When** the round launches, **Then** the round opens without a decision reviewer, `gate.log` has a would-deny line, and the result names each corpus as not checked and why.
25. **Given** a change of 51 files and `max_review_files` at 50, **When** the round launches, **Then** it is refused before any `adr` call, naming 51 and 50, and the next step is to split the PR (full round) or commit in smaller steps (delta round).
26. **Given** a round with a decision reviewer is assessed, **When** the assessment is recorded, **Then** `gate.log` has one line with each of the decision reviewer's finding ids and their rulings.
27. **Given** an org corpus outside the checkout with a governing record, **When** the round launches, **Then** the brief names the record's file as a path that exists.

---

### Edge Cases

- A changed file over 8 KB: its path is still matched; a marker past its first 8192 bytes is not seen, and nothing is said about it.
- A changed symlink or other non-regular file: given to the check and matched by path; adrkit does not scan it for markers, and nothing is said about that.
- A deleted file: given to the check and matched by path, so a record whose matcher covers it governs the change; there is nothing to scan for markers, and nothing is said about that.
- The PR changes a decision record: findings on it refuse the launch only when adrkit reports an `error` on a governing record; findings on a `draft` or `proposed` record change nothing.
- A record whose status adrkit cannot read: counted as governing, so the `error` finding adrkit raises on it refuses the launch (FR-008). It is never dropped the way a `draft` is.
- A `superseded` record: never governing, whatever its dates.
- A repo with no `docs/adr` folder and `ALQ_ORG_ADR_DIR` unset: the round opens with no decision reviewer, and the result says no corpus was checked and that the variable is unset.
- A `docs/adr` folder in the repo that holds no tracked file: not a corpus.
- An untracked or ignored `docs/adr` folder: not a corpus.
- A repo corpus that is itself one of the files the round reviews (the PR adds an ADR): the check runs against the corpus as HEAD has it; a repo corpus holding a file not as HEAD has it (uncommitted, untracked or ignored) cannot be checked (FR-010), naming the files.
- `ALQ_ORG_ADR_DIR` pointing inside the repo under review: still the org corpus, checked once as the org corpus; a tracked `docs/adr` at that path is not checked twice.
- An audit round: no decision reviewer and no check; the feature is the internal round's.
- A broken governing record in `log` mode, or with `decision_checks` at `log`: recorded as a would-deny, and the round opens with the records that were read. A check that could not run in `log` mode: refused, as in `enforce`, unless `decision_checks` is `log` (FR-021).
- Two records with one id in one corpus: adrkit reports `unique-id` as an `error` on each; on a governing record that is a broken record (FR-008), fixed in the corpus.
- A stray `.md` file in a corpus (notes, a misnamed file, a file in a subfolder): adrkit skips it. It refuses only when its status is `accepted`; with no status that can be read it is a notice; otherwise it is ignored.
- A change of more than `max_review_files` files: refused before any `adr` call (FR-022).
- A round that is `INCOMPLETE` because the decision reviewer did not report: launched again with the same arguments, like any partial round.
- The reviewer finds nothing: an empty findings list, which is a normal answer.

## Requirements *(mandatory)*

### Functional Requirements

**The check**

- **FR-001**: At every internal review-round launch, the gate MUST check the files the round reviews against every corpus: each tracked `docs/adr` folder of the repo, and the org corpus when `ALQ_ORG_ADR_DIR` is set.
- **FR-002**: The files MUST come from the git diff the round reviews (full or delta); no list of paths is kept in any file or setting. Every path the diff changes MUST be given to the check, deleted files, symlinks and other non-regular files included: adrkit matches them by path and skips only their marker scan.
- **FR-003**: Each corpus MUST be checked by its own call to the `adr` command with its own folder, so each corpus keeps its own ids.
- **FR-004**: Only governing records count: status `accepted`, or a status adrkit cannot read. A finding on a `draft`, `proposed`, `rejected`, `superseded` or `deprecated` record MUST NOT refuse a launch or add a notice.
- **FR-005**: Every record in a brief, a notice or a refusal MUST be named by its corpus and its id.

**The reviewer**

- **FR-006**: When at least one record governs the change, the round MUST get a decision reviewer, counted among the round's expected reviewers, briefed with each governing record (corpus, id, title and the record's file) and told to judge the diff against those records and nothing else.
- **FR-007**: The decision reviewer's findings MUST go through `assess-round` like every other reviewer's: numbered with its own prefix, ruled FIX, PUSH_BACK or DEFER.

**Refusals**

- **FR-008**: The launch MUST be refused when adrkit could not load a governing record or one of its matchers: an `error` finding (including `unique-id`), `affects-bad-pattern` or `affects-unknown-type` on a governing record, or `corpus-file-skipped` on a file whose status is `accepted`. A skipped file whose status cannot be read is a notice (FR-012); one with any other status is ignored. The refusal MUST name the corpus and the record.
- **FR-009**: The launch MUST be refused when adrkit reports `marker-scan-capped` or `marker-declarations-capped`, or when a changed regular file could not be read. The refusal MUST name the corpus, or the file, and for a cap the next step to split the change.
- **FR-010**: The launch MUST be refused when a corpus cannot be checked at all (its folder is missing or unreadable, the call fails, its answer cannot be read, or it reaches the deadline) and when the `adr` command is missing. The refusal MUST name the corpus, or the missing command and its install step.
- **FR-011**: Every refusal MUST say the check failed, not the work, and name a fix that works for the corpus it names: for a repo corpus, correct the record in this repo and launch again; for the org corpus, fix the org's records or unset `ALQ_ORG_ADR_DIR`. A refusal about the org corpus MUST NOT tell the agent to commit. A record's file, as adrkit names it, MUST be read from the checkout root, where adrkit ran, so an org record outside the repo is found.
- **FR-012**: A matcher adrkit cannot evaluate in a one-repo check, a `package` or `entity` matcher (`affects-unresolvable`) or any repo-qualified matcher (`affects-repo-not-applicable`), MUST NOT refuse the launch; the round's result MUST carry a notice naming the record, its corpus, the matcher and the reason. The record reaches the reviewer only if another of its matchers, or a marker, makes it govern the change. A skipped file whose status cannot be read (FR-008) is a notice naming the file.
- **FR-013**: Every other adrkit finding MUST be ignored. A file over 8 KB is checked as adrkit checks it; nothing is said about markers past its first 8192 bytes.
- **FR-014**: Every `adr` call of a launch MUST end by one deadline, taken when the gate hook receives its payload: the hook's 60-second timeout less a margin. The calls for different corpora MUST run at the same time. A call that reaches the deadline MUST be treated as a corpus that could not be checked (FR-010), and the refusal MUST name the time each step of the launch spent (the review-base fetch, the `gh` calls, each `adr` call), so the next step is the one that can succeed.

**The result**

- **FR-015**: The round's result MUST state which corpora were checked, which records govern the change (by corpus and id), every notice, and, when `ALQ_ORG_ADR_DIR` is unset, that the org corpus was not checked for that reason.
- **FR-016**: An unset `ALQ_ORG_ADR_DIR` MUST NOT refuse the launch.

**Scope and mode**

- **FR-017**: Audit rounds and assess-round launches MUST NOT run the check and MUST NOT get a decision reviewer.
- **FR-018**: With `decision_checks` at `enforce`: a refusal under FR-008 (a governing record adrkit could not load) MUST follow the plugin's mode as the spec refusals do (in `log` mode it is recorded as would-deny and the round opens with the records that were read); a refusal under FR-009 or FR-010 (the check could not run in full) MUST refuse in either mode, as a review base that cannot be read does.
- **FR-019**: The user's choice on notices (FR-012) MUST be recorded as an ADR in `dev/alq-review/docs/adr`, in its own PR before the code lands.
- **FR-020**: The plugin's README MUST state the `adr` command as a dependency with its install step, what the round does with decisions, the `decision_checks` and `max_review_files` settings, in the terms of this spec.
- **FR-021**: The check MUST have its own setting, `decision_checks` (`log` or `enforce`, overridden by `ALQ_REVIEW_DECISION_CHECKS`, shipped `enforce`), as the claim and shim checks have. At `log`, no decision-check refusal blocks: each is recorded as would-deny in `gate.log`, the round opens with the records that were read, and the result names each corpus not checked and why, and each governing record that could not be loaded. Nothing not checked or not loaded is given to the decision reviewer. The constitution's Platform Constraints line on per-check settings changes in the same PR as ADR-0019 (FR-019), before the code.
- **FR-022**: An internal round whose files (FR-002) number more than `max_review_files` (`config.json`, shipped 50) MUST be refused before any `adr` call, following the plugin's mode, naming the count and the limit, with the next step: split the PR, or, for a delta round, commit in smaller steps and launch after each.
- **FR-023**: When a round is assessed, the rulings on the decision reviewer's findings (each finding's id and ruling: FIX, PUSH_BACK or DEFER) MUST be written to `gate.log`, one line per round.

### Key Entities

- **Corpus**: a folder path (repo-relative for a repo corpus, absolute for the org corpus) and the records in it. Identified by its path.
- **Governing record**: corpus, id, title, status, the record's file, its matchers.
- **Decision check result**: per launch: the corpora checked, the governing records that cover the change, the notices, whether the org corpus was unset, and the refusal if any. Reported in the round's result; not kept beyond the round.
- **Notice**: a record (corpus, id), the matcher, and the reason it could not be evaluated here.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a branch that changes a file an accepted record governs, 100% of internal round launches add a decision reviewer briefed with that record, and the round is not clean until it reports.
- **SC-002**: A finding the decision reviewer raises reaches the assessor and gets a ruling in every case tried; none bypasses `assess-round`.
- **SC-003**: Every refusal condition of FR-008 to FR-010 refuses the launch with the corpus (or file, or command) named and a fix that can succeed there; 0 of them open the round in `enforce` mode, and 0 under FR-009 or FR-010 open it in `log` mode.
- **SC-004**: A `draft`, `proposed`, `rejected`, `superseded` or `deprecated` record never refuses a launch, never adds a notice and never reaches the reviewer, in every case tried.
- **SC-005**: Two records with the same id in two corpora are both given to the reviewer, each under its corpus; 0 are lost to the clash.
- **SC-006**: A launch with `ALQ_ORG_ADR_DIR` unset opens the round and says so in the result, 100% of the time.
- **SC-007**: No launch runs an `adr` call past the deadline; a call that reaches it is refused as a corpus that could not be checked.
- **SC-008**: A reader of the round's result can tell "nothing governs this change" from "a corpus was not checked" without reading any log.
- **SC-009**: For every assessed round with a decision reviewer, `gate.log` holds one line with each of its findings' rulings, so the share ruled PUSH_BACK can be read without the session transcript.
- **SC-010**: A change of more than `max_review_files` files never reaches an `adr` call; it is refused with the count and the limit.

## Assumptions

- The decisions in Clarifications stand; this spec states what they mean and does not reopen them.
- adrkit's `check` buckets only `accepted` as governing and files every other status, unknown ones included, under proposals or history (read in adrkit 0.20, not run). Counting an unreadable status as governing (FR-004) is the plugin's rule, so that a record it cannot classify refuses the launch instead of vanishing. The spec names adrkit's finding rules by the names adrkit 0.20 gives them; a later adrkit that renames one is an answer the gate cannot read (FR-010).
- The decision reviewer is one agent per round, however many records govern the change; the records are its brief. Which agent and what prompt are plan matters.
- Org records apply to every repo in the organisation; a record for one repo lives in that repo's corpus. adrkit 0.20's `adr check` has no option naming the repo it runs in, so it skips every repo-qualified matcher, this repo's included (run on 2026-10-12: a matcher qualified with the checked repo's own name came back `affects-repo-not-applicable`); such a matcher in any corpus is a notice (FR-012). How a matcher names a repo is adrkit's rule, not the plugin's.
- `ALQ_ORG_ADR_DIR` names a folder on the machine the round launches from; keeping that folder current is the user's, not the plugin's.
- The deadline's margin is a plan matter; what the spec fixes is that it is one deadline for all calls of the launch, taken when the hook starts, and that the hook's own timeout is 60 seconds.
- Out of scope: checking decisions at planning time (#89, closed); the audit stage; a check at commit time; marking which record a finding cites in the ledger beyond what every finding records; a cache of corpus reads across launches.

## Why this is worth doing

### harm
Answer: A PR changes files that an accepted decision record governs (an `affects` match or an `@adr` marker), for example `plugins/alq-review/scripts/gate.py`, governed by ADR-0018. It contradicts that decision. Every review round passes it, because no reviewer is given the decision. The decision is overturned in code without a superseding record. Org decisions in the engineering repo's `docs/adr` are never consulted by any repo.
Source: code: `grep -rli 'adr check\|adrkit' plugins/` on main finds nothing; `plugins/alq-review/scripts/briefs.py` REVIEWERS has no decision reviewer; 17 accepted records exist in `dev/*/docs/adr`.

### reachable
Answer: predicted. Main has 17 accepted decision records with `affects` paths, and no step in the review round reads them. No specific PR that contradicted one has been identified.
Source: code: `grep -l 'status: accepted' dev/*/docs/adr/*.md` (17); `plugins/alq-review/scripts/briefs.py` waves.

### change-alters
Answer: Yes. At round launch the gate runs `adr check <files git diff changed> --dir <corpus>` per corpus (each tracked `docs/adr`, and `$ALQ_ORG_ADR_DIR`). ADR-0018 governs `gate.py`, so it comes back in `governing`. The round gets a decision reviewer briefed with that record. Its finding that the diff contradicts ADR-0018 goes through `assess-round` like any other. The #92 prototype ran this end to end with adrkit 0.20 in tests.
Source: code: closed PR #92 (`decisions.py`, `test_decisions.py`, `test_gate.DecisionReview`); reproduction: `adr check` returned the governing record for a matching changed file.

### owner
Answer: No. adrkit's Spec Kit `after_plan` hook is optional and only printed in a headless run. It runs at planning time, before any diff exists, and reads one corpus. No CI job runs `adr check`. Human review can catch a contradiction only if the reviewer remembers the record.
Source: code: issue #88 Problem section; #89 closed because no diff exists at planning time; `.github/workflows/` has no `adr` step on main.

### inherited
Answer: No. It comes from the user's request in this session: org ADRs must apply to sub-repos without clashing with repo ADRs, and paths come from the git diff rather than a maintained list.
Source: user: request to make org ADRs available to sub-repos and to check against the diff (session 2026-10-12).

### needs-spec
Answer: It has decisions. #92's review rounds surfaced them: which statuses govern; which adrkit findings refuse a launch, add a notice or are ignored; the per-corpus fix message; the hook deadline. One of them (notice for matchers adrkit cannot evaluate here) needed the user, and the rest are listed in #88 as settled. They need writing down before the rebuild.
Source: code: PR #92 rounds 1-3 (REDESIGN, then RESHAPE_SPEC); user: picked "notice" (2026-10-12).

## Root cause

Not a defect report.
