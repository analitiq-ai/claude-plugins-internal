"""premise_report.py: the premise report's form, its check, and the comment a stop pick leaves
(specs/019-merge-shape-into-alq-spec/contracts/premise-report.md)."""
import subprocess
import sys
import unittest
from pathlib import Path

from test_gate import SCRIPTS
from test_speclocation import Issue

import premise_report
import speclocation
from premise_report import NO_SPEC, NOT_WORTH_DOING, WRITE

QUESTIONS = ("harm", "reachable", "change-alters", "owner", "inherited", "needs-spec")
ANSWERS = {
    "harm": ("a run on a re-scoped pull request loses its verdict", "code: scripts/gate.py"),
    "reachable": ("observed: test_gate fails on main", "reproduction: python3 -m unittest test_gate"),
    "change-alters": ("yes, the verdict is read from the ledger", "code: scripts/ledger.py"),
    "owner": ("nothing guards it", "code: scripts/policy.py"),
    "inherited": ("no", "user: it is a new report"),
    "needs-spec": ("yes, where the verdict lives is undecided", "user: asked in the session"),
}


def report(pick=WRITE, recommendation=None, rests_on="", reason="", wrong="yes", answers=ANSWERS, drop=()):
    """A report as the skill fills the form in: `answers` per question, `drop` the questions left empty."""
    text = premise_report.form().replace("Reports wrong behaviour:", f"Reports wrong behaviour: {wrong}")
    for question, (answer, source) in answers.items():
        if question in drop:
            continue
        before, heading, after = text.partition(f"## {question}\n")
        after = after.replace("Answer:", f"Answer: {answer}", 1).replace("Source:", f"Source: {source}", 1)
        text = before + heading + after
    for field, value in (("Recommendation", recommendation or pick), ("Pick", pick), ("Rests on", rests_on),
                         ("Reason", reason)):
        text = text.replace(f"{field}:", f"{field}: {value}".rstrip())
    return text


class Form(unittest.TestCase):
    def test_the_form_asks_the_six_questions_in_order_each_with_an_answer_and_a_source(self):
        form = premise_report.form()
        self.assertEqual([line[3:] for line in form.splitlines() if line.startswith("## ")], list(QUESTIONS))
        for field in ("Question: ", "Answer:", "Source:"):
            self.assertEqual(sum(line.startswith(field) for line in form.splitlines()), 6, field)

    def test_the_form_has_the_five_fields_outside_the_questions(self):
        lines = premise_report.form().splitlines()
        for field in ("Reports wrong behaviour:", "Recommendation:", "Pick:", "Rests on:", "Reason:"):
            with self.subTest(field):
                self.assertIn(field, lines)

    def test_an_empty_form_is_not_a_report(self):
        self.assertTrue(premise_report.problems(premise_report.form(), WRITE))


class Check(unittest.TestCase):
    def assert_one_problem(self, text, pick, *said):
        found = premise_report.problems(text, pick)
        self.assertEqual(len(found), 1, found)
        for phrase in (*said, "Next step:"):
            self.assertIn(phrase, found[0])
        self.assertEqual(found[0].count("Next step:"), 1)

    def test_a_report_with_every_question_answered_and_sourced_passes(self):
        self.assertEqual(premise_report.problems(report(), WRITE), [])

    def test_a_missing_question_section_is_a_problem(self):
        self.assert_one_problem(report().replace("## owner\n", ""), WRITE, "## owner")

    def test_writing_the_spec_needs_every_answer_and_every_source(self):
        for field, column in (("Answer", 0), ("Source", 1)):
            emptied = {**ANSWERS, "inherited": tuple("" if i == column else v
                                                      for i, v in enumerate(ANSWERS["inherited"]))}
            with self.subTest(field):
                self.assert_one_problem(report(answers=emptied), WRITE, "## inherited", f"{field}:")

    def test_a_source_says_code_reproduction_or_user_and_then_what(self):
        for source in ("the README", "code:", "reproduction: ", "User: asked"):
            with self.subTest(source):
                self.assert_one_problem(report(answers={**ANSWERS, "owner": ("nothing guards it", source)}), WRITE,
                                        "## owner", "code:", "reproduction:", "user:")

    def test_reachable_starts_with_observed_or_predicted(self):
        for answer in ("yes, on main", "it was observed once"):
            with self.subTest(answer):
                self.assert_one_problem(report(answers={**ANSWERS, "reachable": (answer, "code: a.py")}), WRITE,
                                        "## reachable", "observed", "predicted")
        self.assertEqual(premise_report.problems(
            report(answers={**ANSWERS, "reachable": ("predicted: the guard is missing", "code: a.py")}), WRITE), [])

    def test_the_recommendation_and_the_pick_are_each_one_of_the_three_outcomes(self):
        self.assert_one_problem(report(recommendation="approve"), WRITE, "Recommendation:", "approve")
        self.assert_one_problem(report().replace(f"Pick: {WRITE}", "Pick: yes"), WRITE, "Pick:", "yes")

    def test_the_pick_is_the_one_the_user_gave_the_workflow(self):
        self.assert_one_problem(report(NO_SPEC, rests_on="needs-spec", reason="a typo", wrong="no"), NOT_WORTH_DOING,
                                "Pick:", NO_SPEC, NOT_WORTH_DOING)

    def test_whether_the_issue_reports_wrong_behaviour_is_yes_or_no(self):
        self.assert_one_problem(report(wrong="maybe"), WRITE, "Reports wrong behaviour:", "maybe")

    def test_a_stop_pick_names_the_question_it_rests_on_and_gives_a_reason(self):
        for pick in (NO_SPEC, NOT_WORTH_DOING):
            with self.subTest(pick):
                self.assertEqual(premise_report.problems(
                    report(pick, rests_on="needs-spec", reason="a typo", wrong="no"), pick), [])
                self.assert_one_problem(report(pick, rests_on="needs-spec", wrong="no"), pick, "Reason:")
                self.assert_one_problem(report(pick, rests_on="size", reason="a typo", wrong="no"), pick,
                                        "Rests on:", "size", "needs-spec")

    def test_a_stop_pick_needs_only_the_answers_up_to_the_question_it_rests_on(self):
        moot = ("reachable", "change-alters", "owner", "inherited", "needs-spec")
        stopped = report(NOT_WORTH_DOING, rests_on="harm", reason="nothing goes wrong", wrong="no", drop=moot)
        self.assertEqual(premise_report.problems(stopped, NOT_WORTH_DOING), [])
        short = premise_report.problems(report(NOT_WORTH_DOING, rests_on="reachable", reason="main refuses it",
                                               wrong="no", drop=moot), NOT_WORTH_DOING)
        self.assertEqual([problem.split(" has ")[0] for problem in short], ["`## reachable`"] * 2)

    def test_an_issue_that_reports_wrong_behaviour_is_never_recommended_as_needing_no_spec(self):
        text = report(WRITE, recommendation=NO_SPEC, wrong="yes")
        self.assert_one_problem(text, WRITE, "Reports wrong behaviour: yes", NO_SPEC)
        self.assertEqual(premise_report.problems(text.replace("behaviour: yes", "behaviour: no"), WRITE), [])

    def test_every_problem_is_reported_not_only_the_first(self):
        text = report(answers={**ANSWERS, "harm": ("", ""), "owner": ("nothing", "a guess")})
        self.assertEqual(len(premise_report.problems(text, WRITE)), 3)

    def test_the_reason_and_whether_it_is_a_defect_are_read_back(self):
        text = report(NO_SPEC, rests_on="needs-spec", reason="a typo, fixed by the request", wrong="no")
        self.assertEqual(premise_report.reason(text), "a typo, fixed by the request")
        self.assertFalse(premise_report.reports_wrong_behaviour(text))
        self.assertTrue(premise_report.reports_wrong_behaviour(report()))


