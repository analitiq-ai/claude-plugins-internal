---
name: alq-shape
description: Turn a GitHub issue into a written spec before any code is written, and store it on the issue itself. Pulls the issue with gh issue view, refuses if it is already shaped or its premise was challenged, challenges whether the issue solves a real problem and whether its proposed change reaches that problem before shaping anything, judges whether it is big enough to be worth shaping, traces a reported defect from the symptom back to its root cause before any fix is shaped, answers every question it can from code discovery and from data-integration best practice first, interviews the user only on what is genuinely undecided, lists every hand-maintained surface the design adds, then posts the spec as a marked comment on the issue. Use when the user runs /alq-shape with an issue number, asks to shape, spec, or design an issue before implementing it, or when alq-issue-tackle finds no spec for the issue it is about to work on.
---

You will be given a number that represents an issue open in GitHub. Call it `<n>`.

The spec lives **on the issue**, as a comment carrying the marker `<!-- analitiq-spec -->`.
Shaping and implementation are separated in time - an issue can be shaped today and picked
up next week - so the spec cannot live in a worktree that does not exist yet. This skill
needs no worktree and no branch; it runs anywhere with `gh` authenticated.

**The issue is the only home.** `alq-issue-tackle`, `alq-root-cause-check` and the alq-review gate,
which puts it into each internal review round, fetch the spec from that comment; no copy of it is
kept anywhere else.

## Step 1 - read the issue, and stop if it is already shaped

```
gh issue view <n>
gh api repos/{owner}/{repo}/issues/<n>/comments --paginate \
  --jq '.[] | select(.body | contains("<!-- analitiq-spec -->")) | .id'
gh api repos/{owner}/{repo}/issues/<n>/comments --paginate \
  --jq '.[] | select(.body | contains("<!-- analitiq-premise -->")) | .id'
```

If the first lookup returns an id, this issue already has a spec. **Stop.** Print the existing
spec and say it is already shaped, naming the comment. Do not interview and do not overwrite.

Continue only when the user explicitly asks to re-shape, re-do, or replace the spec. Then
keep the same comment id and update it in place at Step 7 - never post a second one, or the
issue gains two specs and neither is the spec. A re-shape runs Step 2 again: the premise
the first spec rested on is exactly what a re-shape is allowed to find wrong.

If the second lookup returns an id and the first returns none, the premise was challenged
(Step 2) and is waiting on the user. **Stop.** Print the challenge and say so. Continue only
when the user explicitly asks to shape the issue anyway; then skip Step 2's stop and record the
user's call as an (asked) entry under **Why this is worth doing**.

## Step 2 - challenge the premise

Every issue asserts that something is worth changing. Test that before shaping, for every
issue: a defect, a feature, a refactor, a sub-issue of a spec already written, and a request so
fully determined that Step 3 would bail with no shape. The last case matters most. A precise
request is the one nobody questions, and a precise request for the wrong change ships as fast
as a precise request for the right one.

Answer each question with its source: (code) naming the module, or the reproduction you ran.
Dispatch `Explore` in parallel to locate what the questions need; the verdicts are yours, per the
boundary in Step 5b.

1. **What goes wrong if this issue is never done?** Name the scenario: the state or input, and
   the wrong outcome it produces - a wrong verdict, a lost record, a failed run, an author
   misled by a sentence. "X is not covered", "Y is inconsistent" and "Z is not governed" are
   descriptions of the code, not outcomes. Push until the answer names what a user, a document,
   a run or a maintainer suffers. If no such outcome can be named, the premise fails.
2. **Can that scenario happen on the default branch?** Label the answer observed (a test, a
   log, a reproduction) or predicted (read from code), per Step 4a. A scenario the code already
   makes impossible fails the premise.
3. **Does the proposed change alter that outcome?** Walk the scenario from question 1 through
   the change the issue proposes. If the wrong outcome still happens afterwards, the change is
   aimed at something other than the harm, and the premise fails however reasonable the change
   looks on its own.
4. **Does something already own this risk?** A guard, a test, a CI job, a build step, a rule, a
   documented procedure. When one does, the issue is redundant, or it is a report that the owner
   is failing - which is a different issue, against the owner.
5. **Is the premise inherited?** A sub-issue, or an issue citing another spec's decision
   ("settled in #N Decision K"), carries that decision as a claim, not as a (code) answer. Put
   questions 1-4 to the inherited decision itself. Confirming that the files it names still
   exist does not re-verify it.

When the premise holds, the answers become the spec's **Why this is worth doing** section.

### When the premise fails

