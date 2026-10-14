# Quickstart: verify #101

Run from `dev/alq-review/`. Steps 1–3 are the red/green checks: run them on `main` first and confirm they fail
there for the stated reason.

0. **Fixtures exist before any test is written (R8)**
   ```bash
   ls tests/fixtures/codex/
   cmp -s specs/101-codex-card-status/samples/verdict-comment.md tests/fixtures/codex/verdict-comment.md && echo same
   ```
   - Expected: the ten names of the spec folder's `samples/`, each byte-identical to its sample (R8).

1. **The reader's states (R5, R4)**
   ```bash
   python -m unittest -v test_codexstate
   ```
   - On `main`: every test errors with `ModuleNotFoundError: No module named 'codexstate'`. This is the red check.
   - On the branch: all pass; the names cover `not_started`, `reviewing`, `answered`, `superseded`, `declined`,
     every `unreadable` reason, and the CLI's exit 2 on malformed input.

2. **The poller never exits 0 while the row says Running (SC-001)**
   ```bash
   python -m unittest -v test_poll_pr_review -k reviewing -k running_row -k superseded -k unknown -k card
   ```
   - On `main`: the Running-card tests fail with `AssertionError: 0 != 3` (the poller exits CLEAN on the card);
     the superseded test fails with `0 != 4`; the unknown-item test with a timeout exit 3 where 4 is expected.
   - On the branch: all pass.

3. **The whole suite, as CI runs it (SC-003, SC-004)**
   ```bash
   python -m unittest -v
   ```
   - Expected: every test passes, `test_shipped_tree` included (the new script imports from a copy holding only
     this plugin).

4. **The reader by hand, with a card in each state (contract)**
   ```bash
   jq -n --arg body "$(cat tests/fixtures/codex/card-one-row-completed.md)" \
     '{since: "2026-10-13T11:57:42Z", head: "<the fixture row'"'"'s commit, padded to 40 hex>",
       items: [{kind: "comment", url: "u", at: "2026-10-13T12:50:58Z", body: $body}]}' \
     | python3 ../../plugins/alq-review/scripts/codexstate.py
   ```
   - Expected: `"state": "answered"` with the row's `status_at`. Change `head` to another SHA: `superseded`.
     Move `since` past the row's time: `not_started`. Delete the `datetime` attribute from the fixture copy:
     `unreadable` with `no datetime in the Status cell`.

5. **Against a live PR (optional, needs `gh`)**
   ```bash
   ../../plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh analitiq-ai/claude-plugins-internal <pr> --minutes 1
   ```
   - On a PR whose card says Running: the first `[poll 1] waiting on:` line reads `Codex is reviewing <sha> since
     <time>` and the run ends `TIMEOUT` (exit 3), never `CLEAN`.

6. **Prose states the rule (FR-009)**
   ```bash
   grep -n "a comment, a review, or a 👍" ../../plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh \
     ../../plugins/alq-review/skills/alq-github-pr-review/SKILL.md
   grep -n "codexstate" ../../plugins/alq-review/README.md
   ```
   - Expected: the first grep prints nothing; the second finds the Layout row.

7. **Contract**: read `codexstate.py`'s output and the poller's lines against
   [contracts/codex-reader.md](contracts/codex-reader.md).
