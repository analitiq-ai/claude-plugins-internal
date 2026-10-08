---
description: Create or update the feature specification from a natural language feature description.
strategy: append
---

## Premise answers and root cause

The last line of the arguments names a premise report. Read it before writing the spec.

- Under each heading of `## Why this is worth doing`, copy that question's `Answer:` and `Source:` lines from
  the report, as they are written there.
- When the report says `Reports wrong behaviour: yes`, trace the behaviour through the code and write
  `## Root cause` as the spec template directs. When it says `no`, the section is the one line the template
  gives for that case.
