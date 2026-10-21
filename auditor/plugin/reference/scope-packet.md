# The scope packet

The interface between an orchestrating skill and a detector agent. A skill builds
one packet per dispatch and pastes it verbatim into the agent's prompt; every
agent reads the same fields. This is the only thing the two skills share, and it
is why one agent body serves both.

An agent that receives a packet missing a required field stops and says which —
it never guesses a boundary.

## Fields

| Field | Values | Meaning |
|---|---|---|
| `mode` | `delta` \| `unit` | `delta` audits a branch's changes; `unit` audits a standing slice of a tree. Only the fields below differ — the checks do not. |
| `repo` | name + absolute root path | Where the agent reads. Never read outside it. |
| `visibility` | `public` \| `private` | What may appear in the tree at all. |
| `unit` | free text | Human label for the report — `"PR delta"`, `"packages/validator"`, `"repo-wide"`. |
| `files` | explicit list, or path globs with exclusions | The agent's boundary. Every file in it is the agent's responsibility. |
| `regions` | `changed-hunks` \| `whole-file` | What counts as the subject. With `changed-hunks` the packet also carries the diff. |
| `read_beyond` | `yes` \| `no` | Whether the agent must read past its regions to judge them. `yes` under `changed-hunks`: pre-existing code is context for the verdict, not itself a finding, except where an agent's own body says otherwise. |
| `baseline` | a git ref | `delta`: the merge-base. `unit`: the ref the sweep is pinned to. |
| `suppressions` | list of categories, possibly empty | Categories the invoker excluded. The commonest is compatibility/legacy work when the invoker asked for it — those stop being findings, and only then. |
| `standards` | pointers | `[[coding-principles]]` and `[[schema-contracts]]` — the rules being enforced. An agent cites them; it does not restate them. |
| `focus` | named symbols, or absent | Optional. Code paths the invoker wants compared directly — read by `semantic-parity`, ignored by everyone else. It is an argument to one invocation, never persisted: no detector may ask for a list to be kept. |

## What a packet does not carry

Not the hunt list, and not the report format. The hunt list is the agent's body —
one copy, per category. The report format is `finding-format.md` beside this file.
A skill that spells out what to look for has started a second copy; it names the
agent and hands it a boundary instead.
