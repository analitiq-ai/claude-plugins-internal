---
# planner's spec_facts.ts sets this block once the spec passes planner's checks; leave it as it is.
codeworks:
  v: 1
  kind: "[set by planner]"
  root_cause:
    observed: "[set by planner]"
---
<!-- Keep every `## ` heading: a story branch may not add, remove or rename one (root ADR-0012 d1). -->
{CORE_TEMPLATE}

## Non-goals

<!--
  ACTION REQUIRED: One line per thing this change will not do that a reader might expect it to. When there is
  none, the one line `None.`
-->

- [what is out, and why]

## Why this is worth doing

<!--
  ACTION REQUIRED: Under each heading, copy that question's `Answer:` and `Source:` lines from the premise
  report, as the report gives them. Do not answer the questions again here: the report is what the user
  picked on.
-->

### harm
Answer: [the report's answer]
Source: [the report's source]

### reachable
Answer: [the report's answer]
Source: [the report's source]

### change-alters
Answer: [the report's answer]
Source: [the report's source]

### owner
Answer: [the report's answer]
Source: [the report's source]

### inherited
Answer: [the report's answer]
Source: [the report's source]

### needs-spec
Answer: [the report's answer]
Source: [the report's source]

## Root cause

<!--
  ACTION REQUIRED: For an issue that reports no wrong behaviour, this section is the one line
  `Not a defect report.` and nothing else.

  For an issue that reports wrong behaviour, read the code before writing anything here, then:

  - Open with the `Observed:` line. It names the failing test, the log line or the reproduction the trace is
    anchored to. When nothing was seen, it reads
    `Observed: nothing; this trace is a hypothesis from reading the code.` Write that sentence as it is. A
    reader decides how far to trust the rest from this one line.
  - Then the mechanism, and the module where the wrong decision is made, which is seldom where it was seen.
  - The other callers that reach that module, each marked verified (it was run and seen) or predicted (it was
    read).
  - What was examined and ruled out, and, as a separate list, what was not investigated. A branch that only
    looked unrelated was not ruled out.
-->

Observed: [the failing test, log line or reproduction this trace is anchored to]

[The mechanism, and the module where the wrong decision is made]

- **Other callers**: [caller] (verified | predicted)
- **Examined and ruled out**: [what, and why it cannot produce the behaviour]
- **Not investigated**: [what]
