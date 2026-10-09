"""speclocation.py, and the marker-comment read and write in github.py."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test_gate import SCRIPTS, Gate
from test_worktree_facts import git

import github
import speclocation
from speclocation import Located, NoSpec, NotWorthDoing, SpecLocationError

MARKER = "<!-- analitiq-spec -->"
FOLDER, BRANCH = "dev/demo/specs/001-demo", "feat/1-demo"
LOCATED = f"{MARKER}\nspec: {FOLDER}\nbranch: {BRANCH}\n"
NOT_WORTH_DOING = f"{MARKER}\nspec: not worth doing\nreason: nothing goes wrong today\n"


class Form(unittest.TestCase):
    def test_a_located_comment_reads_back_as_it_was_written(self):
        self.assertEqual(speclocation.render(FOLDER, BRANCH), LOCATED)
        self.assertEqual(speclocation.parse(LOCATED), Located(FOLDER, BRANCH))

    def test_a_no_spec_comment_reads_back_as_it_was_written(self):
        body = speclocation.render_none("docs only")
        self.assertEqual(body, f"{MARKER}\nspec: none\nreason: docs only\n")
        self.assertEqual(speclocation.parse(body), NoSpec("docs only"))

    def test_a_not_worth_doing_comment_reads_back_as_it_was_written(self):
        self.assertEqual(speclocation.render_not_worth_doing("nothing goes wrong today"), NOT_WORTH_DOING)
        self.assertEqual(speclocation.parse(NOT_WORTH_DOING), NotWorthDoing("nothing goes wrong today"))

    def test_github_line_endings_are_read(self):
        self.assertEqual(speclocation.parse(LOCATED.replace("\n", "\r\n")), Located(FOLDER, BRANCH))

    def test_a_whole_spec_under_the_marker_is_refused_naming_alq_spec(self):
        with self.assertRaises(SpecLocationError) as refused:
            speclocation.parse(f"{MARKER}\n# Demo\n\n## Acceptance\n- b.py prints 20 lines.\n")
        self.assertIn("/alq-review:alq-spec", str(refused.exception))

    def test_a_whole_spec_after_a_blank_line_is_refused_naming_alq_spec(self):
        with self.assertRaises(SpecLocationError) as refused:
            speclocation.parse(f"{MARKER}\r\n\r\n# Demo\r\n")
        self.assertIn("/alq-review:alq-spec", str(refused.exception))

    def test_text_with_no_spec_line_is_refused_naming_alq_spec_and_not_the_form(self):
        for body in (f"{MARKER}\nGoal: x\nScope: y\n", f"{MARKER}\nGoal: move the spec: x\nScope: y\n"):
            with self.subTest(body), self.assertRaises(SpecLocationError) as refused:
                speclocation.parse(body)
            self.assertIn("/alq-review:alq-spec", str(refused.exception))
            self.assertNotIn("spec: <folder", str(refused.exception))

    def test_text_with_no_spec_line_is_refused_with_deleting_the_comment_then_alq_spec_as_the_next_step(self):
        with self.assertRaises(SpecLocationError) as refused:
            speclocation.parse(f"{MARKER}\nGoal: x\nScope: y\n")
        self.assertEqual(str(refused.exception).partition("Next step: ")[2],
                         "delete that comment, then run `/alq-review:alq-spec` on the issue.")

    def test_every_other_shape_is_refused_stating_the_form(self):
        malformed = {
            "wrong order": f"{MARKER}\nbranch: {BRANCH}\nspec: {FOLDER}\n",
            "extra line": LOCATED + "note: x\n",
            "extra prose line": LOCATED + "please do not edit this\n",
            "extra rule line": LOCATED + "---\n",
            "prose after none": f"{MARKER}\nspec: none\nreason: docs only\n(agreed with K.)\n",
            "no space after the key": f"{MARKER}\nspec:{FOLDER}\nbranch: {BRANCH}\n",
            "indented spec line": f"{MARKER}\n  spec: {FOLDER}\nbranch: {BRANCH}\n",
            "blank line after the marker": LOCATED.replace("\n", "\n\n", 1),
            "no branch": f"{MARKER}\nspec: {FOLDER}\n",
            "the marker alone": f"{MARKER}\n",
            "empty value": f"{MARKER}\nspec: {FOLDER}\nbranch: \n",
            "none without a reason": f"{MARKER}\nspec: none\nbranch: {BRANCH}\n",
            "not worth doing without a reason": f"{MARKER}\nspec: not worth doing\nbranch: {BRANCH}\n",
            "not worth doing with a third line": NOT_WORTH_DOING + "failed: harm\n",
            "absolute": f"{MARKER}\nspec: /{FOLDER}\nbranch: {BRANCH}\n",
            "leaves the repo": f"{MARKER}\nspec: ../other/specs/001-demo\nbranch: {BRANCH}\n",
            "not under specs": f"{MARKER}\nspec: dev/demo/001-demo\nbranch: {BRANCH}\n",
        }
        for name, body in malformed.items():
            with self.subTest(name), self.assertRaises(SpecLocationError) as refused:
                speclocation.parse(body)
            self.assertIn("spec: <folder", str(refused.exception))

    def test_render_refuses_an_absolute_folder_a_two_line_branch_and_a_two_line_or_blank_reason(self):
        for write in (lambda: speclocation.render("/abs/specs/x", BRANCH), lambda: speclocation.render(FOLDER, "a\nb"),
                      lambda: speclocation.render_none("two\nlines"), lambda: speclocation.render_none(" "),
                      lambda: speclocation.render_not_worth_doing("two\nlines"),
                      lambda: speclocation.render_not_worth_doing(" ")):
            with self.assertRaises(SpecLocationError):
                write()


class Issue(Gate):
    """A checkout on feat/1-demo whose issue's comments the fake gh hands over."""
    SPEC = "# Demo\n\n## Acceptance\n- b.py prints 20 lines.\n"

    def setUp(self):
        super().setUp()
        patched = mock.patch.dict(os.environ, self.env)
        patched.start()
        self.addCleanup(patched.stop)

    def comments(self, *bodies):
        """One comment per body, ids from 101."""
        self.env["GH_ISSUE_COMMENTS"] = os.environ["GH_ISSUE_COMMENTS"] = "\n".join(
            json.dumps({"id": 101 + i, "body": b}) for i, b in enumerate(bodies))

    def commit_spec(self, folder=FOLDER, text=SPEC):
        (self.root / folder).mkdir(parents=True, exist_ok=True)
        return self.commit(f"{folder}/spec.md", text, f"spec in {folder}")

    def resolve(self, branch=BRANCH):
        return speclocation.resolve("acme/demo", branch, str(self.root))

    def gh_calls(self):
        log = Path(self.env["GH_LOG"])
        return log.read_text().splitlines() if log.exists() else []


