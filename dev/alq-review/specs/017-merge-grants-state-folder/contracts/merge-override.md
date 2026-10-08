# Contract: the merge override and what the merge gate answers

The record and the PR name are in [data-model.md](../data-model.md). The last table here is the test list.

This document says what each answer tells, not its words. The words are the script's, and the tests named in
the last table hold them. A second copy here was held by nothing, and by 2026-10-08 it had gone stale twice.

What Claude Code shows the user of an answer was not run by anyone (quickstart, step 5).

## How a typed command is read

Every command the user types to the plugin is read the same way (research R9): `override-merge`, `unlock`,
`override`, the rescope and the switch.

- A command is a prompt's first words. A prompt that only holds one lower down is not a command.
- A blank parts two words: a space, a tab or a line break. Nothing else does, and nothing else is passed over
  before the first word.
- A word is read whole, and its capitals count. `unlock`, `unlocked` and `Unlock` are three words; `#7.` is not
  the number 7.
- A PR's name is one word, read by the one reader of names (data model). Its capitals do not count.

## What the user types

`override-merge owner/repo#N`: the keyword, then the PR's name. One form. What comes after the name, past a
blank, is the user's to write. The `--admin` refusal prints the line for the PR in hand.

A prompt whose first word is the keyword is always answered. Followed by a PR's name, it is an override.
Followed by anything else, or by nothing, it grants nothing and is told what to type: `#12`, a name whose
number starts with `0`, a name with a letter or digit from outside ASCII, a name with a mark joined to its
end.

A prompt whose first word is not the keyword is not answered by the merge gate.

## What the user and the agent are told

One line, the same for the user (`systemMessage`) and the agent (`additionalContext`), under the plugin's
prefix, as the switch's answers are.

| The prompt's first words | The line tells |
|---|---|
| the keyword and a name, recorded | that the user granted one merge of that PR past its unmet requirements, `--admin` included |
| the keyword and a name, not recorded | that the override for that PR could not be recorded and nothing is granted, then the error's type and message |
| the keyword and anything else, or nothing | that the keyword is not followed by a PR's name, that nothing is granted, and the form to type |
| anything else | nothing |

The hook exits 0 each time and the rest of the prompt goes on. An override that was not recorded is also one
line in `errors.log`; when that cannot be written, the answer ends by saying so, with the reason.

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

A merge that needs an override and finds grants it cannot use is told, in `log` mode too, that the session's
merge overrides could not be used and the merge was judged without one, with the error's type and message.
Then a blank line, then the refusal it gets without a grant. The note is also written to `errors.log`; when
that cannot be written, it ends as an unrecorded override's answer does.

## What an `--admin` merge is told about overriding

The `--admin` refusal is today's, but for what follows "Only the user overrules them:".

| The PR | What follows |
|---|---|
| has a name | that they start a prompt with the override for this PR, given in full. That line, typed as given, is recorded. |
| `gh` is not on the hook's path | that an override names the PR `gh pr view` finds, so none can be applied until `gh` is on the path. No line is given. |
| its address is not a github.com PR's | that an override names a PR by its repo, and `gh pr view` gave no github.com address for this one. No line is given. |

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

What the error says, and the step it names:

| Case | The error |
|---|---|
| record not in the data model's form | names the record, says it is not one the merge gate wrote and why (not the form, or the parser's message), and that the user deletes it and types the override again. What the record holds is not repeated. |
| session id that is not a plain name | the session helper's words, then that no merge override can be kept in this session: the merge waits for what it lacks, or is run from another session |
| the folder, or the plugin's own scripts | the system's error as raised, with the path in it. The gate names no step it does not know. |

**GitHub's answer about a release cannot be read** (research R5): with a grant held, a merge without `--admin`
is refused with the gate's general failure answer and the grant is kept. The same merge with `--admin` passes
on the grant.

