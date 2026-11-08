---
# planner's spec_facts.ts sets this block once the spec passes planner's checks; leave it as it is.
codeworks:
  v: 1
  kind: "[set by planner]"
  root_cause:
    observed: "[set by planner]"
---
{CORE_TEMPLATE}

<!--
  Tiers (root ADR-0012). The intent tier is the human's: the `codeworks` block above, `## Clarifications`,
  `## User Scenarios & Testing`, `## Success Criteria`, `## Non-goals`, `## Why this is worth doing` and the
  folder's `adr-rulings.json`; it changes by a spec PR, never on a story branch. The other sections, the other files
  of the folder, the story's own block of `tasks.md` and the decision records are the design tier, which a
  story changes in `spec:` commits. Every acceptance scenario, edge case and success criterion opens with a
  bold id that is never renumbered or reused: `**US<k>-S<n>**` on scenario n of user story k, `**EC-<nnn>**`
  on an edge case, `**SC-<nnn>**` on a success criterion. A test carries the id of the scenario it checks in
  its name.
-->

## Non-goals

<!--
  ACTION REQUIRED: One line per thing this change will not do that a reader might expect it to, with the
  reason. When there is none, the one line `None.` Keep the heading either way. A story never adds here.
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
  `Not a defect report.` and nothing else. Keep the heading either way.

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
