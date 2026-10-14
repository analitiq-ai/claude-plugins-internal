---
name: alq-github-pr-review
description: Use when a PR needs a Codex review requested (or re-requested after pushing fixes), when you must poll/wait for a review response, when review feedback needs to be triaged, answered, and resolved, and when checking that DeepSource graded the PR A. NEVER poll a PR for review feedback with ad-hoc gh loops (gh pr checks / gh api + sleep / for / while) — always this skill; a hand-rolled loop only sees the one reviewer you wrote it for and reports a PR clean while DeepSource, CodeRabbit or human threads sit unresolved.
colour: yellow
---

# Requesting a Codex PR review

A new non-draft PR (or a PR moved from DRAFT to READY) triggers a Codex review automatically — no manual step needed.
Re-reviews are requested by posting a `@codex review` comment **after** all fixes are pushed. Every time the PR changes, request the review again once all changes are pushed.

Codex (`chatgpt-codex-connector[bot]`) answers ~10–15 min later. Its verdict is not yours to read: the org-wide pr-gate reads it and posts the `codex-review` check run, from the `analitiq-pr-gate` App, on the head. Act on that run's state and title as the poller prints them under *Gate check runs*; the title gives the reason for the state.

**A 👍 on the PR description can be Codex's verdict.** When Codex reviews a PR unasked (opened ready for review, or marked ready) and finds nothing, it leaves a 👍 on the description. The gate counts it when it can tie it to the head, and otherwise says why in the `codex-review` title. A reaction triggers no workflow, so while the poller waits for `codex-review` to catch up with Codex's answer (see *settled* below), it dispatches one gate sweep.

**Codex is not the only reviewer.** CodeRabbit, DeepSource and humans leave inline threads too, and an unresolved thread blocks the PR whoever left it. CodeRabbit also puts findings it cannot anchor to the diff ("Outside diff range comments") in its review body only; they have no thread to resolve and still need triage.

