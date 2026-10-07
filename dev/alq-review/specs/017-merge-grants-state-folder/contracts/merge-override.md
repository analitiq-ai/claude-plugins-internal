# Contract: the merge override and what the merge gate answers

The record and the PR name are in [data-model.md](../data-model.md). The last table here is the test list.

Every line quoted here was printed by the scratch copy on 2026-10-07 (research). What Claude Code then shows
the user was not run by anyone.

## What the user types

`override-merge owner/repo#N` at the start of a prompt (leading whitespace ignored). One form. Capitals in the
name do not matter. The `--admin` refusal prints the line for the PR in hand.

`override-merge #N` is not an override. It is answered, below, and grants nothing.

## What the user and the agent are told

One line, the same for the user (`systemMessage`) and the agent (`additionalContext`), prefixed `[alq-review] `
as the switch's answers are.

| The prompt starts with | The line |
|---|---|
| an override, recorded | ``The user granted one merge of `owner/repo#N` past its unmet requirements, `--admin` included.`` |
| an override, not recorded | `` `override-merge owner/repo#N` could not be recorded, so nothing is granted: <error type>: <error> `` |
| `override-merge #N` | `` `override-merge #N` does not say which repo's PR that is, so nothing is granted. The user names the PR: `override-merge owner/repo#N`. `` |
| anything else, a mistyped override included | nothing, as today |

Either way the hook exits 0 and the rest of the prompt goes on. An override that was not recorded is also one
line in `errors.log`, when that can be written.

## Which commands ask for a grant

A merge **needs an override** when the gate would refuse it without one: it has `--admin`, or `gh pr view`
gave no head, or its head carries neither the attestation nor a version-only release. The grant is asked for
last, by such a merge only, and only for a PR that has a name.

| Command | Asks | When the grants cannot be used |
|---|---|---|
| `gh pr merge` that needs an override, of a PR on github.com | yes | refused, with the note below |
| `gh pr merge` that needs none | no | let through; the record is not opened |
| `gh pr merge --disable-auto`, `gh pr ready`, `gh pr ready --undo` | no | judged as today |
| `gh pr merge` when `gh pr view` fails | no | judged as today |
| `gh pr merge` that needs an override, of a PR without a github.com address | no | refused as with no grant; with `--admin`, told no override applies (below) |
| `gh pr merge` when `gh` is not on the hook's path | no | judged as today: let through, or with `--admin` refused, now told no override applies (below) |
| a merge through `gh api` | no | refused as today |
| any of these while the plugin is off in the session | no | let through as today |

A grant is found by the PR's whole name. One for `acme/demo#12` is not found by a merge of `acme/demo#13` or
of `other/repo#12`, and stays.

A merge that needs an override and finds grants it cannot use gets, in `log` mode too:

``This session's merge overrides could not be used, so this merge was judged without one: <error type>: <error>.``

then a blank line, then the refusal it gets without a grant. The line is also written to `errors.log`, when
that can be written.

## What an `--admin` merge is told about overriding

The `--admin` refusal is today's, but for the sentence after "Only the user overrules them:".

| The PR | The sentence |
|---|---|
| has a name | ``they start a prompt with `override-merge acme/demo#12`.`` The line, typed as given, is recorded. |
| `gh` is not on the hook's path | ``an override names the PR `gh pr view` finds, and `gh` is not on this hook's path, so none can be applied until it is.`` |
| its address is not a github.com PR | ``an override names a PR by its repo, and `gh pr view` gave no github.com address for this one.`` |

How to attest, the refusal an unattested merge gets, is not changed. It does not mention the override today.

## What each broken case gets

| The grants | A typed override | A merge that needs an override | A merge that needs none |
|---|---|---|---|
| healthy | recorded | passes once on a grant; otherwise refused | passes; a grant held is left |
| session id that is not a plain name, or none | not recorded; no record made | refused, with the note | passes |
| record not in the data model's form | not recorded; record left as found | refused, with the note; record left as found | passes; record left as found |
| `sessions` is a file, or cannot be written | not recorded | refused, with the note | passes |
| the plugin's other scripts are missing, or do not load | not recorded | refused with the gate's general failure answer | refused the same |
| a file in the old folder, whatever it holds | recorded in the state folder | as if the file were not there | passes |

