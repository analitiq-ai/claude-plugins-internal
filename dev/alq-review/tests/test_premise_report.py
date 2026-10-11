"""premise_report.py: the premise report's form, its check, and the reason a not-worth-doing issue is closed with."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from test_gate import SCRIPTS

import premise_report
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


def spec_section(answers=ANSWERS):
    """`## Why this is worth doing` as `specify` copies the report's answers into spec.md."""
    return premise_report.SPEC_HEADING + "\n\n" + "".join(
        f"### {question}\nAnswer: {answer}\nSource: {source}\n\n" for question, (answer, source) in answers.items())


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

    def test_a_stop_pick_names_the_question_it_rests_on_and_gives_a_reason_that_is_filled_in(self):
        for pick in (NO_SPEC, NOT_WORTH_DOING):
            with self.subTest(pick):
                self.assertEqual(premise_report.problems(
                    report(pick, rests_on="needs-spec", reason="a typo", wrong="no"), pick), [])
                self.assert_one_problem(report(pick, rests_on="needs-spec", wrong="no"), pick, "Reason:")
                self.assert_one_problem(report(pick, rests_on="needs-spec", reason="[one line]", wrong="no"), pick,
                                        "Reason:")
                self.assert_one_problem(report(pick, reason="a typo", wrong="no"), pick, "Rests on:", "needs-spec")
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

    def test_a_second_line_of_a_report_field_or_of_an_answer_and_a_second_harm_heading_are_each_the_one_problem(self):
        stop = report(NOT_WORTH_DOING, recommendation=NO_SPEC, rests_on="harm", reason="the real reason")
        for label, second in (("Reason", "a line of the answer"), ("Recommendation", WRITE), ("Pick", WRITE),
                              ("Rests on", "owner"), ("Reports wrong behaviour", "no")):
            with self.subTest(label):
                self.assert_one_problem(stop.replace("Answer: a run", f"{label}: {second}\nAnswer: a run"),
                                        NOT_WORTH_DOING, f"`{label}:` lines")
        self.assert_one_problem(report().replace("Source: code: scripts/policy.py",
                                                 "Answer: [answer]\nSource: code: scripts/policy.py"), WRITE,
                                "## owner", "`Answer:` lines")
        self.assert_one_problem(report() + "## harm\nAnswer:\nSource:\n", WRITE, "`## harm` heading")

    def test_an_answer_that_starts_with_a_bracket_and_goes_on_is_an_answer(self):
        logged = {**ANSWERS, "harm": ("[WARN] the row is logged and dropped", "code: scripts/gate.py")}
        self.assertEqual(premise_report.problems(report(answers=logged), WRITE), [])
        self.assertEqual(premise_report.spec_problems(spec_section(logged)), [])

    def test_a_reason_that_is_empty_unfilled_or_on_two_lines_and_a_flag_empty_or_on_two_cannot_be_read_back(self):
        text = report(NO_SPEC, rests_on="needs-spec", reason="a typo", wrong="no")
        for read, label, unreadable in ((premise_report.reason, "Reason", text + "Reason: another\n"),
                                        (premise_report.reason, "Reason", report()),
                                        (premise_report.reason, "Reason",
                                         report(NO_SPEC, rests_on="needs-spec", reason="[one line]", wrong="no")),
                                        (premise_report.reports_wrong_behaviour, "Reports wrong behaviour",
                                         text + "Reports wrong behaviour: yes\n"),
                                        (premise_report.reports_wrong_behaviour, "Reports wrong behaviour",
                                         report(wrong=""))):
            with self.subTest(label, text=unreadable[-40:]):
                with self.assertRaisesRegex(ValueError, f"{label}:"):
                    read(unreadable)

    def test_a_report_that_does_not_say_yes_or_no_cannot_say_whether_it_is_a_defect(self):
        for text in ("garbage", report(wrong="Yes"), report(wrong="")):
            with self.subTest(text[:30]):
                with self.assertRaisesRegex(ValueError, "Reports wrong behaviour:"):
                    premise_report.reports_wrong_behaviour(text)