Do not shape. Post the finding as a comment carrying `<!-- analitiq-premise -->`, never the spec
marker - the spec marker is what lets `alq-issue-tackle` start work:

```
<!-- analitiq-premise -->
# Premise challenge: <issue title> (#<n>)

**Recommendation:** <close as not planned | rewrite #<parent> Decision <k> | re-file against <owner>>

## The claimed problem
<the harm the issue asserts, in its own terms>

## Why it does not hold
<each question above that failed, with its evidence and its source>

## What already owns the risk
<the owner from question 4, or "Nothing found." when the premise failed on other grounds>
```

```
gh issue comment <n> --body-file <file>
```

Then stop and report the recommendation. Closing the issue, or rewriting a parent spec's
decision, is the user's call; this skill does neither.

## Step 3 - decide whether it has a shape

Judge, from the issue body alone, whether the work has decisions in it. It does not when the
outcome is already fully determined by the request - a typo, a version bump, a renamed
variable.

This bail is for a **requested change** whose outcome the request already fixes. An issue that
**reports something behaving wrongly** never qualifies, however small the fix looks: it goes to
Step 4. The size of a defect's fix is an output of tracing it, not an input - "this is a
one-line guard" is a conclusion you are not entitled to before you know what produced the
behaviour, and reaching it early is exactly how a symptom patch gets specified.

A request that adds or extends a hand-maintained surface (Step 6) never qualifies either,
however fully the request determines it: run Step 6 against the request itself, and if it
finds a surface, the issue has a shape - continue to Step 4.

If it has no shape, post this as the spec comment and stop - no interview, no discovery:

```
<!-- analitiq-spec -->
# <issue title> (#<n>)

No shape needed: <one line saying why - the outcome is determined by the request>.

## Why this is worth doing
<the answers to Step 2's questions 1-3, one line each>

## Hand-maintained surfaces
None.
```

The marker still has to be posted. `alq-issue-tackle` looks for it; without it, tackle shapes
the issue again.

## Step 4 - trace the reported behaviour to its cause

Skip only when the issue is not a defect report - a new capability, a refactor, a doc change.

An issue reports what someone **observed**. Where a behaviour is observed is almost never where
it was decided, so the fix an issue implies is a symptom fix by default. Specify that one and it
works: the reported symptom stops appearing, the diff is small, the reviewers pass it, and the
defect is still in the codebase with one of its exits blocked. It comes back through another
caller, under another issue number, and the second fix looks as reasonable as the first.

Do this **before** drafting questions in Step 5. A question list built on the symptom interviews
the user about the wrong module.

### 4a. Start from an observation, and name it

Before tracing anything, find what was actually **observed**: the failing test, the log line, the
stack trace, the record that came out wrong, a reproduction you ran yourself. Write it down. It
anchors the trace, and it is the only part of Step 4 that is not inference.

Often there is none - the report came from someone else, the environment is not reachable from
here, the data that triggered it is gone. That is normal and it does not stop the shaping. It
changes what may be **written**: a trace with no observation behind it is a hypothesis, and the
spec says so in that word. Still worth writing - an implementer who knows the cause is a guess
checks it before building on it, which is exactly what an implementer handed a confident
falsehood does not do.

This exists because of a specific, easy failure: three `Explore` agents return three summaries,
the summaries compose into a plausible mechanism, and the mechanism gets written down as a
finding. Nothing in that sequence executed any code. A wrong Root cause section is worse than a
vague one - Step 7 makes it what the implementer builds against and what the reviewer grades
against, so the confident version is believed where the vague one would have been checked.

Never write "the cause is X" for an X you reasoned to but did not see. Write what you saw, then
what you infer from it, and keep the two separable in the spec.

### 4b. Locate both ends

Dispatch `Explore` (in parallel, per Step 5b) to find:

- **the observation site** - where the wrong value or behaviour becomes visible;
- **the production site** - where that value is first wrong, tracing back through every caller
  and transform between the two;
- **who else reaches the production site** - the other callers, which is what 4d needs.

The Explore boundary from Step 5b holds here: it locates code, it does not judge it. A located
line is where something happens, never a verdict that it is correct.

### 4c. Ask "why" until the answer leaves the repo

At each step: *why does this code do that?* Keep going until the answer is a deliberate decision,
a contract, or something this repo does not own - a driver, an upstream API, the published
schema. The last in-repo answer is the cause.

Stopping earlier is the failure mode, and it has a signature: you stop at the first line that
could be edited to make the symptom disappear. That line is reachable, the edit is small, and
nothing about it answers why the value arrived wrong.

