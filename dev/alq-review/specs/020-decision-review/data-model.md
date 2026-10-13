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
| `outcomes(root, corpora, files, deadline, spent) -> list[CorpusReport \| NotChecked]` | `adrkit` | one value per corpus, never raising for one (§ Reading a record file, § Reading adrkit) | `adr`, `node`, `lstat` |
| `repo_corpora(root, tracked) -> list[Corpus]` | `decisions` | the repo corpora (§ Corpus) | none |
| `merge(repo, org) -> list[Corpus \| NotChecked]` | `decisions` | the corpora to check, the org last; a repo corpus whose `realpath(dir)` equals the org's is dropped (the one exception to "no I/O") | realpath |
| `status_class(text) -> str` | `decisions` | § Status | none |
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
- A record is named `<label> <id>` everywhere: brief, notice, refusal, result.
- `dir` is absolute from the builder on, so no consumer joins `root` to it; `label` is for display only. The only paths
  resolved against `root` are the ones adrkit names (§ Reading adrkit).

## Reading a record file

The plugin never parses an ADR file itself. `scripts/adrkit_records.mjs` loads each corpus with adrkit's own code: the
`@adrkit/core` the installed `adr` imports, found with `createRequire(realpath(which adr)).resolve("@adrkit/core")`, so
the plugin and the CLI read every file with one parser. Run as `node adrkit_records.mjs <realpath of adr> <dir>` with
`cwd` the checkout root, it prints one JSON object:

| Key | One entry per file |
|---|---|
| `records` | `discoverAdrFiles(dir)`: the files adrkit loads as records |
| `skipped` | `discoverSkippedMarkdownFiles(dir)`: the files `corpus-file-skipped` names |

Each entry is `{path, id, status}` from `parseAdrFile`, `id` and `status` the frontmatter's values as YAML parses them,
or `{path, error}` when adrkit cannot read or parse the file; `path` is absolute. The plugin keeps an `id` or `status`
only when it is a string.

## Status

`status_class(text)`, `text` the `status` the record reader gives the file or `None`, for records and skipped files alike:

| Text | Class |
|---|---|
| `accepted` | `accepted` |
| `draft`, `proposed`, `rejected`, `superseded`, `deprecated` | `not governing` |
| any other value, no `status`, no frontmatter | `unreadable` |

## Reading adrkit

`outcomes` makes three calls per corpus: `adr lint --dir <dir> --json`, `adr check --dir <dir> --json -- <files>` (the
options, then `--`, then the paths, so a path that begins with `-` is a path) and the record reader. All run with
`cwd` the checkout root, every call of every corpus at once, each in its own thread as `subprocess.run(...,
capture_output=True, timeout=max(deadline - time.monotonic(), 0))`, so each call's output is read while it runs and
only a call that has not exited is killed. Each call's seconds go into `spent["adr lint <label>"]`, `spent["adr check
<label>"]` and `spent["records <label>"]`. Without `adr` on `PATH`, no call is made.

Fields read, and nothing else:

| Answer | Field | Must be |
|---|---|---|
| lint, check | `findings` | list of objects: `rule`, `severity`, `message` strings; `path`, `id`, `field`, `pattern` strings when present |
| check | `governing` | list of objects: `recordId`, `title` strings |
| check | `markerScan.unreadablePaths` | list of strings |
| record reader | `records`, `skipped` | lists of objects: `path` a string, and either `error` a string or both `id` and `status` present |

`adr` exit 0 and 1 are reports; the record reader answers only on exit 0. Every path adrkit names is relative to its
`cwd`, the checkout root (an org record outside the repo comes back as `../../engineering/docs/adr/0007-x.md`), and is
resolved against it before it is looked up in the record reader's answer, `lstat`ed or briefed.

`CorpusReport(corpus, findings, governing, statuses, record_files, unreadable_regular)`:

| Field | Content |
|---|---|
| `findings` | `Finding(rule, severity, message, source, path=None, id=None, field=None, pattern=None)`, `source` `lint` or `check` |
| `governing` | `(id, title)` per `governing` entry |
| `statuses` | `path -> status` for every path of the record reader's `records` and `skipped`; `None` for an entry with `error` or a status that is not a string |
| `record_files` | `id -> tuple of absolute paths`: for each governing id, the `records` paths whose `id` is that id. adrkit gives a governing record no path, and a record's file name need not carry its id (adrkit 0.20 loads `0005-x.md` with `id: "0007"` as 0007) |
| `unreadable_regular` | the paths of `markerScan.unreadablePaths` that `os.lstat` reports as regular files |

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
| `could-not-run`: `adr` not on `PATH` | `adrkit.outcomes`, for every corpus | | `npm install -g @adrkit/cli@0.20.0` |
| `could-not-run`: an `adr` call exits other than 0 or 1, or the record reader other than 0 | `adrkit.outcomes` | the call and its stderr | what stderr says |
| `could-not-run`: stdout not a JSON object, or a field read of another shape | `adrkit.outcomes` | the call and the field | `npm install -g @adrkit/cli@0.20.0` |
| `could-not-run`: a call not ended by the deadline | `adrkit.outcomes` | the call, the deadline in seconds, and `spent` (review-base fetch, `gh`, each call, in seconds) | the step that spent the time |
| `could-not-run`: `marker-scan-capped` or `marker-declarations-capped` | `decisions.judge` | adrkit's message | split the change |
| `could-not-run`: a path in `unreadable_regular` | `decisions.judge` | the file | make it readable |
| `could-not-run`: a governing id, not broken, whose `record_files` are none or several | `decisions.judge` | the record and the files | the corpus's fix (§ Refusals): for the org corpus, never containing "commit" |

