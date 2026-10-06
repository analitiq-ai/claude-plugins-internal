---
schemaVersion: 0.1.0
id: "0008"
title: "Keep the spec in the spec folder, not in an issue comment"
status: draft
date: 2026-10-06
deciders: []
tags: [spec, review-round, skills]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/skills/{alq-shape,alq-issue-tackle,alq-root-cause-check,design-doc}/SKILL.md"
  - type: path
    pattern: "plugins/alq-review/scripts/{github,briefs,gate}.py"
  - type: path
    pattern: "dev/alq-review/{tests/test_spec_source.py,specs/014-review-spec/**}"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/25"
review:
  tier: async
externalRefs:
  - type: issue
    id: "25"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/25"
    label: "What treats the issue comment as the spec today, and the points not decided"
---

# ADR-0008: Keep the spec in the spec folder, not in an issue comment

Draft for the ratifier. Paths are relative to the repo root. The code and the skills do not follow this
record yet (main @ 50c4330).

## Context

The spec of a change has two homes today, and the documents disagree on which one is the spec.

The first home is a comment on the issue:

- `plugins/alq-review/skills/alq-shape/SKILL.md:8` says "The spec lives **on the issue**, as a comment
  carrying the marker `<!-- analitiq-spec -->`", and line 13 says "**The issue is the only home.**" Its
  Step 7 is headed "post the spec to the issue" (line 325).
- `plugins/alq-review/skills/alq-issue-tackle/SKILL.md:15` says "The spec lives on the issue", and line 27
  says "Write no copy of it into the worktree".
- `plugins/alq-review/skills/alq-root-cause-check/SKILL.md:26` says to fetch the spec "from the issue, its
  only home".
- `issue_spec` (`plugins/alq-review/scripts/github.py:43`) returns the body of the issue comment that
  carries the marker, `None` when no comment does, and raises when more than one does. `branch_spec`
  (`plugins/alq-review/scripts/briefs.py:51`) calls it with the issue number that `issue_number` finds in
  the branch name, when there is one. The gate calls `branch_spec` when a round of stage `internal` is
  launched (`plugins/alq-review/scripts/gate.py:424`), and `brief` calls it too
  (`plugins/alq-review/scripts/briefs.py:152`). Spec 014 chose this in
  `dev/alq-review/specs/014-review-spec/research.md` R1 and R2.
- Spec folders 007, 009, 010, 011, 012, 014 and 015 each open, at line 3 of `spec.md`, by saying that the
  acceptance criteria are the `analitiq-spec` comment on an issue.

The second home is the spec folder. For `#<issue>`, `plugins/alq-review/skills/design-doc/SKILL.md:18` says
"Write the issue to `SPEC_FILE`", and line 20 says "the workflow's `specify` step creates a new spec folder
in `PROJECT/specs/`". The command on line 19 asks `gh issue view` for `url,title,body`. It does not fetch
the issue's comments, where the spec comment is.

The comment was chosen for stated reasons:

- "Shaping and implementation are separated in time - an issue can be shaped today and picked up next week -
  so the spec cannot live in a worktree that does not exist yet"
  (`plugins/alq-review/skills/alq-shape/SKILL.md:9`).
- A copy in the worktree "is one `git add .` from being committed beside the comment it drifts from"
  (`plugins/alq-review/skills/alq-issue-tackle/SKILL.md:28`).
- "the gate replaces the workflow's args, so the caller cannot pass the spec; the prompt is the only channel"
  (`dev/alq-review/specs/014-review-spec/research.md:9`).

## Decision

The user decided on 2026-10-06 that the spec lives in the spec folder, and that an issue comment is no longer
its home. The user's reasons are not recorded here.

1. **One home.** The spec of a change will be in its spec folder, `<dir>/specs/<feature>/`.
2. **The skills will say so.** `alq-shape`, `alq-issue-tackle` and `alq-root-cause-check` will stop naming
   the issue comment as the spec's home.
3. **The gate moves with them.** What the gate hands to the internal reviewers and to the assessor as the
   spec will come from the spec folder. The user agreed on 2026-10-06 that this is one change with point 2
   (issue #25). Otherwise the skills would name the folder while the gate still read the comment.

Not in this record. Issue #25 lists these as not decided:

- Which skill writes the spec into the folder: `alq-shape`, or the `specify` step that `design-doc` runs.
- What the review gate reads when a branch changes more than one spec folder, or none.
- What replaces the comment markers that tell `alq-issue-tackle` whether it may start: the spec marker, the
  "No shape needed" spec, and `<!-- analitiq-premise -->`.
- Whether the seven existing spec folders get their acceptance criteria copied in.

## Options considered

### Option A: The spec folder is the one home (decided by the user)

| Dimension | Assessment |
|---|---|
| Where the acceptance criteria are | In the repo, in the same folder as the design decisions |
| Needs a checkout to write the spec | Yes. This is the cost `alq-shape` named when it chose the comment |
| What the gate reads | To be settled in the spec for issue #25 |

### Option B: Do nothing: the comment is the spec, and the folder holds design decisions (today)

Not chosen. The user's decision names the folder. The facts on record are the ones in Context.

### Option C: Both, with one a copy of the other

Not chosen. The user's decision names one home. `alq-issue-tackle` already gives a reason against a second
copy (`plugins/alq-review/skills/alq-issue-tackle/SKILL.md:28`, quoted in Context).

## Trade-offs

- The reason `alq-shape` gave for the comment still holds as a cost: a spec folder is in a checkout, so a
  spec can no longer be written "anywhere with `gh` authenticated"
  (`plugins/alq-review/skills/alq-shape/SKILL.md:11`).
- Spec 014's R1 to R3 decide how the gate selects and reads the comment. They are to be amended. Its
  rejected ways of handing the spec to a reviewer (`dev/alq-review/specs/014-review-spec/research.md:11-16`)
  are not reopened here.
- Seven spec folders will point at a comment that is no longer the spec, and issues that carry a spec
  comment have no spec folder. No rule for either is decided.

## Consequences

- Easier: one place to read and to change the spec.
- Harder: the three skills, `issue_spec`, `branch_spec` and their callers change together. Spec 014 is to be
  amended first, in its own PR (constitution VI).
- `test_no_skill_or_plugin_names_a_local_spec_copy` (`dev/alq-review/tests/test_spec_source.py:32`) fails
  when a Markdown file of the plugin, outside a `fixtures` folder, contains text that matches
  `specs/<\w+>\.md`. The test is to be looked at again with this change.
- **How we would know this was wrong:** a shaped issue that nobody can pick up because its spec is on a
  branch that was never pushed; or a spec comment and a spec folder that disagree after this lands.
- Revisit if: specs have to be written for repos where no checkout exists at shaping time.

## Action items

1. [ ] The ratifier accepts this record, or sends it back.
2. [ ] Settle the four points listed under "Not in this record" in a spec (issue #25).
3. [ ] Amend spec 014 to this rule, in its own PR, before the code.
4. [ ] Change the three skills, `github.issue_spec`, `briefs.branch_spec` and the tests together.
