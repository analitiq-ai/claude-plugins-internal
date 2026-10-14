"""poll-pr-review.sh against a fake gh serving a sequence of GraphQL snapshots.

Each test hands the poller the snapshots GitHub would return on successive polls
and asserts on its exit code, its printed report and the alq-review drop.
Comment bodies are trimmed copies of what each bot really posts.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from paths import PLUGIN

SAMPLES = Path(__file__).parent / "fixtures" / "codex"
POLLER = PLUGIN / "skills" / "alq-github-pr-review" / "poll-pr-review.sh"
REPO, PR = "acme/demo", 7
HEAD = "abc1234567890abcdef1234567890abcdef12345"
CODEX = "chatgpt-codex-connector"
# Times are relative to now: the poller trusts a lagging gate status only for a
# while after Codex's answer. The round's trigger was posted 15 minutes ago.
BASE = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(minutes=15)

CODEX_THREAD_BODY = (
    "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>"
    "  Avoid importing APIs absent from the pinned validator**\n\n"
    "For normal end-user plugin runs, the import fails.\n\nUseful? React with 👍 / 👎.")
CODERABBIT_THREAD_BODY = (
    "_📐 Maintainability & Code Quality_ | _🟡 Minor_ | _⚡ Quick win_\n\n"
    "**Do not make conventional filenames mandatory.**\n\n"
    "`RULE-PKG-030` permits a sibling type-map document.\n")
DEEPSOURCE_THREAD_BODY = (
    "<!-- DeepSource: id=Q2hlY2tJc3N1ZTp3bXJhbnZvbXY= -->\n<h3><picture>\n"
    '<img src="https://static.deepsource.com/comment_artifacts/light/severity_indicator_major.svg?v=2" height="14"/>\n'
    "</picture>Reimport 'TYPE_MAP_READ_SCHEMA_URL' (imported line 23)</h3>\n"
    '<div><img src="https://static.deepsource.com/comment_artifacts/light/severity_major.svg?v=2"/></div>\n')
OUTSIDE_DIFF_REVIEW_BODY = """**Actionable comments posted: 1**

> [!CAUTION]
> Some comments are outside the diff and can’t be posted inline due to GitHub limitations.
>
> **⚠️ Outside diff range comments (1)**
>
> <details>
> <summary><em>🟡 Minor</em> · Describe <code>cursor_field</code> as a top-level property. · <code>spec-replication.md:35-36</code></summary><blockquote>
>
> `plugins/analitiq-connector-builder/skills/connector-spec-api/spec-replication.md:35-36`
> _📐 Maintainability & Code Quality_ | _🟡 Minor_ | _⚡ Quick win_
>
> **Describe `cursor_field` as a top-level property.**
>
> <!-- cr-comment:v1:50a39c60e9526132bffbe6d5 -->
>
> </blockquote></details>

---
"""
USAGE_LIMIT = ("You have reached your Codex usage limits for code reviews. "
               "You can see your limits in the [Codex usage dashboard](https://chatgpt.com/codex/cloud/settings/usage).")


def sample(name):
    return (SAMPLES / name).read_text()


VERDICT = sample("verdict-comment.md")
REVIEW_WITH_FINDINGS = sample("review-with-findings.md")


def at(minute):
    return (BASE + timedelta(minutes=minute)).strftime("%Y-%m-%dT%H:%M:%SZ")


TRIGGER_AT = at(0)


def page(nodes, key="hasPreviousPage", more=False):
    return {"pageInfo": {key: more}, "nodes": list(nodes)}


def thumbs(*pairs):
    return page({"user": {"login": who}, "createdAt": when} for who, when in pairs)


def comment(cid, author, body, created, thumbs_up=()):
    return {"databaseId": cid, "createdAt": created, "url": f"https://github.com/{REPO}/pull/{PR}#issuecomment-{cid}",
            "body": body, "author": {"login": author}, "reactions": thumbs(*thumbs_up)}


def review(rid, author, body, submitted):
    return {"submittedAt": submitted, "url": f"https://github.com/{REPO}/pull/{PR}#pullrequestreview-{rid}",
            "body": body, "author": {"login": author}}


def thread(tid, author, body, path="src/a.py", line=12, resolved=False, outdated=False, created=None):
    return {"isResolved": resolved, "isOutdated": outdated, "path": path, "line": line,
            "comments": {"nodes": [{"author": {"login": author}, "createdAt": created or at(5), "body": body,
                                    "url": f"https://github.com/{REPO}/pull/{PR}#discussion_r{tid}"}]}}


def check(name, status="COMPLETED", conclusion="SUCCESS"):
    return {"__typename": "CheckRun", "name": name, "status": status, "conclusion": conclusion,
            "detailsUrl": f"https://ci.example/{name}"}


def gate(name, state, title, started, app="analitiq-pr-gate"):
    """A pr-gate verdict as the App posts it: a check run, in progress until it passes or fails."""
    return {"__typename": "CheckRun", "name": name, "status": "IN_PROGRESS" if state == "PENDING" else "COMPLETED",
            "conclusion": None if state == "PENDING" else state, "title": title, "startedAt": started,
            "detailsUrl": "", "checkSuite": {"app": {"slug": app}}}


def card(name="card-one-row-completed.md", at=None, commit=HEAD[:7], created=None, cid=90):
    """Codex's sampled status card, its Code Review row moved to `commit` and the status time `at`."""
    body = sample(name)
    row = next(line for line in body.splitlines() if line.startswith("| 📝 **Code Review**"))
    cells = row.split(" | ")
    stamp = cells[1].split('datetime="')[1].split('"')[0]
    cells[1] = cells[1].replace(stamp, at)
    cells[2] = f"`{commit}`"
    return comment(cid, CODEX, body.replace(row, " | ".join(cells)), created or at)


