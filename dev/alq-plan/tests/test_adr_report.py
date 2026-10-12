"""The ADR report (#88): the decisions governing a plan, from the project's own corpus and the org's, for critique to
judge the plan against.

adrkit itself is not under test: a stand-in `check.sh` plays it, reporting every record of the corpus it is pointed at
as governing, so the tests show which corpus each run was pointed at and what the report makes of its answer.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import PLUGIN
from test_drive_workflow import workflow_steps

SCRIPT = PLUGIN / "scripts" / "adr_report.py"
SPEC_DIR = "specs/001-demo"
REPORT = "adr-report.md"
CHECK = ".specify/extensions/adrkit/scripts/check.sh"
ORG_ADR_DIR = "ALQ_ORG_ADR_DIR"

# Answers as adrkit's check.sh does: its marker line, then one CheckOutcome, here with every record in $ADRKIT_DIR
# governing. The feature folder it was handed is recorded beside the corpus so a test can read it back.
STAND_IN_CHECK = f"""#!{sys.executable}
import json, os, re, sys
corpus = os.environ["ADRKIT_DIR"]
if os.environ.get("CHECK_FAILS"):
    sys.exit("adrkit: adrkit's CLI is not installed")
with open(os.path.join(corpus, ".feature_dir"), "w") as seen:
    seen.write(os.environ["ADRKIT_FEATURE_DIR"])
governed = []
for name in sorted(os.listdir(corpus)):
    found = re.match(r"^([0-9]{{4,}})-(.+)\\.md$", name)
    if found:
        governed.append({{"recordId": found[1], "title": found[2].replace("-", " "), "status": "accepted",
                         "bucket": "governing"}})
print("==> adrkit:check")
print(json.dumps({{"changedFiles": [], "governedBy": governed, "findings": []}}, indent=2))
"""


def record(corpus: Path, rid: str, slug: str, body: str):
    corpus.mkdir(parents=True, exist_ok=True)
    (corpus / f"{rid}-{slug}.md").write_text(f'---\nid: "{rid}"\n---\n\n{body}\n')


class Report(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "project"
        (self.root / SPEC_DIR).mkdir(parents=True)
        (self.root / SPEC_DIR / "plan.md").write_text("# Plan\n")
        self.org = Path(tmp.name) / "engineering" / "docs" / "adr"
        self.env = {k: v for k, v in os.environ.items() if k not in (ORG_ADR_DIR, "CHECK_FAILS")}

    def install_check(self):
        check = self.root / CHECK
        check.parent.mkdir(parents=True)
        check.write_text(STAND_IN_CHECK)
        check.chmod(0o755)

    def run_report(self):
        proc = subprocess.run([sys.executable, str(SCRIPT), SPEC_DIR, REPORT], cwd=self.root, env=self.env,
                              capture_output=True, text=True)
        written = self.root / REPORT
        return proc, written.read_text() if written.is_file() else None

    def test_both_corpora_are_checked_and_one_id_in_each_is_two_decisions(self):
        self.install_check()
        record(self.root / "docs" / "adr", "0002", "keep-the-repo-rule", "Repo body.")
        record(self.org, "0002", "keep-the-org-rule", "Org body.")
        self.env[ORG_ADR_DIR] = str(self.org)
        proc, report = self.run_report()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        repo, org = report.split("## Org decisions")
        self.assertIn("0002", repo)
        self.assertIn("Repo body.", repo)
        self.assertNotIn("Org body.", repo)
        self.assertIn("0002", org)
        self.assertIn("Org body.", org)
        self.assertNotIn("Repo body.", org)

    def test_adrkit_is_handed_the_spec_folder_whose_plan_it_checks(self):
        self.install_check()
        record(self.root / "docs" / "adr", "0001", "rule", "Body.")
        proc, _ = self.run_report()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((self.root / "docs" / "adr" / ".feature_dir").read_text(), SPEC_DIR)

    def test_an_unset_org_corpus_is_named_as_not_checked(self):
        self.install_check()
        record(self.root / "docs" / "adr", "0001", "rule", "Body.")
        proc, report = self.run_report()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        org = report.split("## Org decisions")[1]
        self.assertIn(f"Not checked: {ORG_ADR_DIR} is unset", org)

    def test_a_project_without_its_own_corpus_is_named_as_not_checked(self):
        self.install_check()
        record(self.org, "0001", "rule", "Org body.")
        self.env[ORG_ADR_DIR] = str(self.org)
        proc, report = self.run_report()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        repo, org = report.split("## Org decisions")
        self.assertIn("Not checked: this project has no docs/adr", repo)
        self.assertIn("Org body.", org)

    def test_with_nothing_to_check_adrkit_is_not_needed(self):
        proc, report = self.run_report()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(report.count("Not checked:"), 2)

    def test_a_corpus_no_decision_governs_says_so(self):
        self.install_check()
        self.org.mkdir(parents=True)
        self.env[ORG_ADR_DIR] = str(self.org)
        proc, report = self.run_report()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("No decision", report.split("## Org decisions")[1])

    def test_an_org_corpus_that_is_not_there_stops_the_check(self):
        self.install_check()
        self.env[ORG_ADR_DIR] = str(self.org)
        proc, report = self.run_report()
        self.assertEqual(proc.returncode, 2)
        self.assertIsNone(report)
        self.assertIn(str(self.org), proc.stderr)
        self.assertIn("Next step:", proc.stderr)

    def test_a_project_without_adrkit_stops_the_check_and_names_the_install(self):
        record(self.root / "docs" / "adr", "0001", "rule", "Body.")
        proc, report = self.run_report()
        self.assertEqual(proc.returncode, 2)
        self.assertIsNone(report)
        self.assertIn("specify extension add adrkit", proc.stderr)

    def test_adrkit_failing_stops_the_check_with_its_own_message(self):
        self.install_check()
        record(self.root / "docs" / "adr", "0001", "rule", "Body.")
        self.env["CHECK_FAILS"] = "1"
        proc, report = self.run_report()
        self.assertEqual(proc.returncode, 2)
        self.assertIsNone(report)
        self.assertIn("adrkit's CLI is not installed", proc.stderr)
        self.assertIn("Next step:", proc.stderr)


class Workflow(unittest.TestCase):
    """The report is written after the plan is settled and handed to critique, whose gate is where departures land."""

    def test_the_report_is_written_after_settled_design_and_before_critique(self):
        ids = [s["id"] for s in workflow_steps()]
        self.assertLess(ids.index("settled-design"), ids.index("adr-report"))
        self.assertLess(ids.index("adr-report"), ids.index("critique"))

    def test_critique_is_handed_the_report_the_step_writes(self):
        [step] = [s for s in workflow_steps() if s["id"] == "adr-report"]
        [critique] = [s for s in workflow_steps() if s["id"] == "critique"]
        path = ".specify/workflows/runs/{{ context.run_id }}/adr-report.md"
        self.assertIn(f'python3 "$ALQ_PLAN_ROOT/scripts/adr_report.py" "$dir" "{path}"', step["run"])
        self.assertIn(path, critique["input"]["args"])


if __name__ == "__main__":
    unittest.main()
