# Data model: the internal review round checks the diff against the decisions that govern it

This file is the one statement of the check's contract: every type, function, reader, cause, next step and refusal.
research.md gives the reasons, contracts/interfaces.md the outside interfaces, tasks.md the order of work; none of
them restates what is here. Nothing is stored: every shape lives for one launch, as frozen dataclasses in
`decisions.py`, and leaves the gate only as `args.decisions` (§ Round arguments and result).

## Functions and their owners

| Function | Module | Does | I/O |
|---|---|---|---|
| `files_in(root, rev_range) -> list[str]` | `worktree` | the paths `git diff --no-renames --name-only -z <range>` lists (`_DIFF` plus `--no-renames`, so a rename lists its old path too), deleted ones included | git |
| `tracked(root, pathspec) -> list[str]` | `worktree` | the paths `git ls-files -z -- <pathspec>` lists | git |
| `not_as_head(root, path) -> list[str]` | `worktree` | the paths `git status --porcelain=v1 -z --untracked-files=all --ignored -- <path>` lists | git |
| `org_corpus(root) -> Corpus \| NotChecked \| None` | `adrkit` | the only builder of the org corpus, from `ALQ_ORG_ADR_DIR` (§ Corpus) | env, disk |
| `outcomes(root, corpora, files, deadline, spent) -> list[CorpusReport \| NotChecked]` | `adrkit` | one value per corpus, never raising for one (§ Reading adrkit) | `adr`, `node`, `lstat` |
| `report(corpus, stdout, real_root, is_regular) -> CorpusReport \| NotChecked` | `decisions` | one corpus script answer as a report: the fields-read check and `_path` (§ Reading adrkit) | only through `is_regular`, which `adrkit` gives as an `os.lstat` check |
| `repo_corpora(root, tracked) -> list[Corpus]` | `decisions` | the repo corpora (§ Corpus) | none |
| `merge(repo, org) -> list[Corpus \| NotChecked]` | `decisions` | the corpora to check, the org last; a repo corpus whose `realpath(dir)` equals the org's is dropped (the one exception to "no I/O") | realpath |
| `status_class(status, statuses) -> str` | `decisions` | § Status | none |
| `judge(report) -> Judgement \| NotChecked` | `decisions` | § Judgement | none |
| `governance(outcomes, org) -> Governance` | `decisions` | § Governance | none |
| `refusal_text(kind, items, call) -> str` | `decisions` | § Refusals | none |
| `_governance(...)` | `gate` | runs the above in § Order, refuses per § Refusals | via the above |

## Corpus

`Corpus(label, dir, kind)`:

| Field | Repo corpus | Org corpus |
|---|---|---|
| `label` | path from the repo root, e.g. `dev/alq-review/docs/adr` | `org (<value of ALQ_ORG_ADR_DIR>)` |
| `dir` | `join(root, label)`, absolute | the absolute path |
| `kind` | `repo` | `org` |

- Repo corpora: for each tracked path, every prefix of it that ends in the segments `docs/adr`; distinct, sorted. A
  `docs/adr` whose tracked files all sit in subfolders is a corpus.
- Org corpus: `ALQ_ORG_ADR_DIR` unset or empty is `None`. A value that is not an absolute path to a readable folder
  is `NotChecked(org label, "could-not-run", ...)`. Otherwise the `Corpus`.
- A record is named `<label> <id>` in the brief, notices and result; a broken line names its file (§ Judgement).
- `dir` is absolute from the builder on, so no consumer joins `root` to it; `label` is for display only. The paths
  the corpus script names go through `_path` (§ Reading adrkit).

## Reading adrkit

The plugin never parses an ADR file or applies one of adrkit's rules itself. `scripts/adrkit_corpus.mjs`, the corpus
script, reads one corpus with adrkit's own library: the `@adrkit/core` the installed `adr` imports, found with
`createRequire(<realpath of adr>).resolve("@adrkit/core")`. It makes the three calls `adr check` makes,
`lintCorpus({dir})`, `readSourceMarkersBatch(files)` and `checkChanges({lint, changedFiles: files, dir, markerScans})`,
and prints one JSON object:

| Key | Content |
|---|---|
| `statuses` | adrkit's `Status.options`, the statuses it knows |
| `lint` | `lintCorpus`'s findings: every record and file of the corpus, changed or not |
| `check` | `checkChanges`'s findings less the ones it copied from `lint` (it re-emits lint's findings on changed records as the same objects, so they are dropped by identity): the matcher, marker and cap findings of this change |
| `governing` | one entry per id `checkChanges` lists as governing: `id`, `title`, and `paths`, the path of every record `lintCorpus` loaded with that id |
| `unreadablePaths` | `markerScan.unreadablePaths` |

