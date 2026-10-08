# Data model: merge override grants

## PR name (R8)

`owner/repo#N`: the repo as GitHub names it, a `#`, and the PR's number. `owner` and `repo` are ASCII letters,
digits, `.`, `-` and `_`; `N` is the digits `0` to `9`, the first not `0`. Kept and compared in lower case. The
number is text: it is compared, never counted.

A name has one reader, `PullRequest.named`. It is handed a whole text and answers with the PR or with nothing.
It never looks for a name inside a longer text, so nothing can follow a name, or sit inside one, unjudged. A
`PullRequest` built from its parts is held to the same reading.

Four texts are handed to it, each whole:

| From | The text |
|---|---|
| a prompt starting `override-merge` | the prompt's second word (R9) |
| a prompt starting `unlock` or the rescope | the command's last word, and the locked PR's repo and number written as a name, to compare the two |
| `gh pr view` | the PR's address, `https://github.com/owner/repo/pull/N`, rewritten as `owner/repo#N`. A PR with any other address has no name |
| a record | each item of `granted`, which must also be in lower case, as the gate writes it |

## A typed command's words (R9)

A prompt is read as words by one reader, `first_words`, and its first line by `first_line`. A blank is a
space, a tab or a line break. Blanks part words and are dropped before the first; no other character is. A
line ends at a line break and nowhere else. A word is handed on whole.

## Grant record — `sessions/<session id>.merge.json` (R1, R2)

Under the state root, beside `<session id>.merge.lock`. It appears the first time the session types an
override or runs a merge that needs one (contract); such a merge with no override typed leaves
`{"granted": []}`.

| Field | Meaning |
|---|---|
| `granted` | the PRs this session may merge once each: a list of PR names, written sorted, each once |

No other field. Written only by `pre_merge_gate.py`, through `hookio.session_state`.

- `<session id>` is a plain name, by `hookio`'s rule. For any other id there is no record and none is made (R3).
- A record that is not this form is unreadable: text that is not JSON, anything but an object, a key other
  than `granted`, a `granted` that is not a list of PR names in lower case. Unreadable is never a grant, it is
  said where it is found, and the record is left as found (R2).
- An unreadable record is repaired by hand: the user deletes it and types the override again. Both answers that
  meet one say so and name it. Neither repeats what it holds (R2).
- `{}` reads as no grants. It is what the helper hands back when the file is not there.
- The helper writes the record in place. A write that fails part-way can leave it empty, which is then
  unreadable (issue #48).

## A grant's life

| Event | The record |
|---|---|
| the user starts a prompt with `override-merge owner/repo#N` | the PR's name is added; typed again, nothing changes |
| the user starts a prompt with `override-merge` and anything but a PR's name, `#N` included | not opened; nothing is granted |
| a `gh pr merge` of that PR in that session that needs an override | the name is removed and that merge is let through on it |
| a `gh pr merge` of that PR that needs none | not opened; the name stays for a merge that needs it |
| a merge of another PR, the same number in another repo included | the name stays; that merge finds no grant |
| any other command, another session | unchanged |
| the session ends, or is resumed | the record stays, an unspent grant with it (decision record 0002, decision 8, not built) |

A grant ends only by being spent. It cannot be withdrawn (spec, Assumptions).

A grant that cannot be recorded does not exist (R4). Grants that cannot be read let nothing through, and a
merge that needed one is told so (R5).

No other record changes. `ledger.db`, `gate.log` and the session's switch are not touched. A failure is one
line in `errors.log` (R4, R5); when that line cannot be written, the answer says so.