Each link in the chain is either read or executed, and they are not the same claim. "This
function is called with a null cursor" is observed when a log or a test shows it, and inferred
when it follows from code you read - which is defeated by any caller you did not find. Carry the
distinction; the last link especially, because that one becomes the Root cause.

### 4d. Test the candidate cause

Two questions settle it:

- **If this were fixed, what else stays broken?** Take the other callers of the production site
  from 4b. If any of them still reproduces the defect, the candidate is a symptom.
- **What had to already be true for this to happen?** A missing validation, an unenforced
  invariant, a shape the contract permits and the code cannot handle - the cause is there, not
  at the point that crashed.

Both questions are **predictions** until something runs. Answer them, then say which kind each
answer is: a caller you exercised and watched fail is evidence; a caller you read and believe
would fail is a prediction, and the spec labels it as one. "Also affects the incremental path"
is a different claim from "also affects the incremental path, verified by <test>", and only the
second is a reason for the implementer to skip checking.

"Ruled out" is the strongest sentence in this step and the one most often unearned. A branch is
ruled out when you examined it and it cannot produce the behaviour. A branch that merely looked
unrelated was not ruled out - it was not investigated, and the spec says that instead.

Same-shape siblings are a scope decision, not a free extension. Fix the cause, name the siblings
in the spec, and put them under **Out of scope** against the issue that will cover them.

### 4e. When the symptom is the only reachable fix

Sometimes the cause genuinely sits outside what this repo can change - a driver bug, an upstream
API, a contract the engine consumes and does not own. A symptom-level fix is legitimate there,
and legitimate **only when it is stated as one**: name the real cause, say why it is out of
reach, describe the containment as containment, and open an issue against whatever owns the
cause. The same fix with that paragraph missing is a workaround, which `coding-principles`
forbids.

"Out of reach" is itself a claim about a system you are not looking at, so evidence it: the
driver version and the line in its source you read, the upstream issue number, the clause in
the published contract. `The driver does not support it` with no version and no link is an
assumption, and it is precisely the assumption that quietly licenses the workaround - if it is
wrong, the reachable fix was there the whole time and nobody looked again.

## Step 5 - build the question list, then remove every question you can answer yourself

The user's time is the scarce resource. A question you could have answered from the code or
from settled industry practice is a question you should not have asked.

### 5a. Draft the open questions

From what `gh issue view` returned **and what Step 4 found**, list every decision left open.
This is the draft frontier, not the interview - nothing is put to the user yet.

Draft it against the cause, not the report. The trace usually deletes questions the issue
implied and adds ones it never raised: how far the fix reaches, what the invariant should be,
which of the siblings from 4d come with it.

### 5b. Answer from the code - dispatch Explore in parallel, wait for all of them

Use the **`Explore`** agent for code discovery - one per question, every one dispatched in a
single message so they run concurrently. Give each a specific question and a search breadth:
`medium` for a question about one module, `very thorough` when the answer could live in
several places or under naming you have to guess at.

What to send it: how the surrounding code already does this, what the contract or schema
permits, what callers exist, what a prior decision in an adjacent module already committed
to.

What not to send it: `Explore` locates code, it does not review or audit it. A question that
needs a verdict on whether the existing code is *correct*, or a judgement between two designs
it can only describe, is not answerable by discovery - carry it to 5c or the user. Treating a
located pattern as an endorsed one is how a bug becomes a convention.

Discovery runs against the default branch, not a feature branch - there is no worktree at
shaping time. If a question can only be answered by code that does not exist yet, it is not a
discovery question; it goes to the user.

Dispatch them all at once and **wait for every one to report before asking the user
anything.** This deliberately overrides the grilling skill's default, which says to ask the
rest of the frontier while explorations run. Do not follow that here: an answer arriving
from the code mid-interview means the earlier question was wasted, and a user who has
answered a question the repo already answered stops trusting the interview.

Strike every question an `Explore` answered, and keep the answer - it becomes a (code)
decision in the spec, and the module it names is what makes that decision checkable.

### 5c. Answer from industry practice

For each question still open, ask: *what is the data integration industry best practice on
this?* Where the answer is clear and uncontested - the standard approach to incremental
cursors, idempotent writes, dead-lettering, backoff, schema evolution - take it and strike
the question.

Do not strike a question when the practice is genuinely contested, when this repo has
deliberately diverged from it, or when the issue's constraints make the standard answer a
poor fit. Those go to the user.

### 5d. Grill on what is left

Invoke the `mattpocock-skills:grilling` skill with only the residue: the questions that have
no obvious, clear answer from either the code or industry practice. Give it the struck
questions and their answers as already-settled branches of the design tree, so it does not
re-open them and its first round starts from what is genuinely undecided.

