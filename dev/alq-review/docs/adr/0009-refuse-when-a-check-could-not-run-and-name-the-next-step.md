---
schemaVersion: 0.1.0
id: "0009"
title: "Refuse when a check could not run and name the next step"
status: draft
date: 2026-10-06
deciders: []
tags: [failure-handling, gates]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,pre_merge_gate,sweeper_read,github,claimcheck,shimgate}.py"
  - type: path
    pattern: "dev/alq-review/.specify/memory/constitution.md"
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

# ADR-0009: Refuse when a check could not run and name the next step

Draft for the ratifier. Paths are relative to the repo root. The code was read at main @ 50c4330.

## Context

A check depends on things that can fail to answer: git reading a checkout, GitHub through `gh`, a model, a
reader or judge agent, and the gate's own code. When one of them does not answer, the gate has no verdict.
It still has to do one of two things with the call it was deciding: refuse it, or let it through.

Constitution P4 says how such an outcome is reported: "as a failed check or a named `cannot verify` — never
as a pass, never as a finding against the author, and never as a guess"
(`dev/alq-review/.specify/memory/constitution.md:95-97`). It allows both a refusal and a named
`cannot verify`, so it does not settle whether the call is blocked.

Each gate settled that for itself, and the reasons differ:

- The merge gate: "a false deny costs one command and a false allow costs a merge"
  (`plugins/alq-review/scripts/pre_merge_gate.py:41-43`).
- The review gate's crash handler: "a broken gate must never stall a session; it says so instead"
  (`plugins/alq-review/scripts/gate.py:562`), and for a call it was deciding, "a decision it never reached
  must not be read as a yes" (`plugins/alq-review/scripts/gate.py:547-548`).
- The watch on a held branch: "A checkout git cannot read is reported, not refused: the command itself was
  allowed" (`plugins/alq-review/scripts/gate.py:211-212`).
- The specs: "A check that fails to run MUST refuse the call it was deciding and log the error"
  (`dev/alq-review/specs/004-spec-folder-checks/spec.md:217`), and running a round without its spec is "a
  silent downgrade" (`dev/alq-review/specs/014-review-spec/research.md:33`).

## Decision

The user decided on 2026-10-06 that there is one rule: a check that could not run refuses the call it was
deciding, and the refusal names the next step.

1. **Could not run** means that something the check depends on did not answer: a read failed, a service
   was not reached, a model or an agent did not report, or the gate's own code raised.
2. **The refusal says the check failed, not the work.** The shim check's wording is the model: "The check
   failed, not the fix" (`plugins/alq-review/scripts/shimcheck.py:266`).
3. **The next step is one that can succeed** (constitution P1).
4. **An answer is not a failure.** These are answers, and this rule does not turn them into refusals:
   - A branch that names no issue, or an issue with no spec. `briefs.branch_spec` returns None for both
     (`plugins/alq-review/scripts/briefs.py:51-55`), and `github.py` says of `issue_spec` that "None is an
     answer" (`plugins/alq-review/scripts/github.py:3-4`). A spec that could not be read is the failure, and
     it is refused today (`plugins/alq-review/scripts/gate.py:423-430`).
   - A judge's `UNSURE`. The judge reported. Spec 005 says: "A check whose verdicts all are `UNSURE` has not
     failed" (`dev/alq-review/specs/005-claim-check-gate/spec.md:215`), by a user decision of 2026-10-02
     (`dev/alq-review/specs/005-claim-check-gate/research.md:107-108`).
5. **The rule applies where a call is being decided.** A hook event that only records has no call to refuse.

For the ratifier: when the user chose one rule, the all-`UNSURE` case had been put to them as a case that
lets a commit through. This record reads it as an answer. If the user meant it to refuse, point 4 changes
and spec 005 FR-015 is amended.

Not in this record: whether a refusal blocks while the plugin or a check is in `log` mode or switched off.
That is record 0011 and issue #26.

## Today's code against the rule

Follows the rule:

| Check | What could not run | What happens |
|---|---|---|
| Merge gate | `gh pr view` | Denied: "Cannot verify the pre-merge state" (`plugins/alq-review/scripts/pre_merge_gate.py:317-322`) |
| Merge gate | Its own code raises in `gated` | Denied (`pre_merge_gate.py:366-369`) |
| Review gate | Its own code raises on a tool call it could refuse, in `enforce` mode | Denied (`plugins/alq-review/scripts/gate.py:572-575`) |
| Round launch | The base, the settled-design check, the issue's spec | Refused (`gate.py:411-414`, `gate.py:356-361`, `gate.py:423-430`) |
| Review gate | Which PR a branch has | Refused, with `gh auth status` as the next step (`gate.py:101-104`) |
| Claim check | A reader or judge did not report | The commit is refused: "a checker did not report, not that a claim is wrong" (`plugins/alq-review/scripts/claimcheck.py:267-269`) |
| Shim check | Jev fails, or a step raises `RuntimeError` | The check is stored as `failed` and refused (`plugins/alq-review/scripts/shimgate.py:210-218`) |
| Shim check | The state of a deferral's issue | The launch is refused (`shimgate.py:234-237`) |