## Judgement

`judge(report)` first makes the corpus `NotChecked` for the three causes it owns. Otherwise it returns
`Judgement(corpus, records, notices, broken)`. A finding's record class is `status_class(statuses[path])`; a governing
record is one whose class is `accepted` or `unreadable` (an unreadable status must not hide adrkit's `error`, FR-004).

| Finding | Outcome |
|---|---|
| no `path`, rule other than the two caps | ignored |
| a `path` not in `statuses` (a source file a marker finding names) | ignored: not on a record |
| `corpus-file-skipped`, skipped file `accepted` | broken, subject the file (FR-008) |
| `corpus-file-skipped`, skipped file `unreadable` | `FileNotice(corpus, file, reason)` (FR-012) |
| `corpus-file-skipped`, skipped file `not governing` | ignored |
| severity `error` (`unique-id` included), `affects-bad-pattern`, `affects-unknown-type`, on a governing record | broken, subject the id, or the file when adrkit gives no id (FR-008) |
| `affects-unresolvable` or `affects-repo-not-applicable` from `check`, on a governing record | `MatcherNotice(corpus, id, matcher, reason)`, `matcher` = `` f'{field} "{pattern}"' ``, `reason` adrkit's message (FR-012) |
| any finding on a `not governing` record | ignored (FR-004) |
| anything else | ignored (FR-013) |

- `broken` lines are `Broken(corpus, subject, rule, message)`.
- `records`: each `governing` entry whose id has no broken line, as `Record(corpus, id, title, file)`, `file` its one
  `record_files` path. An id with a broken line is left out with all its files, so two records sharing an id
  (`unique-id`) are both left out.

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
   `adrkit.outcomes`, and each report to `decisions.judge`.
5. `governance = decisions.governance(outcomes, org)`; refusal 2, then refusal 3.

## Refusals

At most one blocks per launch; they are taken in this order.

| # | Refusal | When | Made with | Text |
|---|---|---|---|---|
| 1 | too big | `files` over `max_review_files` | `hookio.refuse` | `refusal_text("too-big", ...)`: "The change is too big to review: <n> files, and max_review_files is <limit>." and the next step |
| 2 | not checked | a `NotChecked` with cause `could-not-run` | `hookio.block_decision` | "The decision check could not run:" then each `<corpus>: <reason>` |
| 3 | broken | `broken` non-empty | `hookio.refuse_decision` | "The decision check found a record it cannot judge against:" then each `<corpus> <subject>: <message> (<rule>)`, then each corpus's fix |

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
| 1 too big | `test_the_size_refusal_follows_the_plugin_s_mode` | blocks | blocks | opens | opens | no `adr` call; every corpus in `not_checked` with cause `too-big`; no decision reviewer |
| 2 not checked (`ALQ_ORG_ADR_DIR=/nowhere`, repo corpus governs) | `test_a_corpus_not_checked_follows_decision_checks` | blocks | opens | blocks | opens | the repo corpus's record briefed; the org corpus in `not_checked` |
| 2 not checked (`adr` not on `PATH`, repo corpus governs) | `test_without_adr_the_check_follows_decision_checks` | blocks | opens | blocks | opens | no decision reviewer; every corpus in `not_checked` with the install step |
| 2 not checked (a repo corpus not as HEAD) | `test_a_corpus_not_as_head_follows_decision_checks` | blocks | opens | blocks | opens | no `adr` call with that `--dir`; the corpus in `not_checked`; no record from it |
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

- `broken` is `[{corpus, subject, rule, message}]`; `not_checked` is `[{corpus, cause, reason}]`. Each is non-empty
  only when its refusal did not block.
- `corpora: []` with `not_checked: []` and `org_corpus: "unset"` is "no corpus was found"; `corpora` non-empty with
  `governing: []` is "nothing in those corpora governs this change".

## Round record (ledger, existing)

`expected` gains `alq-review:decision-reviewer` when `records` is non-empty. No other field changes.
