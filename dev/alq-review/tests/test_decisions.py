"""decisions.py (#88): which accepted decisions govern the files a review round reads, asked of adrkit's own `adr check`
once per corpus: every docs/adr the repo tracks, and the org's at $ALQ_ORG_ADR_DIR.

These run the real adrkit CLI, so what is graded is adrkit's contract and not a copy of it.
"""
import shutil
import tempfile
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
        return decisions.governing(str(self.root), list(files), org, cli)

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


if __name__ == "__main__":
    unittest.main()
