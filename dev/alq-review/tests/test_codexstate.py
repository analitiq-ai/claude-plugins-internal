"""codexstate.py: Codex's state for a review round, graded on the bodies Codex really posted (tests/fixtures/codex)."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

import helpers  # noqa: F401

import codexstate
from paths import PLUGIN

SAMPLES = Path(__file__).parent / "fixtures" / "codex"
READER = PLUGIN / "scripts" / "codexstate.py"
SINCE = "2026-10-13T12:00:00Z"
HEAD = "a3d2db7" + "0123456789abcdef0123456789abcdef0"
OTHER = "d14438b"
USAGE_LIMIT = ("You have reached your Codex usage limits for code reviews. "
               "You can see your limits in the [Codex usage dashboard](https://chatgpt.com/codex/cloud/settings/usage).")


def sample(name):
    return (SAMPLES / name).read_text()


def item(body, at="2026-10-13T12:05:00Z", kind="comment", url="u1"):
    return {"kind": kind, "url": url, "at": at, "body": body}


def card(status="Completed", at="2026-10-13T12:10:00.123456Z", commit="a3d2db7", created="2026-10-13T11:00:00Z",
         url="card"):
    """The sampled one-row card, its Code Review row set to `status` at `at` for `commit`."""
    body = sample(f"card-one-row-{status.lower()}.md")
    row = next(line for line in body.splitlines() if line.startswith("| 📝 **Code Review**"))
    cells = row.split(" | ")
    cells[1] = cells[1].split("<relative-time")[0] + f'<relative-time datetime="{at}">{at}</relative-time>'
    cells[2] = f"`{commit}`"
    return item(body.replace(row, " | ".join(cells)), at=created, url=url)


def unreadable(why, url="card"):
    return [f"Codex status card {url} cannot be read: {why}; its format changed: "
            "report it on the plugin's repo and read the PR by hand"]


class Forms(unittest.TestCase):
    def test_each_sampled_acknowledgement_is_named_by_its_form(self):
        self.assertEqual(codexstate.match(item(sample("card-one-row-completed.md"))), "card")
        self.assertEqual(codexstate.match(item(sample("card-two-rows-code-completed-security-running.md"))), "card")
        self.assertEqual(codexstate.match(item(sample("verdict-comment.md"))), "verdict")
        self.assertEqual(codexstate.match(item(sample("security-comment.md"))), "security")
        # The sampled review body starts with a newline.
        self.assertEqual(codexstate.match(item(sample("review-with-findings.md"), kind="review")), "review")

    def test_a_form_is_matched_only_on_its_own_kind_of_item(self):
        self.assertIsNone(codexstate.match(item(sample("review-with-findings.md"), kind="comment")))
        self.assertIsNone(codexstate.match(item(sample("verdict-comment.md"), kind="review")))
        self.assertIsNone(codexstate.match(item(sample("card-one-row-completed.md"), kind="review")))

    def test_the_sampled_declines_match_no_form(self):
        for body in (sample("decline-not-connected.md"), sample("decline-error.md"), USAGE_LIMIT):
            with self.subTest(body=body[:40]):
                self.assertIsNone(codexstate.match(item(body)))

    def test_the_card_marker_must_be_the_whole_first_line(self):
        body = sample("card-one-row-completed.md").replace("-->\n", "--> trailing\n", 1)
        self.assertIsNone(codexstate.match(item(body)))


class Card(unittest.TestCase):
    def test_each_sampled_card_yields_its_code_review_row(self):
        expected = {
            "card-one-row-running.md": ("Running", "2026-10-13T13:43:28Z", "a3d2db7"),
            "card-one-row-completed.md": ("Completed", "2026-10-13T13:44:45Z", "a3d2db7"),
            "card-two-rows-code-running-security-completed.md": ("Running", "2026-10-13T14:06:20Z", "d14438b"),
            "card-two-rows-code-completed-security-running.md": ("Completed", "2026-10-13T13:54:16Z", "a3d2db7"),
            "card-two-rows-code-completed-security-completed.md": ("Completed", "2026-10-13T13:54:16Z", "a3d2db7"),
        }
        for name, (status, status_at, commit) in expected.items():
            with self.subTest(name=name):
                row, errors = codexstate.read_card("u1", sample(name))
                self.assertEqual(errors, [])
                self.assertEqual((row["status"], row["status_at"], row["commit"]), (status, status_at, commit))


class Unreadable(unittest.TestCase):
    """FR-007: each way a card cannot be read is its own reason, and no state is reported from it."""

    ROW = next(line for line in sample("card-one-row-completed.md").splitlines() if line.startswith("| 📝"))

    def assertUnreadable(self, items, why, url="card"):
        got = codexstate.state(items, SINCE, HEAD)
        self.assertEqual(got["state"], "unreadable")
        self.assertEqual((got["commit"], got["status_at"], got["unknown"]), (None, None, None))
        self.assertEqual(got["errors"], unreadable(why, url))

    def edited(self, new_row):
        return item(sample("card-one-row-completed.md").replace(self.ROW, new_row), url="card")

    def test_no_code_review_row(self):
        self.assertUnreadable([self.edited("")], "no Code Review row")

    def test_two_code_review_rows(self):
        self.assertUnreadable([self.edited(self.ROW + "\n" + self.ROW)], "2 Code Review rows")

    def test_a_status_neither_running_nor_completed(self):
        self.assertUnreadable([self.edited(self.ROW.replace("**Completed**", "**Failed**"))],
                              "status is neither Running nor Completed")

    def test_no_datetime(self):
        no_attr = self.ROW.replace('datetime="2026-10-13T13:44:45.273798Z"', "")
        self.assertNotEqual(no_attr, self.ROW)
        self.assertUnreadable([self.edited(no_attr)], "no datetime in the Status cell")

    def test_a_datetime_not_in_the_cards_format(self):
        self.assertUnreadable([self.edited(self.ROW.replace("2026-10-13T13:44:45.273798Z", "yesterday", 1))],
                              "datetime yesterday is not in the card's format")

    def test_no_commit(self):
        self.assertUnreadable([self.edited(self.ROW.replace("`a3d2db7`", ""))], "no commit in the Commit cell")

    def test_two_cards(self):
        self.assertUnreadable([card(url="first"), card(url="second", created="2026-10-13T11:30:00Z")],
                              "2 comments carry the marker", url="first")

    def test_an_unreadable_card_beside_an_unknown_item_is_unreadable(self):
        self.assertUnreadable([self.edited(""), item(USAGE_LIMIT)], "no Code Review row")


class States(unittest.TestCase):
    """R5: the order the reader decides in."""

    def state(self, *items):
        return codexstate.state(list(items), SINCE, HEAD)

    def test_nothing_from_codex_has_not_started(self):
        got = self.state()
        self.assertEqual((got["state"], got["commit"], got["status_at"]), ("not_started", None, None))

    def test_a_row_that_ended_before_the_trigger_has_not_started(self):
        got = self.state(card(at="2026-10-13T11:50:00Z"))
        self.assertEqual((got["state"], got["commit"], got["status_at"]),
                         ("not_started", "a3d2db7", "2026-10-13T11:50:00Z"))

    def test_a_running_row_is_reviewing_whatever_its_commit(self):
        for commit in ("a3d2db7", OTHER):
            with self.subTest(commit=commit):
                got = self.state(card("Running", commit=commit))
                self.assertEqual((got["state"], got["commit"], got["status_at"]),
                                 ("reviewing", commit, "2026-10-13T12:10:00Z"))

    def test_a_completed_row_for_the_head_is_the_answer_at_its_status_time(self):
        got = self.state(card())
        self.assertEqual((got["state"], got["commit"], got["status_at"]), ("answered", "a3d2db7", "2026-10-13T12:10:00Z"))

    def test_a_completed_row_for_another_commit_is_superseded(self):
        got = self.state(card(commit=OTHER))
        self.assertEqual((got["state"], got["commit"]), ("superseded", OTHER))

    def test_the_cards_creation_time_is_never_compared(self):
        self.assertEqual(self.state(card(created="2026-10-12T09:00:00Z"))["state"], "answered")

    def test_an_unknown_comment_with_no_row_since_the_trigger_is_declined(self):
        for rows in ((), (card(at="2026-10-13T11:50:00Z"),)):
            with self.subTest(rows=len(rows)):
                got = self.state(*rows, item(USAGE_LIMIT, url="limit"))
                self.assertEqual(got["state"], "declined")
                self.assertEqual((got["commit"], got["status_at"]), (None, None))
                self.assertEqual(got["unknown"], {"kind": "comment", "url": "limit", "at": "2026-10-13T12:05:00Z"})

    def test_an_unknown_comment_before_the_trigger_is_not_read(self):
        got = self.state(item(USAGE_LIMIT, at="2026-10-13T11:00:00Z"))
        self.assertEqual((got["state"], got["unknown"]), ("not_started", None))

    def test_an_unknown_item_beside_a_row_keeps_the_rows_state_and_names_the_earliest(self):
        later = item(sample("decline-error.md"), at="2026-10-13T12:07:00Z", url="later")
        earlier = item(USAGE_LIMIT, at="2026-10-13T12:03:00Z", url="earlier")
        for row, expected in ((card("Running"), "reviewing"), (card(), "answered"), (card(commit=OTHER), "superseded")):
            with self.subTest(expected=expected):
                got = self.state(row, later, earlier)
                self.assertEqual(got["state"], expected)
                self.assertEqual(got["unknown"], {"kind": "comment", "url": "earlier", "at": "2026-10-13T12:03:00Z"})

    def test_an_unknown_review_is_unknown_too(self):
        got = self.state(item("### A new heading", kind="review", url="r"))
        self.assertEqual((got["state"], got["unknown"]["kind"]), ("declined", "review"))

    def test_spoke_counts_any_item_but_the_card_since_the_trigger(self):
        self.assertFalse(self.state(card())["spoke"])
        self.assertFalse(self.state(card(), item(sample("verdict-comment.md"), at="2026-10-13T11:00:00Z"))["spoke"])
        self.assertTrue(self.state(card(), item(sample("review-with-findings.md"), kind="review"))["spoke"])

    def test_comments_are_the_non_card_comments_since_the_trigger_oldest_first(self):
        verdict = item(sample("verdict-comment.md"), at="2026-10-13T12:09:00Z", url="verdict")
        limit = item(USAGE_LIMIT, at="2026-10-13T12:01:00Z", url="limit")
        old = item(sample("verdict-comment.md"), at="2026-10-13T11:00:00Z", url="old")
        rev = item(sample("review-with-findings.md"), kind="review", url="review")
        got = self.state(card(), verdict, limit, old, rev)
        self.assertEqual(got["comments"], [{"url": "limit", "at": "2026-10-13T12:01:00Z", "body": USAGE_LIMIT},
                                           {"url": "verdict", "at": "2026-10-13T12:09:00Z",
                                            "body": sample("verdict-comment.md")}])

    def test_every_state_carries_every_field(self):
        for items in ((), (card(),), (item(USAGE_LIMIT),)):
            with self.subTest(n=len(items)):
                self.assertEqual(set(self.state(*items)),
                                 {"state", "commit", "status_at", "spoke", "comments", "unknown", "errors"})


class Cli(unittest.TestCase):
    def run_reader(self, stdin):
        return subprocess.run([sys.executable, str(READER)], input=stdin, capture_output=True, text=True, timeout=30)

    def test_the_cli_prints_the_state_as_json(self):
        for items in ([card()], [card(url="a"), card(url="b")]):
            with self.subTest(n=len(items)):
                done = self.run_reader(json.dumps({"since": SINCE, "head": HEAD, "items": items}))
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual(json.loads(done.stdout), codexstate.state(items, SINCE, HEAD))

    def test_input_of_another_shape_exits_2(self):
        bad = ["not json", "[]", json.dumps({"since": SINCE, "head": HEAD}),
               json.dumps({"since": SINCE, "head": HEAD, "items": [dict(item("x"), kind="reaction")]}),
               json.dumps({"since": SINCE, "head": HEAD, "items": [dict(item("x"), at=None)]}),
               json.dumps({"since": "yesterday", "head": HEAD, "items": []})]
        for stdin in bad:
            with self.subTest(stdin=stdin[:60]):
                done = self.run_reader(stdin)
                self.assertEqual(done.returncode, 2, done.stdout)
                self.assertTrue(done.stderr.startswith("codexstate: "), done.stderr)
                self.assertEqual(done.stdout, "")


if __name__ == "__main__":
    unittest.main()
