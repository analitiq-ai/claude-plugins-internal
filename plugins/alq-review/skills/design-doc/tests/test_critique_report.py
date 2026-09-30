"""critique_report.py: the review gate shows the report this run's critique step wrote, never an older one."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[4] / ".specify" / "workflows" / "design-doc" / "critique_report.py"
FEATURE = "specs/001-demo"


class CritiqueReport(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        (self.root / ".specify").mkdir()
        (self.root / ".specify" / "feature.json").write_text(json.dumps({"feature_directory": FEATURE}))
        self.critiques = self.root / FEATURE / "critiques"
        self.critiques.mkdir(parents=True)

    def run_script(self, action):
        return subprocess.run([sys.executable, str(SCRIPT), action], cwd=self.root, capture_output=True, text=True)

    def test_an_earlier_runs_report_is_not_shown_when_this_run_wrote_none(self):
        (self.critiques / "critique-20990101-000000.md").write_text("old")
        self.assertEqual(self.run_script("mark").returncode, 0)
        found = self.run_script("find")
        self.assertNotEqual(found.returncode, 0)
        self.assertIn("wrote no report", found.stderr)

    def test_the_report_this_run_wrote_is_shown_even_when_an_older_one_sorts_after_it(self):
        (self.critiques / "critique-20990101-000000.md").write_text("old")
        self.run_script("mark")
        (self.critiques / "critique-20260930-120000.md").write_text("new")
        found = self.run_script("find")
        self.assertEqual(found.returncode, 0, found.stderr)
        self.assertEqual(json.loads(found.stdout), {"path": f"{FEATURE}/critiques/critique-20260930-120000.md"})

    def test_two_new_reports_are_refused(self):
        self.run_script("mark")
        (self.critiques / "critique-1.md").write_text("a")
        (self.critiques / "critique-2.md").write_text("b")
        found = self.run_script("find")
        self.assertNotEqual(found.returncode, 0)
        self.assertIn("2 reports", found.stderr)

    def test_find_without_mark_is_refused(self):
        (self.critiques / "critique-1.md").write_text("a")
        self.assertNotEqual(self.run_script("find").returncode, 0)


if __name__ == "__main__":
    unittest.main()