Breaks the rule:

- **A held branch that cannot be read.** Before a Bash command, `hold` reports "cannot verify" and returns no
  refusal (`plugins/alq-review/scripts/gate.py:209-226`). The README says "the command is not blocked on it"
  (`plugins/alq-review/README.md:26-28`).
- **The merge gate with no `gh` on the PATH.** `gated` returns 0 for a gated call without `--admin`
  (`plugins/alq-review/scripts/pre_merge_gate.py:313-315`). Its comment says a `gh` named by path can still
  run.
- **A hook that fails before its guard.** `gate.py` imports its modules at lines 20-32 and reads the payload
  at line 559, both outside the `try` that starts at line 560. `sweeper_read.py` has no `try` in `main`
  (`plugins/alq-review/scripts/sweeper_read.py:29-38`). `pre_merge_gate.py` returns 0 for a payload that is
  not JSON (`pre_merge_gate.py:344-347`). A comment in the merge gate says what a crash means: Claude Code
  treats it "as a non-blocking error" (`pre_merge_gate.py:261-262`).
- **A merge command that cannot be parsed.** It is refused only when its text plainly names the gated call;
  "guessing at everything else would block unrelated work" (`pre_merge_gate.py:354-364`).

Refuses, with the wrong reason: `github.released` returns None "also when gh cannot answer"
(`plugins/alq-review/scripts/github.py:92-93`), and the merge gate reads that as not released
(`pre_merge_gate.py:259-265`). When the head is not attested either, the refusal asks for an attestation
(`pre_merge_gate.py:340`) and does not say that a read failed.

Outside the rule's reach: a hook that reaches its timeout "is cancelled and, on most events, renders no
decision" (`dev/alq-review/specs/005-claim-check-gate/research.md:22-23`). The code keeps slow work under the
timeout instead (`plugins/alq-review/scripts/shimgate.py:21-22`).

Not examined: what a reviewer that never reports does to a round after the 45 minute limit
(`plugins/alq-review/scripts/gate.py:36`).

## Options considered

### Option A: One rule, refuse and name the next step (decided)

No unchecked change gets in where a hook can still answer. Work is stopped, for no fault of the author,
until the dependency answers. A new check inherits the rule and decides nothing.

### Option B: Do nothing: each gate decides by which error is cheaper (today)

Rejected by the user's decision. It is the reason the cases above differ, and each new check has to argue
it again.

### Option C: Let the call through and report `cannot verify`

This is what the held-branch watch does. P4 permits it. Rejected by the user's decision: the call goes
through unchecked.

### Option D: Fall back to a default answer

Rejected by P4: "never as a guess".

## Trade-offs

- A dependency that is down stops the calls that need it. A bug in the gate stops every call the gate
  decides. The comment at `plugins/alq-review/scripts/gate.py:562` was written against that.
- The rule needs an exit that can succeed. When the gate itself is broken, the crash refusal names one:
  "To work while it is broken, set ALQ_REVIEW_MODE=log" (`plugins/alq-review/scripts/gate.py:575`). Nothing
  ties that step to the user. Issue #26 is where that is decided.
- The rule cannot reach a hook that the platform kills or that crashes before it can print.

## Consequences

- Easier: a new check does not choose. A reader of a refusal can tell a failed check from failed work.
- Harder: the four cases under "Breaks the rule" change behaviour, each with its own spec and tests.
- **How we would know this was wrong:** sessions stall on refusals whose next step cannot succeed; or
  `gate.log` shows that most refusals of a check are failed checks, not verdicts.
- Revisit if: the platform gives a hook a way to refuse on timeout or on a crash.

## Action items

1. [ ] The ratifier accepts this record, or sends it back, and confirms the reading of `UNSURE`.
2. [ ] Refuse a Bash command when a held checkout cannot be read before it runs, and update the README.
3. [ ] Refuse a gated merge when `gh` is not on the PATH.
4. [ ] Move the imports and the payload read of `gate.py` inside its guard; guard `sweeper_read.py` and the
   merge gate's payload read the same way.
5. [ ] Decide the unparseable merge command: refuse it, or name it here as the one exception.
6. [ ] Make a failed `released` lookup say that the read failed.
7. [ ] Amend constitution P4 to say that the outcome refuses, in its own PR.
