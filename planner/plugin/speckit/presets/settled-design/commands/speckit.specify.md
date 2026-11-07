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

## Ids and non-goals

- Open every acceptance scenario with its id, `1. **US<k>-S<n>**: **Given** …` (user story k, scenario n),
  every edge case with `**EC-<nnn>**` and every success criterion with `**SC-<nnn>**`, numbered from 1 in
  writing order. When updating a spec, keep every id as it is, give a new item the next unused number and
  never reuse a removed item's number.
- Write `## Non-goals` as the template directs: one line per thing the change will not do that a reader
  might expect, with the reason, or the one line `None.`
