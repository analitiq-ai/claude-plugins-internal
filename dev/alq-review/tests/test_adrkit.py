"""The adrkit boundary: which corpora a checkout has, and one outcome per corpus from the real `adr check`. Stand-in
`adr` commands play the failures the real one cannot be made to show."""
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from test_decisions import needs_adr
from test_worktree_facts import Repo, git

import adrkit
import decisions

RECORD = """---
schemaVersion: 0.1.0
id: "{id}"
title: "{title}"
status: {status}
date: 2026-10-01
deciders: ["@t"]
scope: component
reversibility: two-way-door
blastRadius: component
affects:
  - type: path
    pattern: "src/**"
---

# ADR-{id}: {title}

## Context

c

## Decision

d

## Consequences

e
"""
FAR = 10_000  # seconds: a deadline no test reaches


def record(folder: Path, name: str, id: str, title: str = "On src", status: str = "accepted") -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text(RECORD.format(id=id, title=title, status=status))
    return path


class Checkout(Repo):
    def setUp(self):
        super().setUp()
        self.bin = Path(self.tmp.name) / "bin"
        self.bin.mkdir()
        self.env = {"PATH": os.environ["PATH"]}

    def environ(self, **extra):
        env = {k: v for k, v in os.environ.items() if k != "ALQ_ORG_ADR_DIR"}
        return mock.patch.dict(os.environ, dict(env, **self.env, **extra), clear=True)

    def corpora(self, org=None, root=None):
        with self.environ(**({"ALQ_ORG_ADR_DIR": org} if org is not None else {})):
            return adrkit.corpora(str(root or self.root))

    def check(self, files, org=None, within=FAR, spent=None, root=None):
        found = self.corpora(org, root)
        with self.environ():
            outcomes = adrkit.check(str(root or self.root), found.corpora, files,
                                    adrkit.Deadline(time.monotonic() + within, within), spent or {})
        return found, outcomes

    def stub(self, script: str) -> None:
        """An `adr` that is not adrkit: only it is on PATH, beside git."""
        path = self.bin / "adr"
        path.write_text("#!/bin/sh\n" + script)
        path.chmod(0o755)
        git_dir = str(Path(shutil.which("git")).parent)
        self.env["PATH"] = f"{self.bin}{os.pathsep}{git_dir}"


class Corpora(Checkout):
    def test_repo_corpora_are_labelled_by_their_path_from_the_root(self):
        record(self.root / "dev/x/docs/adr", "0001-a.md", "0001")
        record(self.root / "docs/adr", "0001-a.md", "0001")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "records")
        found = self.corpora()
        self.assertEqual([(c.label, c.org) for c in found.corpora], [("dev/x/docs/adr", False), ("docs/adr", False)])
        self.assertEqual((found.not_checked, found.org_corpus), ([], "unset"))

    def test_an_empty_org_setting_is_unset(self):
        self.assertEqual(self.corpora(org="").org_corpus, "unset")

    def test_the_org_corpus_is_labelled_by_the_setting(self):
        org = Path(self.tmp.name) / "engineering/docs/adr"
        record(org, "0001-a.md", "0001")
        found = self.corpora(org=str(org))
        self.assertEqual([(c.label, c.org) for c in found.corpora], [(f"org ({org})", True)])
        self.assertEqual(found.org_corpus, f"org ({org})")

    def test_a_folder_both_reach_is_one_corpus_the_orgs(self):
        record(self.root / "docs/adr", "0001-a.md", "0001")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "records")
        link = Path(self.tmp.name) / "org-link"
        link.symlink_to(self.root / "docs")
        found = self.corpora(org=f"{link}/adr")
        self.assertEqual([(c.label, c.org) for c in found.corpora], [(f"org ({link}/adr)", True)])

    def test_an_org_setting_that_is_no_absolute_readable_folder_could_not_run(self):
        missing = Path(self.tmp.name) / "nowhere"
        for value in ("relative/docs/adr", str(missing), str(self.root / "a.py")):
            with self.subTest(value=value):
                found = self.corpora(org=value)
                self.assertEqual(found.corpora, [])
                [outcome] = found.not_checked
                self.assertEqual((outcome.corpus.label, outcome.cause), (f"org ({value})", decisions.COULD_NOT_RUN))
                self.assertIn(value, outcome.reason)
                self.assertTrue(outcome.reason.endswith("Next step: point it at the org corpus, or unset it."))
                self.assertNotIn("commit", outcome.reason)


