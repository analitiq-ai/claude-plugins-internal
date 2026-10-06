---
schemaVersion: 0.1.0
id: "0007"
title: "Judge a fix with an outside classifier and compose the verdict in code"
status: draft
date: 2026-10-06
deciders: []
tags: [shim-check, classifier, verdict]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{jev,shimcheck,shimgate}.py"
  - type: path
    pattern: "dev/alq-review/specs/{006-shim-check-gate,011-shim-no-site-left,012-tests-only-tree}/**"
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
    label: "The batch of decision records this one belongs to"
---

# ADR-0007: Judge a fix with an outside classifier and compose the verdict in code

Draft for the ratifier. Paths are relative to the repo root. Specs 006, 011 and 012 made this choice already.

## Context

The shim check needs three judgements about a staged change: is it a fix, where does the fix act, and does it
reach the other sites with the same defect. A model gives them. Three limits shape how:

- The answer has to arrive inside a hook, which spec 006 allows 40 s for the model
  (`dev/alq-review/specs/006-shim-check-gate/research.md:111`).
- A refusal has to follow from a rule a unit test can pin. Spec 006 notes that the model's own overall answer
  would differ from its two answers (`dev/alq-review/specs/006-shim-check-gate/spec.md:197`).
- The check's success criterion SC-001 is a replay over recorded commits
  (`dev/alq-review/specs/006-shim-check-gate/spec.md:274`), so the wording of the questions was measured too.

What the code does today:

- `ask` sends one POST, built with `urllib.request`, to an OpenRouter endpoint for the model
  `typesafe/jev-1.13` (`plugins/alq-review/scripts/jev.py:14`, `:15`, `:59`). This model is called Jev below.
- There are three choice questions: `kind` (`plugins/alq-review/scripts/jev.py:17`), and `level` and
  `coverage` (`plugins/alq-review/scripts/jev.py:21`). A reply whose choice is not one of the question's
  criteria raises `JevError` (`plugins/alq-review/scripts/jev.py:87`).
- `_judge` stores Jev's `level` and `coverage` on the check, then calls `shimcheck.verdict`
  (`plugins/alq-review/scripts/shimgate.py:349`, `:350`). `verdict` returns `complete` or `patch` from the
  kind, the two answers and whether a site is left (`plugins/alq-review/scripts/shimcheck.py:112`).

## Decision

1. **An outside one-shot classifier judges the fix.** Jev is reached through OpenRouter, one POST per ask.
2. **It is asked narrow choice questions**, each with a fixed set of answers, and never the overall verdict:
   "its own overall answer is not asked; the verdict is composed from the two answers only"
   (`dev/alq-review/specs/006-shim-check-gate/spec.md:197`).
3. **Code composes the verdict.** The rule that turns the answers into `complete` or `patch` is a function.
4. **A question stays as it was replayed.** The `level` and `coverage` questions "are copied verbatim because
   SC-001 rests on them" (`dev/alq-review/specs/006-shim-check-gate/research.md:135`). A change to their
   wording, or to the shape of the request, needs a new replay first.
5. **An answer is stored as given.** Code may leave an answer unread. It does not rewrite one: "The stored
   and logged `coverage` is Jev's answer, unchanged" (`dev/alq-review/specs/011-shim-no-site-left/spec.md:14`).
   For `kind` the stored value is the result of up to 3 asks (`plugins/alq-review/scripts/jev.py:95`).
6. **A rule in code goes ahead of the model.** Where code can decide, Jev is not asked: "a deterministic rule
   ahead of a probabilistic one removes that and saves a call"
   (`dev/alq-review/specs/012-tests-only-tree/research.md:34`).
7. **Private source goes to the third party.** "Code goes to OpenRouter/TypeSafe for every repo, private ones
   included, by the user's decision" (`dev/alq-review/specs/006-shim-check-gate/plan.md:53`).

