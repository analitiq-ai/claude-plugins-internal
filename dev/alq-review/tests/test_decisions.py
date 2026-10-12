"""decisions.py (#88): which accepted decisions govern the files a review round reads, asked of adrkit's own `adr check`
once per corpus: every docs/adr the repo tracks, and the org's at $ALQ_ORG_ADR_DIR.

These run the real adrkit CLI, so what is graded is adrkit's contract and not a copy of it.
"""
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from paths import PLUGIN  # noqa: F401 - puts the plugin's scripts on sys.path

from test_worktree_facts import git

import decisions

ADR = shutil.which("adr")


def record(corpus: Path, rid: str, slug: str, status: str = "accepted", pattern: str = "src/**", extra: str = ""):
    corpus.mkdir(parents=True, exist_ok=True)
    deciders = 'deciders: ["@lead"]\n' if status == "accepted" else ""
    (corpus / f"{rid}-{slug}.md").write_text(
        f'---\nid: "{rid}"\ntitle: "{slug.replace("-", " ").capitalize()}"\nstatus: {status}\ndate: 2026-10-12\n'
        f'{deciders}{extra}affects:\n  - type: path\n    pattern: "{pattern}"\n---\n\n# {slug}\n')


@unittest.skipUnless(ADR, "adrkit's CLI `adr` is not on PATH")
class Governing(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "repo"
        self.root.mkdir()
        git(self.root, "init", "-q", "-b", "main")
        (self.root / "src").mkdir()
        (self.root / "src" / "a.py").write_text("a\n")
        self.org = Path(tmp.name) / "engineering" / "docs" / "adr"

    def track(self):
        git(self.root, "add", "-A")

    def governing(self, files=("src/a.py",), org=None, cli=ADR):
        return decisions.governing(str(self.root), list(files), org, cli, time.monotonic() + 60)

    def ids(self, governance):
        return [(d.corpus, d.record_id) for d in governance.decisions]

    def test_only_accepted_decisions_whose_affects_match_a_changed_file_govern(self):
        record(self.root / "docs" / "adr", "0001", "keep-src-pure")
        record(self.root / "docs" / "adr", "0002", "draft-rule", status="draft")
        record(self.root / "docs" / "adr", "0003", "docs-rule", pattern="docs/**")
        self.track()
        found = self.governing()
        self.assertEqual(self.ids(found), [("docs/adr", "0001")])
        [decision] = found.decisions
        self.assertEqual(decision.title, "Keep src pure")
        self.assertEqual(Path(decision.record), self.root / "docs" / "adr" / "0001-keep-src-pure.md")

    def test_every_tracked_corpus_in_the_repo_is_checked_and_an_untracked_one_is_not(self):
        record(self.root / "dev" / "a" / "docs" / "adr", "0001", "rule-of-a")
        record(self.root / "dev" / "b" / "docs" / "adr", "0001", "rule-of-b")
        self.track()
        record(self.root / "dev" / "c" / "docs" / "adr", "0001", "untracked-rule")
        self.assertEqual(self.ids(self.governing()), [("dev/a/docs/adr", "0001"), ("dev/b/docs/adr", "0001")])

    def test_the_same_id_in_the_repo_and_the_org_is_two_decisions(self):
        record(self.root / "docs" / "adr", "0001", "repo-rule")
        record(self.org, "0001", "org-rule")
        self.track()
        found = self.governing(org=str(self.org))
        self.assertEqual(self.ids(found), [("docs/adr", "0001"), (f"org ({self.org})", "0001")])
        self.assertEqual(found.notices, ())

    def test_an_org_corpus_that_is_also_a_repo_corpus_is_checked_once(self):
        record(self.root / "docs" / "adr", "0001", "rule")
        self.track()
        self.assertEqual(self.ids(self.governing(org=str(self.root / "docs" / "adr"))), [("docs/adr", "0001")])

    def test_an_unset_org_corpus_is_a_notice_not_a_silence(self):
        record(self.root / "docs" / "adr", "0001", "rule")
        self.track()
        [notice] = self.governing().notices
        self.assertIn(decisions.ORG_CORPUS_VAR, notice)

    def test_a_relative_org_corpus_is_refused_since_the_hook_and_adr_run_from_different_directories(self):
        record(self.root / "docs" / "adr", "0001", "rule")
        self.track()
        with self.assertRaises(decisions.Unavailable) as raised:
            self.governing(org="docs/adr")
        self.assertIn("absolute", str(raised.exception))

    def test_an_org_corpus_that_is_not_there_cannot_be_checked(self):
        with self.assertRaises(decisions.Unavailable) as raised:
            self.governing(org=str(self.org))
        self.assertIn(str(self.org), str(raised.exception))
        self.assertIn("Next step:", str(raised.exception))

    def test_a_corpus_without_the_cli_cannot_be_checked(self):
        record(self.root / "docs" / "adr", "0001", "rule")
        self.track()
        with self.assertRaises(decisions.Unavailable) as raised:
            self.governing(cli=None)
        self.assertIn("npm install -g @adrkit/cli", str(raised.exception))

    def test_with_no_corpus_at_all_the_cli_is_not_needed(self):
        found = self.governing(cli=None)
        self.assertEqual(found.decisions, ())
        self.assertEqual(found.record_errors, ())

    def test_an_invalid_record_the_change_edits_is_reported(self):
        record(self.root / "docs" / "adr", "0001", "rule")
        (self.root / "docs" / "adr" / "0002-bad.md").write_text(
            '---\nid: "0002"\ntitle: "Bad record"\nstatus: accepted\ndate: 2026-10-12\n---\n')
        self.track()
        found = self.governing(files=("src/a.py", "docs/adr/0002-bad.md"))
        [error] = found.record_errors
        self.assertIn("docs/adr/0002-bad.md", error)
        self.assertIn("decider", error)

    def test_an_invalid_record_the_change_does_not_touch_is_reported(self):
        """adr check leaves out a record it cannot load, so a broken record that should govern would govern nothing."""
        (self.root / "docs" / "adr").mkdir(parents=True)
        (self.root / "docs" / "adr" / "0001-bad.md").write_text(
            '---\nid: "0001"\ntitle: "Bad record"\nstatus: accepted\ndate: 2026-10-12\n'
            'affects:\n  - type: path\n    pattern: "src/**"\n---\n')
        self.track()
        [error] = self.governing().record_errors
        self.assertIn("docs/adr/0001-bad.md", error)


class Unreadable(unittest.TestCase):
    """What a corpus check does when the CLI misbehaves: a stand-in `adr` that hangs or prints the wrong shape."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "repo"
        record(self.root / "docs" / "adr", "0001", "rule")
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "add", "-A")
        self.cli = Path(tmp.name) / "adr"

    def stand_in(self, body: str) -> str:
        self.cli.write_text(f"#!/bin/sh\n{body}\n")
        self.cli.chmod(0o755)
        return str(self.cli)

    def test_a_report_of_another_shape_cannot_be_checked(self):
        cli = self.stand_in("""echo '{"governing": "0001", "findings": []}'""")
        with self.assertRaises(decisions.Unavailable) as raised:
            decisions.governing(str(self.root), ["src/a.py"], None, cli, time.monotonic() + 60)
        self.assertIn("Next step:", str(raised.exception))

    def test_a_cli_that_hangs_is_stopped_at_the_deadline(self):
        cli = self.stand_in("sleep 30")
        started = time.monotonic()
        with self.assertRaises(decisions.Unavailable):
            decisions.governing(str(self.root), ["src/a.py"], None, cli, started + 0.5)
        self.assertLess(time.monotonic() - started, 5)


if __name__ == "__main__":
    unittest.main()
