## Why this is worth doing

<!--
  ACTION REQUIRED: Copy the answers of the premise report, one bullet per question of the report, each
  followed by its source as the report gives it. Do not answer the questions again here: the report is
  what the user picked on.
-->

- **[question heading]**: [answer] ([source])

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
