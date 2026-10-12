"""decisions.py (#88): which accepted decisions govern the files a review round reads, asked of adrkit's own `adr check`
and `adr lint` once per corpus: every docs/adr the repo tracks, and the org's at $ALQ_ORG_ADR_DIR. A corpus adrkit did not
evaluate in full cannot be checked.

Governing runs the real adrkit CLI, so what it grades is adrkit's contract and not a copy of it. Unreadable runs a
stand-in that misbehaves in ways the real one does not on demand.
"""
import os
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
    deciders = 'deciders: ["@lead"]\n' if status == "accepted" and "deciders" not in extra else ""
    (corpus / f"{rid}-{slug}.md").write_text(
        f'---\nid: "{rid}"\ntitle: "{slug.replace("-", " ").capitalize()}"\nstatus: {status}\ndate: 2026-10-12\n'
        f'{deciders}{extra}affects:\n  - type: path\n    pattern: "{pattern}"\n---\n\n# {slug}\n')


def bad(corpus: Path, rid: str, status: str = "accepted"):
    """A record adrkit lints with an error: its deciders are not a list."""
    record(corpus, rid, "bad-record", status=status, extra="deciders: 7\n")


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
        self.corpus = self.root / "docs" / "adr"
        self.org = Path(tmp.name) / "engineering" / "docs" / "adr"

    def track(self):
        git(self.root, "add", "-A")

    def governing(self, files=("src/a.py",), org=None, cli=ADR):
        return decisions.governing(str(self.root), list(files), org, cli, time.monotonic() + 60)

    def refused(self, **kw) -> str:
        with self.assertRaises(decisions.Unavailable) as raised:
            self.governing(**kw)
        self.assertIn("Next step:", str(raised.exception))
        return str(raised.exception)

    def ids(self, governance):
        return [(d.corpus, d.record_id) for d in governance.decisions]

    def test_only_accepted_decisions_whose_affects_match_a_changed_file_govern(self):
        record(self.corpus, "0001", "keep-src-pure")
        record(self.corpus, "0002", "draft-rule", status="draft")
        record(self.corpus, "0003", "docs-rule", pattern="docs/**")
        self.track()
        found = self.governing()
        self.assertEqual(self.ids(found), [("docs/adr", "0001")])
        [decision] = found.decisions
        self.assertEqual(decision.title, "Keep src pure")
        self.assertEqual(Path(decision.record), self.corpus / "0001-keep-src-pure.md")

    def test_every_tracked_corpus_in_the_repo_is_checked_and_an_untracked_one_is_not(self):
        record(self.root / "dev" / "a" / "docs" / "adr", "0001", "rule-of-a")
        record(self.root / "dev" / "b" / "docs" / "adr", "0001", "rule-of-b")
        self.track()
        record(self.root / "dev" / "c" / "docs" / "adr", "0001", "untracked-rule")
        self.assertEqual(self.ids(self.governing()), [("dev/a/docs/adr", "0001"), ("dev/b/docs/adr", "0001")])

    def test_the_same_id_in_the_repo_and_the_org_is_two_decisions(self):
        record(self.corpus, "0001", "repo-rule")
        record(self.org, "0001", "org-rule")
        self.track()
        found = self.governing(org=str(self.org))
        self.assertEqual(self.ids(found), [("docs/adr", "0001"), (f"org ({self.org})", "0001")])
        self.assertEqual(found.notices, ())

    def test_an_org_corpus_that_is_also_a_repo_corpus_is_checked_once(self):
        record(self.corpus, "0001", "rule")
        self.track()
        self.assertEqual(self.ids(self.governing(org=str(self.corpus))), [("docs/adr", "0001")])

    def test_an_unset_org_corpus_is_a_notice_not_a_silence(self):
        record(self.corpus, "0001", "rule")
        self.track()
        [notice] = self.governing().notices
        self.assertIn(decisions.ORG_CORPUS_VAR, notice)

    def test_a_relative_org_corpus_is_refused_since_the_hook_and_adr_run_from_different_directories(self):
        record(self.corpus, "0001", "rule")
        self.track()
        self.assertIn("absolute", self.refused(org="docs/adr"))

    def test_an_org_corpus_that_is_not_there_cannot_be_checked(self):
        self.assertIn(str(self.org), self.refused(org=str(self.org)))

    def test_a_corpus_without_the_cli_cannot_be_checked(self):
        record(self.corpus, "0001", "rule")
        self.track()
        self.assertIn(decisions.INSTALL, self.refused(cli=None))

    def test_with_no_corpus_at_all_the_cli_is_not_needed(self):
        self.assertEqual(self.governing(cli=None).decisions, ())

    def test_an_invalid_accepted_record_the_change_edits_is_refused(self):
        record(self.corpus, "0001", "rule")
        bad(self.corpus, "0002")
        self.track()
        self.assertIn("docs/adr/0002-bad-record.md", self.refused(files=("src/a.py", "docs/adr/0002-bad-record.md")))

    def test_an_invalid_accepted_record_the_change_does_not_touch_is_refused(self):
        """adr check leaves out a record it cannot load, so a broken record that should govern would govern nothing."""
        bad(self.corpus, "0001")
        self.track()
        reason = self.refused()
        self.assertIn("docs/adr/0001-bad-record.md", reason)
        self.assertIn("commit", reason)

    def test_an_accepted_record_with_a_matcher_adrkit_does_not_evaluate_is_refused(self):
        record(self.corpus, "0001", "rooted-rule", pattern="/src/**")
        self.track()
        self.assertIn("docs/adr/0001-rooted-rule.md", self.refused())

    def test_findings_on_a_record_that_cannot_govern_yet_do_not_refuse(self):
        record(self.corpus, "0001", "rule")
        bad(self.corpus, "0002", status="draft")
        record(self.corpus, "0003", "rooted-proposal", status="proposed", pattern="/src/**")
        self.track()
        self.assertEqual(self.ids(self.governing()), [("docs/adr", "0001")])

    def test_a_warning_that_leaves_every_record_evaluated_does_not_refuse(self):
        record(self.corpus, "0001", "rule", extra='conflictsWith: ["0099"]\n')
        self.track()
        self.assertEqual(self.ids(self.governing()), [("docs/adr", "0001")])

    def test_an_invalid_org_record_says_to_fix_the_org_corpus_or_unset_it(self):
        bad(self.org, "0001")
        reason = self.refused(org=str(self.org))
        self.assertIn(decisions.ORG_CORPUS_VAR, reason)
        self.assertNotIn("commit", reason)

    def test_every_rule_this_module_reads_as_incomplete_is_one_the_installed_adrkit_emits(self):
        package = Path(os.path.realpath(ADR)).parents[2]
        shipped = "".join(p.read_text(errors="replace") for p in package.rglob("*.js"))
        self.assertEqual([r for r in decisions.INCOMPLETE_RULES if f'"{r}"' not in shipped], [])


