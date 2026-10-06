"""Skills name no `specs/<n>.md` copy of the spec, fetch its body with one command, and page through comments (engineering#61).

A copy written into a worktree is one `git add .` from being committed beside the comment it was taken
from, in this repo and in every repo that links these skills.
"""
import re
import unittest
from pathlib import Path

from paths import PLUGIN

import helpers  # noqa: F401  puts scripts/ on the path

import github

SKILLS = PLUGIN / "skills"
LOCAL_SPEC_COPY = re.compile(r"specs/<\w+>\.md")


def prose(*roots: Path) -> dict[Path, str]:
    return {path: path.read_text() for root in roots for path in root.rglob("*.md") if "fixtures" not in path.parts}


def spec_fetches(text: str) -> list[str]:
    """Each line in `text` that starts `gh api`, names the spec marker and ends in `.body'`, continuations joined."""
    joined = re.sub(r"\s*\\\n\s*", " ", text)
    return [line.strip() for line in joined.splitlines()
            if line.strip().startswith("gh api") and github.SPEC_MARKER in line and line.rstrip().endswith(".body'")]


class SpecSource(unittest.TestCase):
    def test_no_skill_or_plugin_names_a_local_spec_copy(self):
        hits = [f"{path.relative_to(PLUGIN)}:{text.count(chr(10), 0, m.start()) + 1}"
                for path, text in prose(PLUGIN).items() for m in LOCAL_SPEC_COPY.finditer(text)]
        self.assertEqual(hits, [])

    def test_skills_read_the_spec_with_one_paginated_lookup(self):
        """github.issue_spec reads every page; a skill's copy that reads only the first misses a later spec."""
        readers = {path.relative_to(PLUGIN): found for path, text in prose(SKILLS).items()
                   if (found := spec_fetches(text))}
        self.assertIn(Path("skills/alq-issue-tackle/SKILL.md"), readers)
        self.assertIn(Path("skills/alq-root-cause-check/SKILL.md"), readers)
        forms = {command for found in readers.values() for command in found}
        self.assertEqual(len(forms), 1, forms)
        self.assertIn("--paginate", forms.pop())

    def test_every_skill_reads_an_issues_comments_across_all_pages(self):
        """A lookup of the spec or premise comment by id misses it on page two as surely as a body fetch does."""
        unpaged = [f"{path.relative_to(PLUGIN)}: {line}" for path, text in prose(SKILLS).items()
                   for line in re.sub(r"\s*\\\n\s*", " ", text).splitlines()
                   if re.search(r"gh api (?!(?:.*\s)?-X\s).*issues/<n>/comments", line) and "--paginate" not in line]
        self.assertEqual(unpaged, [])


if __name__ == "__main__":
    unittest.main()
