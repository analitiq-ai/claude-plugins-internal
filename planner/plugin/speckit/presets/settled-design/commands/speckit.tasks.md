---
description: Generate an actionable, dependency-ordered tasks.md for the feature based on available design artifacts.
strategy: append
---

## File paths in task lines

> **This section supersedes the file path guidance of the task format.**

planner's ADR check reads the paths of a task from its backticked spans, so write each file a task creates, changes or
deletes as one literal path per backtick span, relative to the repository root: `core/src/adr.ts`, never
`` `core/src/{adr,git}.ts` `` or `` `core/src/*.ts` ``. No glob, no brace group, no `.` or `..` segment; a folder is
not a path, so name each file in it the task touches.