If nothing survives 5b and 5c, say so and skip the interview - the shape was already
determined; go straight to Step 6.

Grilling ends when the frontier is empty and the user confirms shared understanding. It
writes nothing; the writing below is yours.

## Step 6 - list every hand-maintained surface the design adds

A hand-maintained surface is anything the settled design adds or extends that a person must
keep in step with another source by editing it: a list of paths, names, ids, versions or enum
members that some other source owns or could produce; a mapping table between two
vocabularies; a value copied from its owner; prose restating a fact the code or the contract
states; a phrase list or pattern a check matches. The test is one question - **when the source
it mirrors changes, does this change with it without anyone editing it?** If not, it is
hand-maintained. That holds when a drift test pins it too: the test makes the divergence loud,
it does not remove the edit somebody still has to make.

Walk every Decision and every Acceptance criterion. For each surface, first try to design it
out - read, generate or compute the same facts from their owner. A derived alternative that
works replaces the decision, and the surface is gone. List only what survives, and for each
one state:

- **What it mirrors** - the source that owns the facts it holds.
- **What happens on drift** - what fails, and where, when the two diverge. When nothing fails,
  write "nothing fails"; it is the answer the user most needs to see.
- **Why it is not derived** - the concrete obstacle, naming what the owner lacks. "Simpler" and
  "smaller diff" are not obstacles.

## Step 7 - post the spec to the issue

Write the spec to a temporary file, first line exactly `<!-- analitiq-spec -->`:

```
<!-- analitiq-spec -->
# <issue title> (#<n>)

## Problem
<the problem statement, from the issue - not restated from the interview>

## Why this is worth doing
<Step 2's answers: the concrete wrong outcome if this is never done, whether it can happen on
the default branch (observed or predicted), how the change alters that outcome, and what, if
anything, already owns part of the risk. Every entry carries its source.>

## Root cause
<Opens with **Observed:** - the failing test, log line, or reproduction from 4a that this trace
is anchored to - or **Observed: nothing; this trace is a hypothesis from reading the code.**
That line is not optional and not softened; a reader decides how much to trust everything below
it from that one sentence.

Then the mechanism, and the module where the wrong decision is actually made - not where it was
observed. The evidence that it is the cause: the other callers from 4d that it also fixes, each
marked verified or predicted. What was examined and ruled out, so the next reader does not
re-walk it - and, separately, what was not investigated. Those are different lists and must not
be merged.

If the fix is deliberately at the symptom, the 4e paragraph goes here: the real cause, the
evidence that it is out of reach, and where the issue against its owner was opened.

For an issue that is not a defect report, this section reads "Not a defect report." - keep the
heading, so a reader can tell the trace was considered rather than skipped.>

## Decisions
<one entry per settled decision: what was decided, the reason it beat the alternative, and
where the answer came from - (code), (practice), or (asked). Anything not marked (asked) was
settled without the user seeing it.>

## Hand-maintained surfaces
<"None." - or one entry per surface from Step 6: what it mirrors, what happens on drift, why it
is not derived. A spec without this section has not been through Step 6, and
`alq-issue-tackle` refuses it.>

## Out of scope
<what was raised and deliberately excluded>

## Acceptance
<what has to be true for the diff to satisfy this spec - what a reviewer checks against. For a
defect, at least one criterion names the Root cause module and one names a caller **other than
the one in the issue**, so a diff that only silences the reported symptom fails the spec
instead of passing it.>
```

New spec:

```
gh issue comment <n> --body-file <file>
```

Re-shape, reusing the id from Step 1 so the issue keeps exactly one spec:

```
gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> -F body=@<file>
```

Record the reason a decision beat its alternative, not just the decision. A decision without
its reason cannot be re-evaluated when the constraint that drove it changes.

Mark the source of every decision. A call made on (code) or (practice) grounds was never put
to the user, and a reader who cannot tell the difference will treat a model's judgement as
the user's. Name the module or the practice that settled it, so it can be checked.

A (code) decision is the one that goes stale: it was true of the default branch on the day it
was written, and the implementer may pick this issue up weeks later. Name the module so the
implementer can re-check it rather than trust it.

Assert nothing this run did not establish. Everything above - the tags, the named modules, the
Observed line, verified against predicted, examined against not investigated - is one rule:
a reader must be able to tell what was checked from what was reasoned. A spec is read weeks
later by someone who cannot rerun the shaping, so an unmarked guess is indistinguishable from
a measurement and gets spent like one. Hedging costs a clause; a confident wrong sentence costs
the implementation built on it.

