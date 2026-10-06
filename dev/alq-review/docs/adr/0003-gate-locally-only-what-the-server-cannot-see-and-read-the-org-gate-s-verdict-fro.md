---
schemaVersion: 0.1.0
id: "0003"
title: "Gate locally only what the server cannot see and read the org gate's verdict from its check run"
status: draft
date: 2026-10-06
deciders: []
tags: [merge-gate, org-gate, github]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{pre_merge_gate,github}.py"
  - type: path
    pattern: "plugins/alq-review/skills/alq-github-pr-review/**"
  - type: path
    pattern: "dev/alq-review/specs/008-gate-check-runs-prose/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: async
externalRefs:
  - type: issue
    id: "30"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
    label: "The batch of decisions already made, written as records"
---

# ADR-0003: Gate locally only what the server cannot see and read the org gate's verdict from its check run

Draft for the ratifier. Paths are relative to the repo root. The code was read at main @ 50c4330.

## Context

Two gates stand before a merge. Where a repo has branch protection, GitHub enforces the branch's rules on
the server. The org gate, the `analitiq-pr-gate` App, posts its verdicts there as check runs. Its code is
`pr-gate.js` in `analitiq-ai/.github` (`plugins/alq-review/scripts/github.py:13`), not in this repo. The
plugin's hook `plugins/alq-review/scripts/pre_merge_gate.py` runs in the session, before a command that
merges a PR or marks it ready.

So a local gate has two questions to answer: which rules it checks itself, and how it learns what the org
gate decided. Both answers exist today, but the reasons are in one docstring and one spec.

**What the local gate checks.** The docstring of `plugins/alq-review/scripts/pre_merge_gate.py:5-12`:

> Where a repo has branch protection, the server already blocks a merge on red CI, a missing or stale Codex
> verdict, an unresolved review thread and a missing approval, and this gate deliberately re-checks none of
> it: a local second copy of those rules drifts from the server's and starts disagreeing with it, and the
> disagreement gets resolved in favour of whichever copy was easier to edit. What is left is the one line of
> the pre-merge checklist no GitHub check can observe -- the internal pr-review-toolkit pass -- plus the two
> ways to step around the server's rules entirely.

**How the org gate's verdict is read.** `version_only_release`
(`plugins/alq-review/scripts/github.py:78`) keeps a run when its name is `internal-review` and its App slug
is `analitiq-pr-gate`, and reads the title of the newest of those. The comment on the constants gives the
reason: "Only a run the App posted is its word: an agent's token could post the same text"
(`plugins/alq-review/scripts/github.py:13-14`). `test_the_same_words_from_any_other_app_are_not_trusted`
(`dev/alq-review/tests/test_pre_merge_gate.py:132`) gives the hook a run with the release title from the App
`github-actions` and asserts that the merge is denied.

The poller filters the gate's runs the same way, by App slug and name
(`plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh:176`), under the comment "Only the App's
runs are the gate's word: anything else may carry the same name" (`:51`).

**One reader.** The hook does not keep its own reading of the release verdict. `released`
(`plugins/alq-review/scripts/pre_merge_gate.py:259`) calls `github.released`. The docstring says the hook
"imports it from the same checkout rather than keeping a copy that drifts when the gate changes"
(`plugins/alq-review/scripts/pre_merge_gate.py:31-32`).

**No copy in prose.** Spec 008 R3 has the skill drop its list of gate states. It says a list "would be a
second copy of that mapping with no drift test" and that "the printed title is generated"
(`dev/alq-review/specs/008-gate-check-runs-prose/research.md:40-41`). The skill now says to act on the
run's "state and title as the poller prints them"
(`plugins/alq-review/skills/alq-github-pr-review/SKILL.md:12`).

## Decision

1. **A local gate checks what GitHub cannot observe.** Today that is the internal review of the head commit,
   and the ways to step around the server's rules. It keeps no copy of a rule the server enforces.
2. **The org gate's verdict is a check run from its App.** Code that reads it matches the run's name and the
   App's slug, never the name alone. The reason for a state is the run's title.