class BrokenRecordPlacements(Checkout):
    """R4: a change touching a record adrkit fails on is seen wherever the corpus sits and however it is reached."""
    CASES = {"duplicate id": ("0001-dup.md", "0001"), "no frontmatter": ("0002-bare.md", None)}

    def broken_in(self, corpus: Path, org=None, root=None):
        record(corpus, "0001-a.md", "0001")
        for name, _ in self.CASES.values():
            (corpus / name).write_text("placeholder\n")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "records")
        for case, (name, record_id) in self.CASES.items():
            with self.subTest(case=case):
                if record_id:
                    record(corpus, name, record_id, title="Duplicate")
                else:
                    (corpus / name).write_text("no frontmatter\n")
                changed = str((corpus / name).resolve().relative_to(self.root.resolve()))
                found, outcomes = self.check([changed], org=org, root=root)
                [judged] = [o for o in outcomes if o.corpus.path == str(corpus.resolve())]
                self.assertIsInstance(judged, decisions.Judged, getattr(judged, "reason", ""))
                self.assertEqual([(b["file"], b.get("id")) for b in judged.broken], [(changed, record_id)])
                (corpus / name).write_text("placeholder\n")

    def test_a_nested_repo_corpus(self):
        needs_adr(self)
        self.broken_in(self.root / "dev/x/docs/adr")

    def test_an_org_corpus_inside_the_checkout(self):
        needs_adr(self)
        self.broken_in(self.root / "org/docs/adr", org=str(self.root / "org/docs/adr"))

    def test_an_org_corpus_reached_through_a_symlink(self):
        needs_adr(self)
        link = Path(self.tmp.name) / "org-link"
        link.symlink_to(self.root / "org")
        self.broken_in(self.root / "org/docs/adr", org=f"{link}/docs/adr")

    def test_the_checkout_root_given_through_a_symlink_with_the_org_corpus_named_by_its_real_path(self):
        needs_adr(self)
        link = Path(self.tmp.name) / "root-link"
        link.symlink_to(self.root)
        self.broken_in(self.root / "org/docs/adr", org=str((self.root / "org/docs/adr").resolve()), root=link)