TRIGGER = comment(100, "Analitiq-Bot", "@codex review", TRIGGER_AT)
WAITING = gate("codex-review", "PENDING", "Waiting for a Codex review of abc1234567", at(0))
ATTESTED = gate("internal-review", "SUCCESS", "Internal review clean on abc1234567", at(0))
CODEX_CLEAN = gate("codex-review", "SUCCESS", "Codex found no major issues in abc1234567", at(12))
BODY_THUMBS = [(f"{CODEX}[bot]", at(12))]
ANSWERED = [TRIGGER, card(at=at(12))]
DISPATCH = f"api repos/{REPO}/dispatches -f event_type=pr-gate"


def snapshot(merge="BLOCKED", decision=None, body_thumbs=(), comments=(TRIGGER,), reviews=(), threads=(),
             contexts=(check("pytest"), WAITING, ATTESTED), overflow=None):
    pr = {"createdAt": at(-90), "headRefOid": HEAD, "mergeStateStatus": merge,
          "reviewDecision": decision, "author": {"login": "Analitiq-Bot"},
          "reactions": thumbs(*body_thumbs), "comments": page(comments), "reviews": page(reviews),
          "reviewThreads": page(threads, "hasNextPage"),
          "commits": {"nodes": [{"commit": {"statusCheckRollup": {"contexts": page(contexts, "hasNextPage")}}}]}}
    if overflow:
        pr[overflow]["pageInfo"] = {"hasNextPage": True} if overflow == "reviewThreads" else {"hasPreviousPage": True}
    return {"data": {"repository": {"pullRequest": pr}}}


FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
state = os.environ["FAKE_GH_DIR"]
args = sys.argv[1:]
with open(os.path.join(state, "calls.log"), "a") as log:
    log.write(" ".join(args) + "\n")
if args[:2] == ["api", "graphql"] and os.environ.get("FAKE_GH_GRAPHQL_EXIT"):
    sys.stderr.write("gh: request failed\n")
    sys.exit(int(os.environ["FAKE_GH_GRAPHQL_EXIT"]))
elif args[:2] == ["api", "graphql"]:
    snaps = json.load(open(os.path.join(state, "snapshots.json")))
    counter = os.path.join(state, "served")
    served = int(open(counter).read()) if os.path.exists(counter) else 0
    open(counter, "w").write(str(served + 1))
    print(json.dumps(snaps[min(served, len(snaps) - 1)]))
elif args[:2] == ["api", "repos/%s/dispatches" % os.environ["FAKE_GH_REPO"]]:
    if os.environ.get("FAKE_GH_DISPATCH_FAILS"):
        sys.stderr.write("HTTP 403: Resource not accessible by integration\n")
        sys.exit(1)
elif args[:2] == ["pr", "view"] and "headRefName,headRefOid" in args:
    print(json.dumps({"headRefName": "feat/1-demo", "headRefOid": os.environ["FAKE_GH_HEAD"]}))
else:
    sys.stderr.write("fake gh: unexpected call: %r\n" % (args,))
    sys.exit(99)
