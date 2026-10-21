# Finding format

Every detector agent emits this shape, and both skills render it unchanged. One
copy, read by all callers.

## The bar a finding must clear

- **Verified, not pattern-matched.** Read enough surrounding code to confirm the
  suspect is real. A swallowed error may be re-raised two frames up; a duplicate
  may serve a genuinely different contract.
- **A concrete future cost.** Drift, split-brain, a masked bug, untestable state,
  an outage that will be hard to debug. Style preference and bikeshedding are not
  findings and are not reported as low-severity ones either.
- **A named correct fix.** "This is wrong" without what replaces it is a
  complaint. Where the correct fix needs a change the current layer cannot make —
  a missing API field, a contract that must change — say that, and never propose
  a heuristic that papers over it.

A suspect that fails any of these is dropped silently. Do not report near-misses.

## Severity

| | |
|---|---|
| `HIGH` | Silently produces a wrong result, loses data, leaks a secret or internal detail, or splits a contract in two. |
| `MEDIUM` | Will drift or mask a failure as the code around it changes; costs real debugging time when it does. |
| `LOW` | Certain to be paid for later, but bounded and local — dead code, a flag forking one function, an unused option. |

Order by blast radius: how much breaks, how silently, and how hard it is to find.

## Line-level finding

```
[HIGH|MEDIUM|LOW] repo/path/to/file.py:123 — <category>
  What: one sentence naming the pattern.
  Why it bites later: the concrete failure or drift it causes.
  Correct fix: fix at source / reuse <named existing implementation> / delete.
```

## Mechanism-level finding

Use this whenever the subject is a mechanism rather than a line — a shim with
several call sites, a function holding a pile of special cases. Naming one line
of it hides the size of the problem, which is the finding.

```
[HIGH|MEDIUM|LOW] repo/path/to/file.py (function_or_module) — <category>
  What: the mechanism, and what it now holds.
  Where else: every other site hitting the same mechanism.
  Why it bites later: the concrete failure or drift it causes.
  Correct fix: the one-shot rewrite or reuse that replaces it.
```

## Grouping

Findings sharing one root cause are one entry, not several. Call sites papering
over the same missing field are one fix with a list of sites — never one entry
per site.

## Clean-scope statement

Every agent closes with one, whether or not it found anything:

```
Audited: <unit> — <what was actually read: file count, and what was skipped and why>.
Clean: <the checks in this agent's remit that were applied and produced nothing>.
```

An empty findings list without this is not a clean result; it is an agent that
may have failed. A skill treats it as unaudited and re-dispatches.
