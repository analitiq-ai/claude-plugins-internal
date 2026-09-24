"""poll-pr-review.sh against a fake gh serving a sequence of GraphQL snapshots.

Each test hands the poller the snapshots GitHub would return on successive polls
and asserts on its exit code, its printed report and the alq-review drop.
Comment bodies are trimmed copies of what each bot really posts.
"""
import json
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

POLLER = Path(__file__).resolve().parents[1] / "poll-pr-review.sh"
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


def status(context, state, description, created):
    return {"__typename": "StatusContext", "context": context, "state": state, "description": description,
            "targetUrl": "", "createdAt": created}


TRIGGER = comment(100, "Analitiq-Bot", "@codex review", TRIGGER_AT)
WAITING = status("codex-review", "PENDING", "Waiting for a Codex review of abc1234567", at(0))
ATTESTED = status("internal-review", "SUCCESS", "Internal review clean on abc1234567", at(0))
CODEX_CLEAN = status("codex-review", "SUCCESS", "Codex found no major issues in abc1234567", at(12))
BODY_THUMBS = [(f"{CODEX}[bot]", at(12))]
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
if args[:2] == ["api", "graphql"]:
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
            reviews=[review(9, CODEX, "Here are some automated review suggestions", at(12))],
            threads=[thread(1, "coderabbitai", CODERABBIT_THREAD_BODY), thread(2, CODEX, CODEX_THREAD_BODY)])
        done = self.poll(early, answered)
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertEqual(self.polls, 2)
        self.assertIn("Do not make conventional filenames mandatory.", done.stdout)
        self.assertIn("Avoid importing APIs absent from the pinned validator", done.stdout)

    def test_the_report_waits_for_running_checks(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        running = snapshot(comments=codex, contexts=[check("pytest", "IN_PROGRESS", None), CODEX_CLEAN, ATTESTED])
        failed = snapshot(comments=codex, contexts=[check("pytest", conclusion="FAILURE"), CODEX_CLEAN, ATTESTED])
        done = self.poll(running, failed)
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertEqual(self.polls, 2)
        self.assertIn("pytest [FAILURE]", done.stdout)
        self.assertEqual(self.drop()["failing_checks"][0]["name"], "pytest")

    def test_a_codex_answer_before_the_trigger_does_not_end_the_wait(self):
        stale = [comment(99, CODEX, "Codex Review: Didn't find any major issues.", at(-60)),
                 TRIGGER]
        done = self.poll(snapshot(comments=stale, merge="CLEAN"), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn("TIMEOUT", done.stdout)
        self.assertIsNone(self.drop())

    def test_a_clean_verdict_waits_for_the_gate_status_to_catch_up(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        lagging = snapshot(comments=codex)
        caught_up = snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED])
        done = self.poll(lagging, caught_up)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(self.polls, 2)

    def test_a_gate_status_that_never_catches_up_is_reported_after_the_sweep(self):
        # pr-gate skips re-posting an unchanged status, so a PENDING older than
        # Codex's answer may be final. Past the sweep it is reported, not awaited.
        long_ago = [comment(98, "Analitiq-Bot", "@codex review", at(-50)),
                    comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(-40))]
        unchanged = status("codex-review", "PENDING", "No Codex verdict names abc1234567", at(-55))
        done = self.poll(snapshot(comments=long_ago, contexts=[check("pytest"), unchanged, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertEqual(self.polls, 1)
        self.assertIn("No Codex verdict names abc1234567", done.stdout)

    def test_unknown_merge_state_is_polled_again(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
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
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("CLEAN", done.stdout)
        self.assertEqual(self.drop()["status"], "clean")

    def test_merge_state_clean_with_an_unresolved_thread_is_findings(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  threads=[thread(3, "deepsource-io", DEEPSOURCE_THREAD_BODY)]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertEqual(self.drop()["status"], "findings")

    def test_blocked_without_findings_names_the_pending_gate(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        pending = status("internal-review", "PENDING", "Waiting for an internal review of abc1234567", at(0))
        done = self.poll(snapshot(comments=codex, contexts=[check("pytest"), CODEX_CLEAN, pending]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("BLOCKED", done.stdout)
        self.assertIn("Waiting for an internal review of abc1234567", done.stdout)
        self.assertIsNone(self.drop())

    def test_the_waiver_is_printed(self):
        waived = status("codex-review", "SUCCESS", "WAIVED: Codex is out of credits; abc1234567 was not reviewed", at(13))
        codex = [TRIGGER, comment(101, CODEX, USAGE_LIMIT, at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), waived, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("WAIVED: Codex is out of credits; abc1234567 was not reviewed", done.stdout)

    def test_a_thumbs_up_on_the_pr_body_is_waited_on_with_one_dispatched_sweep(self):
        # A reaction triggers no pr-gate run, so the gate is asked for a sweep,
        # once however long it takes to catch up.
        counted = status("codex-review", "SUCCESS", "Codex found no major issues in abc1234567 (thumbs-up on the PR)", at(13))
        lagging = snapshot(body_thumbs=BODY_THUMBS)
        caught_up = snapshot(merge="CLEAN", body_thumbs=BODY_THUMBS, contexts=[check("pytest"), counted, ATTESTED])
        done = self.poll(lagging, lagging, caught_up)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(self.polls, 3)
        self.assertEqual(self.dispatches(), [DISPATCH])

    def test_a_thumbs_up_the_gate_does_not_count_is_reported_by_the_gates_reason(self):
        not_tied = status("codex-review", "PENDING", "Codex's thumbs-up is not tied to abc1234567; comment @codex review", at(13))
        done = self.poll(snapshot(body_thumbs=BODY_THUMBS, contexts=[check("pytest"), not_tied, ATTESTED]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("Codex's thumbs-up is not tied to abc1234567; comment @codex review", done.stdout)
        self.assertNotIn("cannot count", done.stdout)
        self.assertEqual(self.dispatches(), [])

    def test_a_failed_dispatch_is_announced_and_the_wait_goes_on(self):
        counted = status("codex-review", "SUCCESS", "Codex found no major issues in abc1234567 (thumbs-up on the PR)", at(13))
        done = self.poll(snapshot(body_thumbs=BODY_THUMBS),
                         snapshot(merge="CLEAN", body_thumbs=BODY_THUMBS, contexts=[check("pytest"), counted, ATTESTED]),
                         env_extra={"FAKE_GH_DISPATCH_FAILS": "1"})
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("could not dispatch", done.stderr)
        self.assertEqual(self.dispatches(), [DISPATCH])

    def test_no_sweep_is_dispatched_while_the_gate_is_not_behind_codex(self):
        done = self.poll(snapshot(contexts=[check("pytest", "IN_PROGRESS", None), WAITING, ATTESTED]), minutes="0")
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertEqual(self.dispatches(), [])

    def test_a_thumbs_up_on_the_pr_body_silences_the_trigger_comment_note(self):
        counted = status("codex-review", "SUCCESS", "Codex found no major issues in abc1234567 (thumbs-up on the PR)", at(13))
        request = comment(100, "Analitiq-Bot", "@codex review", TRIGGER_AT, thumbs_up=BODY_THUMBS)
        done = self.poll(snapshot(merge="CLEAN", comments=[request], body_thumbs=BODY_THUMBS,
                                  contexts=[check("pytest"), counted, ATTESTED]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertNotIn("@codex review comment", done.stdout)

    def test_a_bare_thumbs_up_on_the_trigger_comment_asks_for_a_re_request(self):
        # The gate reads Codex's reactions on the PR description only.
        request = comment(100, "Analitiq-Bot", "@codex review", TRIGGER_AT, thumbs_up=BODY_THUMBS)
        done = self.poll(snapshot(comments=[request]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("comment `@codex review`", done.stdout)
        self.assertEqual(self.dispatches(), [])

    def test_a_draft_is_reported_without_waiting_for_codex(self):
        done = self.poll(snapshot(merge="DRAFT"))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertEqual(self.polls, 1)
        self.assertIn("DRAFT", done.stdout)

    # -- the report ------------------------------------------------------------

    def test_gist_and_severity_per_reviewer(self):
        done = self.poll(snapshot(
            reviews=[review(9, CODEX, "Here are some automated review suggestions", at(12))],
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
        codex = review(10, CODEX, "Here are some automated review suggestions", at(12))
        reply = comment(99, "Analitiq-Bot", "Fixed: https://github.com/acme/demo/pull/7"
                                            "#pullrequestreview-7-cr-22222260e9526132bffbe6d5", at(-65))
        done = self.poll(snapshot(comments=[reply, TRIGGER], reviews=[answered, older, this_round, codex]))
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
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  reviews=[review(9, "coderabbitai", OUTSIDE_DIFF_REVIEW_BODY, at(-5))]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn("Describe cursor_field as a top-level property.", done.stdout)

    def test_an_outside_diff_finding_quoted_in_a_pr_comment_is_answered(self):
        answer = comment(102, "Analitiq-Bot", "Pushing back on https://github.com/acme/demo/pull/7"
                                              "#pullrequestreview-9-cr-50a39c60e9526132bffbe6d5: the field is nested.", at(13))
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12)), answer]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  reviews=[review(9, "coderabbitai", OUTSIDE_DIFF_REVIEW_BODY, at(-5))]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_an_outside_diff_count_the_parser_cannot_meet_fails_loud(self):
        garbled = OUTSIDE_DIFF_REVIEW_BODY.replace("<summary><em>", "<summary><strong>")
        done = self.poll(snapshot(reviews=[review(9, "coderabbitai", garbled, at(10)),
                                           review(10, CODEX, "Here are some automated review suggestions", at(12))]))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("Outside diff range", done.stderr)

    def test_the_pr_authors_own_threads_are_replies_not_findings(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  threads=[thread(4, "Analitiq-Bot", "Fixed in abc.")]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_a_resolved_thread_is_not_a_finding(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        done = self.poll(snapshot(merge="CLEAN", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED],
                                  threads=[thread(5, CODEX, CODEX_THREAD_BODY, resolved=True)]))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_an_ignored_failing_check_leaves_github_unstable_and_the_pr_clean(self):
        # GitHub reports a non-required red check as UNSTABLE, never CLEAN.
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        ctx = [check("pytest"), check("flaky", conclusion="FAILURE"), CODEX_CLEAN, ATTESTED]
        done = self.poll(snapshot(merge="UNSTABLE", comments=codex, contexts=ctx), args=("--ignore-check", "flaky"))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("Ignoring CI check(s) by explicit instruction: flaky", done.stdout)
        self.assertIn("flaky [FAILURE]", done.stdout)
        self.assertEqual(self.drop()["status"], "clean")

    def test_unstable_from_a_check_not_ignored_is_blocked(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        pending = status("internal-review", "PENDING", "Waiting for an internal review of abc1234567", at(0))
        ctx = [check("pytest"), check("flaky", conclusion="FAILURE"), CODEX_CLEAN, pending]
        done = self.poll(snapshot(merge="UNSTABLE", comments=codex, contexts=ctx), args=("--ignore-check", "flaky"))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)

    def test_unstable_that_no_ignored_check_explains_is_blocked(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        done = self.poll(snapshot(merge="UNSTABLE", comments=codex, contexts=[check("pytest"), CODEX_CLEAN, ATTESTED]))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)

    def test_an_ignored_check_that_blocks_the_pr_is_named_in_the_report(self):
        codex = [TRIGGER, comment(101, CODEX, "Codex Review: Didn't find any major issues.", at(12))]
        ctx = [check("pytest"), check("required-but-red", conclusion="FAILURE"), CODEX_CLEAN, ATTESTED]
        done = self.poll(snapshot(merge="BLOCKED", comments=codex, contexts=ctx),
                         args=("--ignore-check", "required-but-red"))
        self.assertEqual(done.returncode, 4, done.stdout + done.stderr)
        self.assertIn("required-but-red [FAILURE]", done.stdout)

    def test_codex_comments_reach_the_drop_as_gate_comments(self):
        codex = [TRIGGER, comment(101, CODEX, USAGE_LIMIT, at(12))]
        predates = status("codex-review", "PENDING", "Codex's out-of-credits answer predates abc1234567; comment @codex review", at(13))
        done = self.poll(snapshot(comments=codex, contexts=[check("pytest", conclusion="FAILURE"), predates, ATTESTED]))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        [said] = self.drop()["gate_comments"]
        self.assertEqual((said["url"], said["approves"]), (codex[1]["url"], False))

    def test_more_than_one_page_fails_loud(self):
        done = self.poll(snapshot(overflow="reviewThreads"))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("reviewThreads", done.stderr)


if __name__ == "__main__":
    unittest.main()