'''


class Poller(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ["rm", "-rf", str(self.tmp)])
        (self.tmp / "bin").mkdir()
        gh = self.tmp / "bin" / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.state = self.tmp / "state"

    def poll(self, *snapshots, args=(), minutes="1", env_extra=None):
        (self.tmp / "snapshots.json").write_text(json.dumps(list(snapshots)))
        for counter in ("served", "calls.log"):
            (self.tmp / counter).unlink(missing_ok=True)
        env = dict(os.environ, FAKE_GH_DIR=str(self.tmp), FAKE_GH_HEAD=HEAD, FAKE_GH_REPO=REPO,
                   ALQ_REVIEW_STATE_DIR=str(self.state), PATH=f"{self.tmp / 'bin'}{os.pathsep}{os.environ['PATH']}",
                   **(env_extra or {}))
        done = subprocess.run(["bash", str(POLLER), REPO, str(PR), "--interval", "0", "--minutes", minutes, *args],
                              env=env, capture_output=True, text=True, timeout=120)
        served = self.tmp / "served"
        self.polls = int(served.read_text()) if served.exists() else 0
        return done

    def dispatches(self):
        log = self.tmp / "calls.log"
        return [c for c in log.read_text().splitlines() if "/dispatches" in c] if log.exists() else []

    def drop(self):
        path = self.state / "inbox" / "acme__demo__7.json"
        return json.loads(path.read_text()) if path.exists() else None

    # -- waiting ---------------------------------------------------------------

    def test_a_finding_before_codex_answers_does_not_end_the_wait(self):
        early = snapshot(threads=[thread(1, "coderabbitai", CODERABBIT_THREAD_BODY)])
        answered = snapshot(
            comments=[TRIGGER, card(at=at(12))], reviews=[review(9, CODEX, REVIEW_WITH_FINDINGS, at(12))],
            threads=[thread(1, "coderabbitai", CODERABBIT_THREAD_BODY), thread(2, CODEX, CODEX_THREAD_BODY)])
        done = self.poll(early, answered)
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertEqual(self.polls, 2)
        self.assertIn("Do not make conventional filenames mandatory.", done.stdout)
        self.assertIn("Avoid importing APIs absent from the pinned validator", done.stdout)

    def test_the_report_waits_for_running_checks(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        running = snapshot(comments=codex, contexts=[check("pytest", "IN_PROGRESS", None), CODEX_CLEAN, ATTESTED])
        failed = snapshot(comments=codex, contexts=[check("pytest", conclusion="FAILURE"), CODEX_CLEAN, ATTESTED])
        done = self.poll(running, failed)
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertEqual(self.polls, 2)
        self.assertIn("pytest [FAILURE]", done.stdout)
        self.assertEqual(self.drop()["failing_checks"][0]["name"], "pytest")

    def test_a_codex_answer_before_the_trigger_does_not_end_the_wait(self):
        stale = [card(at=at(-60)), comment(99, CODEX, VERDICT, at(-60)), TRIGGER]
        done = self.poll(snapshot(comments=stale, merge="CLEAN"), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn("TIMEOUT", done.stdout)
        self.assertIsNone(self.drop())

    def test_a_clean_verdict_waits_for_the_gate_status_to_catch_up(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        lagging = snapshot(comments=codex)
        caught_up = snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED])
        done = self.poll(lagging, caught_up)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(self.polls, 2)

    def test_a_gate_status_that_never_catches_up_is_reported_after_the_sweep(self):
        # pr-gate skips re-posting an unchanged status, so a PENDING older than
        # Codex's answer may be final. Past the sweep it is reported, not awaited.
        long_ago = [comment(98, "Analitiq-Bot", "@codex review", at(-50)),
                    card(at=at(-40)), comment(101, CODEX, VERDICT, at(-40))]
        unchanged = gate("codex-review", "PENDING", "No Codex verdict names abc1234567", at(-55))
        done = self.poll(snapshot(comments=long_ago, contexts=[check("pytest"), unchanged, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertEqual(self.polls, 1)
        self.assertIn("No Codex verdict names abc1234567", done.stdout)

    def test_unknown_merge_state_is_polled_again(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        ctx = [check("pytest"), CODEX_CLEAN, ATTESTED]
        done = self.poll(snapshot(merge="UNKNOWN", comments=codex, contexts=ctx),
                         snapshot(merge="CLEAN", comments=codex, contexts=ctx))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(self.polls, 2)

    def test_timeout_prints_what_it_was_still_waiting_on(self):
        done = self.poll(snapshot(contexts=[check("pytest", "QUEUED", None), WAITING, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn("Codex has not answered", done.stdout)
        self.assertIn("pytest", done.stdout)

    # -- verdicts --------------------------------------------------------------

    def test_clean_comes_from_github_merge_state(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("CLEAN", done.stdout)
        self.assertEqual(self.drop()["status"], "clean")

    def test_merge_state_clean_with_an_unresolved_thread_is_findings(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  threads=[thread(3, "deepsource-io", DEEPSOURCE_THREAD_BODY)]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertEqual(self.drop()["status"], "findings")

    def test_blocked_without_findings_names_the_pending_gate(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        pending = gate("internal-review", "PENDING", "Waiting for an internal review of abc1234567", at(0))
        done = self.poll(snapshot(comments=codex, contexts=[check("pytest"), CODEX_CLEAN, pending]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("BLOCKED", done.stdout)
        self.assertIn("Waiting for an internal review of abc1234567", done.stdout)
        self.assertNotIn("WARNING: no codex-review", done.stdout)
        self.assertIsNone(self.drop())

    def test_a_same_named_run_from_another_app_is_not_the_gate(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        forged = gate("codex-review", "SUCCESS", "Codex found no major issues in abc1234567", at(13), app="github-actions")
        done = self.poll(snapshot(comments=codex, contexts=[check("pytest"), forged, ATTESTED]), minutes="0")
        self.assertIn("WARNING: no codex-review check run", done.stdout)
        self.assertNotIn("codex-review: SUCCESS", done.stdout)

    def test_an_ignored_codex_review_run_is_not_reported_missing(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]), minutes="0",
                         args=("--ignore-check", "codex-review"))
        self.assertNotIn("WARNING: no codex-review", done.stdout)

    def test_the_waiver_is_printed(self):
        waived = gate("codex-review", "SUCCESS", "WAIVED: Codex is out of credits; abc1234567 was not reviewed", at(13))
        codex = [TRIGGER, comment(101, CODEX, USAGE_LIMIT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), waived, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("WAIVED: Codex is out of credits; abc1234567 was not reviewed", done.stdout)

    def test_a_thumbs_up_on_the_pr_body_is_waited_on_with_one_dispatched_sweep(self):
        # A reaction triggers no pr-gate run, so the gate is asked for a sweep,
        # once however long it takes to catch up.
        counted = gate("codex-review", "SUCCESS", "Codex found no major issues in abc1234567 (thumbs-up on the PR)", at(13))
        lagging = snapshot(body_thumbs=BODY_THUMBS, comments=ANSWERED)
        caught_up = snapshot(merge="CLEAN", body_thumbs=BODY_THUMBS, comments=ANSWERED,
                             contexts=[check("pytest"), counted, ATTESTED])
        done = self.poll(lagging, lagging, caught_up)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(self.polls, 3)
        self.assertEqual(self.dispatches(), [DISPATCH])

    def test_a_thumbs_up_the_gate_does_not_count_is_reported_by_the_gates_reason(self):
        not_tied = gate("codex-review", "PENDING", "Codex's thumbs-up is not tied to abc1234567; comment @codex review", at(13))
        done = self.poll(snapshot(body_thumbs=BODY_THUMBS, comments=ANSWERED,
                                  contexts=[check("pytest"), not_tied, ATTESTED]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("Codex's thumbs-up is not tied to abc1234567; comment @codex review", done.stdout)
        self.assertNotIn("cannot count", done.stdout)
        self.assertEqual(self.dispatches(), [])

    def test_a_failed_dispatch_is_announced_and_the_wait_goes_on(self):
        counted = gate("codex-review", "SUCCESS", "Codex found no major issues in abc1234567 (thumbs-up on the PR)", at(13))
        done = self.poll(snapshot(body_thumbs=BODY_THUMBS, comments=ANSWERED),
                         snapshot(merge="CLEAN", body_thumbs=BODY_THUMBS, comments=ANSWERED,
                                  contexts=[check("pytest"), counted, ATTESTED]),
                         env_extra={"FAKE_GH_DISPATCH_FAILS": "1"})
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("could not dispatch", done.stderr)
        self.assertEqual(self.dispatches(), [DISPATCH])

    def test_no_sweep_is_dispatched_while_the_gate_is_not_behind_codex(self):
        done = self.poll(snapshot(contexts=[check("pytest", "IN_PROGRESS", None), WAITING, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertEqual(self.dispatches(), [])

    def test_a_thumbs_up_on_the_pr_body_silences_the_trigger_comment_note(self):
        counted = gate("codex-review", "SUCCESS", "Codex found no major issues in abc1234567 (thumbs-up on the PR)", at(13))
        request = comment(100, "Analitiq-Bot", "@codex review", TRIGGER_AT, thumbs_up=BODY_THUMBS)
        done = self.poll(snapshot(merge="CLEAN", comments=[request, card(at=at(12))], body_thumbs=BODY_THUMBS,
                                  contexts=[check("pytest"), counted, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertNotIn("@codex review comment", done.stdout)

    def test_a_bare_thumbs_up_on_the_trigger_comment_is_noted_and_not_an_answer(self):
        # The gate reads Codex's reactions on the PR description only.
        request = comment(100, "Analitiq-Bot", "@codex review", TRIGGER_AT, thumbs_up=BODY_THUMBS)
        done = self.poll(snapshot(comments=[request]), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn("comment `@codex review`", done.stdout)
        self.assertIn(f"Codex has not answered since {TRIGGER_AT}", done.stdout)
        self.assertEqual(self.dispatches(), [])

    def test_a_draft_is_reported_without_waiting_for_codex(self):
        done = self.poll(snapshot(merge="DRAFT"))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertEqual(self.polls, 1)
        self.assertIn("DRAFT", done.stdout)

    # -- the report ------------------------------------------------------------

    def test_gist_and_severity_per_reviewer(self):
        done = self.poll(snapshot(
            comments=ANSWERED, reviews=[review(9, CODEX, REVIEW_WITH_FINDINGS, at(12))],
            threads=[thread(1, "coderabbitai", CODERABBIT_THREAD_BODY), thread(2, CODEX, CODEX_THREAD_BODY),
                     thread(3, "deepsource-io", DEEPSOURCE_THREAD_BODY)]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        found = {t["by"]: (t["severity"], t["gist"]) for t in self.drop()["threads"]}
        self.assertEqual(found, {
            CODEX: ("P1", "Avoid importing APIs absent from the pinned validator"),
            "coderabbitai": ("Minor", "Do not make conventional filenames mandatory."),
            "deepsource-io": ("major", "Reimport 'TYPE_MAP_READ_SCHEMA_URL' (imported line 23)")})

    def test_outside_diff_findings_are_reported_until_a_pr_comment_quotes_them(self):
        # CodeRabbit reviews each push incrementally and does not repeat a
        # finding on a later commit, so an older commit's finding stays live.
        answered = review(7, "coderabbitai", OUTSIDE_DIFF_REVIEW_BODY.replace("50a39c", "222222"), at(-70))
        older = review(8, "coderabbitai", OUTSIDE_DIFF_REVIEW_BODY.replace("50a39c", "111111"), at(-60))
        this_round = review(9, "coderabbitai", OUTSIDE_DIFF_REVIEW_BODY, at(10))
        codex = review(10, CODEX, REVIEW_WITH_FINDINGS, at(12))
        reply = comment(99, "Analitiq-Bot", "Fixed: https://github.com/acme/demo/pull/7"
                                            "#pullrequestreview-7-cr-22222260e9526132bffbe6d5", at(-65))
        done = self.poll(snapshot(comments=[reply, TRIGGER, card(at=at(12))], reviews=[answered, older, this_round, codex]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        found = {t["url"].rsplit("#", 1)[1]: t for t in self.drop()["threads"]}
        self.assertEqual(sorted(found), ["pullrequestreview-8-cr-11111160e9526132bffbe6d5",
                                         "pullrequestreview-9-cr-50a39c60e9526132bffbe6d5"])
        self.assertEqual(found["pullrequestreview-9-cr-50a39c60e9526132bffbe6d5"], {
            "by": "coderabbitai", "severity": "Minor", "outdated": False, "line": 35,
            "path": "plugins/analitiq-connector-builder/skills/connector-spec-api/spec-replication.md",
            "gist": "Describe cursor_field as a top-level property.",
            "url": f"https://github.com/{REPO}/pull/{PR}#pullrequestreview-9-cr-50a39c60e9526132bffbe6d5"})

    def test_outside_diff_findings_of_the_head_posted_before_the_trigger_are_reported(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  reviews=[review(9, "coderabbitai", OUTSIDE_DIFF_REVIEW_BODY, at(-5))]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn("Describe cursor_field as a top-level property.", done.stdout)

    def test_an_outside_diff_finding_quoted_in_a_pr_comment_is_answered(self):
        answer = comment(102, "Analitiq-Bot", "Pushing back on https://github.com/acme/demo/pull/7"
                                              "#pullrequestreview-9-cr-50a39c60e9526132bffbe6d5: the field is nested.", at(13))
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12)), answer]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  reviews=[review(9, "coderabbitai", OUTSIDE_DIFF_REVIEW_BODY, at(-5))]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_an_outside_diff_count_the_parser_cannot_meet_fails_loud(self):
        garbled = OUTSIDE_DIFF_REVIEW_BODY.replace("<summary><em>", "<summary><strong>")
        done = self.poll(snapshot(reviews=[review(9, "coderabbitai", garbled, at(10)),
                                           review(10, CODEX, REVIEW_WITH_FINDINGS, at(12))]))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("Outside diff range", done.stderr)

    def test_the_pr_authors_own_threads_are_replies_not_findings(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  threads=[thread(4, "Analitiq-Bot", "Fixed in abc.")]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_a_resolved_thread_is_not_a_finding(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  threads=[thread(5, CODEX, CODEX_THREAD_BODY, resolved=True)]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_an_ignored_failing_check_leaves_github_unstable_and_the_pr_clean(self):
        # GitHub reports a non-required red check as UNSTABLE, never CLEAN.
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        ctx = [check("pytest"), check("flaky", conclusion="FAILURE"), CODEX_CLEAN, ATTESTED]
        done = self.poll(snapshot(merge="UNSTABLE", comments=codex, contexts=ctx), args=("--ignore-check", "flaky"))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("Ignoring CI check(s) by explicit instruction: flaky", done.stdout)
        self.assertIn("flaky [FAILURE]", done.stdout)
        self.assertEqual(self.drop()["status"], "clean")

    def test_unstable_from_a_check_not_ignored_is_blocked(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        pending = gate("internal-review", "PENDING", "Waiting for an internal review of abc1234567", at(0))
        ctx = [check("pytest"), check("flaky", conclusion="FAILURE"), CODEX_CLEAN, pending]
        done = self.poll(snapshot(merge="UNSTABLE", comments=codex, contexts=ctx), args=("--ignore-check", "flaky"))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)

    def test_unstable_that_no_ignored_check_explains_is_blocked(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="UNSTABLE", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)

    def test_an_ignored_check_that_blocks_the_pr_is_named_in_the_report(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        ctx = [check("pytest"), check("required-but-red", conclusion="FAILURE"), CODEX_CLEAN, ATTESTED]
        done = self.poll(snapshot(merge="BLOCKED", comments=codex, contexts=ctx),
                         args=("--ignore-check", "required-but-red"))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("required-but-red [FAILURE]", done.stdout)

    def test_codex_comments_reach_the_drop_as_gate_comments(self):
        codex = [TRIGGER, comment(101, CODEX, USAGE_LIMIT, at(12))]
        predates = gate("codex-review", "PENDING", "Codex's out-of-credits answer predates abc1234567; comment @codex review", at(13))
        done = self.poll(snapshot(comments=codex, contexts=[check("pytest", conclusion="FAILURE"), predates, ATTESTED]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        [said] = self.drop()["gate_comments"]
        self.assertEqual((said["url"], said["approves"]), (codex[1]["url"], False))

    # -- the status card ---------------------------------------------------------

    def test_a_running_row_holds_the_round_and_names_the_commit(self):
        running = [TRIGGER, card("card-one-row-running.md", at=at(1))]
        done = self.poll(snapshot(merge="CLEAN", comments=running, contexts=[check("pytest"), ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn(f"  - Codex is reviewing {HEAD[:7]} since {at(1)}", done.stdout)
        self.assertIsNone(self.drop())

    def test_the_row_turning_completed_for_the_head_answers(self):
        running = snapshot(merge="CLEAN", comments=[TRIGGER, card("card-one-row-running.md", at=at(1))],
                           contexts=[check("pytest"), ATTESTED])
        completed = snapshot(merge="CLEAN", comments=[TRIGGER, card(at=at(5))], body_thumbs=BODY_THUMBS,
                             contexts=[check("pytest"), ATTESTED])
        done = self.poll(running, completed)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(self.polls, 2)
        self.assertEqual(self.drop()["status"], "clean")

    def test_findings_beside_the_completed_row_are_reported(self):
        running = snapshot(comments=[TRIGGER, card("card-one-row-running.md", at=at(1))],
                           contexts=[check("pytest"), ATTESTED])
        completed = snapshot(comments=[TRIGGER, card(at=at(5))], reviews=[review(9, CODEX, REVIEW_WITH_FINDINGS, at(5))],
                             threads=[thread(1, CODEX, CODEX_THREAD_BODY)], contexts=[check("pytest"), ATTESTED])
        done = self.poll(running, completed)
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn("Avoid importing APIs absent from the pinned validator", done.stdout)

    def test_no_row_since_the_trigger_is_not_started(self):
        for comments in ([TRIGGER], [card(at=at(-5)), TRIGGER]):
            with self.subTest(cards=len(comments) - 1):
                done = self.poll(snapshot(merge="CLEAN", comments=comments, contexts=[check("pytest"), ATTESTED]),
                                 minutes="0")
                self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
                self.assertIn(f"Codex has not answered since {TRIGGER_AT}", done.stdout)

    def test_the_card_is_never_a_codex_comment(self):
        pending = gate("codex-review", "PENDING", "Waiting for a Codex review of abc1234567", at(13))
        done = self.poll(snapshot(comments=[TRIGGER, card(at=at(5))],
                                  contexts=[check("pytest", conclusion="FAILURE"), pending, ATTESTED]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertNotIn("Codex comments since the trigger", done.stdout)
        self.assertEqual(self.drop()["gate_comments"], [])

    def test_only_the_code_review_row_is_read(self):
        two_rows = card("card-two-rows-code-completed-security-running.md", at=at(5))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, two_rows],
                                  contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_the_cards_creation_time_is_never_compared(self):
        created_before = card(at=at(5), created=at(-20))
        done = self.poll(snapshot(merge="CLEAN", comments=[created_before, TRIGGER],
                                  contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_a_verdict_before_the_row_turns_completed_is_not_an_answer(self):
        early = [TRIGGER, card("card-one-row-running.md", at=at(1)), comment(101, CODEX, VERDICT, at(4))]
        done = self.poll(snapshot(merge="CLEAN", comments=early, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]),
                         minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn(f"Codex is reviewing {HEAD[:7]} since {at(1)}", done.stdout)

    def test_a_review_and_verdict_with_no_card_are_not_an_answer(self):
        legacy = [TRIGGER, comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=legacy, reviews=[review(9, CODEX, REVIEW_WITH_FINDINGS, at(12))],
                                  contexts=[check("pytest"), ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn("Codex comments since the trigger", done.stdout)
        self.assertIn(legacy[1]["url"], done.stdout)

    def test_a_completed_row_for_a_superseded_commit_asks_for_a_re_request(self):
        stale = [TRIGGER, card(commit="a3d2db7", at=at(5))]
        done = self.poll(snapshot(merge="CLEAN", comments=stale, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("Codex reviewed a3d2db7, not the head abc1234567: comment `@codex review`", done.stdout)
        self.assertIn(f"Codex: superseded a3d2db7 at {at(5)}", done.stdout)
        self.assertNotIn("CLEAN:", done.stdout)
        self.assertIsNone(self.drop())

    def test_a_superseded_row_beside_findings_is_still_named(self):
        stale = [TRIGGER, card(commit="a3d2db7", at=at(5))]
        done = self.poll(snapshot(comments=stale, contexts=[check("pytest", conclusion="FAILURE"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn("Codex reviewed a3d2db7, not the head abc1234567: comment `@codex review`", done.stdout)

    def test_a_second_trigger_waits_for_a_row_after_it(self):
        second = comment(102, "Analitiq-Bot", "@codex review", at(6))
        ctx = [check("pytest"), CODEX_CLEAN, ATTESTED]
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, card(at=at(3)), second], contexts=ctx),
                         snapshot(merge="CLEAN", comments=[TRIGGER, card("card-one-row-running.md", at=at(7)), second],
                                  contexts=ctx),
                         snapshot(merge="CLEAN", comments=[TRIGGER, card(at=at(9)), second], contexts=ctx))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(self.polls, 3)
        self.assertIn(f"Codex has not answered since {at(6)}", done.stdout)
        self.assertIn(f"Codex is reviewing {HEAD[:7]} since {at(7)}", done.stdout)

    def test_a_second_trigger_during_a_running_row_is_answered_by_the_row_after_it(self):
        second = comment(102, "Analitiq-Bot", "@codex review", at(4))
        ctx = [check("pytest"), CODEX_CLEAN, ATTESTED]
        before = snapshot(merge="CLEAN", comments=[TRIGGER, card("card-one-row-running.md", at=at(2)), second], contexts=ctx)
        for commit, code in ((HEAD[:7], 0), ("a3d2db7", 4)):
            with self.subTest(commit=commit):
                after = snapshot(merge="CLEAN", comments=[TRIGGER, card(commit=commit, at=at(6)), second], contexts=ctx)
                done = self.poll(before, after)
                self.assertEqual(done.returncode, code, done.stdout + done.stderr)
                self.assertIn(f"Codex has not answered since {at(4)}", done.stdout)
                if code == 4:
                    self.assertIn("Codex reviewed a3d2db7, not the head abc1234567", done.stdout)

    def test_the_gate_catch_up_is_timed_from_the_status_time(self):
        pending = gate("codex-review", "PENDING", "Waiting for a Codex review of abc1234567", at(3))
        answered = [TRIGGER, card(at=at(5), created=at(1))]
        lagging = snapshot(comments=answered, contexts=[check("pytest"), pending, ATTESTED])
        caught_up = snapshot(merge="CLEAN", comments=answered, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED])
        done = self.poll(lagging, caught_up)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("codex-review has not caught up with Codex's answer", done.stdout)
        self.assertEqual(len(self.dispatches()), 1)

    def test_an_earlier_review_and_thumbs_up_do_not_move_the_status_time(self):
        pending = gate("codex-review", "PENDING", "Waiting for a Codex review of abc1234567", at(3))
        lagging = snapshot(comments=[TRIGGER, card(at=at(5), created=at(1))], body_thumbs=[(f"{CODEX}[bot]", at(2))],
                           reviews=[review(9, CODEX, REVIEW_WITH_FINDINGS, at(2))],
                           contexts=[check("pytest"), pending, ATTESTED])
        done = self.poll(lagging, minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn("codex-review has not caught up with Codex's answer", done.stdout)
        self.assertEqual(len(self.dispatches()), 1)

    # -- a reply the poller does not know -------------------------------------------

    @staticmethod
    def unknown_line(reply):
        return f"Codex's reply is not one the poller knows ({reply['url']}, {reply['createdAt']})"

    def test_an_unknown_reply_with_no_answer_settles_without_clean(self):
        for name in ("decline-not-connected.md", "decline-error.md"):
            with self.subTest(name=name):
                reply = comment(101, CODEX, sample(name), at(2))
                done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, reply], contexts=[check("pytest"), ATTESTED]))
                self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
                self.assertIn(self.unknown_line(reply) + ": Codex declined or changed what it posts; read it.", done.stdout)
                self.assertIn("Codex comments since the trigger", done.stdout)
                self.assertIn(reply["url"], done.stdout)
                self.assertNotIn("CLEAN:", done.stdout)

    def test_an_unknown_reply_beside_a_failing_check_is_findings(self):
        reply = comment(101, CODEX, sample("decline-not-connected.md"), at(2))
        done = self.poll(snapshot(comments=[TRIGGER, reply], contexts=[check("pytest", conclusion="FAILURE"), ATTESTED]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn(self.unknown_line(reply), done.stdout)
        self.assertEqual([c["url"] for c in self.drop()["gate_comments"]], [reply["url"]])

    def test_an_unknown_reply_beside_a_running_row_is_a_warning(self):
        reply = comment(101, CODEX, sample("decline-not-connected.md"), at(2))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, card("card-one-row-running.md", at=at(1)), reply],
                                  contexts=[check("pytest"), ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn(f"Codex is reviewing {HEAD[:7]} since {at(1)}", done.stdout)
        self.assertIn("WARNING: " + self.unknown_line(reply) + "; read it.", done.stdout)

    def test_an_unknown_reply_beside_the_answer_is_a_warning(self):
        reply = comment(101, CODEX, sample("decline-error.md"), at(2))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, card(at=at(5)), reply],
                                  contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("WARNING: " + self.unknown_line(reply) + "; read it.", done.stdout)

    def test_a_waived_run_releases_an_unknown_reply(self):
        waived = gate("codex-review", "SUCCESS", "WAIVED: Codex is out of credits; abc1234567 was not reviewed", at(3))
        reply = comment(101, CODEX, USAGE_LIMIT, at(2))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, reply], contexts=[check("pytest"), waived, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("  codex-review: SUCCESS — WAIVED: Codex is out of credits; abc1234567 was not reviewed", done.stdout)
        self.assertNotIn("not one the poller knows", done.stdout)

    def test_a_waived_run_does_not_release_a_running_row(self):
        waived = gate("codex-review", "SUCCESS", "WAIVED: Codex is out of credits; abc1234567 was not reviewed", at(3))
        reply = comment(101, CODEX, USAGE_LIMIT, at(2))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, card("card-one-row-running.md", at=at(1)), reply],
                                  contexts=[check("pytest"), waived, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn(f"Codex is reviewing {HEAD[:7]} since {at(1)}", done.stdout)

    def test_a_plain_success_run_does_not_release_an_unknown_reply(self):
        reply = comment(101, CODEX, USAGE_LIMIT, at(2))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, reply], contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn(self.unknown_line(reply), done.stdout)

    def test_every_unknown_reply_is_named(self):
        first = comment(101, CODEX, sample("decline-not-connected.md"), at(2))
        second = comment(102, CODEX, sample("decline-error.md"), at(3))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, first, second], contexts=[check("pytest"), ATTESTED]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        for reply in (first, second):
            self.assertIn(self.unknown_line(reply) + ": Codex declined or changed what it posts; read it.", done.stdout)

    def test_an_unknown_review_beside_the_answer_is_a_warning_and_a_codex_comment(self):
        reply = review(9, CODEX, "### A heading Codex has not posted before", at(6))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, card(at=at(5))], reviews=[reply],
                                  contexts=[check("pytest"), ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn(f"WARNING: Codex's reply is not one the poller knows ({reply['url']}, {at(6)}); read it.",
                      done.stdout)
        self.assertIn("Codex comments since the trigger", done.stdout)
        self.assertEqual([c["url"] for c in self.drop()["gate_comments"]], [reply["url"]])

    def test_blocked_names_codex_as_the_cause_when_github_reports_clean(self):
        cases = ((card(commit="a3d2db7", at=at(5)), "Codex reviewed a3d2db7, not the head abc1234567"),
                 (comment(101, CODEX, USAGE_LIMIT, at(2)), "Codex's reply is not one the poller knows"))
        for said, cause in cases:
            with self.subTest(cause=cause):
                done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, said],
                                          contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
                self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
                self.assertIn(f"BLOCKED: nothing to triage, but {cause}.", done.stdout)
                self.assertNotIn("mergeStateStatus=CLEAN.", done.stdout)

    def test_a_gh_failure_exits_1_even_when_gh_exits_with_a_code_the_poller_gives_a_meaning(self):
        # gh exits 4 when it needs authentication; 2, 3 and 4 are the poller's findings, timeout and blocked exits.
        for code in ("2", "3", "4"):
            with self.subTest(gh_exit=code):
                done = self.poll(snapshot(), env_extra={"FAKE_GH_GRAPHQL_EXIT": code})
                self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
                self.assertIn("ERROR: could not read acme/demo#7", done.stderr)

    def test_blocked_names_the_merge_state_after_the_codex_cause(self):
        cases = ((card(at=at(5)), "GitHub reports mergeStateStatus=BLOCKED"),
                 (card(commit="a3d2db7", at=at(5)),
                  "Codex reviewed a3d2db7, not the head abc1234567; GitHub reports mergeStateStatus=BLOCKED"),
                 (comment(101, CODEX, sample("decline-not-connected.md"), at(6)),
                  "Codex's reply is not one the poller knows; GitHub reports mergeStateStatus=BLOCKED"))
        for said, causes in cases:
            with self.subTest(causes=causes):
                done = self.poll(snapshot(comments=[TRIGGER, said], contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
                self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
                self.assertIn(f"BLOCKED: nothing to triage, but {causes}. Act on", done.stdout)

    def test_every_unknown_reply_beside_a_row_is_a_warning(self):
        first = comment(101, CODEX, sample("decline-not-connected.md"), at(6))
        second = comment(102, CODEX, sample("decline-error.md"), at(7))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, card(at=at(5)), first, second],
                                  contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        for reply in (first, second):
            self.assertIn("WARNING: " + self.unknown_line(reply) + "; read it.", done.stdout)

    def test_a_waived_run_does_not_release_a_superseded_row(self):
        waived = gate("codex-review", "SUCCESS", "WAIVED: Codex is out of credits; abc1234567 was not reviewed", at(6))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, card(commit="a3d2db7", at=at(5))],
                                  contexts=[check("pytest"), waived, ATTESTED]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("Codex reviewed a3d2db7, not the head abc1234567: comment `@codex review`", done.stdout)

    def test_a_waived_run_releases_a_silent_codex(self):
        waived = gate("codex-review", "SUCCESS", "WAIVED: Codex is out of credits; abc1234567 was not reviewed", at(3))
        done = self.poll(snapshot(merge="CLEAN", contexts=[check("pytest"), waived, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_a_success_run_with_no_title_is_read(self):
        untitled = gate("codex-review", "SUCCESS", None, at(13))
        done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, card(at=at(5))],
                                  contexts=[check("pytest"), untitled, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    # -- a card the poller cannot read ------------------------------------------------

    def test_an_unreadable_card_ends_the_run_with_its_url(self):
        body = card(at=at(1))["body"]
        row = next(line for line in body.splitlines() if line.startswith("| 📝 **Code Review**"))
        stamp = f'datetime="{at(1)}"'
        edits = {
            "no Code Review row": body.replace(row, ""),
            "2 Code Review rows": body.replace(row, row + "\n" + row),
            "status is neither Running nor Completed": body.replace("**Completed**", "**Failed**"),
            "no datetime in the Status cell": body.replace(stamp, ""),
            "datetime yesterday is not in the card's format": body.replace(stamp, 'datetime="yesterday"'),
            "no commit in the Commit cell": body.replace(f"`{HEAD[:7]}`", ""),
        }
        cases = [(why, [comment(90, CODEX, edited, at(1))]) for why, edited in edits.items()]
        cases.append(("2 comments carry the marker", [comment(90, CODEX, body, at(1)), comment(91, CODEX, body, at(2))]))
        for why, cards in cases:
            with self.subTest(why=why):
                done = self.poll(snapshot(merge="CLEAN", comments=[TRIGGER, *cards], contexts=[check("pytest"), ATTESTED]))
                self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
                self.assertEqual(self.polls, 1)
                self.assertIn(f"ERROR: Codex status card https://github.com/{REPO}/pull/{PR}#issuecomment-90 cannot be read: "
                              f"{why}; its format changed: report it on the plugin's repo and read the PR by hand",
                              done.stderr)
                self.assertNotIn("== acme/demo#7", done.stdout)
                self.assertIsNone(self.drop())

    # -- what the poller read from Codex ------------------------------------------

    def test_codex_line_follows_the_report_header(self):
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        lines = done.stdout.splitlines()
        header = next(i for i, line in enumerate(lines) if line.startswith("== acme/demo#7 @ "))
        self.assertEqual(lines[header + 1], f"Codex: answered {HEAD[:7]} at {at(12)}")

    def test_codex_line_says_not_started_on_a_timeout_with_no_card(self):
        done = self.poll(snapshot(), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        lines = done.stdout.splitlines()
        header = next(i for i, line in enumerate(lines) if line.startswith("== acme/demo#7 @ "))
        self.assertEqual(lines[header + 1], "Codex: not started")

    def test_reader_failure_exits_1_with_no_drop(self):
        shim = self.tmp / "bin" / "python3"
        shim.write_text(f"""#!/bin/sh
for arg; do last=$arg; done
case "$last" in *codexstate.py) exit 1 ;; esac
exec {sys.executable} "$@"
""")
        shim.chmod(0o755)
        codex = [TRIGGER, card(at=at(12)), comment(101, CODEX, VERDICT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("ERROR: the Codex reader failed", done.stderr)
        self.assertIsNone(self.drop())

    def test_more_than_one_page_fails_loud(self):
        done = self.poll(snapshot(overflow="reviewThreads"))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("reviewThreads", done.stderr)


if __name__ == "__main__":
    unittest.main()