class Unreadable(unittest.TestCase):
    """What a corpus check does when the CLI misbehaves."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "repo"
        record(self.root / "docs" / "adr", "0001", "rule")
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "add", "-A")
        self.cli = Path(tmp.name) / "adr"

    def stand_in(self, lint: str, check: str = '{"governing": [], "findings": [], "markerScan": '
                                                 '{"unreadablePaths": [], "truncatedPaths": []}}') -> str:
        self.cli.write_text(f'#!/bin/sh\ncase "$1" in\n  lint) {lint} ;;\n  *) echo \'{check}\' ;;\nesac\n')
        self.cli.chmod(0o755)
        return str(self.cli)

    def refused(self, cli: str, deadline: float = 60) -> str:
        with self.assertRaises(decisions.Unavailable) as raised:
            decisions.governing(str(self.root), ["src/a.py"], None, cli, time.monotonic() + deadline)
        return str(raised.exception)

    def test_the_stand_in_answers_a_well_formed_report(self):
        cli = self.stand_in("""echo '{"checked": 1, "findings": []}'""")
        self.assertEqual(decisions.governing(str(self.root), ["src/a.py"], None, cli, time.monotonic() + 60).decisions,
                         ())

    def test_a_check_report_of_another_shape_cannot_be_checked(self):
        cli = self.stand_in("""echo '{"checked": 1, "findings": []}'""", check='{"governing": "0001", "findings": []}')
        self.assertIn(decisions.INSTALL, self.refused(cli))

    def test_a_lint_finding_of_another_shape_cannot_be_checked(self):
        cli = self.stand_in("""echo '{"checked": 1, "findings": [{"rule": 7}]}'""")
        self.assertIn(decisions.INSTALL, self.refused(cli))

    def test_a_report_that_is_not_an_object_cannot_be_checked(self):
        cli = self.stand_in("echo '[]'")
        self.assertIn(decisions.INSTALL, self.refused(cli))

    def test_a_marker_scan_that_could_not_read_a_file_is_incomplete(self):
        cli = self.stand_in("""echo '{"checked": 1, "findings": []}'""", check='{"governing": [], "findings": [], '
                            '"markerScan": {"unreadablePaths": ["src/a.py"], "truncatedPaths": []}}')
        self.assertIn("src/a.py", self.refused(cli))

    def test_a_cli_that_hangs_is_stopped_at_the_deadline(self):
        cli = self.stand_in("sleep 30")
        started = time.monotonic()
        self.refused(cli, deadline=0.5)
        self.assertLess(time.monotonic() - started, 5)


if __name__ == "__main__":
    unittest.main()
