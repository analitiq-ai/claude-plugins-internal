# Data model: merge override grants

## PR name (R8)

`owner/repo#N`: the repo as GitHub names it, a `#`, and the PR's number without leading zeros. Kept and
compared in lower case. Built by one function, from what the user typed and from the address `gh pr view`
gives for the PR being merged. A PR without a github.com address has no name.

The name is spelled in one place: `owner` and `repo` are ASCII letters, digits, `.`, `-` and `_`; `N` is the
digits `0` to `9`, the first not `0`. What the user types, the address GitHub gives and what a record holds are
all matched against that spelling, so a name the gate writes is one it reads back.

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
| the user starts a prompt with `override-merge #N` | not opened; nothing is granted |
| a `gh pr merge` of that PR in that session that needs an override | the name is removed and that merge is let through on it |
| a `gh pr merge` of that PR that needs none | not opened; the name stays for a merge that needs it |
| a merge of another PR, the same number in another repo included | the name stays; that merge finds no grant |
| any other command, another session | unchanged |
| the session ends, or is resumed | the record stays, an unspent grant with it (decision record 0002, decision 8, not built) |

A grant ends only by being spent. It cannot be withdrawn (spec, Assumptions).

A grant that cannot be recorded does not exist (R4). Grants that cannot be read let nothing through, and a
merge that needed one is told so (R5).

No other record changes. `ledger.db`, `gate.log` and the session's switch are not touched. A failure is one
line in `errors.log` (R4, R5); when that line cannot be written, the hook says so on stderr.
