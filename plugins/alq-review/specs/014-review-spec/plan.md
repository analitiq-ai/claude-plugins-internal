# Plan: the issue spec in every internal reviewer prompt

Add `github.issue_spec(slug, n)`, the one selector of an issue's `<!-- analitiq-spec -->` comment, and
`briefs.branch_spec(slug, branch)`, which applies it to the issue a branch is named for. `gate.on_workflow`
reads the spec before an internal round is opened and refuses the launch when it cannot be read or is not
unique. `briefs.review_args` takes the spec and `_review_prompt` quotes it in full with the grading
instruction; with no spec the prompt is unchanged. `briefs.brief` carries the spec text as `spec` in place
of the `spec_command` it printed. `alq-issue-tackle` Step 4 and `agents/assessor.md` say so. Tests in
`tests/test_gate.py` (`IssueSpec`) and `tests/test_agents.py` (`IssueTackle`).

## Mechanisms

- The spec is inlined into every internal reviewer prompt, full and delta rounds alike: R1
- One selector of the spec comment, shared by the reviewer prompts and the assessor brief: R2
- A spec that cannot be read, or is not unique, refuses the launch: R3