3. **One reader in code.** The reading lives in `plugins/alq-review/scripts/github.py`. Other code imports it.
4. **Prose restates no gate behaviour.** A skill or rule names the run and its App and sends the reader to
   what the poller prints. One copy is kept, named in Trade-offs.

Known gap, from the same docstring (`plugins/alq-review/scripts/pre_merge_gate.py:14-18`): a private repo
that cannot enable branch protection has nothing that enforces CI, threads or approvals, and "this gate is
the only one there is -- it still checks only the internal review".

Not in this record: how the user overrules the gate (ADR-0004), what the poller counts as clean, and the org
gate's own rules, which `analitiq-ai/.github` owns.

## Options considered

### Option A: Local gate for the unobservable only; verdict from the App's check run (chosen, in place)

| Dimension | Assessment |
|---|---|
| Copies of the server's rules | The hook's docstring: "this gate deliberately re-checks none of it" |
| Can an agent forge the verdict | Not by posting a run with the same name and title from another App (see the test above) |
| Places that read the verdict | `github.py`, imported by the hook; the poller has its own filter in shell |
| Repos without branch protection | Not covered (known gap) |

### Option B: Do nothing: the reasons stay in a docstring and a spec of a prose-only feature

Rejected: the next local gate, or the next skill, has no rule to follow.

### Other options, rejected

| Option | Why rejected |
|---|---|
| C. Re-check the server's rules in the local hook | "a local second copy of those rules drifts from the server's and starts disagreeing with it" (`plugins/alq-review/scripts/pre_merge_gate.py:7-8`). |
| D. Match the check run by name alone | "another check may carry the same name" (`dev/alq-review/specs/008-gate-check-runs-prose/research.md:16-17`). |
| E. Agents read Codex's own answer | The skill: "Its verdict is not yours to read: the org-wide pr-gate reads it and posts the `codex-review` check run" (`plugins/alq-review/skills/alq-github-pr-review/SKILL.md:12`). |
| F. Gate behaviour written in both the rule and the skill | "One prose copy of `pr-gate.js` means one place to drift instead of two" (`dev/alq-review/specs/008-gate-check-runs-prose/research.md:25-26`). |
| G. A list of gate states in the skill | Spec 008 R3, quoted in Context. |

## Trade-offs

- The gap above: on a repo without branch protection the local gate still checks one thing.
- The reading depends on three strings that copy another repo's file: the App slug, the run name and the
  title prefix (`plugins/alq-review/scripts/github.py:15-17`). The tests read a checkout of `pr-gate.js` in
  one place, `test_the_marker_is_the_one_the_org_pr_gate_reads` (`dev/alq-review/tests/test_shell.py:124`),
  and that test checks the attestation marker, not these three strings.
- One prose copy is kept in the skill: the run's name, its App and the paragraph on the thumbs-up. Spec 008
  gives the reason: "Markdown cannot import `pr-gate.js` from another repo, so no drift test is possible here"
  (`dev/alq-review/specs/008-gate-check-runs-prose/plan.md:88`). The same row pins it by hand, "against
  `pr-gate.js@9bd2b2997c03`".
- The poller repeats the App filter in shell, beside the one in `github.py`.

## Consequences

- Easier: a change to the server's rules needs no change in the plugin. A new local check has one question
  to pass before it is built: can GitHub observe it?
- Harder: someone who wants the hook to block a merge on red CI is told no, and is sent to branch protection.
- **How we would know this was wrong:** a merge goes through with unmet requirements on a repo without
  branch protection, and it costs a broken main. Or the org gate changes its run name, App or title prefix and
  the plugin reads no verdict where there is one.
- Revisit if: the org gate publishes its verdict in a form that needs no name and title matching, or branch
  protection becomes available on every repo the plugin serves.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Decide whether the poller's App filter and the one in `github.py` become one reader.
3. [ ] Point spec 008's plan table at this record as the place the kept copy is named.
4. [ ] Decide whether the App slug, run name and title prefix get a drift test like the marker's.
