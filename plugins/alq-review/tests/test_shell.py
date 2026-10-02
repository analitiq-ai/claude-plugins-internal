import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts scripts/ on the path)

import shell

PR_GATE = Path(__file__).resolve().parents[4] / "analitiq-org-github" / ".github" / "scripts" / "pr-gate.js"


def kinds(command, cwd="/work"):
    return [(a.kind, a.cwd) for a in shell.classify(command, cwd)]


class Classify(unittest.TestCase):
    def test_commit_and_push_are_mutations_in_the_session_directory(self):
        self.assertEqual(kinds("git commit -m 'x'"), [("commit", "/work")])
        self.assertEqual(kinds("git add -A && git commit -m x && git push"), [("commit", "/work"), ("push", "/work")])

    def test_git_dash_c_and_cd_name_the_worktree(self):
        self.assertEqual(kinds("git -C /repo/.git/wt/x commit -m y"), [("commit", "/repo/.git/wt/x")])
        self.assertEqual(kinds("cd /repo/.git/wt/x && git push -u origin HEAD"), [("push", "/repo/.git/wt/x")])
        self.assertEqual(kinds("cd sub && git commit -m y"), [("commit", "/work/sub")])

    def test_lookalikes_are_not_mutations(self):
        for command in ("git stash push", "git log --grep=commit", "git log | grep push", "echo git commit",
                        "git commit-tree abc", "git status", "gh pr view 3"):
            self.assertEqual(kinds(command), [], command)

    def test_commit_message_in_a_heredoc_still_classifies(self):
        command = "git commit -F - <<'EOF'\nfix: it's done\n\nalq-session-id: 1\nEOF"
        self.assertEqual(kinds(command), [("commit", "/work")])

    def test_review_rerequest_carries_repo_and_pr(self):
        [action] = shell.classify('gh pr comment 12 --repo acme/demo --body "@codex review"', "/work")
        self.assertEqual((action.kind, action.repo, action.pr), ("rerequest", "acme/demo", 12))
        [action] = shell.classify("gh api repos/acme/demo/issues/12/comments -f body='@codex review'", "/work")
        self.assertEqual((action.kind, action.repo, action.pr), ("rerequest", "acme/demo", 12))

    def test_mentioning_the_trigger_without_posting_it_is_nothing(self):
        self.assertEqual(kinds("grep -rn '@codex review' ."), [])

    def test_marking_ready(self):
        [action] = shell.classify("gh pr ready 12 -R acme/demo", "/work")
        self.assertEqual((action.kind, action.repo, action.pr), ("ready", "acme/demo", 12))
        [action] = shell.classify("cd /repo/.git/wt/x && gh pr ready", "/work")
        self.assertEqual((action.kind, action.pr, action.cwd), ("ready", None, "/repo/.git/wt/x"))

    def test_attesting_the_internal_review_or_opening_a_non_draft_pr_is_marking_ready(self):
        attest = ("gh pr comment 12 --repo acme/demo --body \"$(cat <<'EOF'\n<!-- analitiq-internal-review -->\n"
                  "Internal review clean.\nReviewed commit: `abc123`\nEOF\n)\"")
        [action] = shell.classify(attest, "/work")
        self.assertEqual((action.kind, action.repo, action.pr), ("ready", "acme/demo", 12))
        [action] = shell.classify("gh api repos/acme/demo/issues/12/comments -f body='<!-- analitiq-internal-review -->'", "/work")
        self.assertEqual((action.kind, action.repo, action.pr), ("ready", "acme/demo", 12))
        self.assertEqual(kinds("gh pr create --title t --body b"), [("ready", "/work")])
        for drafted in ("gh pr create --draft --title t", "gh pr create -d --title t"):
            self.assertEqual(kinds(drafted), [], drafted)

    def test_an_issue_comment_on_the_pr_posts_like_a_pr_comment(self):
        [action] = shell.classify("gh issue comment 12 -R acme/demo --body '@codex review'", "/work")
        self.assertEqual((action.kind, action.repo, action.pr), ("rerequest", "acme/demo", 12))

    def test_a_comment_posts_what_its_body_file_holds(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "attest.md").write_text(f"{shell.ATTESTATION_MARKER}\nReviewed commit: `abc123`\n")
            Path(tmp, "rerequest.md").write_text("@codex review\n")
            Path(tmp, "payload.json").write_text(json.dumps({"body": shell.ATTESTATION_MARKER}))
            for command, kind in ((f"gh pr comment 12 --body-file={tmp}/attest.md", "ready"),
                                  ("gh issue comment 12 -F rerequest.md", "rerequest"),
                                  ("gh api repos/acme/demo/issues/12/comments -F body=@attest.md", "ready"),
                                  ("gh api repos/acme/demo/issues/12/comments --input payload.json", "ready")):
                [action] = shell.classify(command, tmp)
                self.assertEqual((action.kind, action.pr), (kind, 12), command)

    def test_editing_a_comment_or_posting_through_graphql_posts_too(self):
        edit = f"gh api -X PATCH repos/acme/demo/issues/comments/99 -f body='{shell.ATTESTATION_MARKER} Reviewed commit: abc123'"
        mutation = ("gh api graphql -f query='mutation { addComment(input: {subjectId: \"PR_1\", body: \"@codex review\"}) "
                    "{ clientMutationId } }'")
        self.assertEqual(kinds(edit), [("ready", "/work")])
        self.assertEqual(kinds(mutation), [("rerequest", "/work")])

    def test_reading_comments_that_mention_the_marker_or_trigger_posts_nothing(self):
        for text in (shell.ATTESTATION_MARKER, "@codex review"):
            for read in ("", "-X GET -f per_page=100 "):
                command = f"gh api {read}repos/acme/demo/issues/12/comments --jq '.[] | select(.body | contains(\"{text}\"))'"
                self.assertEqual(kinds(command), [], command)

    def test_a_commit_that_stages_is_marked(self):
        for command in ("git commit -a -m x", "git commit --all -m x", "git commit -am x", "git commit -i a.py -m x",
                        "git commit --include -m x a.py", "git commit -o a.py -m x", "git commit --only -m x a.py",
                        "git commit -m x a.py", "git commit -m x -- a.py", "git commit --pathspec-from-file=f -m x"):
            [action] = shell.classify(command, "/work")
            self.assertTrue(action.staging, command)

    def test_option_values_are_not_paths(self):
        for command in ("git commit -m x", "git commit -m 'a b'", "git commit -F msg.txt", "git commit --amend --no-edit",
                        "git commit -qm x", "git commit --author 'A <a@b>' -m x", "git commit -C HEAD",
                        "git commit --message=x", "git commit --fixup HEAD", "git commit -F - <<'EOF'\nx a.py\nEOF"):
            [action] = shell.classify(command, "/work")
            self.assertFalse(action.staging, command)

    def test_a_commit_stands_alone_only_after_cd(self):
        for command in ("git add -A && git commit -m x", "git commit -m x; echo done", "true && git commit -m x",
                        "git commit -m x 2>&1 | tail -3"):
            commits = [a for a in shell.classify(command, "/work") if a.kind == "commit"]
            self.assertEqual([a.alone for a in commits], [False], command)
        [action] = shell.classify("cd /x && git commit -m y", "/work")
        self.assertEqual((action.alone, action.cwd), (True, "/x"))
        [action] = shell.classify("git commit -m y", "/work")
        self.assertTrue(action.alone)

    def test_agent_unlocking_its_own_gate_is_recognised(self):
        self.assertEqual(kinds("python3 /p/alq-review/scripts/ledger.py unlock --worktree /w --reason x"), [("unlock", "/work")])


class AttestationContract(unittest.TestCase):
    def test_the_marker_is_the_one_the_org_pr_gate_reads(self):
        self.assertTrue(PR_GATE.is_file(), f"org pr-gate not found at {PR_GATE}")
        self.assertIn(f"ATTESTATION_MARKER = '{shell.ATTESTATION_MARKER}';", PR_GATE.read_text())


if __name__ == "__main__":
    unittest.main()
