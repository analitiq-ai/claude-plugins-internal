---
schemaVersion: 0.1.0
id: "0008"
title: "Give an issue that needs no spec a spec folder that says so"
status: draft
date: 2026-10-12
deciders: []
tags: [premise, spec-folder, issue, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0005", "0006", "0007", "0009"]
affects:
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
  - type: path
    pattern: "plugins/alq-plan/scripts/*.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
review:
  tier: async
externalRefs:
  - type: issue
    id: "79"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
    label: "alq-plan: name spec folders by their issue, land the spec through its own reviewed PR"
  - type: doc
    id: "engineering ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "Every issue has exactly one spec, at specs/<issue>-<slug>/"
---

# ADR-0008: Give an issue that needs no spec a spec folder that says so

## Context

In the premise step the user picks one of three outcomes: `write the spec`, `no spec needed` or `not worth doing`.
ADR-0006, decision 1, closes a `not worth doing` issue as not planned, with the reason. Decision 2 posts nothing on a
`no spec needed` issue and tells the user to pass `spec: null` when the work is reviewed. That run completes with no
folder and no call to GitHub, so the outcome lives only in the session that picked it. ADR-0006 names this, and says
to revisit "if something other than the user needs to know that an issue needs no spec".

ADR-0007 now keeps one spec folder per issue and refuses a new scope of an issue that has one. With no folder, a
`no spec needed` issue shows nothing to that check, so it can be scoped again as if it had never been judged. The
organisation's git workflow (`analitiq-ai/engineering`, ADR-0002) gives every issue one spec folder.

A change with no issue cannot be scoped at all: `/alq-plan:issue-spec` takes `#<issue> [<dir>]` or
`rescope <spec folder> #<issue>`, and refuses anything else. ADR-0007 names every folder by an issue number, and the
organisation's branch rule puts the issue number in every branch name. A change with no issue has neither.

Why now: issue #79, part of #80. The user settled the decisions below on 2026-10-12. The spec is
`dev/alq-plan/specs/79-one-spec-per-issue/`.

## Decision

1. We will keep the three premise outcomes: `write the spec`, `no spec needed` and `not worth doing`.
2. We will have a `no spec needed` pick create `specs/<issue>-<short-name>/spec.md` that says no spec is needed, and
   carries the premise question the pick rests on and the reason, as the premise report records them. The folder is
   the run's one folder input (ADR-0007). One writer, a script in `plugins/alq-plan/scripts/`, writes every such
   `spec.md`, and writes nothing else into the folder. The folder lands like a spec (ADR-0009).
3. We will leave `not worth doing` as ADR-0006, decision 1, has it: the issue is closed as not planned with the
   reason, and no folder is created.
4. We will add the form `untracked "<what changes>" [<dir>]` to `/alq-plan:issue-spec`. It first creates one issue
   for the change in the repo the checkout's `origin` names, with a title and body from the text and one of that
   repo's issue types, the text through a file. It then scopes that issue as `#<issue> [<dir>]` does, premise first,
   so it can end in any of the three outcomes. When GitHub refuses the issue, the skill stops and starts no run.
5. We will have a rescope of a folder whose `spec.md` is a no-spec one run the new-scope workflow from the premise
   (premise → specify → grill → plan → critique → tasks) into that same folder, since a no-spec `spec.md` has nothing
   to grill. The folder input fixes the folder, so `specify` writes over the no-spec `spec.md`; if the premise picks
   `no spec needed` again, the writer writes it again. One pure function, in the writer's module, tells a no-spec
   `spec.md` apart.

This record does not supersede ADR-0006, decision 2. That decision is about the issue: a `no spec needed` run still
posts nothing on it, and still tells the user to pass `spec: null` when the work is reviewed. What changes is
ADR-0006's consequence that the outcome lives only in the session that picked it: it now lives in the repo.
ADR-0006, decisions 1 and 3, stand. The `untracked` form creates an issue. Nothing is posted on an existing issue;
the PR the folder lands through is ADR-0009's.

## Options considered

### Option A: A folder that says no spec is needed, and an issue first for a change with none (chosen)

| Dimension | Assessment |
|---|---|
| Outcomes | `write the spec`, `no spec needed`, `not worth doing` |
| Record of `no spec needed` | A folder in the repo, named by its issue, written by one writer |
| Seen by the one-folder check of ADR-0007 | Yes |
| A change with no issue | Gets an issue, then is scoped like any other |
| Writes to GitHub | `not worth doing` closes the issue; `untracked` creates one; `write the spec` and `no spec needed` push `<issue>-spec` and open a draft PR (ADR-0009) |

### Option B: Do nothing

`no spec needed` leaves no folder, and a later scope of the same issue is not refused. A change with no issue
cannot go through planning, and has no number for its folder or its branch.

### Option C: Drop `no spec needed`

Every issue that is built would get a full spec. Rejected by the user: a change whose request fixes the outcome has
nothing for a spec to decide.

### Option D: Record `no spec needed` on the issue

A label or a comment on the issue. ADR-0006 rejected a comment that no plugin reads, and the one-folder check reads
folders, not issues.

### Option E: An `untracked` change always gets a no-spec folder

The change would skip the premise. Rejected: an issue created for a change is scoped like any other, and the premise
decides whether it needs a spec.

## Trade-offs

- A folder whose `spec.md` states no requirement sits beside real specs. A caller can still pass it to review as a
  story value. Nothing refuses that.
- `no spec needed` now writes to the repo and opens a PR, like a spec (ADR-0009).
- `untracked` creates an issue from text the user typed. When a later step fails, the issue stays, and the message
  names it.
- The issue type is picked from the types the repo offers, by the skill with the user.

## Consequences

- Easier: every issue planning has seen, and not closed, has one folder in the repo. A second scope of a
  `no spec needed` issue is refused. A change with no issue gets an issue and a branch by the same rules as any other.
- Harder: a rescope has two starts, grill for a spec and the premise for a no-spec folder, chosen by what the
  folder's `spec.md` is.
- **How we would know this was wrong:** no-spec folders passed to review as a story value; issues created by
  `untracked` left open with no work on them; or a no-spec folder that has to be deleted before its issue can be
  scoped.
- Revisit if: review or build has to tell a `no spec needed` change apart from one with no folder at all.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