Not in this record: the sweeper agents, the contest of a site, the shim check's release rules, a check that
cannot run (record 0009) and the standard-library rule the POST follows (record 0010).

## Options considered

### Option A: An outside classifier, choice questions, verdict in code (in force)

| Dimension | Assessment |
|---|---|
| Time and cost per call | 0.39 to 0.63 s, about $0.0008 to $0.0009, on the largest replay diff (`dev/alq-review/specs/006-shim-check-gate/research.md:108`) |
| Verdict rule | One function with no I/O, unit tested (`dev/alq-review/tests/test_shimcheck.py:55`) |
| Data leaving the org | A diff of the change, and for a fix the two site lists (`plugins/alq-review/scripts/jev.py:102`, `:128`) |

### Option B: An agent judge inside the session

The reason for Jev over an agent judge is not recorded in the repo. Spec 006 names a design page outside the
repo as its input (`dev/alq-review/specs/006-shim-check-gate/spec.md:9`). The repo records Jev's measured
time and cost (Option A), and no figures for an agent judge.

### Option C: Do nothing: no judgement of the fix

The sweep would list sites with no answer on whether the change reaches them.

### Other options, rejected

| Option | Why rejected |
|---|---|
| D. Ask Jev for the overall verdict | See point 2. The replay's third question "is not sent" (`dev/alq-review/specs/006-shim-check-gate/research.md:105`). |
| E. Rewrite `coverage` to `none_other` when no site is left | "the ledger and log would misreport Jev's answer" (`dev/alq-review/specs/011-shim-no-site-left/research.md:14`). |
| F. Skip the `coverage` question when no site is left | "a second request shape, while 006 SC-001 rests on replaying the one shape" (`dev/alq-review/specs/011-shim-no-site-left/research.md:15`). |
| G. Leave a tests-only tree to Jev's `kind` answer | It "keeps red-test-first commits refusable" (`dev/alq-review/specs/012-tests-only-tree/research.md:34`). |

## Trade-offs

- Private source leaves the org (point 7). The check also needs a key file wherever the plugin runs, "the bot
  image included" (`dev/alq-review/specs/006-shim-check-gate/research.md:250`).
- A request is limited to about 33k tokens (`plugins/alq-review/scripts/jev.py:67`). A larger code diff must
  be split. Spec 006 measured 6 to 8% of 638 recent commits
  (`dev/alq-review/specs/006-shim-check-gate/research.md:248`).
- The questions cannot be reworded without a new replay. Spec 011 kept the request's shape for this reason
  (option F), and spec 012 kept the diff of mixed trees (`dev/alq-review/specs/012-tests-only-tree/research.md:9`).
- `kind` is not stable on one ask. It labelled a real patch `not_fix` in 1 of 5 asks
  (`dev/alq-review/specs/006-shim-check-gate/research.md:126`), which is why it is asked up to 3 times. It
  also labelled 8 of 18 non-fix commits `fix` (`dev/alq-review/specs/006-shim-check-gate/research.md:119`).
- The test that compares the request's questions with the replayed ones reads a script from the user's home
  folder and is skipped where that script is absent (`dev/alq-review/tests/test_jev.py:18`, `:85`).

## Consequences

- Easier: a change to the verdict rule is a code change with a unit test. The stored answers are Jev's.
- Harder: a better-worded question cannot ship on its own. The replay is live and calls OpenRouter
  (`dev/alq-review/tests/replay_shim.py:3`).
- **How we would know this was wrong:** the replay stops giving every evidence fix its expected verdict; the
  share of commits refused as too large rises above the measured 6 to 8%; or the provider changes its terms
  for private source or retires the model.
- Revisit if: the model is changed or withdrawn, or a judge inside the session can answer within the hook's time.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Record in the repo why Jev was chosen over an agent judge, or state that no comparison was made.
3. [ ] Decide whether the replayed questions move into the repo, so the test that pins them is not skipped.