class Outcomes(Checkout):
    def setUp(self):
        super().setUp()
        record(self.root / "docs/adr", "0001-a.md", "0001", title="Accepted on src")
        record(self.root / "docs/adr", "0002-b.md", "0002", title="Draft on src", status="draft")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "records")

    def test_each_corpus_answers_with_the_records_that_govern(self):
        needs_adr(self)
        _, [judged] = self.check(["src/a.py"])
        self.assertEqual(judged.governing, ({"corpus": "docs/adr", "id": "0001", "title": "Accepted on src"},))

    def test_a_capped_marker_scan_could_not_run(self):
        needs_adr(self)
        (self.root / "src").mkdir()
        (self.root / "src/many.py").write_text("".join("// @adr 0001\n" for _ in range(65)))
        _, [outcome] = self.check(["src/many.py"])
        self.assertIsInstance(outcome, decisions.NotChecked)
        self.assertIn("marker-declarations-capped", outcome.reason)
        self.assertTrue(outcome.reason.endswith("Next step: split the change."))

    def test_without_adr_every_corpus_could_not_run_with_the_install_step(self):
        self.env["PATH"] = str(Path(shutil.which("git")).parent)
        _, [outcome] = self.check(["src/a.py"])
        self.assertEqual((outcome.corpus.label, outcome.cause), ("docs/adr", decisions.COULD_NOT_RUN))
        self.assertIn(adrkit.INSTALL, outcome.reason)

    def test_another_adrkit_version_could_not_run_with_the_install_step(self):
        self.stub('[ "$1" = --version ] && echo 0.19.0\n')
        _, [outcome] = self.check(["src/a.py"])
        self.assertIn("0.19.0", outcome.reason)
        self.assertIn(adrkit.INSTALL, outcome.reason)

    def test_an_answer_in_a_shape_the_plugin_does_not_read_could_not_run_with_the_install_step(self):
        answers = {"not json": "echo nope", "no ok": "echo null", "no governing": "echo '{\"ok\": true, \"findings\": []}'",
                   "a notice with no id": "echo '{\"ok\": true, \"governing\": [], \"findings\": [{\"rule\": "
                                          "\"affects-unresolvable\", \"severity\": \"info\", \"message\": \"m\"}]}'",
                   "failed with no error": "echo '{\"ok\": false, \"governing\": [], \"findings\": []}'; exit 1"}
        for case, answer in answers.items():
            with self.subTest(case=case):
                self.stub(f'[ "$1" = --version ] && echo {adrkit.VERSION} && exit 0\n{answer}\n')
                _, [outcome] = self.check(["src/a.py"])
                self.assertIsInstance(outcome, decisions.NotChecked)
                self.assertIn("docs/adr", outcome.reason)
                self.assertIn(adrkit.INSTALL, outcome.reason)

    def test_an_answer_that_is_not_json_says_so(self):
        self.stub(f'[ "$1" = --version ] && echo {adrkit.VERSION} && exit 0\necho nope\n')
        _, [outcome] = self.check(["src/a.py"])
        self.assertIn("Expecting value", outcome.reason)

    def test_any_other_adrkit_failure_could_not_run_with_adrkits_error(self):
        for code in (1, 2):   # adrkit's top-level catch exits 1, like a failed check, but answers on stderr only
            with self.subTest(exit=code):
                self.stub(f'[ "$1" = --version ] && echo {adrkit.VERSION} && exit 0\necho "Error: it broke" >&2\n'
                          f'exit {code}\n')
                _, [outcome] = self.check(["src/a.py"])
                self.assertIn("Error: it broke", outcome.reason)
                self.assertIn("docs/adr", outcome.reason)
                self.assertTrue(outcome.reason.endswith("Next step: fix what adr says, then launch again."))

    def test_a_call_past_the_deadline_names_each_steps_seconds(self):
        self.stub(f'[ "$1" = --version ] && echo {adrkit.VERSION} && exit 0\nsleep 5\n')
        _, [outcome] = self.check(["src/a.py"], within=0.5, spent={"gh calls": 0.2, "review-base fetch": 0.1})
        self.assertEqual(outcome.cause, decisions.COULD_NOT_RUN)
        for step in ("deadline, 0 s after", "gh calls 0.2 s", "review-base fetch 0.1 s", "adr --version",
                     "adr check of docs/adr"):
            self.assertIn(step, outcome.reason)

    def test_the_corpora_are_checked_at_the_same_time(self):
        org = Path(self.tmp.name) / "org"
        org.mkdir()
        answer = '{"ok": true, "governing": [], "findings": []}'
        self.stub(f"[ \"$1\" = --version ] && echo {adrkit.VERSION} && exit 0\nsleep 1\necho '{answer}'\n")
        _, outcomes = self.check(["src/a.py"], org=str(org), within=1.8)
        self.assertEqual([type(o) for o in outcomes], [decisions.Judged, decisions.Judged])

    def test_with_no_corpus_adr_is_not_called(self):
        git(self.root, "rm", "-q", "-r", "docs")
        git(self.root, "commit", "-q", "-m", "no records")
        called = Path(self.tmp.name) / "called"
        self.stub(f"touch {called}\n")
        found, outcomes = self.check(["src/a.py"])
        self.assertEqual((found.corpora, outcomes, called.exists()), ([], [], False))


if __name__ == "__main__":
    unittest.main()