class Cli(Issue):
    """scripts/premise_report.py as the workflow's steps run it, from the project in the issue's worktree."""

    def setUp(self):
        super().setUp()
        self.comments()
        self.path = self.root / "premise-report.md"

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / "premise_report.py"), *args], env=self.env,
                              cwd=self.root, capture_output=True, text=True)

    def posted(self):
        path = Path(self.env["GH_POSTED"])
        return path.read_text() if path.exists() else None

    def stop(self, pick, reason):
        self.path.write_text(report(pick, rests_on="needs-spec", reason=reason, wrong="no"))
        return self.run_cli("record", str(self.path), pick)

    def test_form_prints_the_form(self):
        done = self.run_cli("form")
        self.assertEqual((done.returncode, done.stdout), (0, premise_report.form()), done.stderr)

    def test_check_passes_a_complete_report(self):
        self.path.write_text(report())
        done = self.run_cli("check", str(self.path), WRITE)
        self.assertEqual((done.returncode, done.stderr), (0, ""))

    def test_check_prints_one_problem_per_line_naming_the_file(self):
        self.path.write_text(report(answers={**ANSWERS, "harm": ("", "")}))
        done = self.run_cli("check", str(self.path), WRITE)
        self.assertEqual(done.returncode, 1)
        lines = done.stderr.splitlines()
        self.assertEqual(len(lines), 2)
        for line in lines:
            self.assertTrue(line.startswith(f"{self.path}: "), line)

    def test_check_fails_a_report_that_was_never_written(self):
        done = self.run_cli("check", str(self.path), WRITE)
        self.assertEqual(done.returncode, 1)
        self.assertIn("premise_report.py form", done.stderr)

    def test_check_cannot_run_on_a_pick_that_is_no_outcome(self):
        self.path.write_text(report())
        self.assertEqual(self.run_cli("check", str(self.path), "approve").returncode, 2)

    def test_no_spec_needed_posts_the_no_spec_comment_with_the_reports_reason(self):
        done = self.stop(NO_SPEC, "a typo, fixed by the request")
        self.assertEqual((done.returncode, done.stdout.strip()), (0, "https://github.test/comment"), done.stderr)
        self.assertEqual(self.posted(), speclocation.render_none("a typo, fixed by the request"))

    def test_not_worth_doing_posts_the_third_form_with_the_reports_reason(self):
        done = self.stop(NOT_WORTH_DOING, "nothing goes wrong today")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.posted(), speclocation.render_not_worth_doing("nothing goes wrong today"))

    def test_the_reason_reaches_gh_on_stdin_and_not_on_a_command_line(self):
        self.assertEqual(self.stop(NO_SPEC, "a reason with $(words)").returncode, 0)
        self.assertIn("a reason with $(words)", self.posted())
        self.assertNotIn("words", "\n".join(self.gh_calls()))

    def test_writing_the_spec_posts_nothing(self):
        self.path.write_text(report())
        done = self.run_cli("record", str(self.path), WRITE)
        self.assertEqual((done.returncode, done.stdout), (0, ""), done.stderr)
        self.assertIsNone(self.posted())
        self.assertEqual(self.gh_calls(), [])

    def test_a_github_that_cannot_answer_fails_the_record_in_its_own_words(self):
        self.env["GH_COMMENTS_ERROR"] = "HTTP 502: Bad Gateway"
        done = self.stop(NOT_WORTH_DOING, "nothing goes wrong today")
        self.assertEqual(done.returncode, 2)
        self.assertIn("HTTP 502", done.stderr)
        self.assertIsNone(self.posted())


if __name__ == "__main__":
    unittest.main()
