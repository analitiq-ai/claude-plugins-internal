# Data model: the poller reads Codex's status card (#101)

Nothing is stored. The entities are the reader's input, what it reads from the card, what it returns, and the
one field the poller's analysis gains. Field shapes are in [contracts/codex-reader.md](contracts/codex-reader.md).

## Codex item (reader input, R2)

| Field | Source | Notes |
|---|---|---|
| `kind` | `comment` for a PR comment, `review` for a PR review | the two kinds of item (Terms); reactions are not items |
| `url` | GraphQL `url` | named in every report line and error |
| `at` | `createdAt` of a comment, `submittedAt` of a review | compared with `since`; the card's is never compared |
| `body` | GraphQL `body` | matched by its beginning (R3); the card's is parsed (R4) |

Items are every comment and review by `chatgpt-codex-connector` on the PR, whatever their time.

## Acknowledgement form (R3)

| Name | Kind | Matched by |
|---|---|---|
| `card` | comment | first line is `<!-- codex-pull-request-review-summary -->` |
| `verdict` | comment | begins `Codex Review: Didn't find any major issues.` |
| `security` | comment | begins `### 🛡️ Codex Security Review` |
| `review` | review | begins `### 💡 Codex Review` |

An item since the trigger matching none is **unknown**: it decides `declined` only when no row answers (order
3 below) and is carried as `unknown` in every other state. A card is matched at any time. Two sampled declines
(`decline-not-connected.md`, `decline-error.md`) match none by design.

## Code Review row (read from the card, R4)

| Field | Cell | Read as | Unreadable when |
|---|---|---|---|
| `status` | Status | `**Running**` or `**Completed**` | neither |
| `status_at` | Status | `datetime="…"`, parsed as `%Y-%m-%dT%H:%M:%S.%fZ` or `%Y-%m-%dT%H:%M:%SZ`, re-printed `%Y-%m-%dT%H:%M:%SZ` UTC | absent, or in neither format |
| `commit` | Commit | first `[0-9a-f]{7,40}` token | absent |

The row is the one whose first cell contains `**Code Review**`; none or more than one is unreadable, as is more
than one comment carrying the marker. Other rows are skipped unread.

## Codex's state for the round (reader output, R5)

| Field | Type | Meaning |
|---|---|---|
| `state` | one of the six below | decided in the order listed |
| `commit` | 7–40 hex or null | the row's Commit cell, when a row was read |
| `status_at` | ISO-8601 Z or null | the row's status time; the answer time when `answered` |
| `spoke` | bool | any non-card item is since the trigger |
| `comments` | list of `{url, at, body}` | non-card Codex comments since the trigger, oldest first |
| `unknown` | `{kind, url, at}` or null | the earliest item since the trigger matching no form, in any state |
| `errors` | list of strings | the reading failures, when `unreadable` |

### State transitions

| Order | Condition | `state` |
|---|---|---|
| 1 | a card cannot be read, or more than one card | `unreadable` |
| 2 | row Running, `status_at > since`, any commit | `reviewing` |
| 2 | row Completed, `status_at > since`, `head` starts with `commit` | `answered` |
| 2 | row Completed, `status_at > since`, `head` does not start with `commit` | `superseded` |
| 3 | no such row, and an item since `since` matches no form | `declined` |
| 4 | no such row, no unknown item | `not_started` |

The row's status is Codex's: it moves `Running → Completed` and, at the next trigger, back to `Running` with a new
`status_at` (Terms). The reader sees one snapshot and decides from it alone.

## Poller analysis (`ANALYZE` output, R6, R7)

| Field | Change |
|---|---|
| `codex` | new: the reader's output, verbatim |
| `responded` | removed; `WAITING_ON` reads `codex.state` |
| `waived` | new: a `codex-review` run on the head from the App, SUCCESS, title starts `WAIVED:` (FR-013) |
| `clean` | also requires `codex.state == "answered"`, or `waived` with `not_started` or `declined` |
| `gate_lags` | the answer time is `codex.status_at` when `answered` |
| `thumbs_on_trigger_only` | a 👍 on the trigger, none on the description, and `codex.spoke` false |
| `gate_comments` | from `codex.comments`; `gist` and `approves` computed as today |
| `errors` | gains `codex.errors` |

## Inbox drop

Unchanged in shape (`test_poller_contract.py`). `gate_comments` never carries the card (FR-006) and carries an
unknown comment when the round exits 2.