Every finding that names a corpus file carries `status`: the record's status when adrkit loaded it, otherwise the
frontmatter `status` `parseAdrFile` reads, `null` when it is absent, not a string, or the file cannot be parsed.
Marker and cap findings name no corpus file and carry none.

`decisions.ADRKIT_VERSION` is `"0.20.0"`, what that release's `adr --version` prints (research.md R5's run), and
`decisions.INSTALL` is `npm install -g @adrkit/cli@<ADRKIT_VERSION>`; no other file restates either. `outcomes` first
runs `adr --version`; its stdout, stripped, must equal `ADRKIT_VERSION` (the CLI pins its core to its own version).
Then, per corpus, `node adrkit_corpus.mjs <realpath of adr> <dir> <files>`, with `cwd` = `realpath(root)` and `<dir>` =
`realpath(corpus.dir)`, every corpus at once, each in its own thread. Every call, `adr --version` included, is
`subprocess.run(..., capture_output=True, timeout=max(deadline - time.monotonic(), 0))`, so each call's output is read
while it runs and only a call that has not exited is killed. The script takes no options, so a path that begins with
`-` is a path. Seconds go into `spent["adr --version"]` and `spent["adrkit <label>"]`. Without `adr` on `PATH`, no call
is made; when `adr --version` does not pass, no corpus call is made.

Exit 0 is an answer, whose stdout `outcomes` gives to `decisions.report`. Exit 3 is "no `@adrkit/core` beside `adr`"
(an `adr` that is not the npm-installed command). Any other exit is a failure with its stderr.

Fields read, and nothing else. `report` checks every row; the first that fails makes the corpus `NotChecked(could-not-run)`
naming the field:

| Field | Must be |
|---|---|
| stdout | a JSON object |
| `statuses` | a list of strings |
| `lint`, `check` | lists of objects, each with `rule`, `severity` and `message` strings |
| any finding's `path`, `id`, `field`, `pattern` | strings, when present |
| any finding's `status` | a string or `null`, when present |
| a `lint` finding | has `path` and `status` |
| a `check` finding whose rule begins `affects-` | has `path`, `field`, `pattern` and `status` |
| `governing` | a list of objects: `id`, `title` strings; `paths` a non-empty list of strings |
| `unreadablePaths` | a list of strings |

A file has one identity: every path the script names goes through `_path(p) = normpath(join(real_root, p))` in `report`,
before it is looked up, `lstat`ed or briefed. With `cwd` and `<dir>` already real, adrkit's relative paths (an org
record outside the repo comes back as `../../engineering/docs/adr/0007-x.md`) meet at one string, and the last
component is not resolved, so `lstat` still sees a symlink.

`CorpusReport(corpus, statuses, lint, check, governing, unreadable_regular)`:

| Field | Content |
|---|---|
| `statuses` | tuple of `statuses` |
| `lint`, `check` | tuples of `Finding(rule, severity, message, path=None, id=None, field=None, pattern=None, status=None)`, `path` through `_path` |
| `governing` | tuple of `Governing(id, title, paths)`, `paths` through `_path` |
| `unreadable_regular` | the paths of `unreadablePaths` for which `is_regular` holds |

## Status

`status_class(status, statuses)`, for a record and a skipped file alike:

| `status` | Class |
|---|---|
| `accepted` | `accepted` |
| in `statuses`, other than `accepted` | `not governing` |
| anything else, `null` included | `unreadable` |

A file is governing when its class is `accepted` or `unreadable` (FR-004): an unreadable status must not hide
adrkit's `error`.

## Corpus outcome

Each corpus yields exactly one value. `NotChecked(corpus, cause, reason)`: `cause` is `too-big` or `could-not-run`;
`reason` is one sentence ending `Next step: <step>, then <call>`, `<call>` being `policy.review_call(state,
'internal')`. A corpus that is not checked contributes no record, notice or broken line, and none of its files is
located or briefed.

