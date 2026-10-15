---
schemaVersion: 0.2.0
id: "0021"
title: "Exempt a PR the user labels cleanup from alq-review's review gates"
status: draft
date: 2026-10-14
deciders: ["@Analitiq-Bot-Wonka"]
tags: [merge-gate, user-authority, holds, labels]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0004", "0009", "0018", "0020"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{github,policy,gate,pre_merge_gate,shell}.py"
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

# ADR-0021: Exempt a PR the user labels cleanup from alq-review's review gates

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

1. We will exempt a PR that carries the label `cleanup` from alq-review's review gates.
   - Marking it ready needs no clean internal round. Merging it needs no internal-review attestation.
     `--admin` still needs `override-merge`.
   - A commit on a branch whose open PR carries the label is not held by claim-check or shim-check.
   - The poller neither requests nor waits for a Codex review of it, treats no review thread as
     blocking, and sends the agent to no DeepSource grade check.
   - The label is read from GitHub at each check, whatever the diff. It is bound to the PR, not to a
     head commit: a push after the label was added stays exempt. Removing the label brings every gate
     back.
2. We will refuse no command that adds the label. Forbidding an agent to apply `cleanup` is a rule the
   user creates apart from this plugin (action item 3), and the plugin's README names it as a
   requirement. Until that rule exists, an agent can add the label and exempt its own PR.
3. We will let the label release every hold point 1 lifts, and no other. A round in flight and a lock
   still refuse a cleanup PR as any PR. The label releases no lock: each lock keeps the releases its own
   record names (ADR-0018, ADR-0020).
4. When the label cannot be read, the PR is gated as unlabelled. The ready refusal and the poller say the
   label could not be read (ADR-0009).
5. This record amends two accepted records:
   - ADR-0003 point 1 says the commit checks do not depend on which reviews are run. A cleanup PR's
     commits skip them (ADR-0021 point 1): a commit check alone would still hold a #113-shaped PR on
     its docstring edits.
   - ADR-0003 point 2 named one kind of PR that needs no internal review. It now names two: a
     version-only release and a cleanup PR.
   - ADR-0003 point 3 rests that exception on a verdict the org gate's App posts. The cleanup
     exemption rests on the label, not on a verdict.
   - ADR-0004 points 1 and 3 take a release only from a prompt that starts with its keyword, and accept
     no command as a release. The label releases the holds of ADR-0021 point 3, and the user adds it
     on GitHub, not by a prompt. This plugin refuses no command that adds it (ADR-0021 point 2).
   - ADR-0004 point 4 gives each new user-only action a keyword. Adding the label has none. A keyword
     that lets an agent add the label is Option D, which the user rejected.

## Options considered

### Option A: The `cleanup` label, with the rule that forbids agents to add it kept apart (chosen)

| Dimension | Assessment |
|---|---|
| Exempts a #113-shaped PR | Yes: the diff is not read |
| What releases the holds of point 3 | The label, however it was added |
| An agent adding the label | Not refused by this plugin; forbidden by the user's separate rule once it exists |
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

### Option E: The label, its `gh` additions refused by alq-review's own hook

The hook refuses the `gh` commands that add the label to a PR. Rejected by the user, who will create
that rule apart from this plugin. A PreToolUse hook reads only the `gh` forms it knows: `curl`, a
script or a `gh` call inside `bash -c` add the label unseen, so the refusal is a fixed list either way.

### Option F: The label, with no rule forbidding agents to add it

Nothing to build beyond Option A. Rejected: an agent could add the label to its own PR and skip every
review, and GitHub could not show who did.

### Option G: Do nothing

The user keeps readying and merging such PRs by hand, or switches the plugin off for the session, which
also lifts every other check in it.

## Trade-offs

- The exemption is bound to the PR, not to a head commit. Code pushed after the label was added merges
  with no review of any kind; the attestation, by contrast, is voided by every push.
- A cleanup PR's commits skip claim-check and shim-check, so a labelled PR can land code that no
  alq-review check examined.
- Until the user's rule exists, an agent can add the label and skip review of its own PR. Constitution
  P2 (3.0.0) asks that one approved entity release a hold; this record names the label as the release, and
  the rule of action item 3 makes the user that entity.
- Every commit in every repo with the plugin on makes one more `gh` call. When GitHub does not answer,
  the commit is checked as today.
- In a repo whose rulesets require the org gate's checks, a cleanup PR is still held by them. This
  record does not change the org gate.

## Consequences

- Easier: a PR that needs no review goes from draft to merged with no `!` command and no review round.
  ADR-0003 point 2's list grows by a kind the user marks per PR, rather than by a new switch per kind.
- Harder: the label releases the review hold, and this plugin does not guard who adds it. Its safety
  rests on the user's separate rule.
- **How we would know this was wrong:** a PR labelled `cleanup` merges code that breaks `main`; or the
  user finds a PR labelled `cleanup` that they did not label; or the commit-time label read makes commits
  noticeably slower.
- Revisit if: the user and agent sessions act on GitHub under separate identities, so a hook could check
  who added the label; or the org gate runs in every repo the plugin serves, so one classifier could
  decide for both.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] #114 builds the exemption and the poller's cleanup outcome, and names the rule of item 3 as a
   requirement in the plugin's README.
3. [ ] The user creates the rule that forbids an agent to apply the `cleanup` label.
4. [ ] Once this record is accepted, add to ADR-0003 and ADR-0004 a note naming the amendments of point 5.