class SpecComment(Issue):
    QUOTED = "the gate said:\n" + LOCATED

    def located(self):
        return speclocation.located("acme/demo", 1)

    def test_github_hands_over_every_comment_with_its_id(self):
        self.comments("unrelated chatter", LOCATED)
        self.assertEqual(github.issue_comments("acme/demo", 1), [(101, "unrelated chatter"), (102, LOCATED)])

    def test_the_location_comment_is_the_one_whose_first_line_is_the_marker(self):
        self.comments(self.QUOTED, LOCATED)
        self.assertEqual(self.located(), Located(FOLDER, BRANCH))

    def test_a_comment_that_only_quotes_the_marker_is_no_location_comment(self):
        self.comments(self.QUOTED)
        with self.assertRaisesRegex(SpecLocationError, "has no location comment"):
            self.located()

    def test_an_issue_judged_not_worth_doing_is_refused_with_its_reason_and_one_next_step(self):
        self.comments(NOT_WORTH_DOING)
        with self.assertRaises(SpecLocationError) as refused:
            self.located()
        self.assertEqual(str(refused.exception),
                         "acme/demo#1 was judged not worth doing: nothing goes wrong today. Next step: run "
                         "/alq-review:alq-spec #1 to put the question again.")

    def test_two_are_refused_naming_both_with_one_next_step(self):
        self.comments(LOCATED, "unrelated chatter", LOCATED)
        with self.assertRaisesRegex(SpecLocationError, "101, 103") as refused:
            self.located()
        self.assertIn("delete all but one", str(refused.exception))
        self.assertEqual(str(refused.exception).count("Next step"), 1)


