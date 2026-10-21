"""new_issue.py: the issue an `untracked` change gets, created in the repo origin names, its text through a file.

No test reaches GitHub: `gh` is a stand-in that keeps each call, with what it read on stdin.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import PLUGIN

SCRIPT = PLUGIN / "skills" / "issue-spec" / "scripts" / "new_issue.py"
ORIGIN = "https://github.test/acme/demo.git"
TYPES = ["Task", "Bug", "Feature"]
TITLE = "Rename the gate's `--x` flag"
BODY = "The flag `--x` $(touch PWNED) is renamed to `--strict`.\n\nNothing else changes."
URL = "https://github.test/acme/demo/issues/81"


class Checkout:
    """A git checkout whose origin is ORIGIN, beside a stand-in `gh`."""

    def __init__(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.root, bin_dir, self.log = tmp / "checkout", tmp / "bin", tmp / "gh.log"
        self.root.mkdir()
        bin_dir.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        for name, url in (("upstream", "https://github.test/other/demo.git"), ("origin", ORIGIN)):
            subprocess.run(["git", "-C", str(self.root), "remote", "add", name, url], check=True)
        # GH_FAILS fails every call and GH_CREATE_FAILS the create, the way gh does when GitHub refuses one.
        # GH_DROPS_TYPE creates the issue with no type, as GitHub does for a user without push access.
        gh = bin_dir / "gh"
        gh.write_text(f"#!{sys.executable}\nimport json, os, sys\n"
                      "args = sys.argv[1:]\n"
                      "stdin = sys.stdin.read() if args[-2:] == ['--input', '-'] else None\n"
                      f"with open({str(self.log)!r}, 'a') as log:\n"
                      "    log.write(json.dumps({'args': args, 'stdin': stdin}) + '\\n')\n"
                      "if os.environ.get('GH_FAILS'):\n"
                      "    sys.exit('HTTP 502: Bad Gateway')\n"
                      "if args[:2] == ['repo', 'view']:\n"
                      "    print('acme/demo')\n"
                      "elif args[:2] == ['api', 'graphql']:\n"
                      f"    print({chr(10).join(TYPES)!r})\n"
                      "elif os.environ.get('GH_CREATE_FAILS'):\n"
                      "    sys.exit('HTTP 422: Validation Failed')\n"
                      "else:\n"
                      "    kind = None if os.environ.get('GH_DROPS_TYPE') else {'name': json.loads(stdin)['type']}\n"
                      f"    print(json.dumps({{'number': 81, 'html_url': {URL!r}, 'type': kind}}))\n")
        gh.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"}

    def run(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.root, env=self.env,
                              capture_output=True, text=True)

    def issue_file(self, text):
        path = self.root.parent / "issue.md"
        path.write_text(text)
        return str(path)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def creates(self):
        return [call for call in self.calls() if call["args"][:3] == ["api", "--method", "POST"]]

    def close(self):
        self._tmp.cleanup()


class NewIssue(unittest.TestCase):
    def setUp(self):
        self.checkout = Checkout()
        self.addCleanup(self.checkout.close)

    def create(self, kind="Task", text=f"# {TITLE}\n\n{BODY}\n"):
        return self.checkout.run("create", kind, self.checkout.issue_file(text))

    def test_types_prints_the_issue_types_of_the_repo_origin_names(self):
        done = self.checkout.run("types")
        self.assertEqual((done.returncode, done.stdout.splitlines()), (0, TYPES), done.stderr)
        self.assertEqual(self.checkout.calls()[0]["args"][:3], ["repo", "view", ORIGIN])

    def test_create_makes_one_issue_in_origins_repo_with_its_text_read_from_stdin_and_prints_it(self):
        done = self.create()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout), {"issue": "81", "url": URL})
        self.assertEqual(self.checkout.calls()[0]["args"][:3], ["repo", "view", ORIGIN])
        [call] = self.checkout.creates()
        self.assertEqual(call["args"], ["api", "--method", "POST", "repos/acme/demo/issues", "--input", "-"])
        self.assertEqual(json.loads(call["stdin"]), {"title": TITLE, "body": BODY, "type": "Task"})

    def test_the_text_is_on_no_command_line_and_runs_nothing(self):
        self.create()
        self.assertTrue(self.checkout.creates())
        for call in self.checkout.calls():
            with self.subTest(call=call["args"][:2]):
                self.assertEqual([arg for arg in call["args"] if "--x" in arg or "PWNED" in arg], [])
        self.assertEqual(list(self.checkout.root.parent.rglob("PWNED")), [])

    def test_a_type_the_repo_does_not_offer_creates_nothing_and_names_the_ones_it_does(self):
        done = self.create("Epic")
        self.assertNotEqual(done.returncode, 0)
        for said in ("Epic", *TYPES, "Next step:"):
            self.assertIn(said, done.stderr)
        self.assertEqual(self.checkout.creates(), [])

    def test_a_title_or_body_that_is_empty_or_spaces_calls_github_for_nothing(self):
        for text in ("", "  \n", f"#   \n\n{BODY}\n", f"# {TITLE}\n\n  \n", f"{TITLE}\n\n{BODY}\n"):
            with self.subTest(text=text):
                done = self.create(text=text)
                self.assertNotEqual(done.returncode, 0)
                self.assertIn("Next step:", done.stderr)
                self.assertEqual(self.checkout.calls(), [])

    def test_an_issue_github_refuses_fails_with_what_github_said_and_the_next_step(self):
        self.checkout.env["GH_CREATE_FAILS"] = "1"
        done = self.create()
        self.assertNotEqual(done.returncode, 0)
        self.assertEqual(done.stdout, "")
        for said in ("HTTP 422", "Next step:"):
            self.assertIn(said, done.stderr)

    def test_an_issue_created_without_its_type_fails_naming_the_issue_and_how_to_set_it(self):
        self.checkout.env["GH_DROPS_TYPE"] = "1"
        done = self.create()
        self.assertNotEqual(done.returncode, 0)
        self.assertEqual(done.stdout, "")
        for said in (URL, "type", "push access", "Next step:"):
            self.assertIn(said, done.stderr)
        self.assertEqual(len(self.checkout.creates()), 1)

    def test_a_repo_github_cannot_show_fails_before_any_issue_is_created(self):
        self.checkout.env["GH_FAILS"] = "1"
        done = self.create()
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("HTTP 502", done.stderr)
        self.assertEqual(self.checkout.creates(), [])

    def test_a_checkout_with_no_origin_calls_github_for_nothing(self):
        """gh left to pick the repo picks one from the other remotes."""
        subprocess.run(["git", "-C", str(self.checkout.root), "remote", "remove", "origin"], check=True)
        for args in (("types",), ("create", "Task", self.checkout.issue_file(f"# {TITLE}\n\n{BODY}\n"))):
            with self.subTest(args=args[0]):
                done = self.checkout.run(*args)
                self.assertNotEqual(done.returncode, 0)
                self.assertIn("origin", done.stderr)
                self.assertEqual(self.checkout.calls(), [])


if __name__ == "__main__":
    unittest.main()
