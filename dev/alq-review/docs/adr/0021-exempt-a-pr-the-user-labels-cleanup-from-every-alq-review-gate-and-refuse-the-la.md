---
schemaVersion: 0.2.0
id: "0021"
title: "Exempt a PR the user labels cleanup from every alq-review gate, and refuse the listed gh forms that add the label"
status: draft
date: 2026-10-14
deciders: ["@Analitiq-Bot-Wonka"]
tags: [merge-gate, user-authority, holds, labels]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0004", "0009", "0018"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{github,policy,gate,pre_merge_gate}.py"
  - type: path
    pattern: "plugins/alq-review/skills/alq-github-pr-review/**"
  - type: path
    pattern: "plugins/alq-review/README.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/114"
review:
  tier: async
externalRefs:
  - type: issue
    id: "114"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/114"
    label: "alq-review: a PR that only deletes files under specs/ is gated for internal and Codex review"
---

# ADR-0021: Exempt a PR the user labels cleanup from every alq-review gate, and refuse the listed gh forms that add the label

## Context

Some PRs need no review: the PR that deletes a retired spec folder is the one seen. `/alq-post-merge`
says such a PR needs no review and can be merged once CI is green. The plugin does not agree. On #113
both `gh pr ready` and `gh pr merge` were refused for a missing internal round and attestation, and the
user ran them by hand.

ADR-0003 point 2 names every kind of PR that needs no internal review. Today there is one, the
version-only release, and the org gate rules which PRs are one. The org gate runs only in repos whose
workflows call it. `claude-plugins-internal`, where #113 happened, runs none, so the plugin's hooks are
its only gate and the release exemption can never apply there. For any other PR, ADR-0003 leaves the
user the switch, which is all or nothing for a session.

The PR that retires a spec does more than delete files under `specs/`. #113 also edited two docstrings
outside it to remove citations of the spec. A rule that reads the diff for deletions under `specs/`
would not have exempted it.

The user and every agent session act on GitHub as the same bot. GitHub cannot tell who added a label,
or who posted a comment. For that reason ADR-0004 takes the user's authority only from the user's own
prompt, and accepts no command as a release. A label is not a prompt, so this record departs from
ADR-0004 as well as from ADR-0003; point 5 names each departure.

## Decision

1. We will exempt a PR that carries the label `cleanup` from every alq-review gate.
   - Marking it ready needs no clean internal round. Merging it needs no internal-review attestation.
     `--admin` still needs `override-merge`.
   - A commit on a branch whose open PR carries the label is not held by claim-check or shim-check.
   - The poller neither requests nor waits for a Codex review of it, treats no review thread as
     blocking, and sends the agent to no DeepSource grade check.
   - The label is read from GitHub at each check, whatever the diff. It is bound to the PR, not to a
     head commit: a push after the label was added stays exempt. Removing the label brings every gate
     back.
2. We will refuse the `gh` forms this list names, and no other command. This list alone says what the hook
   refuses.
   1. `gh pr edit` with `--add-label` naming `cleanup`.
   2. `gh issue edit` with `--add-label` naming `cleanup`, for a number that is a PR. When GitHub cannot
      say whether it is, the command is refused and the refusal says why.
   3. `gh pr create` with `--label` or `-l` naming `cleanup`.
   4. A `gh api` write, other than a DELETE, to `issues/{n}/labels`, or to `issues/{n}` with a `labels`
      field, whose fields or body name `cleanup`, for an `{n}` that is a PR or that GitHub cannot say is
      not.
   5. A `gh api` write, other than a DELETE, to `issues/{n}/labels` or `issues/{n}` whose body comes from
      stdin other than a heredoc on that call, or from a file the hook cannot read.
   6. A `gh api graphql` call whose query or fields set labels (`addLabelsToLabelable`, `labelIds`), or
      whose body comes from stdin other than a heredoc on that call, or from a file the hook cannot read.
   7. A `gh` command that names labels and that the hook cannot parse.

   Forms 5 to 7 are refused whatever they add or remove, on a PR or on an issue. The refusal holds in
   every mode but off, log mode included, and no prompt lifts it. Every command this list does not name
   is not refused: removing the label, adding it to an issue that is not a PR, a command that is not
   `gh` (`curl`, a script), a `gh` call inside `bash -c` or a script, a `gh` alias or extension, and any
   command run while alq-review is off, among others. A label added by one of them exempts the PR as any
   other does.
3. We will let the label release every hold point 1 lifts, and no other. A round in flight and a lock
   still refuse a cleanup PR as any PR, and a lock is still released only by `unlock` (ADR-0018).
