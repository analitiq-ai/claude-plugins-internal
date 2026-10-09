---
name: alq-root-cause-check
description: Judge whether a fix actually reached the cause its spec names, or only guards the symptom. Reads the Root cause section of the spec, the diff, and the code at the cause site - including the parts the diff did not touch - then returns one of four verdicts (at cause, at symptom, spec wrong, cannot tell). Use before opening or merging a PR on a bugfix/hotfix branch, when asked whether a fix is a real fix or a band-aid, whether it treats the symptom or the source, or whether it fixes the root cause, and from alq-review:alq-issue-tackle's review step. Report-only.
colour: red
---

# Does the fix reach the cause?

One question: **does this diff change the mechanism that produces the wrong state, or does it
react to that state after it exists?**

A symptom fix is clean code by every other measure. It is small, well named, correctly scoped,
and tested; it passes lint, review, and every other audit, because nothing about it is *badly*
written. It is wrong only in its location, and location is invisible to a reader who has not
read the trace. That is why this check is separate from [[alq-anti-pattern-audit]], which hunts
recognisable shim shapes and would clear this one.

The question is **not "which file did it change"**. A path comparison is cheap and answers a
different question - it catches a fix that never opened the cause file, and passes a one-line
guard added next to it. Whether a change is at the cause is about what it does to the flow of
the wrong value, not its address.

## Step 1 - get the spec

`<n>` from the branch (`^(bugfix|hotfix|feat|...)/(\d+)-`) or from the invoker. SPECLOC is
`../../scripts/speclocation.py` from this skill's base directory. Run:

```
python3 SPECLOC show <n>
```

It prints the spec folder and its branch, or `spec: none` and a reason. Read `<folder>/spec.md` in the checkout.

Stop and say so, with no verdict, when the section reads `Not a defect report.` Report
**CANNOT TELL** and name what is missing when: `show` exits non-zero (with no location comment,
name `/alq-review:alq-spec #<n>` as the next step), it prints `spec: none`, or spec.md has no
`## Root cause` section. Never invent the cause yourself and grade
against that; a cause you derived from the diff will always agree with the diff.

## Step 2 - read the Root cause, and check how much of it was measured

Find the `Observed:` line. It decides how much of the spec you may take as given.

- **An observation is named** (a failing test, a log line, a reproduction): the mechanism is
  anchored. Take it as the cause and go to Step 3. Still locate it in the code - a mechanism
  you cannot point at is one you cannot grade a diff against.
- **`Observed: nothing` / marked a hypothesis**: the cause is a guess, and grading a diff
  against a guess launders the guess into a verdict. Verify the mechanism yourself first -
  reproduce it, or find the test or log that shows it. If the hypothesis does not hold, the
  verdict is **SPEC WRONG** whatever the diff does, and the finding is the trace, not the fix.
- Affected callers marked *predicted* rather than *verified* are unverified claims. Treat them
  as Step 4 candidates to check, never as established facts.

## Step 3 - classify what the diff does

Collect the delta: `git diff $(git merge-base main HEAD)...HEAD`, plus uncommitted work if the
invoker is mid-change. Put every substantive hunk in exactly one bucket:

- **mechanism** - changes how the wrong value is produced, decided, or allowed to exist
- **guard** - detects the wrong value once it exists and handles it
- **containment** - dead-letters, retries, degrades, or reports it
- **incidental** - tests, docs, naming, unrelated

**A diff with no mechanism hunk is at the symptom.** That is the test.

The one case that inverts it: when the spec's cause *is* an absent check - a missing validation,
an unenforced invariant, a shape the contract permits and the code never rejected - then adding
that check **is** the mechanism, and it is at the cause. Distinguish by asking where the wrong
state can exist afterwards. A guard at the boundary that makes the state unrepresentable
downstream is a mechanism. A guard that lets the state exist and copes with it at one of its
exits is a symptom fix, however deep in the stack it sits.

## Step 4 - the siblings

The Root cause section names the other callers that reach the same production site. For each,
read it as it stands after the diff and answer: does it still reproduce the defect?

- Still broken, and not in **Out of scope** with an issue behind it → the fix is at the symptom,
  even if it touched the cause file. The reported exit closed; the others did not.
- Still broken, and deliberately deferred with an issue → not a finding here. Say it is deferred
  and name the issue, so the deferral stays visible rather than becoming permanent.

Read the sibling code. Do not infer from the diff that it must be fixed - that is the inference
that produced the symptom fix in the first place.

## Step 5 - verdict

Exactly one, stated first, before any reasoning:

| Verdict | Means |
|---|---|
| **AT CAUSE** | A mechanism hunk changes what the spec names, and the siblings are fixed or deferred with an issue. |
| **AT SYMPTOM** | The wrong state is still produced; the diff reacts to it. Name what still produces it and which caller still reproduces it. |
| **SPEC WRONG** | The trace does not hold - the named cause is not what produces the behaviour. Name what does, and what evidence says so. |
| **CANNOT TELL** | No spec, no Root cause section, or the mechanism could not be located. Say which, and what would resolve it. |

**SPEC WRONG is a real verdict and must stay available.** A check that can only find the diff at
fault degrades into enforcing the spec, and specs are written by someone who had not yet seen the
code work. When the trace is wrong, say so - that is the more valuable finding, because it is the
one nobody else in the pipeline is looking for.

## The rule that keeps this honest

When the diff and the spec disagree, there are exactly two legitimate resolutions: **move the fix
to the cause**, or **redo the trace and re-scope the issue**. Editing the Root cause section to
describe wherever the diff happens to be is neither. It is the cheapest way past this check and it
turns the spec into a transcript of what was done, which is worth nothing to the next reader.

Assert nothing this run did not establish. If you did not execute the reproduction, say the
mechanism is inferred. If you read a sibling rather than exercised it, say so. A confident wrong
verdict here is worse than none: it is the last gate before the fix ships, and it is the one a
reviewer will trust instead of looking themselves.

## Report format

```
VERDICT: AT CAUSE | AT SYMPTOM | SPEC WRONG | CANNOT TELL

Cause per spec: <mechanism, module> (observed | hypothesis)
Diff does: <mechanism | guard | containment> at <path:line>
Siblings: <caller> - fixed | still broken | deferred (#issue)
Basis: <what was executed, and what was only read>
```

Then, only for AT SYMPTOM and SPEC WRONG, one paragraph: what still produces the wrong state,
and which of the two legitimate resolutions applies.

Report only. Do not apply the fix; the invoker decides, and a fix written by the checker is one
nobody checked.
