---
name: pr-audit
description: Run a fresh, skeptical anti-pattern audit of a PR or session's work — judging not just whether each individual patch is correct, but whether the work was built as a front-loaded systematic sweep or accreted via fix-as-you-go patching, and surfacing pre-existing shims beneath the edited lines that the work is repeatedly patching instead of fixing holistically. Trigger when the user asks to audit/scan/check a PR or recent code for such patterns ("any workarounds in what we wrote?", "did we hand-roll anything?", "audit this for anti-patterns"), and proactively after implementing a substantial change, before entering the internal PR review loop. Report-only — it produces triaged findings and does not fix anything unless explicitly asked.
colour: red
---

# Anti-Pattern Audit — PR delta

Audit what this session or PR authored, and report every pattern that trades a quick
win now for a complication later. The standards being enforced are
`[[coding-principles]]` and `[[schema-contracts]]`.

You are the **orchestrator**. You collect the delta once, dispatch the detectors,
and synthesize. You do not carry a hunt list — each detector's remit lives in its
own body, and restating any of it here starts the second copy this plugin exists to
avoid.

## Run this fresh and skeptical

Every invocation re-derives its findings from the code as it stands now — never
from what an earlier pass in this same conversation concluded. "I already checked
this" and "the last patch fixed it" are not evidence. Approach your own prior edits
with the suspicion you would give a stranger's PR: that you wrote it, or that it
already passed a review round, is not proof it is clean. If this skill ran earlier
in the session, this run supersedes it.

Pass that instruction down. A detector must not be told what a previous run found.

## 1. Collect the delta, once

Identify every repo the session or PR touched — most likely a worktree, possibly
with a PR already open. In each:

```
git log --oneline $(git merge-base main HEAD)...HEAD
git log --name-only $(git merge-base main HEAD)...HEAD | sort | uniq -c | sort -rn
git diff $(git merge-base main HEAD)...HEAD
```

Plus `git diff --staged` and untracked new files if nothing is committed yet.

**Collect the commit-by-commit history, not only the squashed diff.** The history
is the evidence the `history-shape` detector reads, and a squashed diff destroys
it.

For a large delta, delegate the *gathering* to the repo agents or `Explore`. The
judgment stays with the detectors and the synthesis stays with you.

## 2. Build the packet

One `delta`-mode scope packet per repo, per
`${CLAUDE_PLUGIN_ROOT}/reference/scope-packet.md`:

- `mode: delta`
- `repo`, and `visibility` — public or private, which decides part of
  `boundary-trust`'s remit
- `unit: PR delta`
- `files`: the changed files
- `regions: changed-hunks`, with the diff pasted in
- `read_beyond: yes` — pre-existing code is context for the verdict, not itself a
  finding, except where a detector's own body says otherwise
- `baseline`: the merge-base
- `suppressions`: empty, unless the invoker asked for compatibility work or for a
  suppression comment — then name the category
- `focus`: only if the invoker named specific code paths to compare — it reaches
  `semantic-parity` and nothing else

## 3. Dispatch, in parallel

`history-shape`, `mechanism-depth`, `failure-evasion`, `duplication`,
`code-shape`, `boundary-trust` — each with the same packet.

Then `semantic-parity`, which derives its sibling families from the tree on this
run. Dispatch it after `duplication` returns so it receives that detector's parity
candidates alongside the packet; where the invoker named a pair in `focus`, it runs
on that whether or not anything else surfaced it.

Hand each one the packet and nothing else. Do not summarize the code for a
detector, do not tell it what you suspect, and do not narrow its remit: a detector
told what to look for stops looking.

A detector that returns findings without a clean-scope statement has not audited
its remit. Re-dispatch it.

## 4. Synthesize

You are the synthesizer: detectors collect, you judge.

- **Verify before passing through.** Never report a detector's claim you have not
  checked against the actual code. A detector that could not follow a call stack
  returns unverified suspects — those are yours to resolve or drop, not to relay.
- **Dedupe across detectors.** One defect surfaces in several remits — a
  hand-rolled parser is `duplication`'s finding and often `mechanism-depth`'s too.
  Merge them into the entry that names the real fix, and keep the higher severity.
- **Keep the mechanism-level findings as mechanisms.** Flattening one into its
  line-level instances hides the size of the problem, which is the finding.

## 5. Report

**Say nothing until this step.** Output discipline — silence while the detectors
run, and how little the report says — is
`${CLAUDE_PLUGIN_ROOT}/reference/reporting.md`.

Open with the process verdict, before anything itemized:

```
Process: SWEEP | FIX-AS-YOU-GO — one line of commit evidence.
```

This verdict is not a demand to redo the work. It is the input the invoker
triages; FIX-AS-YOU-GO is what should prompt *considering* a one-shot rewrite per
`[[pr-review-loop]]`, not an automatic block.

Then the confirmed findings, severity-ordered, in the shape
`${CLAUDE_PLUGIN_ROOT}/reference/finding-format.md` defines.

Close with the **clean-scope statement**: which repos and files were audited, and
which detectors came back clean — so an absence of findings reads as a checked
claim rather than silence.

## Two things this audit does not cover

**Whether a fix reached its root cause.** That is `[[builder:root-cause-check]]`, which
reads an issue spec's root-cause section and judges a fix against it. This audit
reads past the diff too, but only to detect shim *shapes* and patching patterns; it
has no issue spec and draws no verdict on cause versus symptom. A clean report here
is not evidence a fix landed at the cause. Say so rather than implying coverage.

**Anything outside the delta's reach.** Pre-existing code is in scope only where
the work chose to extend it, or where it is the counterparty to something the work
added — `duplication` and `semantic-parity` both reach untouched code that way. For a standing sweep of a whole tree, use the
`codebase-audit` skill in this plugin.

## Do not apply fixes

The deliverable is the report. Fixes happen only when the invoker asks, and then
follow `[[coding-principles]]` scope discipline.
