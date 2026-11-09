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

## Headings, ids and non-goals

- Every `## ` heading of the template stays, a section that does not apply too, holding the one line its
  comment gives for that case or `None.` where the comment gives none; this overrides "remove it entirely"
  under Section Requirements above for `## ` sections, a `### ` section that does not apply still going.
- The ids are the template's opening note's. Open every acceptance scenario `1. **US<k>-S<n>**: **Given** …`
  (user story k, scenario n), number each kind from 1 in writing order and, when updating a spec, keep every
  id and give a new item the next unused number; a retired line reads `- **EC-003**: retired` or
  `2. **US1-S2**: retired`.
- Write `## Non-goals` as the template directs; every scope exclusion goes there, none under `## Assumptions`,
  the template's Assumptions example notwithstanding.