What `<error>` is, and the step it names:

| Case | `<error>` |
|---|---|
| record not in the data model's form | `<record> is not a record the merge gate wrote (<why>). The user deletes it and types the override again`. `<why>` is `it is not {"granted": [PR names]}` or the parser's message. What the record holds is not repeated. |
| session id that is not a plain name | `session_id <id> is not a name a state file can be kept under. No merge override can be kept in this session: the merge waits for what it lacks, or is run from another session` |
| the folder, or the plugin's own scripts | the system's error as raised, with the path in it. The gate names no step it does not know. |

**GitHub's answer about a release cannot be read** (research R5): with a grant held, a merge without `--admin`
is refused with the gate's general failure answer and the grant is kept. The same merge with `--admin` passes
on the grant.

**Not met where the switch fails first** (research R5, issue #49): when the session's switch cannot be read and
`errors.log` cannot be written, as with a file where the state folder should be, a merge or a publish is refused
with the gate's general failure answer, as on main. A typed override is still answered as not recorded.

## The write guard

An agent's Edit or Write to the record gets what an edit to any record in the state folder gets, from
`gate.py`, unchanged: `The review ledger is written by the gate only.` when the plugin is on and enforcing.

## Test list

Three kinds.

- **New**: written first and seen to fail on main. Where main fails it only because main does not take an
  override that names its repo, the row also names the wrong version of the new code that fails it for the
  row's own reason.
- **Guard**: pins behaviour that does not change, so it passes on main. It is first seen to fail on the wrong
  version it names.
- **Kept**: an existing test of the override. It changes in what it types, in the address its stand-in PR
  has, and in where its state is kept (SC-004). One that shows a refusal also shows the same override letting
  its own merge through; without that it passes on a gate that grants nothing.

Run on 2026-10-07 as the tests of `tests/test_pre_merge_gate.py`, by the author: every row passes on the new
script; every new and kept row fails on main's; every guard row passes on main's; every wrong version fails the
rows that name it.

On main a typed `override-merge owner/repo#N` is not taken: it is answered with nothing and grants nothing. A
row that types one fails on main for that, whatever more its cell says of main.

| # | Kind | The test shows | Fails on main because | Wrong version that fails it |
|---|---|---|---|---|
| N1 | new | an override is recorded as `{"granted": ["acme/demo#12"]}` under the state folder; the second folder does not come to exist | main does not take the name, and keeps grants in the old folder | grants kept in the old folder |
| N2 | new | a recorded override shows the user and the agent the same line, naming the PR | main does not take the name, and tells the agent only | the line sent to the agent only |
| N3 | new | `override-merge #12` is answered with what to type, writes nothing, and an `--admin` merge is still refused | main grants on it | |
| N4 | new | a `Write` to the file the gate wrote, found by listing the folders, is refused | main does not take the name, so no file is written | grants kept in the old folder |
| N5 | new | a file in the old folder grants nothing and is left as it was, in the old form and in the new | main reads it as a grant | |
| N6 | new | an attested merge leaves a held grant, and an `--admin` merge then passes on it once | main does not take the name | the grant asked for before `unmet` |
| N7 | new | the same for a version-only release | the same | the same |
| N8 | new | while the record's lock is held a merge that needs the grant waits; the grant is taken away meanwhile, and the merge is refused | main locks another file | the grant read before the lock |
| N9 | new | an override under an id that is not a plain name, or under none, is answered as not recorded, with what can be done | main answers nothing | |
| N10 | new | an `--admin` merge under such an id gets the note, the same words, and the `--admin` refusal | main gives no note | |
| N11 | new | an override over each damaged record names the record and the repair, leaves it as found, and repeats nothing it holds | main does not read that file | what the record holds quoted in the answer |
| N12 | new | an unattested merge over each damaged record gets the note and how to attest; an `--admin` one gets the note in `log` mode | main gives no note | the last refusal sent through `hookio.refuse` |
| N13 | new | after the damaged record is deleted, the override is recorded and one merge passes | main does not read that file | |
| N14 | new | `sessions` a file, and `sessions` read-only: the override is not recorded; an `--admin` merge gets the note | main keeps grants elsewhere | |
| N15 | new | a file where the state folder should be: the override is answered as not recorded | main keeps grants elsewhere | |
| N16 | new | a failure to record, and a failure to use, each leave a line in `errors.log` | main writes none | |
| N17 | new | an override typed while off is recorded under the state folder | main does not take the name | grants kept in the old folder |
| N18 | new | no file of the plugin spells the old folder; `pre_merge_gate.py` spells neither `fcntl` nor `SESSION_ID` | the merge gate has all three | |
| N19 | new | the script run apart from the plugin's other scripts still answers an override as not recorded | main does not need them | |
| N20 | new | a `hookio.py` that does not parse, and one that raises when loaded: the override is answered as not recorded, exit 0 | main does not load it, and grants | the log step's guard letting only a missing module and a file error pass |
| N21 | new | the README's State section lists the record; the README gives the override as `override-merge owner/repo#N` and nowhere as `override-merge #N` | the README has neither | |
| N22 | new | an `--admin` refusal gives `override-merge acme/demo#12` | main gives `override-merge #12` | |
| N23 | new | a grant for `acme/demo#12` does not let `other/repo#12` through, before or after an attested merge of its own PR, and then lets its own through | main does not take the name | the name built without the repo |
| N24 | new | a name typed in capitals, and GitHub answering in capitals, both find the grant | main does not take the name | the name kept as typed |
| N25 | new | `gh` not on the hook's path, grant held: `--admin` is refused, told none can be applied, and given no line | main gives `override-merge #12` | |
| N26 | new | a PR without a github.com address: `--admin` is refused, told no override can name it, and given no line | main gives `override-merge #12` | |
| N27 | new | an override typed twice grants one merge | main does not take the name | the names kept as a list |
| N28 | new | another PR, the same number in another repo and another session find no grant; the grant stands in for a missing attestation once | main does not take the name | the name built without the repo; every session's grants kept under one id; a grant asked for by an `--admin` merge only |
| N29 | new | GitHub's answer about a release cannot be read, grant held: the merge is refused with the general answer, the grant is kept, and `--admin` then passes | main does not take the name, so no grant is held | the grant asked for before `unmet` |
| G1 | guard | an attested merge passes over each damaged record and leaves it as found | | the grant asked for before `unmet` |
| G2 | guard | an attested merge passes under an id that is not a plain name | | the same |
| G3 | guard | over a damaged record, `gh pr ready`, `--undo`, `--disable-auto`, a merge `gh pr view` cannot name and a `gh api` merge are judged as today | | the grants read at the top of `gated` |
| G4 | guard | over a damaged record, a session that is off is let through | | the same |
| G5 | guard | in `log` mode, with no override typed, an `--admin` merge and an unattested merge are refused | | the last refusal sent through `hookio.refuse` |
| G6 | guard | a prompt that is not an override prints nothing and writes nothing | | an answer built before the keyword is matched |
| G7 | guard | the line an `--admin` refusal gives, typed as given, lets that merge through | | the refusal giving `override-merge #12` |
| K1 | kept | a held grant does not publish a draft; an `--admin` merge then passes on it | main does not take the name | a grant asked for by a publish too |
| K2 | kept | a grant is not spent while `gh pr view` fails; once it answers, the merge passes on it | the same | none built: the PR's name comes from the answer that failed |
| K3 | kept | an override quoted lower in a prompt grants nothing; typed at the start it does | the same | the keyword looked for anywhere in the prompt |

The existing tests "one PR", "one session", "exactly one merge", "stands in for the attestation", "named in
the refusal", "`gh` not on the path" and "typed while off" are the new rows above that show the same thing.
Each keeps its name (SC-004); N28 is three of them.

The damaged records: `[12]`, text that is not JSON, an empty file, a list nested 100,000 deep, a second key,
numbers for names, a name in capitals, `true` for a name, and an object holding words written to be obeyed.