**Review threads are not the only blocker.** Checks (`DeepSource: Python`, `CodeRabbit`, and the gate's `codex-review` and `internal-review` check runs) block the PR too. The DeepSource *grade* blocks it as well, and no status carries that — see *DeepSource grade* below.

# Waiting for the response: run the poller

After opening a PR or posting `@codex review`, launch the poller. Never hand-roll a `gh` + `sleep`/`for` watcher — a PreToolUse hook rejects those.

Paths below are relative to this skill directory.

```bash
# poll-pr-review.sh <owner/repo> <pr-number> [trigger-comment-id]
./poll-pr-review.sh analitiq-ai/analitiq-engine 331
```

- The trigger is the given comment id, else the newest `@codex review` comment, else the PR's creation.
- Defaults: polls every 60s for up to 15 min. Override with `--interval <seconds>` / `--minutes <n>`.
- `--ignore-check <name>` (repeatable) leaves a check out for this run only — for a check red for reasons outside the PR and outside the branch's required set. It is announced, and every report lists the ignored checks that are not passing. GitHub then reports `UNSTABLE`, which counts as clean when only ignored checks are not passing; an ignored *required* check still leaves the PR `BLOCKED`.

The poller waits until the round has **settled** — Codex is not reviewing: its status card's Code Review row, dated after the trigger, is waited on while Running, answers when Completed for the head, and settles the round with a re-request when Completed for an earlier commit; with no such row the round waits for one, unless Codex posted a reply not on `scripts/codexstate.py`'s list of what Codex is known to post, which settles it (beside a row such a reply is only a warning); a `WAIVED:` `codex-review` run on the head releases only a round with no such row, never a Running or earlier-commit row; a status card the poller cannot read ends the poll with exit 1; no check is still running, the gate runs and ignored checks aside; with nothing to triage, an in-progress `codex-review` is not older than Codex's answer (for 20 min after that answer); and GitHub has computed mergeability — then prints one report: `mergeStateStatus`, the gate check runs with their titles verbatim (a `WAIVED:` shows here), every failing check, and every unresolved finding with gist and URL, plus severity for Codex, CodeRabbit and DeepSource. Threads opened by the PR's own author are left out. A draft settles at once, because Codex does not review drafts.

Exit codes drive the next step:

| Exit | Meaning | Do next |
|------|---------|---------|
| `0`  | **Clean** — GitHub reports `mergeStateStatus=CLEAN` and nothing is left to triage | Run `deepsource-pr-gate.sh`; if it passes, proceed to merge/next step. |
| `2`  | **Findings** — failing checks and/or unresolved findings printed | Go to *Triaging* below. |
| `4`  | **Blocked** — nothing to triage, but GitHub does not report CLEAN, or Codex reviewed an earlier commit, or Codex replied with something the poller does not know; the `BLOCKED:` line names which | Act on the gate check runs and notes printed: re-request when `codex-review` says to, attest the internal review (see *Attesting the internal review*), approve, update the branch, leave draft. |
| `3`  | **Timeout** — not settled in time; the report says what it was still waiting on | Re-run the poller, or act on what it names. |
| `1`  | **Error** — a usage error, or the poller could not read the PR (`gh` failed, a Codex status card it cannot read, …); stderr says why | Act on what stderr names; for a format change, report it on the plugin's repo and read the PR by hand. |

Exit `2` fires on *any* unresolved finding or failing check, including ones left before this review round — a stale finding still blocks the PR.

Requires the `gh` CLI authenticated for the target repo (`gh auth status`).

# Attesting the internal review

`internal-review` turns `success` only on an `Analitiq-Bot` PR comment in the format defined by the shared gate's README, section [The internal-review attestation](https://github.com/analitiq-ai/.github#the-internal-review-attestation). Take the marker and body from there, not from memory. It must name the full head SHA, so re-attest after every push.

The `alq-review` gate refuses the attestation until its internal round is clean at the head. After fixes from a GitHub round move the head, run a delta internal round before attesting again.

# DeepSource grade

The DeepSource Code Review grade must be A for a PR to merge. It lives only in DeepSource's PR summary comment, which names the commit range it reviewed.

```bash
# deepsource-pr-gate.sh <owner/repo> <pr-number>
./deepsource-pr-gate.sh analitiq-ai/claude-code-plugins 352
```

| Exit | Meaning |
|------|---------|
| `0`  | Overall Grade A and every analyzer passed, on the head commit |
| `2`  | Below A, or an analyzer failed or timed out — the dimension grades, analyzer statuses and run URL are printed |
| `3`  | No summary for the head yet — DeepSource has not finished; run it again later |
| `1`  | Usage error, or a summary whose format the script cannot read — read the comment by hand |

On exit `2`, find what to fix with the deepsource MCP tools:
1. `get_pull_request` for the PR, to get its latest run.
2. `get_run_report` for that run — the grade per dimension (security, reliability, complexity, hygiene) and per analyzer.
3. `list_analysis_issues` with the `pr_number` — the occurrences behind the grade, with file, line and issue shortcode; `get_issue` explains a shortcode.

Fix the occurrences that are real. A false positive is reported or ignored at the source (`report_false_positive`, `create_ignore_rule`), never worked around in code.

# Triaging PR review comments

When the poller exits `2`, triage everything it printed:

**Failing CI checks** — open the details URL to see what failed. Fix legitimate failures and push.

**Unresolved findings** — the poller hands them to the `alq-review` gate as one review round, and code stays locked until that round is assessed. Run `Workflow(name='alq-review:assess-round', args={worktree: '<absolute worktree path>'})`; it rules on every reviewer's findings — CodeRabbit, DeepSource and human ones as well as Codex's. Then act on each as ruled:
- PUSH_BACK → reply on the comment with the ruling's reason, resolve it.
- FIX → fix it, reply with a fix summary, resolve the comment.
- DEFER → reply naming the issue it moved to, resolve it.

A CodeRabbit outside-diff finding has no thread: its URL points at the review. Answer it in a PR comment that quotes its URL — that is what marks it answered. The poller reports every outside-diff finding, from any commit's review, until a PR comment quotes it — CodeRabbit does not repeat a finding on a later commit.

Every thread must end resolved; that is what lets the poller reach exit `0`. Repeat until all are resolved. If you changed the PR, push, post a fresh `@codex review`, and run the poller again.