class Resolve(Issue):
    def test_the_spec_is_spec_md_of_the_named_folder_as_committed(self):
        self.commit_spec()
        self.comments(LOCATED)
        (self.root / FOLDER / "spec.md").write_text("an uncommitted edit\n")
        self.assertEqual(self.resolve(), speclocation.FoundSpec(FOLDER, self.SPEC))

    def test_the_named_folder_wins_over_those_committed_before_and_after_it(self):
        self.commit_spec("dev/demo/specs/000-earlier", "# Earlier\n")
        self.commit_spec()
        self.commit_spec("dev/demo/specs/002-later", "# Later\n")
        self.comments(LOCATED)
        self.assertEqual(self.resolve(), speclocation.FoundSpec(FOLDER, self.SPEC))

    def test_an_issue_that_needs_no_spec_says_why(self):
        self.comments(speclocation.render_none("docs only"))
        self.assertEqual(self.resolve(), NoSpec("docs only"))

    def test_an_issue_judged_not_worth_doing_has_no_spec_to_grade_against(self):
        self.comments(NOT_WORTH_DOING)
        self.assertIn("was judged not worth doing: nothing goes wrong today", self.refusal())

    def test_a_branch_naming_no_issue_has_no_spec_and_asks_github_nothing(self):
        self.assertIsNone(self.resolve("chore/no-issue"))
        self.assertEqual(self.gh_calls(), [])

    def refusal(self):
        with self.assertRaises(SpecLocationError) as refused:
            self.resolve()
        return str(refused.exception)

    def test_no_location_comment_is_refused_naming_alq_spec(self):
        self.comments("unrelated chatter")
        self.assertIn("/alq-review:alq-spec #1", self.refusal())

    def test_no_location_comment_is_refused_with_running_alq_spec_as_the_whole_next_step(self):
        self.comments("unrelated chatter")
        self.assertEqual(self.refusal().partition("Next step: ")[2], "run `/alq-review:alq-spec #1`.")

    def test_a_folder_the_checkout_does_not_hold_is_refused_naming_it_and_its_branch(self):
        self.comments(speclocation.render(FOLDER, "feat/1-elsewhere"))
        refusal = self.refusal()
        self.assertIn(FOLDER, refusal)
        self.assertIn("feat/1-elsewhere", refusal)

    def test_a_missing_or_empty_spec_md_is_refused_the_same_way(self):
        self.comments(LOCATED)
        for text in (None, " \n"):
            if text is None:
                (self.root / FOLDER).mkdir(parents=True)
                self.commit(f"{FOLDER}/plan.md", "# Plan\n", "plan only")
            else:
                self.commit_spec(text=text)
            with self.subTest(text):
                refusal = self.refusal()
                self.assertIn(f"{FOLDER}/spec.md", refusal)
                self.assertIn(BRANCH, refusal)

    def test_a_malformed_comment_is_refused_stating_the_form_and_the_issue(self):
        self.comments(f"{MARKER}\nspec: ../x/specs/001-demo\nbranch: {BRANCH}\n")
        refusal = self.refusal()
        self.assertIn("acme/demo#1", refusal)
        self.assertIn("spec: <folder", refusal)

    def test_a_github_that_cannot_answer_is_not_a_missing_comment(self):
        self.env["GH_COMMENTS_ERROR"] = os.environ["GH_COMMENTS_ERROR"] = "HTTP 502: Bad Gateway"
        with self.assertRaisesRegex(RuntimeError, "HTTP 502") as refused:
            self.resolve()
        self.assertNotIsInstance(refused.exception, SpecLocationError)