| Cause | Made by | `reason` names | Next step |
|---|---|---|---|
| `too-big`: the round's files number more than `max_review_files` | gate, for each corpus not already `NotChecked`; no call is made | the count and the limit | full round: split the PR; delta round: commit in smaller steps and launch after each |
| `could-not-run`: `ALQ_ORG_ADR_DIR` not an absolute path to a readable folder | `adrkit.org_corpus` | the variable and its value | point it at the org's `docs/adr` as an absolute path, or unset it |
| `could-not-run`: a repo corpus holds a file `not_as_head` lists | gate, before any call | the files | commit or remove them |
| `could-not-run`: `adr` not on `PATH`, or `adr --version` printing other than `ADRKIT_VERSION` | `adrkit.outcomes`, for every corpus | the version found, if any | `INSTALL` |
| `could-not-run`: the corpus script exits 3 | `adrkit.outcomes` | `adr`'s path and the script's stderr | `INSTALL`, so the `adr` on `PATH` is the npm-installed command |
| `could-not-run`: `adr --version` exits other than 0 (for every corpus), or the corpus script other than 0 or 3 | `adrkit.outcomes` | the call and its stderr | what stderr says |
| `could-not-run`: a field read of another shape | `decisions.report` | the field | `INSTALL` |
| `could-not-run`: a call not ended by the deadline (`adr --version`: every corpus) | `adrkit.outcomes` | the call, the deadline in seconds, and `spent` (review-base fetch, `gh`, each call, in seconds) | the step that spent the time |
| `could-not-run`: the causes of § Judgement | `decisions.judge` | § Judgement | § Judgement |

## Judgement

`judge(report)` returns `NotChecked(corpus, "could-not-run", reason)` for the first of these it meets:

1. a path in `unreadable_regular`: `reason` names the file; next step: make it readable.
2. a `check` finding of rule `marker-scan-capped` or `marker-declarations-capped`: `reason` is adrkit's message; next
   step: split the change.

Otherwise it returns `Judgement(corpus, records, notices, broken)`. Each finding takes the first row it matches;
"governing" is § Status's, of the finding's `status`.

| From | Finding | Outcome |
|---|---|---|
| `lint` | severity `error` (`unique-id` included), governing | broken (FR-008) |
| `lint` | rule `corpus-file-skipped`, class `accepted` | broken (FR-008) |
| `lint` | rule `corpus-file-skipped`, class `unreadable` | `FileNotice(corpus, file, reason)`, `reason` adrkit's message (FR-012) |
| `check` | rule `affects-bad-pattern` or `affects-unknown-type`, governing | broken (FR-008) |
| `check` | rule `affects-unresolvable` or `affects-repo-not-applicable`, governing | `MatcherNotice(corpus, id, matcher, reason)`, `matcher` = `` f'{field} "{pattern}"' ``, `reason` adrkit's message (FR-012) |
| either | anything else | ignored: every finding on a file that is not governing, lint's record-level `affects-repo-not-applicable` (check's names each matcher), marker findings (FR-004, FR-013) |

- A record's identity is its file. A broken line is `Broken(corpus, file, id, rule, message)`: `file` the finding's
  `path`, which every broken row's finding has (§ Reading adrkit), and `id` adrkit's, or `None`, for display only.
- `records`: each `governing` entry none of whose `paths` has a broken line, as `Record(corpus, id, title, file)`,
  `file` its one path. Two loaded records share an id only with adrkit's `unique-id` error on each, so an entry with
  several `paths` always has a broken line. A file adrkit could not load is in no entry's `paths` even when its
  frontmatter repeats a loaded record's id: it is broken by its own file, and the loaded record is still briefed.
- `affects-unknown-type` never reaches `check` in 0.20, whose lint rejects an unknown matcher type before loading the
  record; the row keeps a later adrkit's answer from being ignored.
- `RULES` is every rule name this table and the two causes above name: a copy of adrkit's vocabulary, pinned by
  `test_decisions.Drift` to the installed core's JS. The statuses are not copied: they come with each report.

## Governance

`governance(outcomes, org)`, `org` the result of `org_corpus` → `Governance(corpora, records, notices, broken,
not_checked, org_corpus)`:

| Field | Content |
|---|---|
| `corpora` | the labels of the judged corpora, in order |
| `records`, `notices`, `broken` | every judgement's, in corpus order; the same id from two corpora is two records |
| `not_checked` | every `NotChecked` |
| `org_corpus` | the org label, or `unset` when `org` is `None` |

## Order

`gate._governance` for an internal launch, after `launch_round` and the review base, before `open_round`:

1. `files = worktree.files_in(root, briefs.review_range(decision, base))`.
2. Corpora: `decisions.merge(decisions.repo_corpora(root, worktree.tracked(root, "*docs/adr/*")), adrkit.org_corpus(root))`.
3. Over `max_review_files`: every corpus not yet `NotChecked` becomes `NotChecked(too-big)`; refusal 1.
4. Otherwise: each repo corpus with `not_as_head` output becomes `NotChecked(could-not-run)`; the rest go to
   `adrkit.outcomes` (which builds each report with `decisions.report`), and each report to `decisions.judge`.