**Not met where the switch fails first** (research R5, issue #49): when the session's switch cannot be read and
`errors.log` cannot be written, as with a file where the state folder should be, a merge or a publish is refused
with the gate's general failure answer, as on main. A typed override is still answered as not recorded.

## The write guard

An agent's Edit or Write to the record gets what an edit to any record in the state folder gets, from
`gate.py`'s write guard, unchanged, when the plugin is on and enforcing.

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

Rows N1 to N45, G1 to G7 and K1 to K3 are tests of `tests/test_pre_merge_gate.py`. N46 to N50, G8, G10 and G11 are
in `tests/test_gate.py`; N51 to N53 and G9 in `tests/test_switch.py`; N54 in `tests/test_claim_gate.py`; N55 and
N56 in `tests/test_shim_gate.py`. What was run, when and by whom is in research R7.

On main a typed `override-merge owner/repo#N` is not taken: it is answered with nothing and grants nothing. A
row that types one fails on main for that, whatever more its cell says of main.

| # | Kind | The test shows | Fails on main because | Wrong version that fails it |
|---|---|---|---|---|
| N1 | new | an override is recorded as `{"granted": ["acme/demo#12"]}` under the state folder; the second folder does not come to exist | main does not take the name, and keeps grants in the old folder | grants kept in the old folder |
| N2 | new | a recorded override shows the user and the agent the same line, naming the PR | main does not take the name, and tells the agent only | the line sent to the agent only |
| N3 | new | `override-merge #12` is answered with what to type, writes nothing, and an `--admin` merge is still refused | main grants on it | the keyword without a name left unanswered |
| N4 | new | a `Write` to the file the gate wrote, found by listing the folders, is refused | main does not take the name, so no file is written | grants kept in the old folder |
| N5 | new | a file in the old folder grants nothing and is left as it was, in the old form and in the new | main reads it as a grant | |
| N6 | new | an attested merge leaves a held grant, and an `--admin` merge then passes on it once | main does not take the name | the grant asked for before `unmet` |
| N7 | new | the same for a version-only release | the same | the same |
| N8 | new | while the record's lock is held a merge that needs the grant waits; the grant is taken away meanwhile, and the merge is refused | main locks another file | the grant read before the lock |
| N9 | new | an override under an id that is not a plain name, or under none, is answered as not recorded, with what can be done | main answers nothing | the answer cut before what can be done |
| N10 | new | an `--admin` merge under such an id gets the note, the same words, and the `--admin` refusal | main gives no note | the same |
| N11 | new | an override over each damaged record names the record and the repair, leaves it as found, and repeats nothing it holds | main does not read that file | what the record holds quoted in the answer; a name in a record not read by the reader of names; a record's names taken from an object's keys; the number's digits not held to `0` to `9`; the name's letters not held to ASCII |
| N12 | new | an unattested merge over each damaged record gets the note and how to attest; an `--admin` one gets the note in `log` mode | main gives no note | the last refusal sent through `hookio.refuse`; and those of N11 but the first |
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
| N26 | new | a PR without a github.com address, and one whose address has a number written `012`, a letter from outside ASCII or a space in its name: `--admin` is refused, told no override can name it, and given no line | main gives `override-merge #12` | the address read by a pattern of its own; the name's letters not held to ASCII |
| N27 | new | an override typed twice, with more words after the name, grants one merge | main does not take the name | the names kept as a list |
| N28 | new | another PR, the same number in another repo and another session find no grant; the grant stands in for a missing attestation once | main does not take the name | the name built without the repo; the name built with one number whatever the PR; every session's grants kept under one id; a grant asked for by an `--admin` merge only |
| N29 | new | GitHub's answer about a release cannot be read, grant held: the merge is refused with the general answer, the grant is kept, and `--admin` then passes | main does not take the name, so no grant is held | the grant asked for before `unmet` |
| N30 | new | an override whose number is thousands of digits long is answered as granted, exit 0 | main does not take the name | the number counted when the name is read |
| N31 | new | a folder where `errors.log` should be: a failure to record and a failure to use are answered as in N9 and N12, each ending by saying the log line was not written, with the reason, and the same when the hook's stderr cannot be written | main does not take the name | the ending left out; the ending also printed on stderr; the ending without the reason; the ending put first |
| N32 | new | a name with a digit, a dot, a hyphen and an underscore in it, typed in capitals, is recorded in lower case and its `--admin` merge passes | main does not take the name | each of the four left out of what a name may hold; a number of two digits at least; a word after the name read as part of the command |
| N33 | new | of every character there is, owner and repo take ASCII letters, digits, `.`, `-` and `_`, and no other | main has no reader of names | the name's letters not held to ASCII, in the owner or in the repo; the text put in lower case before it is read |
| N34 | new | of every character there is, a number takes the digits `0` to `9`, and does not start with `0` | the same | the number's digits not held to `0` to `9`; a name found at the start of a longer text |
| N35 | new | one `/` and one `#` join a name's parts, and nothing else does | the same | a second mark taken for each |
| N36 | new | a name is kept in lower case, its number as written, and reads back as itself | the same | the name kept as typed; the number counted |
| N37 | new | a text with anything before, after or inside a name is no name | the same | a name found at the start of a longer text |
| N38 | new | a PR cannot be built from parts that are not its name in lower case | the same | the check on building left out |
| N39 | new | of every character there is, only a space, a tab and a line break part two words | main has no reader of words | words parted by every kind of blank |
| N40 | new | of every character there is, only those are passed over before the first word | the same | every kind of blank passed over before the first word |
| N41 | new | a prompt's first words: none of an empty prompt, no more than asked for, a mark kept on the word it is joined to | the same | more words handed back than asked for; an empty word handed back |
| N42 | new | a github.com pull request's address names its PR, capitals or not | main has no reader of names | the repo cut at the first `/pull/` |
| N43 | new | any other address names none: another host, `http`, a path that goes on, a number written `012`, a letter from outside ASCII | the same | the address not held to start with github.com's; a name found at the start of a longer text; the name's letters not held to ASCII |
| N44 | new | the keyword followed by nothing, or by a word that is not one whole name, is answered with what to type and writes nothing | main answers nothing | the keyword without a name left unanswered; a mark dropped from the word's end; a name found at the start of a longer text; the number's digits not held to `0` to `9`; the name's letters not held to ASCII |
| N45 | new | a prompt's first line ends at a line break and at no other character, and only blanks are dropped from its ends | main has no reader of lines | every kind of blank dropped before it, or after it; every kind of line break ending it |
| N46 | new | `unlock` and the rescope, with a no-break space, a line separator, a vertical tab or an ideographic space before them or between their words, release nothing and are not answered | main passes over and parts on every kind of blank | words parted by every kind of blank; every kind of blank passed over before the first word |
| N47 | new | the word after `unlock` or the rescope is read whole: `#11,`, `#015`, a full-width digit, a zero-width space and nine more forms release nothing, each with a locked PR of its own to release | main reads the digits it understands and stops | a typed number counted |
| N48 | new | a PR's name unlocks its PR whatever its capitals, typed or kept | main compares the repo as typed | the name compared as typed |
| N49 | new | a PR kept under a repo that is no name is not unlocked by a word that is no name, and is by `#` and its number | main reads a letter from outside ASCII as part of a name | two texts that are both no name taken for the same name |
| N50 | new | an answer names the command by its words, a blank apart | main quotes the prompt's own blanks | the word after the command's last quoted with it |
| N51 | new | the switch, with one of those four before it or between its words, changes nothing and is not answered | main passes over and parts on every kind of blank | as N46 |
| N52 | new | the switch's line ends at a line break only: a line separator, a vertical tab, a form feed or a next-line mark after `off` leaves it one line, which is not a switch | main ends a line at each of them | every kind of line break ending a line |
| N53 | new | `alq-review` alone, or followed by anything but `on` or `off` alone on its line, changes nothing and is answered with the two forms | main answers only when `on` or `off` comes next | the answer given only when `on` or `off` comes next; the words read across lines |
| N54 | new | `unlock claim-<id>`: a no-break space for the blank, or a line separator first, is not answered; a mark joined to the id releases nothing; blanks of the three kinds release the claim | main takes all four | a claim's name found at the start of a longer word; and as N46 |
| N55 | new | `override shim-<id>`: a no-break space for the blank, a line separator first, `overrides`, `Shim-` and a second word that does not start `shim-` are not answered and leave the commit refused; blanks of the three kinds switch the check off | main takes the first two | a bug's name found at the start of a longer word; a word that starts with `override` taken for it; and as N46 |
| N56 | new | `override` and a word that starts `shim-` and is no bug's name (a mark joined to the id, an id one digit short, `shim-` alone) is answered that it names no bug, and the commit stays refused | the script before it answers nothing | the answer kept for a whole bug's name only |
| G1 | guard | an attested merge passes over each damaged record and leaves it as found | | the grant asked for before `unmet` |
| G2 | guard | an attested merge passes under an id that is not a plain name | | the same |
| G3 | guard | over a damaged record, `gh pr ready`, `--undo`, `--disable-auto`, a merge `gh pr view` cannot name and a `gh api` merge are judged as today | | the grants read at the top of `gated` |
| G4 | guard | over a damaged record, a session that is off is let through | | the same |
| G5 | guard | in `log` mode, with no override typed, an `--admin` merge and an unattested merge are refused | | the last refusal sent through `hookio.refuse` |
| G6 | guard | a prompt whose first word is not the keyword prints nothing and writes nothing: the keyword lower in the prompt, in capitals, in backticks, with a letter or a mark joined to it, or with a no-break space after it | | an answer built before the keyword is matched; the keyword looked for anywhere in the prompt; a word that starts with the keyword taken for it; words parted by every kind of blank |
| G7 | guard | the line an `--admin` refusal gives, typed as given, lets that merge through | | the refusal giving `override-merge #12` |
| G8 | guard | spaces, tabs and line breaks before `unlock` and between its words are passed over, and what follows on later lines is not read | | none: it is the form every other test of `unlock` types, with more blanks |
| G9 | guard | a first word that is not the plugin's name is not answered: a mark joined to it, a letter more, a capital, backticks | | a word that starts with the plugin's name taken for it |
| G10 | guard | a word that only starts like a command's word is not it: `unlocked`, `unlock#7`, `Unlock`, the skill's name with a letter or a mark more or under another plugin's name, `rescoped` | | a word that starts with `unlock`, or with the rescope's words, taken for it |
| G11 | guard | a prompt with too few words for a command is not answered and nothing is unlocked: empty, blanks only, `unlock` or `override` alone, the rescope without its PR | | a command taken from its first word alone; a prompt's first word read where it has none |
| K1 | kept | a held grant does not publish a draft; an `--admin` merge then passes on it | main does not take the name | a grant asked for by a publish too |
| K2 | kept | a grant is not spent while `gh pr view` fails; once it answers, the merge passes on it | the same | none built: the PR's name comes from the answer that failed |
| K3 | kept | an override quoted lower in a prompt grants nothing; typed at the start it does | the same | the keyword looked for anywhere in the prompt |

The existing tests "one PR", "one session", "exactly one merge", "stands in for the attestation", "named in
the refusal", "`gh` not on the path" and "typed while off" are the new rows above that show the same thing.
Each keeps its name (SC-004); N28 is three of them. Three existing tests of the other commands are named by
wrong versions of this round and are not rows: the switch followed by a further word, the switch's log line,
and the unlock a refusal names.

Added on 2026-10-08, after the PR was opened.

- Review round 1: N30; N31; two damaged records (a number with a leading zero, digits that are not `0` to
  `9`); two prompts with a name that is not one, then in G6 (a number written `012`, a letter from outside
  ASCII); a wrong version for N9 and N10 and one more for N11, N12 and N28.
- Review round 2: N31 as it now reads; one damaged record (a letter that is not ASCII), and the record of
  digits that are not `0` to `9` now starts with a `1`; two such prompts more (a number that goes on in a
  digit, and in a letter, from outside ASCII); three addresses for N26; four wrong versions.
- Review round 3: N32 to N38 and N42 to N44, with the reader of names; three tests of the override's word,
  since replaced by N39 to N41; G6 as it now reads, its prompts with a name that is not one moved to N44, where
  they are answered; twenty-one wrong versions.
- The audit of the branch: N39 to N41 on the reader of words, N45 to N55, G8 to G10; nineteen wrong versions,
  and seven of round 3's rebuilt on the reader of words.
- Review round 4: N56, and N55 without the words N56 now answers. G11; in G10 a rescope under another plugin's
  name; in N53 `on` or `off` as a third word; in N54 a claim nobody holds. Eight wrong versions.

The damaged records: `[12]`, text that is not JSON, an empty file, a list nested 100,000 deep, a second key,
numbers for names, a name in capitals, `true` for a name, a number with a leading zero, digits that are not
`0` to `9`, a letter that is not ASCII in the owner and in the repo, the word `None` for a name, an object
with names as its keys for the list, and an object holding words written to be obeyed.