class InSpec(unittest.TestCase):
    """The premise answers as spec.md holds them, graded on the report's own form."""

    def spec(self, section):
        return f"# Demo\n\n{section}## Root cause\n\nNot a defect report.\n\n## Requirements\n\n- x\n"

    def assert_one_problem(self, section, *said):
        found = premise_report.spec_problems(self.spec(section))
        self.assertEqual(len(found), 1, found)
        for phrase in (*said, "Next step:"):
            self.assertIn(phrase, found[0])

    def test_the_six_answers_each_with_a_source_pass(self):
        self.assertEqual(premise_report.spec_problems(self.spec(spec_section())), [])

    def test_a_spec_without_the_section_or_without_one_of_its_questions_is_a_problem(self):
        self.assert_one_problem("", premise_report.SPEC_HEADING)
        self.assert_one_problem(spec_section({k: v for k, v in ANSWERS.items() if k != "owner"}), "### owner")
        self.assert_one_problem(spec_section().replace("### owner\n", ""), "### owner")

    def test_an_answer_is_filled_and_sourced_as_in_the_report(self):
        for answer, said in ((("", "code: a.py"), "Answer:"), (("[answer]", "code: a.py"), "Answer:"),
                             (("nothing guards it", ""), "Source:"), (("nothing guards it", "the README"), "code:")):
            with self.subTest(answer):
                self.assert_one_problem(spec_section({**ANSWERS, "owner": answer}), "### owner", said)
        self.assert_one_problem(spec_section({**ANSWERS, "reachable": ("yes", "code: a.py")}), "### reachable",
                                "observed", "predicted")

    def test_a_second_answer_line_question_heading_or_section_heading_is_the_specs_one_problem(self):
        self.assert_one_problem(spec_section().replace("Source: code: scripts/policy.py",
                                                       "Answer: [answer]\nSource: code: scripts/policy.py"),
                                "### owner", "`Answer:` lines")
        self.assert_one_problem(spec_section() + "### harm\nAnswer:\nSource:\n\n", "`### harm` heading")
        found = premise_report.spec_problems(self.spec(spec_section()) + f"\n{premise_report.SPEC_HEADING}\n")
        self.assertEqual(len(found), 1, found)
        self.assertIn(f"`{premise_report.SPEC_HEADING}` heading", found[0])

    def test_a_question_heading_outside_the_section_is_not_the_sections(self):
        without_owner = spec_section({k: v for k, v in ANSWERS.items() if k != "owner"})
        found = premise_report.spec_problems(self.spec(without_owner) + "\n### owner\nAnswer: x\nSource: code: a\n")
        self.assertEqual(len(found), 1, found)


class Cli(unittest.TestCase):
    """scripts/premise_report.py as the workflow's steps run it, from the project's folder."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.path = self.root / "premise-report.md"

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / "premise_report.py"), *args], cwd=self.root,
                              capture_output=True, text=True)

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

    def test_spec_passes_a_spec_folder_that_holds_the_answers_and_fails_one_that_does_not(self):
        folder = self.root / "specs" / "001-demo"
        folder.mkdir(parents=True)
        (folder / "spec.md").write_text(spec_section())
        done = self.run_cli("spec", str(folder))
        self.assertEqual((done.returncode, done.stderr), (0, ""))
        (folder / "spec.md").write_text("# Demo\n")
        done = self.run_cli("spec", str(folder))
        self.assertEqual(done.returncode, 1)
        self.assertTrue(done.stderr.startswith(f"{folder / 'spec.md'}: "), done.stderr)
        self.assertEqual(self.run_cli("spec", str(folder) + ".gone").returncode, 2)

    def test_check_cannot_run_on_a_pick_that_is_no_outcome(self):
        self.path.write_text(report())
        self.assertEqual(self.run_cli("check", str(self.path), "approve").returncode, 2)

    def test_reason_prints_the_reports_reason_line(self):
        self.path.write_text(report(NOT_WORTH_DOING, rests_on="harm", reason="nothing goes wrong today", wrong="no"))
        done = self.run_cli("reason", str(self.path))
        self.assertEqual((done.returncode, done.stdout), (0, "nothing goes wrong today\n"), done.stderr)

    def test_reason_fails_a_report_whose_reason_is_empty(self):
        for reason in ("", "[one line]"):
            with self.subTest(reason=reason):
                self.path.write_text(report(NOT_WORTH_DOING, rests_on="harm", reason=reason, wrong="no"))
                done = self.run_cli("reason", str(self.path))
                self.assertEqual((done.returncode, done.stdout), (1, ""), done.stderr)
                self.assertIn("Reason:", done.stderr)


if __name__ == "__main__":
    unittest.main()
