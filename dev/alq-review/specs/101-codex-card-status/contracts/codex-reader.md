# Contract: the Codex reader and what the poller prints per state (#101)

Two interfaces: `codexstate.py`'s stdin/stdout (R1, R2, R5) and the poller's lines and exit codes per state
(R6). Both are inside one plugin; nothing outside it reads them.

## `python3 scripts/codexstate.py`

### Input (stdin, one JSON object)

```json
{
  "since": "2026-10-13T11:57:42Z",
  "head": "d14438b0c1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6",
  "items": [
    {"kind": "comment", "url": "https://github.com/o/r/pull/7#issuecomment-1", "at": "2026-10-13T12:50:58Z", "body": "<!-- codex-pull-request-review-summary -->\n…"},
    {"kind": "review",  "url": "https://github.com/o/r/pull/7#pullrequestreview-9", "at": "2026-10-13T12:55:04Z", "body": "### 💡 Codex Review\n…"}
  ]
}
```

`since` and every `at` are ISO-8601 UTC with a `Z`. `items` holds every Codex comment and review on the PR, any
time. Produced by the poller's `CODEX_ITEMS` jq program.

### Output (stdout, one JSON object, exit 0)

```json
{
  "state": "answered",
  "commit": "d14438b",
  "status_at": "2026-10-13T12:55:07Z",
  "spoke": true,
  "comments": [{"url": "…", "at": "…", "body": "Codex Review: Didn't find any major issues. …"}],
  "unknown": null,
  "errors": []
}
```

| `state` | `commit` | `status_at` | `unknown` | `errors` |
|---|---|---|---|---|
| `not_started` | row's or null | row's or null | null | `[]` |
| `reviewing` | row's | row's (Running since) | `{kind, url, at}` or null | `[]` |
| `answered` | row's (prefix of `head`) | row's (the answer time) | `{kind, url, at}` or null | `[]` |
| `superseded` | row's (not a prefix of `head`) | row's | `{kind, url, at}` or null | `[]` |
| `declined` | null | null | `{kind, url, at}` | `[]` |
| `unreadable` | null | null | null | one or more reasons |

`unknown` is the earliest item since the trigger matching no form; it makes the state `declined` only when no
Code Review row has a status time after `since`.

Each error reads `Codex status card <url> cannot be read: <why>; its format changed: report it on the plugin's
repo and read the PR by hand`, with `<why>` one of the seven FR-007 lists: `no Code Review row`, `<n> Code
Review rows`, `status is neither Running nor Completed`, `no datetime in the Status cell`, `datetime <text> is
not in the card's format`, `no commit in the Commit cell`, `<n> comments carry the marker`.

### Exit codes

| Exit | When |
|---|---|
| 0 | the input was read; the state is on stdout, `unreadable` included |
| 2 | stdin is not the input shape; `codexstate: <why>` on stderr, nothing on stdout |

### Pure function

`state(items: list[dict], since: str, head: str) -> dict` returns the output object. `main()` only reads,
validates, calls it and prints.

## The poller, per state

| `codex.state` | Waits? | Report line | Exit |
|---|---|---|---|
| `not_started` | yes: `Codex has not answered since <since>`; no when `waived` | — | 3 at the deadline; when `waived`, as today (0 clean) |
| `reviewing` | yes: `Codex is reviewing <commit> since <status_at>`, `waived` or not | WARNING when `unknown` | 3 at the deadline |
| `answered` | no (other waits may hold) | as today; WARNING when `unknown` | 2 findings · 0 clean · 4 blocked |
| `superseded` | no | `Codex reviewed <commit>, not the head <head[0:10]>: comment \`@codex review\``; WARNING when `unknown` | 2 if findings or failing checks, else 4; never 0 |
| `declined` | no | `Codex's reply is not one the poller knows (<url>, <at>): Codex declined or changed what it posts; read it.`, omitted when `waived` | 2 if findings or failing checks, else 4; never 0; when `waived`, as today (0 clean) |
| `unreadable` | — | `ERROR: <each error>` on stderr | 1 at once |

`waived`: a `codex-review` run on the head from the App, SUCCESS, whose title starts `WAIVED:` (FR-013); a
SUCCESS run with another title is not. The WARNING line is `WARNING: Codex's reply is not one the poller knows
(<url>, <at>); read it.` Every report carries, after its header, `Codex: <state> <commit> at <status_at>`
(`since` for `reviewing`; `Codex: not started` with no row) (FR-014).

Unchanged: the draft rule, the running-checks wait, the mergeability wait, the `codex-review` lag wait and its
one sweep dispatch (now timed from `status_at`), the 👍-on-trigger note, the exit codes' meanings in `SKILL.md`,
the inbox drop's shape, and the waiver's outcome (exit 0 under a WAIVED run on the head).

`Codex comments since the trigger (codex-review is not success):` lists `codex.comments` only: never the card
(FR-006), an unknown comment included.