5. `governance = decisions.governance(outcomes, org)`; refusal 2, then refusal 3.

## Refusals

At most one blocks per launch; they are taken in this order.

| # | Refusal | When | Made with | Text |
|---|---|---|---|---|
| 1 | too big | `files` over `max_review_files` | `hookio.refuse` | `refusal_text("too-big", ...)`: "The change is too big to review: <n> files, and max_review_files is <limit>." and the next step |
| 2 | not checked | a `NotChecked` with cause `could-not-run` | `hookio.block_decision` | "The decision check could not run:" then each `<corpus>: <reason>` |
| 3 | broken | `broken` non-empty | `hookio.refuse_decision` | "The decision check found a record it cannot judge against:" then each `<corpus> <file>` (and `<id>` when adrkit gives one) `: <message> (<rule>)`, then each corpus's fix |

A corpus's fix: repo corpus, "correct the record in this repo, commit, then <call>"; org corpus, "fix the org's
records at <dir> or unset ALQ_ORG_ADR_DIR, then <call>", never containing "commit".

A refusal that blocks opens no round and writes nothing to the ledger; its helper writes a `deny` line to `gate.log`.
One that does not block writes a `would_deny` line to `gate.log`; the launch takes the next refusal, then opens the
round on `Governance` as it stands.

### By mode

`P` is the plugin's mode, `D` is `decision_checks`. Each row is one gate test whose subTests are the four cells; each
blocking cell asserts one `deny` line, each open cell one `would_deny` line and the state named.

| Refusal | Test (`test_gate.DecisionReview`) | P enforce, D enforce | P enforce, D log | P log, D enforce | P log, D log | State a round opens on |
|---|---|---|---|---|---|---|
| 1 too big | `test_the_size_refusal_follows_the_plugin_s_mode` | blocks | blocks | opens | opens | no adrkit call; every corpus in `not_checked` with cause `too-big`; no decision reviewer |
| 2 not checked (`ALQ_ORG_ADR_DIR=/nowhere`, repo corpus governs) | `test_a_corpus_not_checked_follows_decision_checks` | blocks | opens | blocks | opens | the repo corpus's record briefed; the org corpus in `not_checked` |
| 2 not checked (`adr` not on `PATH`, repo corpus governs) | `test_without_adr_the_check_follows_decision_checks` | blocks | opens | blocks | opens | no decision reviewer; every corpus in `not_checked` with the install step |
| 2 not checked (a repo corpus not as HEAD) | `test_a_corpus_not_as_head_follows_decision_checks` | blocks | opens | blocks | opens | no call for that corpus; the corpus in `not_checked`; no record from it |
| 3 broken (a governing `unique-id` pair beside a governed 0001) | `test_a_broken_record_blocks_only_when_both_enforce` | blocks | opens | opens | opens | the pair in `broken`, neither briefed; 0001 briefed |

`hookio.refuse` blocks when `P` enforces, `hookio.block_decision` when `D` enforces, `hookio.refuse_decision` when
both do; the cells where two of them differ are each in the table.

## Round arguments and result

`args.decisions`, injected for an internal round, echoed by the workflow as `decisions` in its result:

```json
{
  "corpora": ["dev/alq-review/docs/adr", "org (/home/me/engineering/docs/adr)"],
  "governing": [{"corpus": "dev/alq-review/docs/adr", "id": "0018", "title": "Release a RESHAPE_SPEC lock only by unlock",
                 "file": "/abs/checkout/dev/alq-review/docs/adr/0018-release-a-reshape-spec-lock-only-by-unlock.md"}],
  "notices": [{"corpus": "org (/home/me/engineering/docs/adr)", "id": "0007", "matcher": "affects.package \"core\"",
               "reason": "<adrkit's message>"},
              {"corpus": "dev/alq-review/docs/adr", "file": "dev/alq-review/docs/adr/notes.md",
               "reason": "<adrkit's message>; its status cannot be read"}],
  "broken": [],
  "not_checked": [],
  "org_corpus": "org (/home/me/engineering/docs/adr)"
}
```

- `broken` is `[{corpus, file, id, rule, message}]`; `not_checked` is `[{corpus, cause, reason}]`. Each is non-empty
  only when its refusal did not block.
- `corpora: []` with `not_checked: []` and `org_corpus: "unset"` is "no corpus was found"; `corpora` non-empty with
  `governing: []` is "nothing in those corpora governs this change".

## Round record (ledger, existing)

`expected` gains `alq-review:decision-reviewer` when `records` is non-empty. No other field changes.