4. When the label cannot be read, the PR is gated as unlabelled, and the refusal says the label could
   not be read rather than that a review is missing (ADR-0009).
5. This record amends two accepted records:
   - ADR-0003 point 1 says the commit checks do not depend on which reviews are run. A cleanup PR's
     commits skip them (ADR-0021 point 1): a commit check alone would still hold a #113-shaped PR on
     its docstring edits.
   - ADR-0003 point 2 named one kind of PR that needs no internal review. It now names two: a
     version-only release and a cleanup PR.
   - ADR-0003 point 3 rests that exception on a verdict the org gate's App posts. The cleanup
     exemption rests on the label and on the refusal of ADR-0021 point 2, not on a verdict.
   - ADR-0004 points 1 and 3 take a release only from a prompt that starts with its keyword, and accept
     no command as a release. The label releases the holds of ADR-0021 point 3, and the user adds it
     on GitHub, not by a prompt. The commands ADR-0021 point 2 does not name stay open to agents.
   - ADR-0004 point 4 gives each new user-only action a keyword. Adding the label has none. A keyword
     that lets an agent add the label is Option D, which the user rejected.

## Options considered

### Option A: The `cleanup` label, the `gh` forms of point 2 refused (chosen)

| Dimension | Assessment |
|---|---|
| Exempts a #113-shaped PR | Yes: the diff is not read |
| What releases the holds of point 3 | The label, however it was added |
| An agent adding the label | Refused in the forms point 2 names; open by every command it does not |
| Repos without the org gate | Applies in full |
| Repos whose rulesets require the org gate's checks | The plugin lets the PR through; the required checks still hold it |
| Cost per commit | One `gh` call to read the branch's open PR and its labels |

### Option B: Exempt a PR whose diff only deletes files under `specs/`

The issue's own proposal. No one has to mark the PR. Rejected: the PR that retires a spec also removes
its citations outside `specs/`, as #113 did, so the rule does not exempt the PR it was written for.

### Option C: Let the org gate classify the PR and read its verdict, as for a version-only release

One classifier for every repo. Rejected: `claude-plugins-internal` runs no org gate, so it would need
adopting the gate there first, and the user scoped the change to alq-review.

### Option D: The label, which an agent may add under a prompt grant

A prompt starting `cleanup owner/repo#N` would let the agent add the label once, as `override-merge`
works. Rejected by the user: a second grant mechanism for an action the user can take on GitHub.

### Option E: The label, which anyone may add

No refusal to build. Rejected: an agent could add the label to its own PR and skip every review, and
GitHub could not show who did.

### Option F: Do nothing

The user keeps readying and merging such PRs by hand, or switches the plugin off for the session, which
also lifts every other check in it.

## Trade-offs

- The exemption is bound to the PR, not to a head commit. Code pushed after the label was added merges
  with no review of any kind; the attestation, by contrast, is voided by every push.
- A cleanup PR's commits skip claim-check and shim-check, so a labelled PR can land code that no
  alq-review check examined.
- An agent can still add the label by a command point 2 does not name. Constitution P2 fails a hold
  with a second way out; action item 3 takes this to P2.
- Point 2's forms 5 to 7 refuse label writes the hook cannot read, even where the label is not
  `cleanup`: an agent sets labels through GraphQL or from an unread body only by a command point 2 does not
  name.
- Every commit in every repo with the plugin on makes one more `gh` call. When GitHub does not answer,
  the commit is checked as today.
- In a repo whose rulesets require the org gate's checks, a cleanup PR is still held by them. This
  record does not change the org gate.

## Consequences

- Easier: a PR that needs no review goes from draft to merged with no `!` command and no review round.
  ADR-0003 point 2's list grows by a kind the user marks per PR, rather than by a new switch per kind.
- Harder: the label is now a security boundary that point 2 guards only in part. A new `gh` form that
  adds labels is open until point 2's list names it.
- **How we would know this was wrong:** a PR labelled `cleanup` merges code that breaks `main`; or a
  PR's timeline shows the label added by a command point 2 refuses; or the commit-time label read makes
  commits noticeably slower.
- Revisit if: GitHub starts showing which actor added a label, so the hook could check who added it;
  or the org gate runs in every repo the plugin serves, so one classifier could decide for both.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] #114 builds the exemption, the refusal of point 2 and the poller's cleanup outcome.
3. [ ] Amend constitution P2, in its own PR: the label releases the holds of point 3, and the commands
   point 2 does not name are a second way out it leaves open.