class Cli(Issue):
    """scripts/speclocation.py as the skills run it."""

    def setUp(self):
        super().setUp()
        self.project = self.root / "dev" / "demo"
        (self.project / ".specify").mkdir(parents=True)
        (self.project / ".specify" / "feature.json").write_text(json.dumps({"feature_directory": "specs/001-demo"}))
        self.comments()

    def run_cli(self, *args, cwd=None):
        return subprocess.run([sys.executable, str(SCRIPTS / "speclocation.py"), *args], env=self.env,
                              cwd=cwd or self.root, capture_output=True, text=True)

    def posted(self):
        path = Path(self.env["GH_POSTED"])
        return path.read_text() if path.exists() else None

    def test_post_creates_the_comment_from_the_checkouts_branch_and_feature_folder(self):
        done = self.run_cli("post", str(self.project))
        self.assertEqual((done.returncode, done.stdout.strip()), (0, "https://github.test/comment"), done.stderr)
        self.assertEqual(self.posted(), LOCATED)
        self.assertIn("api -X POST repos/acme/demo/issues/1/comments", self.gh_calls()[-1])

    def test_post_again_rewrites_the_same_comment(self):
        self.comments("unrelated chatter", speclocation.render(FOLDER, "feat/1-old"))
        self.assertEqual(self.run_cli("post", str(self.project)).returncode, 0)
        self.assertEqual(self.posted(), LOCATED)
        self.assertIn("api -X PATCH repos/acme/demo/issues/comments/102", self.gh_calls()[-1])

    def test_post_writes_a_new_comment_beside_one_that_only_quotes_the_marker(self):
        self.comments(SpecComment.QUOTED)
        self.assertEqual(self.run_cli("post", str(self.project)).returncode, 0)
        self.assertIn("api -X POST repos/acme/demo/issues/1/comments", self.gh_calls()[-1])

    def test_none_posts_the_reason_and_creates_no_folder(self):
        done = self.run_cli("none", str(self.project), "docs only")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.posted(), speclocation.render_none("docs only"))
        self.assertFalse((self.project / "specs").exists())

    def test_none_without_a_reason_is_bad_usage_and_posts_nothing(self):
        self.assertEqual(self.run_cli("none", str(self.project), " ").returncode, 2)
        self.assertIsNone(self.posted())

    def test_the_reason_reaches_gh_on_stdin_and_not_on_its_command_line(self):
        self.assertEqual(self.run_cli("none", str(self.project), "a reason with $(words)").returncode, 0)
        self.assertIn("a reason with $(words)", self.posted())
        self.assertNotIn("words", "\n".join(self.gh_calls()))

    def test_not_worth_doing_posts_the_reason_on_stdin_and_creates_no_folder(self):
        done = self.run_cli("not-worth-doing", str(self.project), "nothing goes $(wrong) today")
        self.assertEqual((done.returncode, done.stdout.strip()), (0, "https://github.test/comment"), done.stderr)
        self.assertEqual(self.posted(), speclocation.render_not_worth_doing("nothing goes $(wrong) today"))
        self.assertNotIn("wrong", "\n".join(self.gh_calls()))
        self.assertFalse((self.project / "specs").exists())

    def test_not_worth_doing_rewrites_the_issues_one_comment(self):
        self.comments(LOCATED)
        self.assertEqual(self.run_cli("not-worth-doing", str(self.project), "nothing goes wrong today").returncode, 0)
        self.assertEqual(self.posted(), NOT_WORTH_DOING)
        self.assertIn("api -X PATCH repos/acme/demo/issues/comments/101", self.gh_calls()[-1])

    def test_not_worth_doing_without_a_reason_is_bad_usage_and_posts_nothing(self):
        self.assertEqual(self.run_cli("not-worth-doing", str(self.project), " ").returncode, 2)
        self.assertIsNone(self.posted())

    def test_show_refuses_an_issue_judged_not_worth_doing(self):
        self.comments(NOT_WORTH_DOING)
        done = self.run_cli("show", "1", "--repo", "acme/demo")
        self.assertEqual((done.returncode, done.stdout), (1, ""))
        self.assertIn("was judged not worth doing: nothing goes wrong today", done.stderr)

    def test_status_names_which_of_the_four_states_the_issue_is_in(self):
        states = {"located": [LOCATED], "none": [speclocation.render_none("docs only")],
                  "not worth doing": [NOT_WORTH_DOING], "no comment": ["unrelated chatter"]}
        for status, bodies in states.items():
            self.comments(*bodies)
            done = self.run_cli("status", "1", "--repo", "acme/demo")
            with self.subTest(status):
                self.assertEqual((done.returncode, done.stdout), (0, status + "\n"), done.stderr)

    def test_status_refuses_a_comment_it_cannot_read_and_two_comments(self):
        for bodies, said in (([f"{MARKER}\n# Demo\n"], "alq-spec"), ([LOCATED, LOCATED], "101, 102")):
            self.comments(*bodies)
            done = self.run_cli("status", "1", "--repo", "acme/demo")
            with self.subTest(said):
                self.assertEqual((done.returncode, done.stdout), (1, ""))
                self.assertIn(said, done.stderr)

    def test_post_from_a_branch_naming_no_issue_is_refused(self):
        git(self.root, "branch", "-m", "chore/no-issue")
        done = self.run_cli("post", str(self.project))
        self.assertEqual(done.returncode, 1)
        self.assertIn("chore/no-issue", done.stderr)
        self.assertIsNone(self.posted())

    def test_show_prints_where_the_spec_is(self):
        self.comments(LOCATED)
        done = self.run_cli("show", "1", "--repo", "acme/demo")
        self.assertEqual((done.returncode, done.stdout), (0, f"spec: {FOLDER}\nbranch: {BRANCH}\n"), done.stderr)

    def test_show_without_repo_takes_the_repo_of_the_checkout_it_runs_in(self):
        self.comments(LOCATED)
        done = self.run_cli("show", "1")
        self.assertEqual((done.returncode, done.stdout), (0, f"spec: {FOLDER}\nbranch: {BRANCH}\n"), done.stderr)
        self.assertIn("repos/acme/demo/issues/1/comments", self.gh_calls()[-1])

    def test_show_without_repo_outside_a_checkout_is_bad_usage_naming_repo(self):
        with tempfile.TemporaryDirectory() as outside:
            done = self.run_cli("show", "1", cwd=outside)
        self.assertEqual(done.returncode, 2)
        self.assertIn("--repo", done.stderr)

    def test_show_refuses_two_location_comments_as_it_refuses_a_malformed_one(self):
        self.comments(LOCATED, LOCATED)
        done = self.run_cli("show", "1", "--repo", "acme/demo")
        self.assertEqual(done.returncode, 1)
        self.assertIn("101, 102", done.stderr)

    def test_show_prints_that_no_spec_is_needed(self):
        self.comments(speclocation.render_none("docs only"))
        self.assertEqual(self.run_cli("show", "1", "--repo", "acme/demo").stdout, "spec: none\nreason: docs only\n")

    def test_show_refuses_an_issue_with_no_comment_naming_alq_spec(self):
        done = self.run_cli("show", "1", "--repo", "acme/demo")
        self.assertEqual((done.returncode, done.stdout), (1, ""))
        self.assertIn("/alq-review:alq-spec #1", done.stderr)

    def test_show_refuses_a_malformed_comment(self):
        self.comments(f"{MARKER}\n# Demo\n")
        done = self.run_cli("show", "1", "--repo", "acme/demo")
        self.assertEqual(done.returncode, 1)
        self.assertIn("alq-spec", done.stderr)

    def test_a_github_that_cannot_answer_is_a_check_that_could_not_run(self):
        self.env["GH_COMMENTS_ERROR"] = "HTTP 502: Bad Gateway"
        done = self.run_cli("show", "1", "--repo", "acme/demo")
        self.assertEqual(done.returncode, 2)
        self.assertIn("HTTP 502", done.stderr)


if __name__ == "__main__":
    unittest.main()
